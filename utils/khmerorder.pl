#!/usr/bin/perl
# Puts Khmer marks in one order, so the same word is spelled with the same
# characters everywhere: a consonant, its robat (៌), its subscripts (្ + a
# consonant), then its shifter (៉ ៊), vowel and other signs. Fixes vowels
# typed before the subscript they go under (ស្រី្ត -> ស្ត្រី, មា្នល ->
# ម្នាល), and makes the shifter go after the subscript (ម៉្លេះ -> ម្ល៉េះ)
# and the robat before it, as most of the text has them.
#
# Usage: utils/khmerorder.pl file.tsv ...   (in place; prints the files it changed)
use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));

my $sub = qr/(?:\x{17D2}[\x{1780}-\x{17A2}])+/;        # Subscripts
my $marks = qr/[\x{17B6}-\x{17CB}\x{17CD}-\x{17D1}\x{17D3}\x{17DD}]+/; # Shifters, vowels, signs (not the robat)

for my $file (@ARGV){
	open(my $in, '<', $file) or die "$file: $!";
	local $/;
	my $text = <$in>;
	close $in;
	my $n = 0;
	1 while ($text =~ s/($sub)(\x{17CC})/$2$1/g && ++$n);   # Robat before subscripts
	1 while ($text =~ s/($marks)($sub)/$2$1/g && ++$n);     # Subscripts before the rest
	next unless $n;
	open(my $out, '>', $file) or die "$file: $!";
	print $out $text;
	close $out;
	print "$file\n";
}
