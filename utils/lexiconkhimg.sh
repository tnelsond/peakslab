#!/bin/bash
# Fetch the Lexicon KH pictures into their own slab directory, named so each
# groups with its entry ("<khmer>|@<english>.webp"). The list comes from
# lexiconkhtotsv.py. rac-app.com only serves some regions, so anything it
# refuses is tried from the Internet Archive; what neither has is listed.
# Usage: lexiconkhimg.sh [list] [outdir]
LIST="${1:-utils/lexiconkh-images.txt}"
OUT="${2:-dict_src/khmer/dict/tech/lexiconkh-img}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
got=0; missing=0
while IFS=$'\t' read -r url name; do
	[ -s "$OUT/$name" ] && { got=$((got+1)); continue; }
	# (the archive's copies so far are a parked-domain page, which magick rejects)
	if { curl -sfL --max-time 30 -o "$TMP/img" "$url" ||
		curl -sfL --max-time 60 -o "$TMP/img" "https://web.archive.org/web/2id_/$url"; } &&
		magick "$TMP/img" -resize '800x800>' -quality 70 "$OUT/$name" 2>/dev/null; then
		got=$((got+1))
	else
		echo "missing: $url ($name)"; missing=$((missing+1))
	fi
	sleep 0.5
done < "$LIST"
if [ "$got" -gt 0 ] && [ ! -f "$OUT/zzz.meta" ]; then
	printf '#desc\tPictures for Lexicon KH from the National Council of Khmer Language\n#priority\t3\n#no compress\n' > "$OUT/zzz.meta"
fi
echo "$got images, $missing missing"
