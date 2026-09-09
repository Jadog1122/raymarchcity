#!/bin/zsh
# usage: tools/lyrics.sh song.mp3 [locale]   -> writes song.lrc next to the audio (offline macOS speech recognition).
# Launched through LaunchServices so the system permission dialog is attributed to "Lyrics", not to the terminal.
DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIO="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
open -W -a "$DIR/Lyrics.app" --args "$AUDIO" "${2:-en-US}"
OUT="${AUDIO%.*}.lrc"
[ -f "$OUT" ] && cat "$OUT" || { echo "no lyrics written (check System Settings > Privacy & Security > Speech Recognition)"; exit 1; }
