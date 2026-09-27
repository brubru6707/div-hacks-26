#!/usr/bin/env bash
#
# pull_recordings.sh -- copy the full-rate (15 fps) recordings off the Pi.
# Run on the Mac, on the same network as the Pi (campus Wi-Fi or the cable):
#
#     ./pi/pull_recordings.sh                 # Pi at its campus Wi-Fi address
#     PI=pi@raspberrypi.local ./pi/pull_recordings.sh
#
# Each recording is <time>_<id>.mjpeg (concatenated JPEGs, 640x480) plus
# <time>_<id>.txt with one line per frame: ms since the recording started.
# The <id> matches the entry on the dashboard's Recordings tab.
# To get an .mp4 to watch:  ffmpeg -f mjpeg -framerate 15 -i X.mjpeg -pix_fmt yuv420p X.mp4
set -euo pipefail

PI="${PI:-pi@10.206.18.8}"
DEST="${DEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/recordings}"

mkdir -p "$DEST"
rsync -av --progress "$PI:barn-owl/recordings/" "$DEST/"
echo "saved to $DEST"
