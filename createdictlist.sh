#!/bin/bash
# gen_manifest.sh - Combines all .meta files into files.json
# and merges abbreviations from abbreviations.json
# Usage: ./createdictlist.sh [search_dir]   (default: meta/)
# Output format:
# {
#   "files": [ [file, description, buflen, priority, timestamp], ... ],
#   "abbr": {
#     "khmer": ["km", "ខ"],
#     "music": ["mus", "𝄞"],
#     ...
#   }
# }
# Each abbr value is [romanized, symbolic] (or more elements if provided).
# Each abbr entry is written on a single line.

OUT="files.json"
SEARCH_DIR="${1:-meta}"
ABBR_FILE="abbreviations.json"
FIRST=1

echo "{" > "$OUT"
echo '  "files": [' >> "$OUT"

while IFS= read -r -d '' metafile; do
    desc=""
    priority=""
    file=""
    timestamp=""
    buflen=""

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"  # strip Windows \r if present
        case "$line" in
            "#d"*)  desc="${line:3}"      ;;
            "#p"*)  priority="${line:3}"; priority="${priority%%[[:space:]]*}"      ;;
            "#f"*)  file="${line:3}"      ;;
            "#t"*)  timestamp="${line:3}"; timestamp="${timestamp%%[[:space:]]*}" ;;
            "#b"*)  buflen="${line:3}"; buflen="${buflen%%[[:space:]]*}" ;;
        esac
    done < "$metafile"

    # Strip any tabs/embedded control chars and trim trailing whitespace so
    # no raw control characters end up inside the JSON string (raw tabs or
    # newlines are illegal in JSON string literals and break parsers).
    desc="${desc//$'\t'/ }"
    desc="${desc%"${desc##*[![:space:]]}"}"  # trim trailing whitespace

    # Escape backslashes and double quotes in desc for JSON safety
    desc="${desc//\\/\\\\}"
    desc="${desc//\"/\\\"}"

    [ "$FIRST" -eq 1 ] && FIRST=0 || printf ",\n" >> "$OUT"

    printf '    ["%s", "%s", %s, %s, %s]' "$file" "$desc" "$buflen" "$priority" "$timestamp" >> "$OUT"

done < <(find "$SEARCH_DIR" -name "*.meta" -print0 | sort -z)

printf "\n  ],\n" >> "$OUT"

# Merge abbreviations under compact key "abbr"
# Each entry is forced onto a single line:  "khmer": ["km", "ខ"],
if [ -f "$ABBR_FILE" ]; then
    if command -v python3 >/dev/null 2>&1; then
        python3 -c '
import json
with open("'"$ABBR_FILE"'") as f:
    abbr = json.load(f)
print("  \"abbr\": {")
keys = list(abbr.keys())
for i, k in enumerate(keys):
    # separators=(", ", ": ") keeps spaces after commas/colons; no indent/newlines inside the value
    line = json.dumps(k, ensure_ascii=False) + ": " + json.dumps(abbr[k], ensure_ascii=False, separators=(", ", ": "))
    comma = "," if i < len(keys) - 1 else ""
    print("    " + line + comma)
print("  }")
' >> "$OUT"
    else
        # Fallback: minify whole object onto fewer lines
        echo '  "abbr":' >> "$OUT"
        cat "$ABBR_FILE" | tr -d '\n' | sed 's/  */ /g; s/^/  /' >> "$OUT"
        echo >> "$OUT"
    fi
else
    echo '  "abbr": {}' >> "$OUT"
fi

printf "\n}\n" >> "$OUT"
echo "Written to $OUT (with abbr from $ABBR_FILE)"
