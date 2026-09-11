// Builds a single self-contained page: index.html with the tracks in music/ and their lyrics embedded.
// Chrome gives every file:// document its own opaque origin, so a double-clicked page cannot read a
// sibling mp3 at all — neither by fetch nor through an <audio> element. Inlining is the only way to
// make the double-click case work offline.
import fs from 'node:fs'; import path from 'node:path';

const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg' };
const man = JSON.parse(fs.readFileSync('music/manifest.json', 'utf8'));
const tracks = man.tracks.map(t => {
  const audioPath = path.join('music', t.file);
  const lrcPath = path.join('music', t.file.replace(/\.[^.]+$/, '.lrc'));
  const bytes = fs.readFileSync(audioPath);
  const mime = MIME[path.extname(t.file).toLowerCase()] || 'application/octet-stream';
  return {
    artist: t.artist, title: t.title, duration: t.duration,
    audio: `data:${mime};base64,` + bytes.toString('base64'),
    lrc: fs.existsSync(lrcPath) ? fs.readFileSync(lrcPath, 'utf8') : null,
    _mb: bytes.length / 1048576
  };
});
const payload = tracks.map(({ _mb, ...t }) => t);
let html = fs.readFileSync('index.html', 'utf8');
// three.js has to travel with the page too: offline means offline, and the importmap points at a CDN.
// Import maps accept a data: URL as an address, so the module specifier still resolves.
const threePath = 'vendor/three.module.js';
if (!fs.existsSync(threePath)) { console.error(`missing ${threePath} — run: curl -sL https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js -o ${threePath}`); process.exit(1); }
const threeURI = 'data:text/javascript;base64,' + fs.readFileSync(threePath).toString('base64');
html = html.replace(/"three":\s*"[^"]*"/, () => '"three": ' + JSON.stringify(threeURI));
const inject = `<script>window.__BUNDLE = ${JSON.stringify({ tracks: payload })};</script>\n`;
const marker = '<script type="importmap">';
if (!html.includes(marker)) { console.error('could not find the injection point'); process.exit(1); }
const out = html.replace(marker, inject + marker);
const dest = process.argv[2] || 'nightcity.html';
fs.writeFileSync(dest, out);
for (const t of tracks) console.log(`  ${t.artist} / ${t.title}  ${t._mb.toFixed(1)} MB audio, ${t.lrc ? t.lrc.split('\n').filter(Boolean).length + ' lyric lines' : 'NO LYRICS'}`);
console.log(`${dest}: ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB`);
