// npm run verify [-- M1]   or   M=M1 npm run verify
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const M = process.env.M || process.argv[2] || 'M0';
const EXTRA = process.env.EXTRA || '';          // extra query params, e.g. '&beat=0.9'
const OUT = process.env.OUT || M;               // name of the timestamped copy
const NOREC = !!process.env.NOREC;
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
fs.mkdirSync('shots', { recursive: true });

const errors = [];
let smokeFail = '';
try { const { execSync } = await import('node:child_process'); const b = execSync('pmset -g batt').toString(); if (/Battery Power/.test(b)) console.log('WARNING: on battery power — fps is not meaningful (' + (b.match(/\d+%/) || [''])[0] + ')'); } catch {}
const browser = await chromium.launch({
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const url = pathToFileURL(path.resolve('index.html')).href + '?test=1' + EXTRA;
await page.goto(url);
await page.bringToFront();
await page.waitForTimeout(3000);
const stats = await page.evaluate(() => window.__stats);
await page.screenshot({ path: 'shots/latest.png' });
fs.copyFileSync('shots/latest.png', `shots/${OUT}-${hhmm}.png`);
// edge-flicker metric: move the camera 0.02 units and compare
const FLICKER_MAX = +(process.env.FLICKER_MAX ?? '1.2');   // % of pixels changing >20 % luma for a 0.02 unit dolly; 0 = report only
const CAMZ = parseFloat((EXTRA.match(/camz=([\d.]+)/) || [0, '100'])[1]);
await page.goto(url.replace(/&camz=[\d.]+/, '') + '&camz=' + (CAMZ + 0.02)); await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/latest-b.png' });
// ---------- recording check: 5 s via MediaRecorder, count frames with playwright's ffmpeg ----------
let recFrames = -1;
if (!NOREC) {
  await ctx.close();                              // no second GPU window while recording
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 540 }, acceptDownloads: true });
  const p2 = await ctx2.newPage();
  const dl = p2.waitForEvent('download', { timeout: 20000 });
  await p2.goto(pathToFileURL(path.resolve('index.html')).href + '?test=1&rec=5');
  const d = await dl; const webm = path.resolve('shots/rec-test.webm'); await d.saveAs(webm);
  // count frames by letting Chrome decode the file (playwright's ffmpeg is a minimal build)
  const p3 = await ctx2.newPage();
  await p3.goto('about:blank');
  recFrames = await p3.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'video/webm' });
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob); document.body.appendChild(v);
    await new Promise(r => { v.onended = r; v.onerror = r; v.play(); setTimeout(r, 15000); });
    return v.getVideoPlaybackQuality().totalVideoFrames;
  }, [...fs.readFileSync(webm)]);
  console.log(`rec: ${d.suggestedFilename()} ${fs.statSync(webm).size} bytes, ${recFrames} frames in 5 s`);
  await ctx2.close();
}
// ---------- smoke test of the real page: ?test=1 skips most of the app, so load it the way a user does ----------
{
  const c3 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p3 = await c3.newPage();
  const bad = [];
  p3.on('pageerror', e => bad.push('pageerror: ' + e.message));
  p3.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push('console: ' + m.text().slice(0, 120)); });
  // prefer the local server so the playlist path is covered too; fall back to file://
  const served = await fetch('http://127.0.0.1:5173/index.html').then(r => r.ok).catch(() => false);
  await p3.goto(served ? 'http://127.0.0.1:5173/index.html' : url.replace(/\?test=1.*$/, ''));
  await p3.waitForTimeout(3000);
  const live = await p3.evaluate(() => ({ lib: !!window.__lib, stats: !!window.__stats, tracks: document.querySelectorAll('.track').length }));
  console.log(`smoke (${served ? 'http' : 'file://'}): lib=${live.lib} stats=${live.stats} tracks=${live.tracks}` + (bad.length ? ` errors=${bad.length}` : ''));
  const real = bad.filter(b => !/manifest\.json/.test(b));                 // file:// cannot read the manifest; loadLibrary already falls back
  if (real.length) smokeFail = 'runtime errors on the real page: ' + real[0];
  else if (!live.lib || !live.stats) smokeFail = 'app did not initialise on the real page';
  else if (served && live.tracks === 0) smokeFail = 'playlist did not render on the real page';
  // lyrics must follow the audio even when rendering is paused (fullscreen on macOS blurs the window; hidden tabs stop rAF)
  if (!smokeFail && served && live.tracks > 0) {
    await p3.click('.track:nth-child(1)');
    await p3.waitForFunction(() => window.__lyrics && window.__lyrics().length > 3, null, { timeout: 25000 }).catch(() => {});
    await p3.waitForTimeout(800);
    const seek = async t => { await p3.evaluate(s => { player.currentTime = s; }, t); await p3.waitForTimeout(1200);
      return p3.evaluate(() => ({ lyric: window.__text ? window.__text.lyric : null, frames: window.__stats.frames })); };
    // pick two moments that genuinely belong to different lines, so a repeated chorus cannot pass or fail it by accident
    const picks = await p3.evaluate(() => { const L = window.__lyrics ? window.__lyrics() : [];
      if (L.length < 4) return null;
      const first = L[1], other = L.find(x => x.text !== first.text && x.t > first.t + 5);
      return other ? { n: L.length, a: first.t + 1, b: other.t + 1 } : null; });
    if (!picks) smokeFail = 'no usable lyrics loaded for the first track';
    else {
      const a1 = await seek(picks.a);
      const b1 = await seek(picks.b);
      console.log(`smoke lyrics: ${picks.n} lines, ${picks.a.toFixed(0)}s "${String(a1.lyric).slice(0, 12)}" -> ${picks.b.toFixed(0)}s "${String(b1.lyric).slice(0, 12)}"`);
      if (!a1.lyric || a1.lyric === b1.lyric) smokeFail = 'lyric did not follow the audio position';
    }
  }
  await c3.close();
}
await browser.close();

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
const pngB = decodePNG(fs.readFileSync('shots/latest-b.png'));
let flick = 0;
for (let i = 0; i < png.w * png.h; i++) {
  const o = i * png.bpp, la = 0.2126*png.data[o] + 0.7152*png.data[o+1] + 0.0722*png.data[o+2];
  const lb = 0.2126*pngB.data[o] + 0.7152*pngB.data[o+1] + 0.0722*pngB.data[o+2];
  if (Math.abs(la - lb) > 51) flick++;
}
const flickerPct = 100 * flick / (png.w * png.h);
// composition: brightness-weighted centroid offset from the centre (% of width), and count of highlight blobs (luma > 0.8, 1/8 res)
let cx = 0, cy = 0, cw = 0; const W8 = Math.floor(png.w / 8), H8 = Math.floor(png.h / 8); const grid = new Uint8Array(W8 * H8);
for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) {
  const o = (y * png.w + x) * png.bpp, l = (0.2126*png.data[o] + 0.7152*png.data[o+1] + 0.0722*png.data[o+2]) / 255;
  if (l > 0.5) { cx += x * l; cy += y * l; cw += l; }
  if (l > 0.8) grid[Math.floor(y / 8) * W8 + Math.floor(x / 8)] = 1;
}
const centroidPct = cw > 0 ? 100 * Math.hypot(cx / cw - png.w / 2, cy / cw - png.h / 2) / png.w : 0;
let blobs = 0; const seen = new Uint8Array(W8 * H8);
for (let i = 0; i < W8 * H8; i++) if (grid[i] && !seen[i]) { blobs++; const st = [i]; seen[i] = 1;
  while (st.length) { const k = st.pop(), kx = k % W8, ky = (k / W8) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = kx + dx, ny = ky + dy; if (nx < 0 || ny < 0 || nx >= W8 || ny >= H8) continue; const j = ny * W8 + nx; if (grid[j] && !seen[j]) { seen[j] = 1; st.push(j); } } } }
