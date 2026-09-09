// npm run verify [-- M1]   or   M=M1 npm run verify
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const M = process.env.M || process.argv[2] || 'M0';
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
fs.mkdirSync('shots', { recursive: true });

const errors = [];
const browser = await chromium.launch({
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const url = pathToFileURL(path.resolve('index.html')).href + '?test=1';
await page.goto(url);
await page.bringToFront();
await page.waitForTimeout(3000);
const stats = await page.evaluate(() => window.__stats);
await page.screenshot({ path: 'shots/latest.png' });
await browser.close();
fs.copyFileSync('shots/latest.png', `shots/${M}-${hhmm}.png`);

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
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
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
const png = decodePNG(fs.readFileSync('shots/latest.png'));
let nonBlack = 0, magenta = 0; const n = png.w * png.h;
const hist = new Float64Array(256);
for (let i = 0; i < n; i++) {
  const r = png.data[i * png.bpp], g = png.data[i * png.bpp + 1], b = png.data[i * png.bpp + 2];
  if (Math.max(r, g, b) > 12) nonBlack++;
  if (r > 200 && g < 60 && b > 200) magenta++;
  hist[Math.round(0.2126*r + 0.7152*g + 0.0722*b)]++;
}
const nonBlackPct = 100 * nonBlack / n, magentaPct = 100 * magenta / n;
// luminance percentiles: mean of darkest 5 % and brightest 1 %
function tailMean(fromDark, frac){
  let need = n * frac, sum = 0, cnt = 0;
  for (let k = 0; k < 256; k++){ const bin = fromDark ? k : 255 - k; const take = Math.min(hist[bin], need - cnt);
    sum += take * bin; cnt += take; if (cnt >= need) break; }
  return sum / cnt / 255;
}
const dark5 = tailMean(true, 0.05), bright1 = tailMean(false, 0.01);

// ---------- report ----------
console.log('stats:', JSON.stringify(stats));
console.log(`png: ${png.w}x${png.h}  nonBlack=${nonBlackPct.toFixed(1)}%  magenta=${magentaPct.toFixed(3)}%  dark5=${dark5.toFixed(3)}  bright1=${bright1.toFixed(3)}`);
if (errors.length) console.log('console errors:\n  ' + errors.slice(0, 5).join('\n  '));

const fails = [];
if (stats.shaderError) fails.push('shaderError: ' + stats.shaderError.slice(0, 300));
if (!(stats.fps >= 50)) fails.push(`fps ${stats.fps} < 50`);
if (!(nonBlackPct > 40)) fails.push(`nonBlack ${nonBlackPct.toFixed(1)}% <= 40%`);
if (!(magentaPct < 0.1)) fails.push(`magenta ${magentaPct.toFixed(3)}% >= 0.1%`);
if (!(dark5 < 0.03)) fails.push(`dark5 ${dark5.toFixed(3)} >= 0.03 (no true blacks)`);
if (!(bright1 > 0.9)) fails.push(`bright1 ${bright1.toFixed(3)} <= 0.9 (no highlights)`);
if (errors.some(e => /pageerror|SHADER ERROR/.test(e))) fails.push('page/shader errors in console');
if (fails.length) { console.log('VERIFY FAIL\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('VERIFY PASS  -> shots/latest.png');
