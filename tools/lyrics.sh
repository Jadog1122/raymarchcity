#!/bin/zsh
# usage: tools/lyrics.sh song.mp3 [locale] > song.lrc   (offline, macOS speech recognition; first run asks for permission)
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/Lyrics.app/Contents/MacOS/lyrics" "$@"