let nonBlack = 0, magenta = 0, warm = 0; const n = png.w * png.h;
const hist = new Float64Array(256);
for (let i = 0; i < n; i++) {
  const r = png.data[i * png.bpp], g = png.data[i * png.bpp + 1], b = png.data[i * png.bpp + 2];
  if (Math.max(r, g, b) > 12) nonBlack++;
  if (r > 200 && g < 60 && b > 200) magenta++;
  hist[Math.round(0.2126*r + 0.7152*g + 0.0722*b)]++;
  if (r > 1.3*b && (0.2126*r + 0.7152*g + 0.0722*b) > 51) warm++;
}
const warmPct = 100 * warm / n;
const nonBlackPct = 100 * nonBlack / n, magentaPct = 100 * magenta / n;
// luminance percentiles: mean of darkest 5 % and brightest 1 %
function tailMean(fromDark, frac){
  let need = n * frac, sum = 0, cnt = 0;
  for (let k = 0; k < 256; k++){ const bin = fromDark ? k : 255 - k; const take = Math.min(hist[bin], need - cnt);
    sum += take * bin; cnt += take; if (cnt >= need) break; }
  return sum / cnt / 255;
}
const BRIGHT_FRAC = +(process.env.BRIGHT_FRAC ?? '0.005');   // M8: fewer, better lights -> judge the top 0.5 %
const dark5 = tailMean(true, 0.05), bright1 = tailMean(false, BRIGHT_FRAC);

