#!/bin/bash
# Fetch the map pages and every image the commentary/dictionary pages use,
# converting them to small webp for embedding.
# Usage: fetchimg.sh <rawdir> <imgdir>
RAW="$1"; IMG="$2"
mkdir -p "$IMG/orig"
for m in $(grep -ho "/dictionary/map-[a-z-]*\.html" "$RAW"/dictionary/*.html | sort -u); do
	f="$RAW/dictionary/$(basename "$m")"
	[ -s "$f" ] || { curl -sfL "https://laobible.net$m" -o "$f"; sleep 0.2; }
done
grep -ho "src='/[a-z]*/[a-z]*/[^']*'" "$RAW"/commentary/*.html "$RAW"/dictionary/*.html \
	| sed "s/src='//;s/'$//" | sort -u | while read -r src; do
	o="$IMG/orig/$(basename "$src")"
	[ -s "$o" ] || { curl -sfL "https://laobible.net$src" -o "$o"; sleep 0.2; }
	# Maps and diagrams keep more detail than the photos
	case "$src" in *.png) w=900; q=70 ;; *) w=480; q=60 ;; esac
	magick "$o" -resize "${w}x${w}>" -quality $q "$IMG/$(basename "${src%.*}").webp"
done
du -ch "$IMG"/*.webp | tail -1
