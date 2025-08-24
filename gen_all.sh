bash gen.sh lao "#770000" "#DD4466"
bash gen.sh khmer "#770044" "#DDDDDD"
bash gen.sh chitonga "#666600" "#5588ff"
bash gen.sh lozi "#3300BB" "#995500"

index="$(ls -d */ | grep -v '_example/' | sed -e 's/\b\([^\/]*\)\//<li><a href="\1\/">\1 dictionary<\/a><\/li>/g' | sed -e 's/>[a-z]/\U&/g')"
sed -n -e '1,/<ul id="index"/p' index.html > index.bak
echo "$index" >> index.bak
sed -n -e '/<\/ul>/,$p' index.html >> index.bak
mv index.bak index.html
