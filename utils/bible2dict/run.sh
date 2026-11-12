#!/bin/sh
# Khmer <-> English Bible glosses for PeakSlab, from word-aligning every Khmer
# Bible with every English one (eflomal): one dictionary, Khmer headwords and
# English ones, dict_src/khmer/bible/dict/km-bible-align.tsv.
#
# Usage: utils/bible2dict/run.sh WORKDIR KHMER.tsv... -- ENGLISH.tsv...
#   e.g. utils/bible2dict/run.sh /tmp/b2d dict_src/khmer/bible/text/km-*.tsv -- \
#        dict_src/english/bible/text/en-{bsb,ULB,asv,kjv}.tsv en-web.tsv en-bbe.tsv en-erv.tsv
#   (a Bible's name is its file's: km-khsv.tsv is KHSV)
# Needs: pip install eflomal spacy khmer-nltk && python3 -m spacy download en_core_web_sm
set -e
W=$1; shift; D=$(dirname "$0")
mkdir -p "$W"
# Khmer words: the Khmer dictionaries' headwords (a Bible's pieces of one, ផ្ទៃ​មេឃ, are one word)
cut -f1 dict_src/khmer/dict/km-nath2022.tsv dict_src/khmer/dict/km-h97.tsv dict_src/khmer/dict/km-wiktionary.tsv \
	dict_src/khmer/dict/km-kaikki.tsv | sed 's/\xe2\x80\x8b//g' | grep -P '^[\x{1780}-\x{17FF}]{2,}$' | sort -u > "$W/km-words.txt"
[ -s "$W/corpus.km" ] || { python3 "$D/prep.py" "$W" "$W/km-words.txt" "$@" && python3 "$D/build_corpus.py" "$W"; }  # clean, tokenize, pair every Khmer x English Bible verse by verse (kept: delete corpus.km to redo)
# aligned all at once (PIECE=0), or in pieces of PIECE verse pairs, in order: eflomal's
# memory grows with the corpus (all of it, 1.2 million: about 3 GB), and a piece's statistics are its own
PIECE=${PIECE:-0}
rm -f "$W"/piece.* "$W/fwd.align" "$W/rev.align"
L=$PIECE; [ "$L" -gt 0 ] || L=$(wc -l < "$W/corpus.km")
split -l "$L" -d -a 3 "$W/corpus.km" "$W/piece.km."
split -l "$L" -d -a 3 "$W/corpus.en" "$W/piece.en."
for k in "$W"/piece.km.*; do
	n=${k##*.}
	eflomal-align -s "$k" -t "$W/piece.en.$n" -f "$W/piece.fwd.$n" -r "$W/piece.rev.$n" -m 3 --overwrite
	cat "$W/piece.fwd.$n" >> "$W/fwd.align"; cat "$W/piece.rev.$n" >> "$W/rev.align"
	rm "$k" "$W/piece.en.$n" "$W/piece.fwd.$n" "$W/piece.rev.$n"
done
python3 "$D/extract.py" "$W"                # count aligned word/phrase pairs
python3 "$D/build_dict.py" "$W" "${OUT:-dict_src/khmer/bible/dict/km-bible-align.tsv}"
