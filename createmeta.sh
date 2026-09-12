#!/bin/bash
# Check if a filename was provided
if [[ $# -eq 0 ]]; then
    echo "Usage: ./createmeta <filename>"
    exit 1
fi

filename="$1"
timestamp=$(date +%s)
mkdir -p meta
metafile="meta/${filename}.meta"
echo "#f	${filename}" > "$metafile"
echo "#t	${timestamp}" >> "$metafile"
echo "Created $metafile"
