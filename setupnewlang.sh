#!/bin/sh

if [ $# -eq 0 ]; then
    >&2 echo "USAGE: ./setupnewlang.sh NEWNAME APPNAME LANG_CODE"
    exit 1
fi

cp -R chitonga $1
capital=${1^}
sed $1/config.js -e "s/chitonga/$1/g; s/Chitonga/$capital/g; s/toi_ZM/$3/g; s/tonga/$2/g" -i
sed $1/manifest.json -e "s/chitonga/$1/g; s/Chitonga/$capital/g;" -i
rm $1/src/*
rm $1/db/*
sed index.html -e "s/^<\/ul>$/<li><a href=\"$1\/\">$capital dictionary<\/a><\/li>\n&/" -i
sed sw.js -e "s/\t'\/khmer\/'.*/\
\t'\/$1\/': 'v1',\n\
\t'\/$1\/config.js': 'v1',\n\
\t'\/$1\/manifest.json': 'v1',\n\
\n&/" -i
