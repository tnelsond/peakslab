#!/bin/sh
# The Khmer Holy Study Bible's notes and cross references (two Limon-encoded
# PDFs from the Bible League Cambodia) as a peakslab Bible-notes module keyed
# to KHOV: dict_src/khmer/bible-extra/khovstudy.tsv
#
# Usage: utils/khmerstudybible/run.sh <Old Testament.pdf> <New Testament.pdf> [workdir]
# Needs: pdfplumber, zstandard (pip); node with khmer-unicode-converter (npm i)
set -e
HERE=$(dirname "$0")
OT=$1; NT=$2; W=${3:-/tmp/khmerstudybible}
mkdir -p "$W" dict_src/khmer/bible-extra
python3 "$HERE/khovverses.py" khmer/bible/text/khov.peak.zst "$W"
export KHOV_VERSES="$W/khov_verses.json"
[ -s "$W/ot.jsonl" ] || python3 "$HERE/extract.py" "$OT" "$W/ot.jsonl"   # (slow: ~5 min each)
[ -s "$W/nt.jsonl" ] || python3 "$HERE/extract.py" "$NT" "$W/nt.jsonl"
python3 "$HERE/parse.py" "$W/ot.jsonl" "$W/ot_parsed.json"
python3 "$HERE/parse.py" "$W/nt.jsonl" "$W/nt_parsed.json"
python3 "$HERE/build.py" "$W/khov_verses.json" dict_src/khmer/bible-extra/khovstudy.tsv "$W/ot_parsed.json" "$W/nt_parsed.json"
./peakgen dict_src/khmer/bible-extra/khovstudy.tsv
