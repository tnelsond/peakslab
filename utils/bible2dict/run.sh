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
[ -s "$W/corpus.km" ] || { python3 "$D/prep.py" "$W" "$@" && python3 "$D/build_corpus.py" "$W"; }  # clean, tokenize, pair every Khmer x English Bible verse by verse (kept: delete corpus.km to redo)
# aligned in pieces (PIECE verse pairs each: eflomal's memory grows with the corpus), in order
PIECE=${PIECE:-250000}
rm -f "$W"/piece.* "$W/fwd.align" "$W/rev.align"
split -l "$PIECE" -d -a 3 "$W/corpus.km" "$W/piece.km."
split -l "$PIECE" -d -a 3 "$W/corpus.en" "$W/piece.en."
for k in "$W"/piece.km.*; do
	n=${k##*.}
	eflomal-align -s "$k" -t "$W/piece.en.$n" -f "$W/piece.fwd.$n" -r "$W/piece.rev.$n" -m 3 --overwrite
	cat "$W/piece.fwd.$n" >> "$W/fwd.align"; cat "$W/piece.rev.$n" >> "$W/rev.align"
	rm "$k" "$W/piece.en.$n" "$W/piece.fwd.$n" "$W/piece.rev.$n"
done
python3 "$D/extract.py" "$W"                # count aligned word/phrase pairs
python3 "$D/build_dict.py" "$W" dict_src/khmer/bible/dict/km-bible-align.tsv
