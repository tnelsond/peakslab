#!/bin/bash
# Split a big .tsv into x.tsv.1, x.tsv.2, ... on line boundaries so each part
# stays under GitHub's 100 MB file limit. peakgen and the Makefile build the
# parts as one dictionary. The original x.tsv is removed.
# Usage: utils/splittsv.sh dict_src/english/dict/webster.tsv [maxsize]
set -e
if [[ $# -lt 1 || "$1" != *.tsv ]]; then
    echo "Usage: utils/splittsv.sh file.tsv [maxsize, default 90M]"
    exit 1
fi
f="$1"
rm -f "$f".[0-9]*
split -C "${2:-90M}" --numeric-suffixes=1 -a 1 "$f" "$f."
# keep the mtime so make doesn't rebuild an unchanged dictionary
touch -r "$f" "$f".[0-9]*
rm "$f"
ls -l "$f".[0-9]*
