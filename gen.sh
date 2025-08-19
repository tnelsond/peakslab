#!/bin/bash

u=${1^}
db=$(find $1 -iname "*.db.*" ! -iname "*ass.db.*" -printf "%P")
dbass=$(find $1 -iname "*ass.db.*" -printf "%P")
echo "$db"
echo "$dbass"
mkdir -p $1
cp -u _example/* $1/
sed -e "s/@XXXX/$1/g; s/@UXXXX/$u/g; s/@DB/$db/g; s/@ASSDB/$dbass/g;" _example/index.html > $1/index.html
sed -e "s/@XXXX/$1/g; s/@DB/$db/g; s/@ASSDB/$dbass/g;" _example/dictsw.js | sed -e "/^ *'',/d"  > $1/dictsw.js
sed -e "s/@XCOLOR/$2/; s/@X2COLOR/$3/; s/@UXXXX/$u/g; s/@XXXX/$1/g;" _example/manifest.json > $1/manifest.json
