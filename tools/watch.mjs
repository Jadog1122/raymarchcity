// Watch the thing in motion. Captures the real page (no ?test=1) while a track plays,
// at a fixed wall-clock interval, together with the state that explains each frame.
//   node tools/watch.mjs [seconds] [interval_ms] [seek_seconds] [track_index]
// Writes shots/motion/f###.png and shots/motion/log.json.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const SECS = +(process.argv[2] || 24), IV = +(process.argv[3] || 400);
const SEEK = +(process.argv[4] || 0), TRACK = +(process.argv[5] || 1);
fs.rmSync('shots/motion', { recursive: true, force: true });
fs.mkdirSync('shots/motion', { recursive: true });

let served = await fetch('http://127.0.0.1:5173/index.html').then(r => r.ok).catch(() => false);
let srv = null;
if (!served) {
  srv = spawn('node', ['tools/serve.mjs', '5173'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 40 && !served; i++) { await new Promise(r => setTimeout(r, 250));
    served = await fetch('http://127.0.0.1:5173/index.html').then(r => r.ok).catch(() => false); }
}
if (!served) { console.error('dev server would not start'); process.exit(2); }

const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1720, height: 720 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5173/index.html');
await page.waitForTimeout(2500);
await page.click(`.track:nth-child(${TRACK})`);
await page.waitForTimeout(2500);
if (SEEK) { await page.evaluate(s => { player.currentTime = s; }, SEEK); await page.waitForTimeout(1200); }

const log = [];
const n = Math.round(SECS * 1000 / IV);
for (let i = 0; i < n; i++) {
  const name = `shots/motion/f${String(i).padStart(3, '0')}.png`;
  await page.screenshot({ path: name });
  log.push(await page.evaluate(() => ({
    t: +player.currentTime.toFixed(2), fps: window.__stats.fps, scale: window.__stats.renderScale,
    rig: window.__p.uRig.value, focal: +window.__p.uFocal.value.toFixed(2),
    ro: [window.__p.uCamRo.value.x, window.__p.uCamRo.value.y, window.__p.uCamRo.value.z].map(v => +v.toFixed(1)),
    lyric: (window.__text && window.__text.lyric ? window.__text.lyric : '').slice(0, 18),
    hud: document.body.className || '-', paused: player.paused,
    energy: +window.__audio.val.energy.toFixed(2), bass: +window.__audio.val.bass.toFixed(2),
    section: window.__audio.section, bpm: Math.round(window.__audio.bpm), conf: +(window.__audio.bpmConf||0).toFixed(2), beat: +(window.__audio.lastBeat||0).toFixed(2)
  })).catch(() => ({})));
  await page.waitForTimeout(IV - 120);
}
fs.writeFileSync('shots/motion/log.json', JSON.stringify(log, null, 1));
console.log(`${n} frames over ${SECS}s` + (errs.length ? `  ERRORS: ${errs[0]}` : ''));
const rigs = log.map(l => l.rig).join('');
console.log('rig track: ' + rigs);
console.log('fps: ' + log.map(l => l.fps).join(' '));
await browser.close();
if (srv) process.kill(-srv.pid);
