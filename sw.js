/* OpenTasks service worker.
 *
 * It does exactly ONE thing: receive files shared to OpenTasks from the Android share sheet
 * (Web Share Target, declared in manifest.webmanifest). GitHub Pages cannot accept a POST, so the
 * share is intercepted here, the files are parked in IndexedDB, and the app is opened with
 * ?share=1 — the page then encrypts and uploads them to the Locker.
 *
 * Nothing is cached: every other request goes straight to the network, so app updates are never
 * stuck behind a stale cache.
 */
const DB = 'otk-share', STORE = 'files';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function park(entries) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      for (const e of entries) st.add(e);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return; // everything else: network
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const ts = Date.now();
      const entries = form.getAll('files')
        .filter((f) => f && typeof f !== 'string')
        .map((f) => ({ file: f, name: f.name, type: f.type, ts }));
      // a shared link or text without a file becomes a small text note in the Locker
      const text = ['title', 'text', 'url'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v.trim()).join('\n');
      if (!entries.length && text) entries.push({ text, ts });
      if (entries.length) await park(entries);
    } catch (e) { /* the app still opens; nothing was parked */ }
    return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
  })());
});
