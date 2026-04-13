#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

my $prevh = "";
my $prevb = "";

while(<>){
	chomp;
	my ($h, $b) = /^([^\t]*)\t(.*)/;
	if($h eq $prevh){
		$prevb .= "\t<br>\@$b";
	}else{
		print "$prevh\t\@$prevb\n" if($prevh);
		$prevh = $h;
		$prevb = $b;
	}
}
print "$prevh\t$prevb";
