import {readArchiveBytes,fetchArchiveRange} from './transport.js';

const archives = new Map();
const verifiedFiles = new Map();
const workerCache = new Map();
let cachedBytesCount = 0;
const MAX_WORKER_CACHE = 256 * 1024 * 1024; // 256 MB in-memory LRU cache in worker

postMessage('ready');

onmessage = async ({data:request}) => {
  if (request.type === 'mount') {
    archives.set(request.url, request.transport);
    if (request.integrity) verifiedFiles.set(request.url,{...request.integrity,pending:null});
    return;
  }
  const state = request.sab && new Int32Array(request.sab, 0, 2);
  const cacheKey = `${request.url}#${request.start}-${request.end}`;

  try {
    let bytes = workerCache.get(cacheKey);

    if (!bytes) {
      const verified = verifiedFiles.get(request.url);
      if (verified) {
        verified.pending ??= fetchArchiveRange(request.url,0,verified.size-1,verified.size).then(async data => {
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',data));
          if (Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('') !== verified.sha256) throw new Error('Texture SHA256 mismatch');
          return data;
        });
        bytes = (await verified.pending).slice(request.start,Math.min(request.end+1,verified.size));
      } else {
        bytes = await readArchiveBytes({...request, transport:archives.get(request.url)});
      }

      if (bytes && bytes.length > 0 && bytes.length < 16 * 1024 * 1024) {
        workerCache.set(cacheKey, bytes);
        cachedBytesCount += bytes.length;
        while (cachedBytesCount > MAX_WORKER_CACHE && workerCache.size > 1) {
          const oldestKey = workerCache.keys().next().value;
          cachedBytesCount -= workerCache.get(oldestKey).length;
          workerCache.delete(oldestKey);
        }
      }
    }

    if (state) {
      new Uint8Array(request.sab, 8).set(bytes);
      state[1] = bytes.length;
      Atomics.store(state, 0, 1);
    } else {
      postMessage({id:request.id, bytes}, [bytes.buffer]);
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
