// Look-dev probe: render one frame, optionally poking a uniform first, and save a PNG.
//   node tools/probe.mjs "&rig=0&camz=100" /tmp/a.png "window.__p.uBloomStr.value=0"
// The third argument runs in the page after the scene has settled — window.__p is the post-pass
// uniform block, so it can switch bloom/DOF/AA off to find out which pass owns an artifact.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [q, out, js] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1720, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(pathToFileURL(path.resolve('index.html')).href + '?test=1' + (q || ''));
await page.waitForTimeout(2600);
if (js) { await page.evaluate(js); await page.waitForTimeout(900); }
await page.screenshot({ path: out });
const s = await page.evaluate(() => window.__stats);
console.log(s.shaderError ? 'SHADER ERROR: ' + s.shaderError.slice(0, 300) : `fps ${s.fps}  scale ${s.renderScale}`);
await browser.close();
