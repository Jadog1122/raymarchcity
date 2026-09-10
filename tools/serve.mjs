// Dev server with HTTP Range support. python3 -m http.server has none, so the browser cannot seek
// inside an audio file that is not fully buffered yet.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const ROOT = process.cwd(), PORT = +(process.argv[2] || 5173);
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json',
  '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.wav':'audio/wav', '.flac':'audio/flac', '.ogg':'audio/ogg',
  '.png':'image/png', '.jpg':'image/jpeg', '.webm':'video/webm', '.lrc':'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(url.parse(req.url).pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let st; try { st = fs.statSync(p); } catch { res.writeHead(404).end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
  const type = TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : st.size - 1;
    if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(p, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    fs.createReadStream(p).pipe(res);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT} (Range supported)`));
