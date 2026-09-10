#!/bin/bash
# gen_manifest.sh - Combines all .meta files into files.json
# and merges abbreviations from abbreviations.json
# Usage: ./createdictlist.sh [search_dir]   (default: meta/)
# Output format:
# {
#   "core":  [ [file, timestamp], ... ],
#   "dicts": [ [file, description, buflen, priority, timestamp], ... ],
#   "abbr": {
#     "khmer": ["km", "ខ"],
#     "music": ["mus", "𝄞"],
#     ...
#   }
# }
# Dictionaries (.peak, .peak.zst, .slab, .slab.zst) go under "dicts".
# All other files go under "core" (filename + timestamp only).
# Each abbr value is [romanized, symbolic] (or more elements if provided).
# Each abbr entry is written on a single line.

OUT="files.json"
SEARCH_DIR="${1:-meta}"
ABBR_FILE="abbreviations.json"

CORE_TMP=$(mktemp)
DICTS_TMP=$(mktemp)
trap 'rm -f "$CORE_TMP" "$DICTS_TMP"' EXIT

CORE_FIRST=1
DICTS_FIRST=1

find "$SEARCH_DIR" -name "*.meta" -print0 | sort -z | while IFS= read -r -d '' metafile; do
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

    # Strip tabs/control chars and trim trailing whitespace from all string fields.
    # Raw tabs/newlines are illegal inside JSON string literals.
    file="${file//$'\t'/ }"
    file="${file%"${file##*[![:space:]]}"}"
    desc="${desc//$'\t'/ }"
    desc="${desc%"${desc##*[![:space:]]}"}"

    # Escape backslashes and double quotes for JSON safety
    file="${file//\\/\\\\}"
    file="${file//\"/\\\"}"
    desc="${desc//\\/\\\\}"
    desc="${desc//\"/\\\"}"

    # Classify: dictionaries vs core
    case "$file" in
        *.peak|*.peak.zst|*.slab|*.slab.zst)
            if [ "$DICTS_FIRST" -eq 1 ]; then
                DICTS_FIRST=0
            else
                printf ",\n" >> "$DICTS_TMP"
            fi
            printf '    ["%s", "%s", %s, %s, %s]' "$file" "$desc" "$buflen" "$priority" "$timestamp" >> "$DICTS_TMP"
            ;;
        *)
            if [ "$CORE_FIRST" -eq 1 ]; then
                CORE_FIRST=0
            else
                printf ",\n" >> "$CORE_TMP"
            fi
            printf '    ["%s", %s]' "$file" "$timestamp" >> "$CORE_TMP"
            ;;
    esac

done

# Assemble final JSON
{
    echo "{"
    echo '  "core": ['
    if [ -s "$CORE_TMP" ]; then
        cat "$CORE_TMP"
        echo
    fi
    echo '  ],'
    echo '  "dicts": ['
    if [ -s "$DICTS_TMP" ]; then
        cat "$DICTS_TMP"
        echo
    fi
    echo '  ],'

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
'
        else
            # Fallback: minify whole object onto fewer lines
            echo '  "abbr":'
            cat "$ABBR_FILE" | tr -d '\n' | sed 's/  */ /g; s/^/  /'
            echo
        fi
    else
        echo '  "abbr": {}'
    fi

    echo "}"
} > "$OUT"

echo "Written to $OUT (with abbr from $ABBR_FILE)"
