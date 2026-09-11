// Writes music/<basename>.lrc for every track in the manifest, so the player needs no network.
// The lyrics are fetched by this machine from a public synced-lyrics service and cached next to the audio.
import fs from 'node:fs'; import path from 'node:path';
import { lookup } from './scan-music.mjs';

const man = JSON.parse(fs.readFileSync('music/manifest.json', 'utf8'));
for (const t of man.tracks) {
  const out = path.join('music', t.file.replace(/\.[^.]+$/, '.lrc'));
  if (fs.existsSync(out) && !process.argv.includes('--force')) { console.log(`skip  ${t.title} (already have ${path.basename(out)})`); continue; }
  const r = await lookup(t.artist, t.title, t.duration);
  if (!r || !r.lyrics) { console.log(`MISS  ${t.artist} / ${t.title}`); continue; }
  fs.writeFileSync(out, r.lyrics.endsWith('\n') ? r.lyrics : r.lyrics + '\n');
  const n = r.lyrics.split('\n').filter(Boolean).length;
  console.log(`write ${path.basename(out)}  ${n} timed lines  (matched ${r.artist} / ${r.track}, Δ${r.diff}s)`);
}
