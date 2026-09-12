// Builds music/manifest.json: the track list the page shows when it is served over http.
// usage: node tools/scan-music.mjs [--lyrics]      (--lyrics also checks that timed lyrics exist)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';

const DIR = 'music';
const AUDIO = /\.(mp3|m4a|wav|flac|ogg|aac)$/i;

// "Artist - Title (Official Audio).mp3" -> { artist, title }
export function parseName(file){
  let s = file.replace(/\.[^.]+$/, '');
  s = s.replace(/[（(\[【][^）)\]】]*(?:official|audio|video|mv|lyric|hd|4k|live|完整版|官方|高清|字幕)[^）)\]】]*[）)\]】]/gi, ' ');
  s = s.replace(/\s*[-–—]\s*(?:topic|official)\s*$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  const m = s.split(/\s+[-–—]\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  return { artist: '', title: s };
}
export function duration(file){
  try {
    const out = execFileSync('afinfo', [file], { encoding: 'utf8' });
    const m = out.match(/estimated duration:\s*([\d.]+)/i);
    if (m) return Math.round(+m[1]);
  } catch {}
  return 0;
}
// "張惠妹 A-Mei" -> ["張惠妹 A-Mei", "張惠妹", "A-Mei"] so bilingual names can be queried either way
export function variants(s){
  const out = [s];
  const cjk = (s.match(/[\u3400-\u9fff\u3040-\u30ff]+/g) || []).join(' ').trim();
  const latin = s.replace(/[\u3400-\u9fff\u3040-\u30ff]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cjk && cjk !== s) out.push(cjk);
  if (latin && latin !== s && latin.length > 1) out.push(latin);
  return [...new Set(out.filter(Boolean))];
}
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function artistMatches(found, wanted){
  const f = norm(found);
  return wanted.some(w => { const n = norm(w); return n.length > 1 && (f.includes(n) || n.includes(f)); });
}
// Finds timed lyrics for one track. Exact match first, then searches; candidates are scored by
// duration distance and whether the artist actually matches, so same-title songs are not picked up.
export async function lookup(artist, title, dur, opts = {}){
  const UA = { 'User-Agent': 'raymarchcity/1.0 (personal music visualiser)' };
  const A = variants(artist).filter(Boolean), T = variants(title);
  const seen = new Set(); const cands = [];
  for (const a of A) for (const t of T){
    const u = `https://lrclib.net/api/get?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}&duration=${dur}`;
    const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r && r.ok){ const j = await r.json(); if (j.syncedLyrics) return { lyrics: j.syncedLyrics, via: 'exact', artist: j.artistName, track: j.trackName, diff: 0 }; }
  }
  const queries = [];
  for (const a of A) for (const t of T) queries.push(`${a} ${t}`);
  for (const t of T) queries.push(t);
  for (const q of queries){
    if (seen.has(q)) continue; seen.add(q);
    const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { headers: UA }).catch(() => null);
    if (!r || !r.ok) continue;
    const list = (await r.json()).filter(x => x.syncedLyrics);
    for (const x of list){
      const dd = Math.abs(x.duration - dur);
      if (dd > 6) continue;
      const ok = A.length ? artistMatches(x.artistName, A) : true;
      cands.push({ x, score: dd + (ok ? 0 : 100), ok, dd, q });
    }
    if (cands.some(c => c.ok && c.dd <= 2)) break;                 // good enough, stop hitting the API
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.score - b.score);
  const best = cands[0];
  if (!best.ok && !opts.allowArtistMismatch) return { ambiguous: true, artist: best.x.artistName, track: best.x.trackName, diff: best.dd };
  return { lyrics: best.x.syncedLyrics, via: `search "${best.q}"`, artist: best.x.artistName, track: best.x.trackName, diff: best.dd };
}

// The manifest names what the repo actually carries. A track that is gitignored will 404 on the
// published site, so it must not appear here either — the allowlist in .gitignore is the one source
// of truth for "what ships", and this reads it rather than keeping a second copy of the decision.
function shipped(f){
  try { execFileSync('git', ['check-ignore', '-q', path.join(DIR, f)], { stdio: 'ignore' }); return false; }
  catch { return true; }                                   // non-zero exit from check-ignore = not ignored
}
const all = fs.readdirSync(DIR).filter(f => AUDIO.test(f)).sort();
const files = all.filter(shipped);
const held = all.filter(f => !shipped(f));
if (held.length) console.log(`  (${held.length} 个本地文件不进 manifest，因为 .gitignore 挡着：${held.join(', ')})`);
const tracks = files.map(f => { const { artist, title } = parseName(f); return { file: f, artist, title, duration: duration(path.join(DIR, f)) }; });
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ tracks }, null, 2) + '\n');
console.log(`manifest.json: ${tracks.length} tracks`);
for (const t of tracks) console.log(`  ${String(t.duration).padStart(4)}s  ${t.artist || '(no artist)'}  |  ${t.title}`);
if (process.argv.includes('--lyrics')){
  console.log('\nlyrics lookup:');
  for (const t of tracks){
    const r = await lookup(t.artist, t.title, t.duration);
    const n = r && r.lyrics ? r.lyrics.split('\n').filter(Boolean).length : 0;
    console.log(`  ${t.artist} / ${t.title}`);
    console.log(`    ${!r ? 'NOT FOUND' : r.ambiguous ? `AMBIGUOUS: closest is ${r.artist} / ${r.track} (Δ${r.diff}s) — artist does not match` : `${n} timed lines, Δ${r.diff}s, via ${r.via} -> ${r.artist} / ${r.track}`}`);
  }
}
