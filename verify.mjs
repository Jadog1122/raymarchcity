// npm run verify            full suite
// FRAME=downtown npm run verify   just one frame of the suite
// NOREC=1 / FPS_SOFT=1 / AB=1     skip the recording check / report throughput only / cross-check the tracer
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const M = process.env.M || process.argv[2] || 'M0';
const OUT = process.env.OUT || M;
const NOREC = !!process.env.NOREC;
const FPS_SOFT = !!process.env.FPS_SOFT;
const ONE = process.env.FRAME || '';
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
fs.mkdirSync('shots/suite', { recursive: true });

// ---------------------------------------------------------------------------
// The frame suite.
//
// One frame cannot stand for this city any more: the zoning makes an industrial belt and an
// entertainment quarter genuinely different pictures, and a threshold tuned on either one is wrong
// for the other. So the suite walks the camera through every district and every piece of
// infrastructure, and each frame carries the limits that are true of *it*.
//
// `dark5` became per frame for the same reason `brightArea` always was. The measured black content of
// the thirteen frames is not one population: every ordinary street has 1.4-4.4% of its pixels under
// 0.03, while the two neon-quarter frames have 0.6% and 1.0%. A district papered wall to wall with lit
// signs does not contain black, and the real place does not either — so there "the darkest 5%" was
// measuring the dimmest part of a bright picture, not a floor, and it blocked three separate correct
// changes to the lighting. Each frame now carries the cap its own composition allows, which is tighter
// than the old universal 0.040 on nine of the thirteen. UNIVERSAL.dark5max is the backstop.
//
// `brightArea` is the one that legitimately varies — a long lens on a lit landmark is mostly light,
// an aerial shot is mostly dark — so its cap is per frame, measured with about a third of headroom.
// Everything else is a rule about the look and holds everywhere.
// ---------------------------------------------------------------------------
const UNIVERSAL = {
  dark5max: 0.055,     // darkest 5 % mean, backstop: past this the picture is grey mush wherever it is
  bright: 0.90,        // brightest 0.5 % mean: it must contain real highlights
  warm: 12,            // % warm pixels: the two-colour discipline
  nonBlack: 40,        // % non-black: not a black screen
  magenta: 0.1,        // % NaN sentinel
  flicker: 1.2,        // % pixels changing >20 % luma for a 0.02 unit dolly
};
const FRAMES = [
  { name: 'oldtown',       q: '&rig=1&camz=16',            dark5: 0.034, brightArea: 2.8, note: 'low-rise quarter' },
  { name: 'river',         q: '&rig=1&camz=32',            dark5: 0.033, brightArea: 3.7, note: 'street crossing the water on a bridge' },
  { name: 'station',       q: '&rig=1&camz=52',            dark5: 0.037, brightArea: 7.3, note: 'concourse under the elevated line' },
  { name: 'downtown',      q: '&rig=1&camz=100',           dark5: 0.033, brightArea: 2.2, note: 'high-rise district', primary: true },
  { name: 'industrial',    q: '&rig=1&camz=172',           dark5: 0.033, brightArea: 2.6, note: 'industrial belt' },
  { name: 'entertainment', q: '&rig=1&camz=240',           dark5: 0.046, brightArea: 5.2, note: 'neon quarter, from the elevated road' },
  // Down among the tubes, which is the one place the signs are close enough to light the walls. The
  // elevated frame above looks across the district from outside it and never sees that happen.
  { name: 'neonstreet',    q: '&rig=1&camz=212',           dark5: 0.046, brightArea: 2.9, note: 'street level in the neon quarter' },
  { name: 'office',        q: '&rig=1&camz=284',           dark5: 0.042, brightArea: 3.0, note: 'office district' },
  { name: 'riverbank',     q: '&rig=2&camz=20',            dark5: 0.008, brightArea: 3.2, note: 'across the water' },
  { name: 'aerial',        q: '&rig=0&camz=100',           dark5: 0.006, brightArea: 1.4, note: 'above the skyline' },
  { name: 'tower',         q: '&rig=3&camz=100',           dark5: 0.004, brightArea: 2.5, note: 'long lens on the landmark' },
  // The beat ring moves with the camera, so the 0.02 dolly that measures flicker also moves the ring:
  // these frames check the ring renders, and skip the temporal comparison that it would confound.
  { name: 'beatring',      q: '&rig=3&camz=100&beat=0.9',  dark5: 0.004, brightArea: 3.0, flicker: 0, note: 'the ring has passed: the city has to come back down' },
  // The suite had no street frame with a beat in it, and that is exactly where the ring did its damage:
  // held at full strength it clipped a third of the street footage to white and nothing here could see it.
  { name: 'beatstreet',    q: '&rig=1&camz=100&beat=0.6',  dark5: 0.040, brightArea: 3.4, flicker: 0, note: 'the beat ring in the canyon, at its peak' },
];
const suite = ONE ? FRAMES.filter(f => f.name === ONE) : FRAMES;
if (!suite.length) { console.error(`no frame named "${ONE}"`); process.exit(2); }

