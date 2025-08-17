#!/bin/bash

u=${1^}
mkdir $1
cp _example/* $1/
sed -e "s/@XXXX/$1/g; s/@UXXXX/$u/g;" _example/index.html > $1/index.html
cp _example/dictsw.js $1/
sed -e "s/@XCOLOR/$2/; s/@X2COLOR/$3/; s/@UXXXX/$u/g; s/@XXXX/$1/g;" _example/manifest.json > $1/manifest.json
sed -e "s/@XXXX/$1/g;" _example/dictsw.js > $1/dictsw.js
