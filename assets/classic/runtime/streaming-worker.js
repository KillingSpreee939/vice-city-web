import {readArchiveBytes,fetchArchiveRange} from './transport.js';

const CHUNK_SIZE = 256 * 1024;
const DB_NAME = 'vice-assets-cache-v2';
const STORE_NAME = 'chunks';
let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function getCachedRange(url, start, end) {
  const db = await getDB();
  if (!db) return null;
  const firstChunk = Math.floor(start / CHUNK_SIZE);
  const lastChunk = Math.floor(end / CHUNK_SIZE);
  const totalChunks = lastChunk - firstChunk + 1;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const chunks = new Array(totalChunks);
      let loaded = 0;
      let missing = false;

      for (let i = firstChunk; i <= lastChunk; i++) {
        const arrayIdx = i - firstChunk;
        const req = store.get(`${url}#${i}`);
        req.onsuccess = () => {
          if (missing) return;
          if (!req.result) {
            missing = true;
            resolve(null);
            return;
          }
          chunks[arrayIdx] = req.result;
          loaded++;
          if (loaded === totalChunks) {
            let totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
            const combined = new Uint8Array(totalBytes);
            let offset = 0;
            for (const c of chunks) {
              combined.set(c, offset);
              offset += c.length;
            }
            const from = start - firstChunk * CHUNK_SIZE;
            const to = from + (end - start + 1);
            resolve(combined.slice(from, to));
          }
        };
        req.onerror = () => {
          missing = true;
          resolve(null);
        };
      }
    } catch {
      resolve(null);
    }
  });
}

async function saveCachedRange(url, start, bytes) {
  const db = await getDB();
  if (!db || !bytes || !bytes.length) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const firstChunk = Math.floor(start / CHUNK_SIZE);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunkIdx = firstChunk + Math.floor(offset / CHUNK_SIZE);
      const part = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
      store.put(part, `${url}#${chunkIdx}`);
    }
  } catch {}
}

const archives = new Map();
const verifiedFiles = new Map();
postMessage('ready');

onmessage = async ({data:request}) => {
  if (request.type === 'mount') {
    archives.set(request.url, request.transport);
    if (request.integrity) verifiedFiles.set(request.url,{...request.integrity,pending:null});
    return;
  }
  const state = request.sab && new Int32Array(request.sab, 0, 2);
  try {
    // 1. Fast local SSD/IndexedDB lookup (takes 1-2ms on hit!)
    let bytes = await getCachedRange(request.url, request.start, request.end);

    if (bytes && bytes.length === request.end - request.start + 1) {
      if (state) {
        new Uint8Array(request.sab, 8).set(bytes);
        state[1] = bytes.length;
        Atomics.store(state, 0, 1);
      } else {
        postMessage({id:request.id, bytes}, [bytes.buffer]);
      }
      return;
    }

    // 2. Cache miss: fetch from network
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

    // 3. Immediately reply to engine
    if (state) {
      new Uint8Array(request.sab, 8).set(bytes);
      state[1] = bytes.length;
      Atomics.store(state, 0, 1);
    } else {
      postMessage({id:request.id, bytes}, [bytes.buffer]);
    }

    // 4. Save to IndexedDB in the background so future hits are 1ms
    void saveCachedRange(request.url, request.start, bytes);
  } catch (error) {
    if (state) {state[1] = 0;Atomics.store(state, 0, 2);}
    else postMessage({id:request.id, error:error.message});
  }
};
