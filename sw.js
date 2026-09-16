// Cache layer for the deployed site only — index.html registers this on https alone, so localhost
// development and verify never see it, and file:// (the offline bundle) has no service workers.
//
//   page      network first, cache fallback: a deploy must always win over the cache
//   three.js  cache first: the importmap pins one exact version under one URL
//   audio     cache first with Range slicing: <audio> asks for byte ranges, and the Cache API
//             refuses to store partial (206) responses — so the first play streams straight
//             through untouched while one full copy is fetched in the background for next time
//   manifest  network first: a stale manifest would list tracks that are not there any more
const VER = 'nightcity-v1';
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VER).then(c => c.addAll(['./', CDN]).catch(() => {})));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// Serve a Range request out of a cached full body: Safari will not accept a 200 where it asked
// for bytes, so the slice has to be a real 206 with a Content-Range.
async function sliced(req, res){
  const range = req.headers.get('range');
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  if (!m) return new Response(buf, { status: 200, headers: res.headers });
  const start = +m[1], end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
    'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
  } });
}

self.addEventListener('fetch', e => {
  const u = e.request.url;
  if (e.request.method !== 'GET') return;

  const heavy = u === CDN || (u.includes('/music/') && /\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/i.test(u));
  if (heavy){
    e.respondWith((async () => {
      const c = await caches.open(VER);
      const hit = await c.match(u, { ignoreSearch: true, ignoreVary: true });
      if (hit) return sliced(e.request, hit);
      // Not cached yet: answer the stream untouched (first play must not wait for a full download),
      // and pull one complete copy in the background so the next visit costs nothing.
      e.waitUntil((async () => {
        try { const full = await fetch(u); if (full.status === 200) await c.put(u, full); } catch {}
      })());
      return fetch(e.request);
    })());
    return;
  }

  if (e.request.mode === 'navigate' || /\/(index\.html)?(\?|$)/.test(u)){
    e.respondWith((async () => {
      const c = await caches.open(VER);
      try { const net = await fetch(e.request); if (net.ok) c.put('./', net.clone()); return net; }
      catch { return (await c.match('./')) || Response.error(); }
    })());
  }
});
