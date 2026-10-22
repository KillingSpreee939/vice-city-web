const CHUNK_SIZE = 256 * 1024;

export function fetchArchiveRangeSync(url, start, end, size, transport, sha256) {
  const request = new XMLHttpRequest();
  end = Math.min(end, size - 1);
  request.open('GET', url, false);
  request.overrideMimeType('text/plain; charset=x-user-defined');
  request.setRequestHeader('Range', `bytes=${start}-${end}`);
  request.send();
  if (request.status !== 206) throw new Error(`Archive HTTP ${request.status}: ${url}`);
  if (request.getResponseHeader('Content-Range') !== `bytes ${start}-${end}/${size}`) throw new Error(`Archive Content-Range mismatch: ${url}`);
  if (request.responseText.length !== end - start + 1) throw new Error(`Archive truncated range: ${url}`);
  const bytes = Uint8Array.from(request.responseText, character => character.charCodeAt(0) & 255);
  if (transport) for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = transport.chunks[(start + offset) / CHUNK_SIZE];
    const part = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
    if (part.length !== chunk.size || sha256(part) !== chunk.sha256) throw new Error('Transport decoded SHA256 mismatch');
  }
  return bytes;
}

export async function fetchArchiveRange(url, start, end, size, {signal, attempts = 3} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once:true});
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      signal?.throwIfAborted();
      const response = await fetch(url, {headers:{Range:`bytes=${start}-${end}`}, signal:controller.signal});
      if (response.status !== 206) {
        await response.body?.cancel();
        const error = new Error(`Archive HTTP ${response.status}: ${url}`);
        error.retryable = [408,429,500,502,503,504].includes(response.status);
        throw error;
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      if (!range || Number(range[1]) !== start || Number(range[2]) !== Math.min(end, size - 1) || Number(range[3]) !== size) {
        await response.body?.cancel();
        throw new Error(`Archive Content-Range mismatch: ${url}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== Math.min(end, size - 1) - start + 1) throw new Error(`Archive truncated range: ${url}`);
      return bytes;
    } catch (error) {
      if (signal?.aborted || attempt === attempts - 1 || !(error.retryable || error instanceof TypeError || error.name === 'AbortError')) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    } finally {clearTimeout(deadline);signal?.removeEventListener('abort', abort);}
  }
}

export function validateTransportIndex(index, base) {
  if (index.format !== 'vice-native-transport/1' || index.codec !== 'gzip' || index.chunkBytes !== CHUNK_SIZE || !Array.isArray(index.archives)) throw new Error('Invalid archive transport index');
  const hashes = /^[a-f0-9]{64}$/;
  const archives = new Map();
  for (const archive of index.archives) {
    if (!/^[\w-]+(?:\/[\w.-]+)+$/.test(archive.path) || archive.path.split('/').includes('..') || !hashes.test(archive.sha256) || !Number.isSafeInteger(archive.size) || archive.size <= 0 || archives.has(archive.path)) throw new Error('Invalid transport archive');
    if (!Array.isArray(archive.packs) || !archive.packs.length || !Array.isArray(archive.chunks) || archive.chunks.length !== Math.ceil(archive.size / CHUNK_SIZE)) throw new Error('Invalid transport coverage');
    const packs = archive.packs.map(pack => {
      if (!hashes.test(pack.sha256) || pack.path !== pack.sha256 + '.bin' || !Number.isSafeInteger(pack.size) || pack.size <= 0 || pack.size > 64 * 1024 * 1024) throw new Error('Invalid transport pack');
      return {...pack, url:new URL(pack.path, base).href};
    });
    const ends = packs.map(() => 0);
    let previousPack = 0;
    archive.chunks.forEach((chunk, i) => {
      if (!Number.isInteger(chunk.pack) || chunk.pack < previousPack || chunk.pack > previousPack + 1 || !packs[chunk.pack] || !Number.isSafeInteger(chunk.offset) || chunk.offset !== ends[chunk.pack] || !Number.isSafeInteger(chunk.length) || chunk.length <= 0 || chunk.length > CHUNK_SIZE + 1024 || chunk.offset + chunk.length > packs[chunk.pack].size || chunk.size !== Math.min(CHUNK_SIZE, archive.size - i * CHUNK_SIZE) || !hashes.test(chunk.sha256)) throw new Error('Invalid transport chunk');
      ends[chunk.pack] += chunk.length;previousPack = chunk.pack;
    });
    if (ends.some((end,i) => end !== packs[i].size)) throw new Error('Incomplete transport pack');
    archives.set(archive.path, {...archive,packs});
  }
  return archives;
}

async function verifyChunk(bytes, chunk) {
  if (bytes.length !== chunk.size) throw new Error('Transport decoded length mismatch');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2,'0')).join('');
  if (hash !== chunk.sha256) throw new Error('Transport decoded SHA256 mismatch');
}

async function decodeChunk(bytes, chunk) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const output = new Uint8Array(chunk.size);
  let offset = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      if (offset + value.length > output.length) throw new Error('Transport decoded overflow');
      output.set(value, offset);offset += value.length;
    }
  } catch (error) {await reader.cancel().catch(() => {});throw error;}
  await verifyChunk(output.subarray(0,offset), chunk);
  return output;
}

export async function readArchiveBytes({url, file, start, end, size, transport}) {
  if (file) return new Uint8Array(await file.slice(start,end + 1).arrayBuffer());
  end = Math.min(end, size - 1);
  const first = start / CHUNK_SIZE, last = Math.floor(end / CHUNK_SIZE);
  if (!transport) return fetchArchiveRange(url, start, end, size);
  if (!Number.isInteger(first) || end !== Math.min((last + 1) * CHUNK_SIZE, size) - 1 || transport.size !== size) throw new Error('Unaligned transport read');
  const compressed = new AbortController(), overall = new AbortController();
  const compressedDeadline = setTimeout(() => compressed.abort(), 8000);
  const overallDeadline = setTimeout(() => overall.abort(), 55000);
  try {
    if (typeof DecompressionStream !== 'function') throw new Error('Archive gzip unavailable');
    const output = new Uint8Array(end - start + 1);
    for (let i = first; i <= last;) {
      const begin = transport.chunks[i], pack = transport.packs[begin.pack];
      let until = i;
      while (until < last && transport.chunks[until + 1].pack === begin.pack) until++;
      const tail = transport.chunks[until];
      compressed.signal.throwIfAborted();
      const bytes = await fetchArchiveRange(pack.url, begin.offset, tail.offset + tail.length - 1, pack.size, {signal:compressed.signal, attempts:1});
      for (; i <= until; i++) {
        const chunk = transport.chunks[i];
        compressed.signal.throwIfAborted();
        const decoded = await decodeChunk(bytes.subarray(chunk.offset - begin.offset, chunk.offset - begin.offset + chunk.length), chunk);
        output.set(decoded, (i - first) * CHUNK_SIZE);
      }
    }
    return output;
  } catch {
    // Original bytes remain the compatibility and recovery path; never feed damaged decoded data.
    const bytes = await fetchArchiveRange(url, start, end, size, {signal:overall.signal});
    for (let i = first; i <= last; i++) {
      overall.signal.throwIfAborted();
      await verifyChunk(bytes.subarray((i - first) * CHUNK_SIZE, Math.min((i - first + 1) * CHUNK_SIZE, bytes.length)), transport.chunks[i]);
    }
    return bytes;
  } finally {clearTimeout(compressedDeadline);clearTimeout(overallDeadline);}
}
