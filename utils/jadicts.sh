#!/bin/bash
# The Japanese dictionaries from FreeMdict (downloads.freemdict.com,
# 100G_Super_Big_Collection/日语), in ~/code/dictworking/japanese/freemdict,
# into dict_src:
#   utils/jadicts.sh [dictworking dir]
set -e
W=${1:-$HOME/code/dictworking}/japanese/freemdict
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
FM='from <a href="https://downloads.freemdict.com/">FreeMdict</a>'
JA='[ぁ-ヿ㐀-鿿〆々]'
mdx() { pyglossary "$W/$1.mdx" "$T/$1.txt" --read-format=OctopusMdict --write-format=Tabfile >/dev/null 2>&1; }
mkdir -p dict_src/japanese/dict dict_src/chinese/dict

mdx daijirin
python3 -I utils/tabtotsv.py $T/daijirin.txt dict_src/japanese/dict/daijirin.tsv "三省堂 大辞林 (Daijirin, Sanseido): its words by their kana and kanji, $FM" 1
mdx shinmeikai
python3 -I utils/tabtotsv.py $T/shinmeikai.txt dict_src/japanese/dict/shinmeikai.tsv "新明解国語辞典 (Shin Meikai Kokugo Jiten, Sanseido), its words by their kana, $FM" 2

# GENIUS, Japanese–English and English–Japanese in one: the Japanese words here, the English there
mdx genius
python3 -I utils/tabtotsv.py $T/genius.txt $T/genius.tsv x
python3 -I utils/freemdictfix.py split $T/genius.tsv "$JA" dict_src/japanese/dict/geniusjaen.tsv dict_src/japanese/dict/geniusenja.tsv \
	"ジーニアス和英辞典 (Genius Japanese–English, Taishukan), $FM" "ジーニアス英和辞典 (Genius English–Japanese, Taishukan), $FM" 1 bi rbi

# Shogakukan's Japanese–Chinese and Chinese–Japanese: the Chinese in Chinese
mdx jazh
python3 -I utils/tabtotsv.py $T/jazh.txt dict_src/japanese/dict/jazh.tsv "小学馆日汉辞典 (Shogakukan Japanese–Chinese), $FM" 3 ja,zh
mdx zhja
python3 -I utils/tabtotsv.py $T/zhja.txt dict_src/chinese/dict/zhja.tsv "小学馆中日辞典 (Shogakukan Chinese–Japanese), $FM" 3 zh,ja
