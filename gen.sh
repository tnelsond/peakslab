#!/bin/bash

u=${1^}
mkdir $1
sed -e "s/@XXXX/$1/g; s/@UXXXX/$u/g; s/@XBGCOLOR/$2/;" _example/index.html > $1/index.html
cp _example/dictsw.js $1/
sed -e "s/@XCOLOR/$3/; s/@X2COLOR/$4/" _example/manifest.json > $1/manifest.json
