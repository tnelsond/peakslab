#!/bin/bash
# The Korean dictionaries from FreeMdict (downloads.freemdict.com,
# 100G_Super_Big_Collection/韩语), in ~/code/dictworking/korean/freemdict,
# into dict_src:
#   utils/kodicts.sh [dictworking dir]
set -e
W=${1:-$HOME/code/dictworking}/korean/freemdict
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
FM='from <a href="https://downloads.freemdict.com/">FreeMdict</a>'
HANGUL='[가-힣ㄱ-ㆎ]'
mdx() { pyglossary "$W/$1.mdx" "$T/$1.txt" --read-format=OctopusMdict --write-format=Tabfile >/dev/null 2>&1; }
mkdir -p dict_src/korean/dict dict_src/chinese/dict

mdx stdict
# (its words; not their hanja's entries again: a word's 【氣勢】 is in its text)
python3 -I utils/tabtotsv.py $T/stdict.txt $T/ko-stdict.tsv x
python3 -I utils/freemdictfix.py split $T/ko-stdict.tsv "$HANGUL" dict_src/korean/dict/ko-stdict.tsv $T/hanja.tsv \
	"표준국어대사전 (Standard Korean Language Dictionary, National Institute of Korean Language): its words, their hanja, meanings and examples, $FM" x 1 mono x

mdx naver-koen
python3 -I utils/tabtotsv.py $T/naver-koen.txt $T/naver.tsv x
python3 -I utils/freemdictfix.py split $T/naver.tsv "$HANGUL" dict_src/korean/dict/ko-naverkoen.tsv dict_src/korean/dict/ko-naverenko.tsv \
	"Naver Korean–English dictionary, $FM" "Naver English–Korean dictionary, $FM" 1 bi rbi

# Korean–Chinese and Chinese–Korean: the Korean words here, the Chinese in Chinese
mdx kozh
python3 -I utils/tabtotsv.py $T/kozh.txt $T/ko-zh.tsv x
python3 -I utils/freemdictfix.py split $T/ko-zh.tsv "$HANGUL" dict_src/korean/dict/ko-zh.tsv dict_src/chinese/dict/zh-ko.tsv \
	"韩汉辞典: Korean to Chinese, $FM" "汉韩辞典: Chinese to Korean, $FM" 3 ko,zh zh,ko
