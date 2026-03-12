#/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

my %abr = qw(JHN JOH
						JOL JOE
						PHP PHI
						EZK EZE
						SNG SOL
						1JN 1JO
						2JN 2JO
						3JN 3JO
						JAS JAM
						MRK MAR);
my $bookabr = "NULL";
my $book = "NULL";
my $chapter = "NULL";
while(<>){
	if(/^\\id (.*)/){
		$bookabr = $abr{$1};
		if(!$bookabr){$bookabr = $1}
	}elsif(/^\\h (.*)/){
		$book = $1;
	}elsif(/^\\c (.*)/){
		$chapter = $1;
	}elsif(/^\\v ([0-9]+) (.*)/){
		print "$bookabr $chapter:$1\t<p-n>\@$book $chapter:$1</p-n>\t$2\n"
	}
}
