#!/bin/sh
for src in "$@"; do
  outpath="${src/\/src\//\/db\/}"
  outpath="${outpath%.*}.peak.zst"
  echo "Running: ./peakgen \"$src\" \"$outpath\""
  ./peakgen "$src" "$outpath"
done
