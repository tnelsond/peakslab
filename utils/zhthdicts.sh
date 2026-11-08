#!/bin/bash
# The Chinese and Thai dictionaries from FreeMdict (downloads.freemdict.com,
# 100G_Super_Big_Collection/汉语, 泰语) and the Collins Chinese–English (its
# ABBYY Lingvo edition), in ~/code/dictworking/{chinese,thai}, into dict_src:
#   utils/zhthdicts.sh [dictworking dir]
# (moedict, 台湾教育部国语辞典.mdx, left out: FreeMdict's copy has its
# entries cut up across its keys and two blocks that don't decompress)
set -e
W=${1:-$HOME/code/dictworking}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
FM='from <a href="https://downloads.freemdict.com/">FreeMdict</a>'
mdx() { pyglossary "$1" "$T/$2.txt" --read-format=OctopusMdict --write-format=Tabfile >/dev/null 2>&1; }
mkdir -p dict_src/chinese/dict dict_src/chinese/bible/dict dict_src/thai/dict

Z=$W/chinese/freemdict
mdx $Z/xinhua.mdx xinhua
python3 -I utils/tabtotsv.py $T/xinhua.txt dict_src/chinese/dict/zh-xinhua.tsv "超级新华字典 (Super Xinhua Dictionary): characters and words, their pinyin, meanings, sources and English, $FM" 1
mdx $Z/xiandai5.mdx xiandai
python3 -I utils/tabtotsv.py $T/xiandai.txt dict_src/chinese/dict/zh-xiandai.tsv "现代汉语词典 第5版 (Contemporary Chinese Dictionary, 5th edition, 2005), $FM" 2
mdx $Z/chengyu.mdx chengyu
python3 -I utils/tabtotsv.py $T/chengyu.txt dict_src/chinese/dict/zh-chengyu.tsv "中華成語大詞典 (Chinese idioms, in traditional characters: their pinyin, meaning, source, an example, similar and opposite idioms, English), $FM" 2
mdx $Z/strongs-zh.mdx strongs
python3 -I utils/tabtotsv.py $T/strongs.txt $T/en-strongs.tsv "圣经原文编号词典 (Strong's Greek and Hebrew lexicon in Chinese), $FM" 2
python3 -I utils/freemdictfix.py strongs $T/en-strongs.tsv dict_src/chinese/bible/dict/zh-strongs.tsv
7z x -y -o"$T/zh-collins" "$W/chinese/Collins Chinese-English Dictionary.7z" >/dev/null
pyglossary "$T/zh-collins/CollinsChEn.dsl" $T/collins.txt --read-format=ABBYYLingvoDSL --write-format=Tabfile >/dev/null 2>&1
python3 -I utils/tabtotsv.py $T/collins.txt dict_src/chinese/dict/zh-collins.tsv "Collins Chinese Dictionary (2nd edition, 2006) Chinese–English: 36,000 headwords, with pinyin, examples and synonyms" 1 bi

H=$W/thai/freemdict
mdx $H/lexitron.mdx lexitron
python3 -I utils/tabtotsv.py $T/lexitron.txt $T/lexitron.tsv x
python3 -I utils/freemdictfix.py lexitron $T/lexitron.tsv dict_src/thai/dict/th-lexitron-th.tsv dict_src/thai/dict/th-lexitron-en.tsv \
	"LEXiTRON Thai–English (NECTEC), $FM" "LEXiTRON English–Thai (NECTEC), $FM" 1
mdx $H/thai-eng-chi.mdx thaienzh
python3 -I utils/tabtotsv.py $T/thaienzh.txt dict_src/thai/dict/th-enzh.tsv "泰文释英及汉辞典: Thai to English and Chinese (its Chinese machine translated), $FM" 3 th,en,zh
