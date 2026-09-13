// Press stills for the film. One frame each, at maximum quality, after loading has finished.
//   node tools/stills.mjs [nameFilter]
// TEST pins iTime at 8.0 and disables the adaptive scaler, so scale=2 really is 2x supersampling
// rather than something the scaler walks back down while the shot is being taken.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const W = 1920, H = 804;                       // 2.39:1 exactly, so nothing is lost to the letterbox
const DPR = 2;                                 // -> 3840x1608 delivered
const SETTLE = 90;                             // frames to let TAA/bloom/adaptation settle before the shot

// Positions found by sweeping camz down the whole city (tools/stills.mjs --scan), not by trusting the
// district labels: at street level you almost always see downtown towers up the avenue, so the label
// and what is actually in frame are two different things.
const SHOTS = [
  { n: '01-skyline',      q: '&rig=0&camz=100',          d: '1 · 开场全景 · 一座城' },
  { n: '02-street-rain',  q: '&rig=1&camz=212',          d: '2 · 街面 · 湿地反光＋雨丝' },
  { n: '03-glass',        q: '&rig=1&camz=72',           d: '3 · 商务区 · 玻璃冷色高' },
  { n: '04-signs',        q: '&rig=1&camz=120',          d: '4 · 繁华街 · 招牌一个挨一个' },
  { n: '05-packed',       q: '&rig=2&camz=24',           d: '5 · 老城区 · 最接近的一张' },
  { n: '06-industrial',   q: '&rig=1&camz=152',          d: '6 · 工业带 · 空冷灯少' },
  { n: '07-viaduct',      q: '&rig=1&camz=232',          d: '7 · 高架横穿＋列车' },
  { n: '07-viaduct-alt',  q: '&rig=1&camz=248',          d: '7 · 高架 · 干净的横穿' },
  { n: '08-wavefront',    q: '&rig=1&camz=100&beat=0.6', d: '8 · 光圈波前 · 近亮远暗' },
  { n: '09-superpowers',  q: '&rig=1&camz=216',          d: '9 · 歌名 · Superpowers', title: 'DANIEL CAESAR · SUPERPOWERS' },
  { n: '10-jide',         q: '&rig=3&camz=100',          d: '10 · 歌名 · 記得',        title: '張惠妹 · 記得' },
  { n: '11-finale',       q: '&rig=1&camz=280',          d: '11 · 压轴' },
];

const only = process.argv[2];
const list = only ? SHOTS.filter(s => s.n.includes(only)) : SHOTS;
fs.mkdirSync('stills', { recursive: true });

const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  PAGEERROR', e.message.slice(0, 160)));
const url = pathToFileURL(path.resolve('index.html')).href;

for (const s of list) {
  const t0 = Date.now();
  await page.goto(`${url}?test=1&scale=2&taa=1${s.q}`);
  await page.waitForFunction(() => window.__stats && !window.__stats.shaderError, null, { timeout: 60000 });
  // the shot is "after loading finished": wait for the boot sequence to hand over, then let it settle
  await page.waitForFunction(n => window.__stats.frames > n, SETTLE, { timeout: 180000 });
  // The visible title is drawn into a canvas texture and sampled by the post shader; the #title div is
  // not what ends up in the frame. window.__text is that state, and drawText() redraws when its key
  // changes, so setting the string here is enough — then give it frames to be picked up.
  if (s.title) {
    await page.evaluate(t => { window.__text.title = t; }, s.title);
    await page.waitForFunction(t => window.__text.drawnKey.startsWith(t + '|'), s.title, { timeout: 15000 });
  }
  await page.waitForTimeout(400);
  const out = path.resolve('stills', s.n + '.png');
  await page.screenshot({ path: out, timeout: 180000 });   // a 3840x1608 readback on a throttled machine is not a 30 s job
  const st = await page.evaluate(() => ({ f: window.__stats.frames, s: window.__stats.renderScale, rt: window.__stats.rtW + 'x' + window.__stats.rtH }));
  console.log(`${s.n.padEnd(22)} ${s.d.padEnd(22)} ${st.rt} scale ${st.s}  ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
await browser.close();
console.log('\n-> ' + path.resolve('stills'));
