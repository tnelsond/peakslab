#!/bin/sh

temp="asldkfjasdfjkoijklasdfj.tmp"
echo '#no sort' > $temp
sort -V $1 | sed -e 's/^(..) @//' >> $temp
mv $temp $1
