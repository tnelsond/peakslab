#!/bin/bash
# gen_manifest.sh - Combines all .meta files into manifest.json
# Usage: ./gen_manifest.sh [search_dir]   (default: meta/)
# Output format per entry: [file, description, priority, timestamp]

OUT="files.json"
SEARCH_DIR="${1:-meta}"
FIRST=1

echo "[" > "$OUT"

while IFS= read -r -d '' metafile; do
    desc=""
    priority=""
    file=""
    timestamp=""

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"  # strip Windows \r if present
        case "$line" in
            "#d"*)  desc="${line:3}"      ;;
            "#p"*)  priority="${line:3}"  ;;
            "#f"*)  file="${line:3}"      ;;
            "#t"*)  timestamp="${line:3}" ;;
        esac
    done < "$metafile"

    # Escape backslashes and double quotes in desc for JSON safety
    desc="${desc//\\/\\\\}"
    desc="${desc//\"/\\\"}"

    [ "$FIRST" -eq 1 ] && FIRST=0 || printf ",\n" >> "$OUT"

    printf '  ["%s", "%s", %s, %s]' "$file" "$desc" "$priority" "$timestamp" >> "$OUT"

done < <(find "$SEARCH_DIR" -name "*.meta" -print0 | sort -z)

printf "\n]\n" >> "$OUT"
echo "Written to $OUT"
