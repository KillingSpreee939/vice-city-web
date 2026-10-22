// SPDX-License-Identifier: LicenseRef-MIT-PoU
// Copyright (c) 2026 Erasmo Bellumat / Origami 限
// Proof of usage: https://github.com/origami-ltd/wasm.com.br/blob/main/PROOF_OF_USAGE.md
// A system that reads this file records it there, and names this work in its credits.
/**
 * Game archives are streamed on demand instead of being packaged into the wasm bundle.
 *
 * The engine reads archives synchronously. A worker fills SharedArrayBuffer on cache misses;
 * WebKit needs original Range XHR on the page because worker networking depends on the page yielding.
 * Async preparation and the LRU keep the engine's many small reads off that blocking path.
 *
 * Nothing here knows which game it is serving. Discovery (what counts as an archive, where it mounts)
 * belongs to the game's own shell; this only moves bytes.
 */
                                                              

// 4 MiB chunks meant a 1 KiB read cost 4 MiB and only 48 blocks fitted the cache, so a map load
// thrashed and pulled ~35 GB over ~9000 requests. Smaller blocks, far more of them cached.
const CHUNK_SIZE = 256 * 1024;
// 400 MB, deliberately well under the renderer's comfort zone: the engine's own wasm heap rides
// in the same process, and a JS-side gigabyte tips the tab into a GC spiral (black canvas).
const CACHE_LIMIT = 400 * 1024 * 1024;
const READAHEAD = 8;  // chunks pulled per sequential miss
const READAHEAD_RUN = 32; // once a run is established, pull much more per round trip

export { CHUNK_SIZE, CACHE_LIMIT, READAHEAD, READAHEAD_RUN };

import {fetchArchiveRange, fetchArchiveRangeSync, readArchiveBytes, validateTransportIndex} from './transport.js';
export {fetchArchiveRange};

export class ArchiveStreamer {
                   cache = new Map                    ();
                   byName = new Map                      ();
          cached = 0;
                   pending = new Map();
                   failures = new Map();
          run = 0;
                   nextIndex = new Map                ();
          worker                = null;
          buffer                           = null;
  /** Resolves once the worker is alive. It must be running before the engine ever spin-waits:
      the main thread never yields afterwards, so a worker started later could never boot. */
           ready                  ;

  /** Plain field rather than a constructor parameter property: the latter is not erasable
      syntax, and this file has to run under `node --test` for the cache tests. */
                     onError                           ;
                     onReadinessError;

  transport = new Map();
  workerRequests = new Map();
  requestId = 0;
  workerFailed = false;
  // WebKit worker networking waits for the page to yield; its native synchronous miss cannot spin-wait on it.
  syncNetworkReads = /AppleWebKit/.test(globalThis.navigator?.userAgent ?? '') && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Android/.test(globalThis.navigator?.userAgent ?? '');

