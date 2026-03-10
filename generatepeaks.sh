#!/bin/dash

new_dir="db/"
new_ext="peak"


for arg in "$@"; do
	filename=$(basename "$arg")
	filename_no_ext="${filename%.*}"
	new_filepath="$new_dir/$filename_no_ext.$new_ext"
  ../peakgen $arg $new_filepath
	zstd -k -19 -f $new_filepath
done

