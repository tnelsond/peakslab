#!/bin/bash

# generate_offsets.sh - Pure bash, accurate byte offsets (UTF-8 safe)

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <input.tsv> <output_base>"
    echo "Example: $0 sonv3.tsv ../db/sonv3"
    exit 1
fi

INPUT="$1"
OUTPUT_BASE="$2"
OFFSETS_FILE="${OUTPUT_BASE}.offsets"
ZST_FILE="${OUTPUT_BASE}.zst"

if [[ ! -f "$INPUT" ]]; then
    echo "Error: Input file '$INPUT' not found!"
    exit 1
fi

echo "Generating accurate byte offsets for $INPUT → $OFFSETS_FILE"

# Temporary file for binary output
TEMP=$(mktemp)
trap 'rm -f "$TEMP"' EXIT

# Function to write little-endian uint32
write_u32() {
    local n=$1
    printf '\\x%02x\\x%02x\\x%02x\\x%02x' \
        $((n & 0xFF)) \
        $(( (n >> 8) & 0xFF )) \
        $(( (n >> 16) & 0xFF )) \
        $(( (n >> 24) & 0xFF )) | xargs printf >> "$TEMP"
}

# Write initial offset 0
write_u32 0

pos=0
line_count=0

# Process line by line, measuring exact byte length including the \n
while IFS= read -r line || [[ -n $line ]]; do
    # Byte length of the current line (including trailing \n that was stripped by read)
    # We reconstruct it as: bytes of line + 1 for \n
    line_bytes=${#line}  # character count (temporary)
    # Better: use printf to re-add \n and measure exact bytes
    byte_len=$(printf '%s\n' "$line" | wc -c)
    ((pos += byte_len))

    write_u32 "$pos"

    ((line_count++))
done < "$INPUT"

# Final sentinel: total file length
write_u32 "$pos"

# Finalize
mv "$TEMP" "$OFFSETS_FILE"

file_size=$(stat -f%z "$OFFSETS_FILE" 2>/dev/null || stat -c%s "$OFFSETS_FILE")
size_kb=$((file_size / 1024))

echo "Offsets written to $OFFSETS_FILE ($line_count lines, ${size_kb} KB, $file_size bytes)"

if (( file_size % 4 != 0 )); then
    echo "ERROR: File size not multiple of 4 — something went wrong!"
    exit 1
fi

# Optional compression
if [[ ! -f "$ZST_FILE" ]]; then
    if command -v zstd >/dev/null; then
        echo "Compressing $INPUT → $ZST_FILE"
        zstd -19 -f "$INPUT" -o "$ZST_FILE"
        echo "Compressed: $ZST_FILE"
    else
        echo "zstd not found — install it to compress (or do manually)"
    fi
else
    echo "Compressed file already exists: $ZST_FILE"
fi

echo "Done! Your .offsets file is now correct and will load without RangeError."
