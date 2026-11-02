#!/bin/bash
# Encode recordings as .tnefar files for a media slab.
#
#   utils/tnefar/encode.sh voice.fcq bps out_dir in.f32...      FARGAN features (20 floats a frame)
#   utils/tnefar/encode.sh voice.fcq bps out_dir in.m4a...      any audio ffmpeg reads
#
# out_dir/<name>.tnefar for each input. Audio is made 16 kHz mono and its features taken with
# opus' fargan_demo; for words cut out of longer recordings, slice.py gives better starts (the
# features of the whole recording, cut). Needs fcq and fargan_demo from the fcq tree (opus2/zclaude):
# FCQ=... FARGAN_DEMO=... to say where. The voice is the one tnefar.wasm has built in (voice/).
set -e
FCQ=${FCQ:-fcq}; FARGAN_DEMO=${FARGAN_DEMO:-fargan_demo}
[ $# -ge 4 ] || { sed -n 2,11p "$0"; exit 1; }
voice=$1 bps=$2 out=$3; shift 3
mkdir -p "$out"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
one() {
	local in=$1 name; name=$(basename "${in%.*}")
	local f="$in"
	if [ "${in##*.}" != f32 ]; then
		ffmpeg -nostdin -v error -y -i "$in" -ac 1 -ar 16000 -f s16le "$tmp/$name.pcm"
		"$FARGAN_DEMO" -features "$tmp/$name.pcm" "$tmp/$name.f32" >/dev/null
		f="$tmp/$name.f32"
	fi
	OMP_NUM_THREADS=1 "$FCQ" encode -c "$voice" -i "$f" -o "$out/$name.tnefar" --bps "$bps" >/dev/null 2>&1 ||
		echo "failed: $in" >&2
}
export -f one; export FCQ FARGAN_DEMO voice bps out tmp
printf '%s\0' "$@" | xargs -0 -P "$(nproc)" -I{} bash -c 'one "$1"' _ {}