// ---------- optional A/B: grid-walk tracer vs reference sphere-trace ----------
let abPct = -1;
if (process.env.AB) {
  const b2 = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
  const c2 = await b2.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
  const p4 = await c2.newPage(); await p4.goto(url + '&path=0'); await p4.waitForTimeout(2500);
  await p4.screenshot({ path: 'shots/latest-ref.png' }); await b2.close();
  const R = decodePNG(fs.readFileSync('shots/latest-ref.png')); let df = 0;
  for (let i = 0; i < png.w * png.h; i++) { const o = i * png.bpp;
    const la = 0.2126*png.data[o] + 0.7152*png.data[o+1] + 0.0722*png.data[o+2], lb = 0.2126*R.data[o] + 0.7152*R.data[o+1] + 0.0722*R.data[o+2];
    if (Math.abs(la - lb) > 51) df++; }
  abPct = 100 * df / (png.w * png.h);
  console.log(`A/B tracer vs reference: ${abPct.toFixed(2)}% pixels differ`);
}
// ---------- report ----------
console.log('stats:', JSON.stringify(stats));
console.log(`png: ${png.w}x${png.h}  nonBlack=${nonBlackPct.toFixed(1)}%  magenta=${magentaPct.toFixed(3)}%  dark5=${dark5.toFixed(3)}  bright1=${bright1.toFixed(3)}  warm=${warmPct.toFixed(1)}%  flicker=${flickerPct.toFixed(2)}%  centroid=${centroidPct.toFixed(1)}%  blobs=${blobs}`);
if (errors.length) console.log('console errors:\n  ' + errors.slice(0, 5).join('\n  '));

const fails = [];
if (smokeFail) fails.push(smokeFail);
if (stats.shaderError) fails.push('shaderError: ' + stats.shaderError.slice(0, 300));
if (!(stats.fps >= 50)) { if (process.env.FPS_SOFT) console.log(`(fps ${stats.fps} < 50 — reported only, FPS_SOFT set)`); else fails.push(`fps ${stats.fps} < 50`); }
if (!(nonBlackPct > 40)) fails.push(`nonBlack ${nonBlackPct.toFixed(1)}% <= 40%`);
if (!(magentaPct < 0.1)) fails.push(`magenta ${magentaPct.toFixed(3)}% >= 0.1%`);
if (!(dark5 < 0.03)) fails.push(`dark5 ${dark5.toFixed(3)} >= 0.03 (no true blacks)`);
if (!(bright1 > 0.9)) fails.push(`bright1 ${bright1.toFixed(3)} <= 0.9 (no highlights)`);
if (!(warmPct <= 12)) fails.push(`warm ${warmPct.toFixed(1)}% > 12% (two-colour rule broken)`);
const CENTROID_MIN = +(process.env.CENTROID_MIN ?? '3'), BLOBS_MAX = +(process.env.BLOBS_MAX ?? '110');
if (CENTROID_MIN > 0 && !(centroidPct >= CENTROID_MIN)) fails.push(`centroid ${centroidPct.toFixed(1)}% < ${CENTROID_MIN}% (composition too centred)`);
if (BLOBS_MAX > 0 && !(blobs <= BLOBS_MAX)) fails.push(`highlight blobs ${blobs} > ${BLOBS_MAX} (no light hierarchy)`);
if (abPct >= 0 && !(abPct <= 2)) fails.push(`A/B ${abPct.toFixed(2)}% > 2% (tracer disagrees with the reference)`);
if (FLICKER_MAX > 0 && !(flickerPct <= FLICKER_MAX)) fails.push(`flicker ${flickerPct.toFixed(2)}% > ${FLICKER_MAX}% (edge aliasing)`);
if (!NOREC && !(recFrames >= 140)) fails.push(`recording ${recFrames} frames < 140 in 5 s`);
if (errors.some(e => /pageerror|SHADER ERROR/.test(e))) fails.push('page/shader errors in console');
if (fails.length) { console.log('VERIFY FAIL\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('VERIFY PASS  -> shots/latest.png');
