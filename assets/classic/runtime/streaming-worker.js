import {readArchiveBytes,fetchArchiveRange} from './transport.js';

const CHUNK_SIZE = 256 * 1024;
const archives = new Map();
const verifiedFiles = new Map();
const workerCache = new Map();
const inFlight = new Map();
let cachedBytesCount = 0;
const MAX_WORKER_CACHE = 384 * 1024 * 1024; // 384 MB in-memory LRU cache in worker

postMessage('ready');

const chunkKey = (url, index) => `${url}#${index}`;

function storeChunk(key, part) {
  if (workerCache.has(key)) {
    workerCache.delete(key);
  }
  workerCache.set(key, part);
  cachedBytesCount += part.length;
  while (cachedBytesCount > MAX_WORKER_CACHE && workerCache.size > 1) {
    const oldestKey = workerCache.keys().next().value;
    cachedBytesCount -= workerCache.get(oldestKey).length;
    workerCache.delete(oldestKey);
  }
}

function assembleRangeFromCache(url, start, end) {
  const firstChunk = Math.floor(start / CHUNK_SIZE);
  const lastChunk = Math.floor(end / CHUNK_SIZE);
  for (let i = firstChunk; i <= lastChunk; i++) {
    if (!workerCache.has(chunkKey(url, i))) return null;
  }
  const totalLen = end - start + 1;
  const assembled = new Uint8Array(totalLen);
  let written = 0;
  for (let i = firstChunk; i <= lastChunk; i++) {
    const chunkData = workerCache.get(chunkKey(url, i));
    const chunkStart = i * CHUNK_SIZE;
    const from = Math.max(start, chunkStart) - chunkStart;
    const to = Math.min(end + 1, chunkStart + chunkData.length) - chunkStart;
    assembled.set(chunkData.subarray(from, to), written);
    written += to - from;
  }
  return assembled;
}

onmessage = async ({data:request}) => {
  if (request.type === 'mount') {
    archives.set(request.url, request.transport);
    if (request.integrity) verifiedFiles.set(request.url,{...request.integrity,pending:null});
    return;
  }
  const state = request.sab && new Int32Array(request.sab, 0, 2);

  try {
    // 1. Check if all required chunks are already cached in worker memory
    let bytes = assembleRangeFromCache(request.url, request.start, request.end);

    if (!bytes || bytes.byteLength === 0) {
      // 2. Dedup in-flight network requests
      const requestKey = `${request.url}#${request.start}-${request.end}`;
      let fetchPromise = inFlight.get(requestKey);

      if (!fetchPromise) {
        const verified = verifiedFiles.get(request.url);
        if (verified) {
          verified.pending ??= fetchArchiveRange(request.url,0,verified.size-1,verified.size).then(async data => {
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',data));
            if (Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('') !== verified.sha256) throw new Error('Texture SHA256 mismatch');
            return data;
          });
          fetchPromise = verified.pending.then(data => data.slice(request.start,Math.min(request.end+1,verified.size)));
        } else {
          fetchPromise = readArchiveBytes({...request, transport:archives.get(request.url)});
        }
        inFlight.set(requestKey, fetchPromise);
      }

      try {
        bytes = await fetchPromise;
      } finally {
        inFlight.delete(requestKey);
      }

      // 3. Store individual 256 KB chunks into workerCache so any sub-chunk or overlap hits instantly
      if (bytes && bytes.length > 0) {
        const firstChunk = Math.floor(request.start / CHUNK_SIZE);
        for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
          const cIdx = firstChunk + Math.floor(offset / CHUNK_SIZE);
          const part = bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
          storeChunk(chunkKey(request.url, cIdx), part);
        }
      }
    }

    if (state) {
      new Uint8Array(request.sab, 8).set(bytes);
      state[1] = bytes.length;
      Atomics.store(state, 0, 1);
    } else {
      // Transfer a separate slice so workerCache retains valid, intact data
      const transferBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      postMessage({id:request.id, bytes: new Uint8Array(transferBuffer)}, [transferBuffer]);
    }
  } catch (error) {
    if (state) {
      state[1] = 0;
      Atomics.store(state, 0, 2);
    } else {
      postMessage({id:request.id, error:error.message});
    }
  }
};