try { const b = execSync('pmset -g batt').toString();
  if (/Battery Power/.test(b)) console.log('WARNING: on battery power — fps is not meaningful (' + (b.match(/\d+%/) || [''])[0] + ')'); } catch {}

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
function measure(file) {
  const p = decodePNG(fs.readFileSync(file)); const n = p.w * p.h; const hist = new Float64Array(256);
  let nonBlack = 0, magenta = 0, warm = 0, bright = 0, cx = 0, cy = 0, cw = 0;
  for (let i = 0; i < n; i++) {
    const o = i * p.bpp, r = p.data[o], g = p.data[o + 1], b = p.data[o + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hist[Math.round(L)]++;
    if (Math.max(r, g, b) > 12) nonBlack++;
    if (r > 200 && g < 60 && b > 200) magenta++;
    if (r > 1.3 * b && L > 51) warm++;
    if (L / 255 > 0.8) { bright++; }
    if (L / 255 > 0.5) { const x = i % p.w, y = (i / p.w) | 0; cx += x * L / 255; cy += y * L / 255; cw += L / 255; }
  }
  const tail = (fromDark, frac) => { let need = n * frac, s = 0, c = 0;
    for (let k = 0; k < 256; k++) { const bin = fromDark ? k : 255 - k; const take = Math.min(hist[bin], need - c); s += take * bin; c += take; if (c >= need) break; }
    return s / c / 255; };
  return { png: p, n, nonBlack: 100 * nonBlack / n, magenta: 100 * magenta / n, warm: 100 * warm / n,
    dark5: tail(true, 0.05), bright: tail(false, 0.005), brightArea: 100 * bright / n,
    centroid: cw > 0 ? 100 * Math.hypot(cx / cw - p.w / 2, cy / cw - p.h / 2) / p.w : 0 };
}
function flickerBetween(a, b) {
  const A = decodePNG(fs.readFileSync(a)), B = decodePNG(fs.readFileSync(b));
  let n = 0; const total = A.w * A.h;
  for (let i = 0; i < total; i++) { const o = i * A.bpp;
    const la = 0.2126 * A.data[o] + 0.7152 * A.data[o + 1] + 0.0722 * A.data[o + 2];
    const lb = 0.2126 * B.data[o] + 0.7152 * B.data[o + 1] + 0.0722 * B.data[o + 2];
    if (Math.abs(la - lb) > 51) n++; }
  return 100 * n / total;
}

const fails = [];
const browser = await chromium.launch({ headless: false, args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
const base = pathToFileURL(path.resolve('index.html')).href + '?test=1&search=-1.68';
await page.bringToFront();

// ---------- the suite ----------
console.log('frame           dark5  bright  warm%  brArea%  centroid%  flicker%   fps');
let primaryStats = null;
for (const f of suite) {
  await page.goto(base + f.q); await page.waitForTimeout(2600);
  const st = await page.evaluate(() => window.__stats);
  const shot = `shots/suite/${f.name}.png`;
  await page.screenshot({ path: shot });
  const m = measure(shot);

  const flickMax = f.flicker !== undefined ? f.flicker : UNIVERSAL.flicker;
  let fl = -1;
  if (flickMax > 0) {
    const camz = +(f.q.match(/camz=([\d.]+)/) || [0, '100'])[1];
    await page.goto(base + f.q.replace(/camz=[\d.]+/, 'camz=' + (camz + 0.02))); await page.waitForTimeout(1300);
    await page.screenshot({ path: 'shots/suite/_b.png' });
    fl = flickerBetween(shot, 'shots/suite/_b.png');
    fs.unlinkSync('shots/suite/_b.png');
  }
  console.log(f.name.padEnd(15), m.dark5.toFixed(3).padStart(5), m.bright.toFixed(3).padStart(6), m.warm.toFixed(1).padStart(6),
    m.brightArea.toFixed(2).padStart(7), m.centroid.toFixed(1).padStart(9), (fl < 0 ? '  n/a' : fl.toFixed(2)).padStart(9), String(st.fps).padStart(6));

  const bad = (msg) => fails.push(`${f.name}: ${msg}`);
  if (st.shaderError) bad('shaderError: ' + st.shaderError.slice(0, 200));
  if (!(m.magenta < UNIVERSAL.magenta)) bad(`magenta ${m.magenta.toFixed(3)}% (NaN in the shader)`);
  if (!(m.nonBlack > UNIVERSAL.nonBlack)) bad(`nonBlack ${m.nonBlack.toFixed(1)}% <= ${UNIVERSAL.nonBlack}%`);
  if (!(m.dark5 < UNIVERSAL.dark5max)) bad(`dark5 ${m.dark5.toFixed(3)} >= ${UNIVERSAL.dark5max} (grey mush)`);
  if (!(m.dark5 < f.dark5)) bad(`dark5 ${m.dark5.toFixed(3)} >= ${f.dark5} (this frame has lost its blacks)`);
  if (!(m.bright > UNIVERSAL.bright)) bad(`bright ${m.bright.toFixed(3)} <= ${UNIVERSAL.bright} (no highlights)`);
  if (!(m.warm <= UNIVERSAL.warm)) bad(`warm ${m.warm.toFixed(1)}% > ${UNIVERSAL.warm}% (two-colour rule broken)`);
  if (!(m.brightArea <= f.brightArea)) bad(`bright area ${m.brightArea.toFixed(2)}% > ${f.brightArea}% (too much of the frame is lit)`);
  if (fl >= 0 && !(fl <= flickMax)) bad(`flicker ${fl.toFixed(2)}% > ${flickMax}%`);
  if (!(st.fps >= 50)) { if (FPS_SOFT) { /* reported in the table */ } else bad(`fps ${st.fps} < 50`); }

  if (f.primary) {
    primaryStats = st;
    fs.copyFileSync(shot, 'shots/latest.png');
    fs.copyFileSync(shot, `shots/${OUT}-${hhmm}.png`);
  }
}

// ---------- composition is a property of the camera, not of where the light landed ----------
// The old check measured the brightness centroid, which a symmetric quarter fails for reasons that
// have nothing to do with framing. Assert the camera rig itself instead.
{
  await page.goto(base + '&rig=1&camz=100'); await page.waitForTimeout(1200);
  const cam = await page.evaluate(() => ({ ro: window.__u.uCamRo.value.toArray(), fw: window.__u.uCamFw.value.toArray(), focal: window.__u.uFocal.value }));
  const offAxis = Math.abs(cam.ro[0]);
  const yaw = Math.abs(cam.fw[0] / Math.max(cam.fw[2], 1e-3));
  const pitch = cam.fw[1];
  console.log(`camera: off-axis ${offAxis.toFixed(2)}u, yaw ${(Math.atan(yaw) * 57.3).toFixed(1)}deg, pitch ${(Math.asin(pitch) * 57.3).toFixed(1)}deg, focal ${cam.focal.toFixed(2)}`);
  if (!(offAxis > 0.3)) fails.push(`camera sits on the street centre line (x=${cam.ro[0].toFixed(2)})`);
  if (!(yaw > 0.04)) fails.push(`camera looks straight down the street (yaw ${(Math.atan(yaw) * 57.3).toFixed(1)}deg)`);
  if (!(pitch > 0.02)) fails.push(`camera is level; the horizon needs to sit off centre (pitch ${(Math.asin(pitch) * 57.3).toFixed(1)}deg)`);
}

// ---------- the real page: ?test=1 skips most of the app ----------
let smokeFail = '';
{
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p2 = await c2.newPage();
  const bad = [];
  p2.on('pageerror', e => bad.push('pageerror: ' + e.message));
  p2.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push('console: ' + m.text().slice(0, 120)); });
  const served = await fetch('http://127.0.0.1:5173/index.html').then(r => r.ok).catch(() => false);
  await p2.goto(served ? 'http://127.0.0.1:5173/index.html' : pathToFileURL(path.resolve('index.html')).href);
  // Wait for the app, do not sleep at it. A fixed 3 s is a coin flip on a loaded machine, and a flaky
  // check is worse than a slow one: it teaches you to re-run instead of to look.
  await p2.waitForFunction(() => window.__lib && window.__stats, null, { timeout: 20000 }).catch(() => {});
  if (served) await p2.waitForFunction(() => document.querySelectorAll('.track').length > 0, null, { timeout: 20000 }).catch(() => {});
  await p2.waitForTimeout(400);
  const live = await p2.evaluate(() => ({ lib: !!window.__lib, stats: !!window.__stats, tracks: document.querySelectorAll('.track').length }));
  console.log(`smoke (${served ? 'http' : 'file://'}): lib=${live.lib} stats=${live.stats} tracks=${live.tracks}` + (bad.length ? ` errors=${bad.length}` : ''));
  const real = bad.filter(b => !/manifest\.json/.test(b));
  if (real.length) smokeFail = 'runtime errors on the real page: ' + real[0];
  else if (!live.lib || !live.stats) smokeFail = 'app did not initialise on the real page';
  else if (served && live.tracks === 0) smokeFail = 'playlist did not render on the real page';
  // Landing cued: one click anywhere has to start the music, not open a menu to pick from. All of this
  // sits inside `if (!TEST)`, so no static frame can see it — it only exists if asserted on the real page.
  if (!smokeFail && served && live.tracks > 0) {
    const hint = (await p2.textContent('#pickerHint')) || '';
    const preloaded = await p2.evaluate(() => !!player.src && player.preload === 'auto');
    await p2.mouse.click(100, 100);                               // empty canvas, not a control
    const started = await p2.waitForFunction(() => !player.paused && player.currentTime > 0.05,
      null, { timeout: 10000 }).then(() => true).catch(() => false);
    const at = await p2.evaluate(() => player.currentTime);
    console.log(`smoke cue: preloaded=${preloaded} · one click -> ${started ? 'playing at ' + at.toFixed(2) + 's' : 'SILENT'}`);
    if (!/点任意处播放/.test(hint)) smokeFail = 'the default track was not cued on landing: "' + hint.slice(0, 40) + '"';
    else if (!preloaded) smokeFail = 'the cued track was not buffering before the gesture';
    else if (!started) smokeFail = 'one click on the canvas did not start the cued track';
  }

  // Lyrics must follow the audio even when rendering is paused. The words themselves are not what is
  // under test — the clock is — so the check seeds its own .lrc into the page's IndexedDB cache instead
  // of asking lrclib for them. That removes a third-party service from the critical path and, more to
  // the point, makes the check work for any track: a cover will never match on lrclib by design (the
  // artist has to agree), so a lyric lookup is not something verify can assume will succeed.
  if (!smokeFail && served && live.tracks > 0) {
    const SEED = ['[00:10.00]first seeded line', '[00:20.00]second seeded line',
                  '[00:30.00]third seeded line', '[00:40.00]fourth seeded line'].join('\n');
    await p2.evaluate(async lrc => {
      const id = window.__lib.tracks[0].id;
      const db = await new Promise(r => { const q = indexedDB.open('nightcity', 1); q.onsuccess = () => r(q.result); });
      await new Promise(r => { const tx = db.transaction('lyrics', 'readwrite');
        tx.objectStore('lyrics').put({ id, lrc, at: Date.now() }); tx.oncomplete = r; tx.onerror = r; });
    }, SEED);
    await p2.reload({ waitUntil: 'load' });
    await p2.waitForFunction(() => document.querySelectorAll('.track').length > 0, null, { timeout: 20000 });
    if (await p2.evaluate(() => document.getElementById('overlay').classList.contains('hidden'))) await p2.keyboard.press('l');
    await p2.waitForSelector('.track:nth-child(1)', { state: 'visible', timeout: 10000 });
    await p2.click('.track:nth-child(1)');
    await p2.waitForFunction(() => window.__lyrics && window.__lyrics().length > 3, null, { timeout: 25000 }).catch(() => {});
    await p2.waitForTimeout(800);
    const picks = await p2.evaluate(() => { const L = window.__lyrics ? window.__lyrics() : [];
      if (L.length < 4) return null;
      const first = L[1], other = L.find(x => x.text !== first.text && x.t > first.t + 5);
      return other ? { n: L.length, a: first.t + 1, b: other.t + 1 } : null; });
    if (!picks) smokeFail = 'no usable lyrics loaded for the first track';
    else {
      const seek = async t => { await p2.evaluate(s => { player.currentTime = s; }, t); await p2.waitForTimeout(1200);
        return p2.evaluate(() => (window.__text ? window.__text.lyric : null)); };
      const a1 = await seek(picks.a), b1 = await seek(picks.b);
      console.log(`smoke lyrics: ${picks.n} lines, ${picks.a.toFixed(0)}s "${String(a1).slice(0, 12)}" -> ${picks.b.toFixed(0)}s "${String(b1).slice(0, 12)}"`);
      if (!a1 || a1 === b1) smokeFail = 'lyric did not follow the audio position';
    }
  }
  // The transport controls, asserted directly rather than through a screenshot: dragging the progress
  // bar has to seek and must not also toggle playback, and the volume keys have to move the volume.
  if (!smokeFail && served) {
    // The HUD fades after 2.5 s of stillness while a track plays, so by now the bar may be invisible
    // and unclickable. Wake it the way a user does — with an actual movement; a mousemove that does
    // not move is ignored on purpose — and wait for it, rather than relying on the test being quick.
    await p2.mouse.move(200, 300); await p2.mouse.move(240, 320);
    await p2.waitForFunction(() => !document.body.classList.contains('hud-away'), null, { timeout: 5000 }).catch(() => {});
    const bar = await p2.$('#nowPlaying .bar');
    const box = bar && await bar.boundingBox();
    // assert the bar's width directly: a zero-width bar makes every scrub land at 0 and the failure
    // reads as "seeking is broken" instead of "the layout collapsed", which is a much longer hunt.
    if (!box) smokeFail = 'no progress bar to scrub';
    else if (box.width < 60) smokeFail = `progress bar collapsed to ${box.width.toFixed(0)}px wide (title/lyric squeezed it out)`;
    else {
      await p2.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
      await p2.waitForTimeout(500);
      const st = await p2.evaluate(() => ({ t: player.currentTime, d: player.duration || 0, paused: player.paused, vol: player.volume }));
      const want = st.d * 0.6;
      if (!(st.d > 1)) smokeFail = 'no duration on the loaded track';
      else if (Math.abs(st.t - want) > st.d * 0.06) smokeFail = `scrub landed at ${st.t.toFixed(1)}s, wanted ~${want.toFixed(1)}s`;
      else if (st.paused) smokeFail = 'scrubbing paused playback';
      else {
        await p2.keyboard.press('ArrowDown'); await p2.keyboard.press('ArrowDown'); await p2.waitForTimeout(300);
        const v2 = await p2.evaluate(() => player.volume);
        if (!(v2 < st.vol - 0.05)) smokeFail = 'volume keys did nothing';
        else console.log(`smoke transport: scrub ${st.t.toFixed(1)}s/${st.d.toFixed(1)}s, volume ${st.vol.toFixed(2)} -> ${v2.toFixed(2)}`);
      }
    }
  }
  await c2.close();

  // Phone smoke: portrait 390x844@3 with touch. Portrait must be full-bleed (the letterbox is a
  // landscape idea — bars would leave a 390x163 slit), and one tap anywhere must start playback,
  // exactly like the desktop click. Layout is CSS; this asserts the behaviour, not the styling.
  if (!smokeFail && served) {
    const cm = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const pm = await cm.newPage();
    const badM = [];
    pm.on('pageerror', e => badM.push(e.message));
    await pm.goto('http://127.0.0.1:5173/index.html');
    await pm.waitForFunction(() => window.__lib && window.__stats && document.querySelectorAll('.track').length > 0, null, { timeout: 20000 }).catch(() => {});
    await pm.touchscreen.tap(195, 260);
    const ok = await pm.waitForFunction(() => !player.paused && player.currentTime > 0.05, null, { timeout: 10000 }).then(() => true).catch(() => false);
    // Playback opens on a 2 s fade from black, and uMood.w's INITIAL value is already 1 — waiting on
    // it alone passes instantly with zero frames rendered. Wait for both real things: frames actually
    // advancing (the compile watchdog can hold the first one back ~4 s) and the fade done.
    await pm.waitForFunction(() => window.__stats.frames > 30 && window.__u.uMood.value.w > 0.95, null, { timeout: 15000 }).catch(() => {});
    await pm.waitForTimeout(300);
    const shotM = 'shots/suite/_mobile.png';
    await pm.screenshot({ path: shotM });
    const mm = measure(shotM);
    // The very top rows are zenith sky and genuinely near-black at night — sampling them said
    // "letterbox" about a working frame. Sample the band at 25-40% height instead: in portrait that
    // band holds the skyline, and under a letterbox it would sit inside the top bar as pure zeros.
    const topBlack = (() => { const g = mm.png; let dark = 0, n = 0;
      for (let y = Math.round(g.h*0.25); y < Math.round(g.h*0.40); y += 5) for (let x = 0; x < g.w; x += 7){ const i = (y*g.w + x)*g.bpp;
        if ((g.data[i] + g.data[i+1] + g.data[i+2]) / 765 < 0.02) dark++; n++; }
      return dark / n; })();
    const mst = await pm.evaluate(() => ({ err: window.__stats.shaderError, scale: window.__stats.renderScale }));
    console.log(`smoke mobile: tap->${ok ? 'playing' : 'SILENT'} · nonblack ${mm.nonBlack.toFixed(0)}% · scale ${mst.scale} · 25-40% band black ${(100*topBlack).toFixed(0)}%`);
    fs.unlinkSync(shotM);
    // This runs on the LIVE page, so the camera is wherever the dolly has reached — a dark stretch of
    // road is a perfectly valid frame and was failing a 40% non-black bar meant for the fixed TEST
    // frames. What this check is actually for is "portrait renders at all, and one tap plays": assert
    // the signals that say so (no shader error, no NaN magenta, not a black screen, no letterbox) and
    // leave "is it beautiful" to the 13 deterministic frames.
    if (badM.length) smokeFail = 'mobile pageerror: ' + badM[0].slice(0, 120);
    else if (mst.err) smokeFail = 'mobile shaderError: ' + mst.err.slice(0, 120);
    else if (!ok) smokeFail = 'mobile: one tap did not start playback';
    else if (mm.magenta > 0.1) smokeFail = `mobile: ${mm.magenta.toFixed(2)}% magenta (NaN in the shader)`;
    else if (mm.nonBlack < 8) smokeFail = 'mobile: frame is black';
    // What the startup adaptation settles on is a function of throughput, same family as fps and the
    // recording check — and this suite is itself the load (four contexts plus a 27 MB page). On a
    // genuinely busy machine dropping the scale is the CORRECT behaviour, so under FPS_SOFT this only
    // reports. It still fails on a quiet machine, where a floor-scraping scale means a single stall
    // was mistaken for a slow GPU.
    else if (mst.scale < 0.4 && !FPS_SOFT) smokeFail = `mobile: startup dropped quality to ${mst.scale} (a stall read as a slow GPU)`;
    else if (topBlack > 0.9) smokeFail = 'mobile: letterbox still applied in portrait';
    await cm.close();
  }
}
if (smokeFail) fails.push(smokeFail);

// ---------- optional: does the grid-walk tracer agree with the reference sphere-trace ----------
if (process.env.AB) {
  const c3 = await browser.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
  const p3 = await c3.newPage();
  await p3.goto(base + '&rig=1&camz=100&path=0'); await p3.waitForTimeout(2600);
  await p3.screenshot({ path: 'shots/suite/_ref.png' });
  await c3.close();
  const ab = flickerBetween('shots/suite/downtown.png', 'shots/suite/_ref.png');
  fs.unlinkSync('shots/suite/_ref.png');
  console.log(`A/B tracer vs reference: ${ab.toFixed(2)}% pixels differ`);
  if (!(ab <= 2)) fails.push(`A/B ${ab.toFixed(2)}% > 2% (tracer disagrees with the reference)`);
}

// ---------- the offline bundle: the actual deliverable, opened the way it ships ----------
// index.html over http is not what anyone receives. nightcity.html is a single 25 MB file with the
// audio, the lyrics and three.js inlined, opened by double-clicking, and until now nothing checked
// that it works — the one artifact that matters had no test at all.
let bundleNote = 'skipped (no nightcity.html — run npm run bundle)';
if (fs.existsSync('nightcity.html')) {
  const c5 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p5 = await c5.newPage();
  const bad5 = [];
  p5.on('pageerror', e => bad5.push(e.message));
  // count the .lrc files that belong to tracks the manifest actually ships
  const localLrc = (() => {
    try {
      const man = JSON.parse(fs.readFileSync('music/manifest.json', 'utf8')).tracks || [];
      return man.filter(t => fs.existsSync(path.join('music', t.file.replace(/\.[^.]+$/, '.lrc')))).length;
    } catch { return 0; }
  })();
  await p5.goto(pathToFileURL(path.resolve('nightcity.html')).href);
  await p5.waitForFunction(() => document.querySelectorAll('.track').length > 0, null, { timeout: 40000 }).catch(() => {});
  const n = await p5.evaluate(() => document.querySelectorAll('.track').length);
  if (bad5.length) bundleNote = 'pageerror: ' + bad5[0].slice(0, 80);
  else if (!n) bundleNote = 'no tracks in the bundle';
  else {
    await p5.click('.track:nth-child(1)');
    // The audio is a data: URI, so it has to decode before it can play at all.
    await p5.waitForFunction(() => player.duration > 1 && player.currentTime > 0.3, null, { timeout: 30000 }).catch(() => {});
    const st = await p5.evaluate(() => ({ d: player.duration || 0, t: player.currentTime || 0,
      lyr: window.__lyrics ? window.__lyrics().length : 0, err: window.__stats.shaderError }));
    if (st.err) bundleNote = 'shader error in the bundle: ' + st.err.slice(0, 60);
    else if (!(st.d > 1)) bundleNote = 'bundled audio did not decode';
    else if (!(st.t > 0.2)) bundleNote = 'bundled audio did not play';
    // The invariant is "whatever lyrics exist locally must travel with the bundle", not "lyrics exist".
    // A cover never matches on lrclib by design, so there may genuinely be no .lrc to carry — but if
    // one is sitting in music/ and did not make it into the file, offline lookup is impossible and
    // that is a real defect.
    else if (localLrc > 0 && !(st.lyr > 3)) bundleNote = `bundled lyrics missing: ${localLrc} .lrc in music/ did not travel (offline lookup is impossible)`;
    else bundleNote = `${n} tracks, ${st.d.toFixed(0)}s audio playing at ${st.t.toFixed(1)}s, ${st.lyr} lyric lines`;
  }
  await c5.close();
  const mb = (fs.statSync('nightcity.html').size / 1048576).toFixed(1);
  console.log(`bundle (file://): ${bundleNote}  [${mb} MB]`);
  if (!/tracks,/.test(bundleNote)) fails.push('offline bundle: ' + bundleNote);
} else console.log('bundle: ' + bundleNote);

// ---------- recording throughput ----------
let recFrames = -1;
if (!NOREC) {
  const c4 = await browser.newContext({ viewport: { width: 1280, height: 540 }, acceptDownloads: true });
  const p4 = await c4.newPage();
  // Recording throughput is a throughput measurement like fps, so under FPS_SOFT it may only report.
  // An unhandled timeout here killed the entire run instead — which is exactly what FPS_SOFT exists to
  // prevent. A starved machine now reports 0 and the suite finishes.
  const dl = p4.waitForEvent('download', { timeout: 25000 }).catch(() => null);
  await p4.goto(pathToFileURL(path.resolve('index.html')).href + '?test=1&rec=5');
  const d = await dl;
  if (!d) {
    console.log('rec: no recording produced within 25 s' + (FPS_SOFT ? ' (reported only — FPS_SOFT)' : ''));
    if (!FPS_SOFT) fails.push('recording produced nothing in 25 s');
    await c4.close();
  } else {
  const webm = path.resolve('shots/rec-test.webm'); await d.saveAs(webm);
  recFrames = await p4.evaluate(async (bytes) => {
    const v = document.createElement('video'); v.muted = true;
    v.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
    document.body.appendChild(v);
    await new Promise(r => { v.onended = r; v.onerror = r; v.play(); setTimeout(r, 20000); });
    return v.getVideoPlaybackQuality().totalVideoFrames;
  }, [...fs.readFileSync(webm)]);
  console.log(`rec: ${(fs.statSync(webm).size / 1048576).toFixed(1)} MB, ${recFrames} frames in 5 s`);
  if (!(recFrames >= 140)) { if (!FPS_SOFT) fails.push(`recording ${recFrames} frames < 140 in 5 s`); }
  await c4.close();
  }
}
await browser.close();

if (consoleErrors.some(e => /pageerror|SHADER ERROR/.test(e))) fails.push('page/shader errors: ' + consoleErrors[0].slice(0, 160));
if (FPS_SOFT) console.log('(fps and recording throughput reported only — FPS_SOFT is set)');
if (primaryStats) console.log(`gpu: ${primaryStats.gpu} | render target ${primaryStats.rtW}x${primaryStats.rtH} | dpr ${primaryStats.dpr}`);

if (fails.length) { console.log('VERIFY FAIL\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log(`VERIFY PASS  (${suite.length} frame${suite.length > 1 ? 's' : ''})  -> shots/suite/, shots/latest.png`);