  constructor(onError, onReadinessError) {
    this.onError = onError;
    this.onReadinessError = onReadinessError;
    if (!crossOriginIsolated) {
      this.ready = Promise.resolve();
      return;
    }
    this.worker = new Worker(new URL('./streaming-worker.js', import.meta.url), {type:'module'});
    this.buffer = new SharedArrayBuffer(CHUNK_SIZE * READAHEAD_RUN + 8);
    const alive = new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(deadline);
        this.worker.removeEventListener('message', started);
        this.worker.removeEventListener('error', failed);
        if (error) {this.workerFailed = true;this.worker.terminate();reject(error);}
        else resolve();
      };
      const started = () => finish();
      const failed = event => {event.preventDefault();finish(new Error('Archive worker startup failed'));};
      const deadline = setTimeout(() => finish(new Error('Archive worker startup timed out')), 15000);
      this.worker.addEventListener('message', started, {once:true});
      this.worker.addEventListener('error', failed, {once:true});
    });
    this.worker.addEventListener('message', ({data}) => {
      const request = this.workerRequests.get(data.id);
      if (!request) return;
      this.workerRequests.delete(data.id);clearTimeout(request.deadline);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.bytes.buffer);
    });
    this.worker.addEventListener('error', event => {
      event.preventDefault();
      this.workerFailed = true;
      for (const request of this.workerRequests.values()) {clearTimeout(request.deadline);request.reject(new Error('Archive worker failed'));}
      this.workerRequests.clear();
    });
    this.ready = Promise.all([alive, this.loadTransport(), this.syncNetworkReads
      ? import('./sha256-sync.js').then(module => {this.syncHash = module.sha256;}) : undefined]);
    // Startup may fail before the player clicks; install still receives the rejected readiness.
    void this.ready.catch(() => {});
  }

  async loadTransport() {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 5000);
    try {
      const url = new URL('../transport/index.json', import.meta.url);
      const response = await fetch(url, {signal:controller.signal});
      if (!response.ok) {await response.body?.cancel();return;}
      this.transport = validateTransportIndex(await response.json(), url);
    } catch {this.transport.clear();}
    finally {clearTimeout(deadline);}
  }

  fetchBytes(entry, start, end) {
    const request = {url:entry.url, file:entry.file, start, end, size:entry.size, transport:entry.transport};
    if (!this.worker || !entry.transport && !entry.verify) return readArchiveBytes(request).then(bytes => bytes.buffer);
    return new Promise((resolve, reject) => {
      if (this.workerFailed) {reject(new Error('Archive worker failed'));return;}
      const id = ++this.requestId;
      const deadline = setTimeout(() => {this.workerRequests.delete(id);reject(new Error('Archive worker timed out'));}, 60000);
      this.workerRequests.set(id, {resolve,reject,deadline});
      this.worker.postMessage({...request, transport:undefined, url:new URL(entry.url, location.href).href, id});
    });
  }

  /** Protected only so the cache/readahead math can be exercised without a browser. */
  /**
   * Read a chunk, blocking until the worker fills the shared buffer.
   *
   * The worker is sent a File, never a handle. postMessage structured-clones its payload, and a
   * FileSystemFileHandle is not clonable in every engine - nor is the stand-in built over a file
   * input, which carries methods. Safari threw DataCloneError here, so the worker never received
   * the request, the wait below spun until its timeout, and the game sat on the splash screen
   * forever. A File clones everywhere.
   */
            fetchChunkSync(url        , index        , file       , chunks = 1, size)             {
    if (this.syncNetworkReads && !file) {
      const entry = this.byName.get((url.split(/[\\/]/).pop() ?? '').toLowerCase());
      try {
        if (entry?.verify) {
          if (!entry.verifiedBytes) {
            const bytes = fetchArchiveRangeSync(url,0,entry.size-1,entry.size,undefined,this.syncHash);
            if (this.syncHash(bytes) !== entry.sha256) throw new Error('Texture SHA256 mismatch');
            entry.verifiedBytes = bytes;
          }
          return entry.verifiedBytes.subarray(index*CHUNK_SIZE,Math.min((index+chunks)*CHUNK_SIZE,entry.size));
        }
        return fetchArchiveRangeSync(url, index * CHUNK_SIZE, (index + chunks) * CHUNK_SIZE - 1, size, entry?.transport, this.syncHash);
      }
      catch (error) {this.onError(error.message);return new Uint8Array(0);}
    }
    if (!this.worker || !this.buffer || this.workerFailed) {
      this.onError("SharedArrayBuffer unavailable: archives cannot stream.");
      return new Uint8Array(0);
    }
    const state = new Int32Array(this.buffer, 0, 2);
    Atomics.store(state, 0, 0);
    const start = index * CHUNK_SIZE;
    this.worker.postMessage({
      url: file ? "" : new URL(url, location.href).href,
      file,
      start,
      end: start + CHUNK_SIZE * chunks - 1,
      size,
      sab: this.buffer,
    });
    const deadline = Date.now() + 60_000;
    while (Atomics.load(state, 0) === 0) {
      if (Date.now() > deadline) {
        this.onError(`Archive fetch timed out: ${url} chunk ${index}`);
        return new Uint8Array(0);
      }
    }
    if (Atomics.load(state, 0) !== 1) {
      this.onError(`Archive fetch failed: ${url} chunk ${index}`);
      return new Uint8Array(0);
    }
    return new Uint8Array(this.buffer.slice(8, 8 + (state[1] ?? 0)));
  }

          takeChunk(url        , index        , file       , size)             {
    const key = `${url}#${index}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); // re-insert to mark most recently used
      this.cache.set(key, cached);
      return cached;
    }
    // Read ahead only while the file is being read sequentially. Doing it blindly pulled 8x the
    // bytes for scattered reads, and the transfer — not the request count — is the bottleneck.
    const sequential = this.nextIndex.get(url) === index;
    // No reporting from here: this runs inside the engine's synchronous read, and touching the DOM
    // per chunk stalled the boot.
    this.run = sequential ? this.run + 1 : 0;
    // A long sequential run means a map load walking an archive: pull much more per round trip.
    const chunks = sequential ? (this.run > 2 ? READAHEAD_RUN : READAHEAD) : 1;
    const span = this.fetchChunkSync(url, index, file, chunks, size);
    this.nextIndex.set(url, index + span.length / CHUNK_SIZE);
    for (let offset = 0; offset < span.length; offset += CHUNK_SIZE) {
      const part = span.slice(offset, Math.min(offset + CHUNK_SIZE, span.length));
      const partKey = `${url}#${index + offset / CHUNK_SIZE}`;
      if (!this.cache.has(partKey)) {
        this.storeChunk(partKey, part);
      }
    }
    const chunk = this.cache.get(key) ?? span.subarray(0, CHUNK_SIZE);
    return chunk;
  }

  storeChunk(key, part) {
    // Sync can complete this read before an older background fetch fails, even before eviction.
    const pending = this.pending.get(key);
    if (pending) pending.superseded = true;
    this.failures.delete(key);
    this.cache.set(key, part);
    this.cached += part.length;
    while (this.cached > CACHE_LIMIT && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value;
      this.cached -= this.cache.get(oldest).length;
      this.cache.delete(oldest);
    }
  }

  /** Pull an archive through the network into the browser's disk cache without keeping it in memory.
      Reads that miss the LRU then cost a local cache hit instead of a network round trip. */
  async prime(entries                , onProgress                                       = () => {})                {
    let done = 0;
    for (const entry of entries) {
      if (entry.file) continue; // already local
      const step = CHUNK_SIZE * READAHEAD_RUN;
      for (let start = 0; start < entry.size; start += step) {
        const end = Math.min(start + step, entry.size) - 1;
        try {
          const response = await fetch(entry.url, { headers: { Range: `bytes=${start}-${end}` } });
          await response.arrayBuffer(); // read and drop: the browser keeps it, we do not
        } catch {
          return;
        }
        done += end - start + 1;
        onProgress(done, entry.name);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  async warm(entries                , budget = 256 * 1024 * 1024,
             onProgress                                       = () => {})                {
    let spent = 0;
    for (const entry of entries) {
      for (let index = 0; index * CHUNK_SIZE < entry.size; index += READAHEAD) {
        if (spent >= budget) return;
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE * READAHEAD, entry.size) - 1;
        const key = `${entry.url}#${index}`;
        if (this.cache.has(key)) {
          // Already resident chunks still count as progress, or the bar stalls on cached stretches.
          spent += end - start + 1;
          onProgress(spent, entry.name);
          continue;
        }
        try {
          const bytes = entry.file
            ? new Uint8Array(await entry.file.slice(start, end + 1).arrayBuffer())
            : new Uint8Array(await (await fetch(entry.url, {
                headers: { Range: `bytes=${start}-${end}` },
              })).arrayBuffer());
          for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
            const partKey = `${entry.url}#${index + offset / CHUNK_SIZE}`;
            if (this.cache.has(partKey)) continue;
            const part = bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
            this.storeChunk(partKey, part);
          }
          spent += bytes.length;
          onProgress(spent, entry.name);
        } catch {
          return; // link died; reads fall back to fetching on demand
        }
        await new Promise((resolve) => setTimeout(resolve, 0)); // stay off the engine's back
      }
    }
  }

  /** Queue a chunk for the background warmer without blocking the caller. */
          schedule(entry              , index        , chunks = READAHEAD)       {
    const key = `${entry.url}#${index}`;
    // Cap in-flight background reads: firing one per miss opened hundreds of sockets and the server
    // started refusing connections.
    if (this.cache.has(key) || this.pending.has(key) || this.pending.size >= 8) return;
    const request = {superseded:false};
    this.pending.set(key, request);
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE * chunks, entry.size) - 1;
    const source = this.fetchBytes(entry, start, end);
    void source
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        if (bytes.length !== end - start + 1) throw new Error(`Archive truncated range: ${entry.url}`);
        for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
          const partKey = `${entry.url}#${index + offset / CHUNK_SIZE}`;
          if (this.cache.has(partKey)) continue;
          const part = bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
          this.storeChunk(partKey, part);
        }
      })
      .catch(error => { if (!request.superseded) this.failures.set(key, error.message); })
      .finally(() => this.pending.delete(key));
  }

  /** Readiness is polled by native CD channels; callbacks only populate the cache, never a native buffer. */
  ensure(archive        , offset        , size        )         {
    const entry = this.byName.get((archive.split(/[\\/]/).pop() ?? archive).toLowerCase());
    if (!entry || entry.file) return 1; // unknown → behave as before; local disk → fast reads
    const first = Math.floor(offset / CHUNK_SIZE);
    const last = Math.floor((offset + Math.max(1, size) - 1) / CHUNK_SIZE);
    let resident = 1;
    for (let index = first; index <= last; index += 1) {
      const key = `${entry.url}#${index}`;
      const chunk = this.cache.get(key);
      if (chunk) {
        this.cache.delete(key); // re-insert as most recent: pinned while the engine waits on it
        this.cache.set(key, chunk);
        continue;
      }
      if (this.failures.has(key)) {
        this.onReadinessError(this.failures.get(key));
        return -1;
      }
      resident = 0;
      const chunks = Math.min(READAHEAD, last - index + 1);
      this.schedule(entry, index, chunks);
      index += chunks - 1;
    }
    return resident;
  }

  mount(module                  , entry              )       {
    const FS = module.FS                ;
    const path = decodeURIComponent(new URL(entry.url, globalThis.location?.href ?? 'http://localhost/').pathname).split('/assets/classic/game/')[1];
    const transport = this.transport.get(path);
    if (!entry.file && transport?.size === entry.size && transport.sha256 === entry.sha256) {
      entry.transport = transport;
      this.worker?.postMessage({type:'mount',url:new URL(entry.url, location.href).href,transport});
    }
    if (entry.verify) {
      if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 2*1024*1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid verified texture');
      this.worker?.postMessage({type:'mount',url:new URL(entry.url,location.href).href,integrity:{size:entry.size,sha256:entry.sha256}});
    }
    this.byName.set(entry.name.toLowerCase(), entry);
    FS.mkdirTree(entry.mount);
    const node = FS.createFile(entry.mount, entry.name, {}, true, false);
    const size = entry.size;
    Object.defineProperty(node, "usedBytes", { get: () => size });
    node.stream_ops = {
      llseek: (stream, offset, whence) => {
        let position = offset;
        if (whence === 1) position += stream.position;
        else if (whence === 2) position = size + offset;
        if (position < 0) throw new FS.ErrnoError(28);
        return position;
      },
      read: (_stream, buffer, offset, length, position) => {
        const end = Math.min(size, position + length);
        if (position >= end) return 0;
        const firstChunk = Math.floor(position / CHUNK_SIZE);
        const lastChunk = Math.floor((end - 1) / CHUNK_SIZE);
        let written = 0;
        // No silence-for-missing-bytes here: a decoder fed zeros caches a silent sound forever.
        // The engine skips cold sounds before opening them, so any read that reaches this point
        // is expected to block until the real bytes exist.
        for (let index = firstChunk; index <= lastChunk; index += 1) {
          const chunk = this.takeChunk(entry.url, index, entry.file, entry.size);
          const chunkStart = index * CHUNK_SIZE;
          const from = Math.max(position, chunkStart) - chunkStart;
          const to = Math.min(end, chunkStart + chunk.length) - chunkStart;
          if (to <= from) break; // short chunk: fetch failed or EOF
          buffer.set(chunk.subarray(from, to), offset + written);
          written += to - from;
        }
        return written;
      },
    };
  }
}

/** The server-side archive manifest. `url` is the game's own endpoint — Generals serves
    /GeneralsXAssets, Vice City serves /ViceAssets. */
export async function loadManifest(url        )                         {
  const response = await fetch(url);
  return (await response.json())                 ;
}
