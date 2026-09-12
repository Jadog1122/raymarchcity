// tools/live.mjs <url> [query]  — open the DEPLOYED page the way a visitor does and check it renders.
// Default query is ?test=1 (deterministic render); pass "" for the real visitor path, which is the
// only one that exercises the player — loadLibrary() lives inside `if (!TEST)`. Run both.
// Load the deployed page exactly as a visitor would, and check it actually renders.
import { chromium } from 'playwright';
import zlib from 'zlib';
import fs from 'fs';
import os from 'os';
import path from 'path';


// ---------- minimal PNG decode (8-bit RGB/RGBA, non-interlaced) ----------
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, colorType = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, prv = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[prv + i] : 0;
      const c = (y > 0 && i >= bpp) ? out[prv + i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                  v = x + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); break; }
        default: v = x;
      }
      out[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

const S = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));  // the shot is scratch, never the repo
const URL_ = process.argv[2];
const b = await chromium.launch({ headless: false });
const ctx = await b.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [], bad = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
p.on('response', r => { if (!r.ok() && r.status() !== 304) bad.push(r.status() + ' ' + r.url().slice(0, 90)); });

await p.goto(URL_ + (process.argv[3] ?? '?test=1'), { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => window.__stats, null, { timeout: 40000 }).catch(() => {});
await p.waitForTimeout(5000);
const st = await p.evaluate(() => ({ err: window.__stats ? window.__stats.shaderError : 'no __stats',
  fps: window.__stats && window.__stats.fps, lib: !!window.__lib,
  tracks: document.querySelectorAll('.track').length,
  hint: (document.getElementById('pickerHint') || {}).textContent }));
const shot = path.join(S, 'live.png');
await p.screenshot({ path: shot });
const g = decodePNG(fs.readFileSync(shot));
let mag = 0, nb = 0, sum = 0; const n = g.w * g.h, d = g.data, st_ = g.bpp;
for (let i = 0; i < n; i++) {
  const r = d[i*st_]/255, gr = d[i*st_+1]/255, bl = d[i*st_+2]/255;
  if (r > 0.9 && gr < 0.1 && bl > 0.9) mag++;
  const l = 0.2126*r + 0.7152*gr + 0.0722*bl;
  sum += l; if (l > 0.02) nb++;
}
console.log(JSON.stringify({ url: URL_, size: g.w + 'x' + g.h, shaderError: st.err || '', fps: st.fps,
  playerReady: st.lib, tracksListed: st.tracks, hint: st.hint,
  magentaPct: +(100*mag/n).toFixed(3), nonBlackPct: +(100*nb/n).toFixed(1), meanLum: +(sum/n).toFixed(4),
  errors: errs.slice(0, 4), failedRequests: bad.slice(0, 6) }, null, 2));
await b.close();
