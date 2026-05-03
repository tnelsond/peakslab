#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

my %data;
open my $fh, '<', 'khmer-book-list.tsv' or die "Cannot open khmer-book-list.tsv: $!";
while (my $line = <$fh>) {
    chomp $line;
    next if $line =~ /^\s*$/;        # skip empty lines
    my ($n, $key, $val) = split /\t/, $line, 3;
    $data{$key} = $val;
}
close $fh;

my %abr = qw(JHN JOH
						NAM NAH
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
my $header = "";
my $verse = "";
my $before = "";
my $para = "";
while(<>){
	chomp;
	if(m#^\\q *$#){
		$before = "p-q>";
	}
	if(m#^\\p *$#){
		$para = "¶ "
	}
	s#\\f\*#<\/p-fn>#g;
	s#\\f \+ \\ft#<p-fn>#g;
	s#\\fqa\*#<\/p-q>#g;
	s#\\fqa#<p-q>#g;
	if(s#\\d (.*)#<h4>$1</h4>#){
		$header = $1;
	}
	s#\\q2(.*)#<p-q2>$1</p-q2>#;
	s#\\q(.*)#<p-q>$1</p-q>#;
	if(/^\\toc3 (.*)/){
		$bookabr = $abr{uc($1)};
		if(!$bookabr){$bookabr = uc $1}
	}elsif(/^\\h (.*)/){
		$book = $1;
	}elsif(/^\\c (.*)/){
		$chapter = $1;
	}elsif(/^\\v ([0-9]+) (.*)/){
		my $two = $2;
		if($before){
			$two = "<$before$two</$before";
			$before = "";
		}
		if($header){
			print "\n$bookabr $chapter:$1\t<p-n>\@$book $chapter:$1</p-n>\t<h3>$header</h3> $para$two";
			$header = "";
		}
		else{
			print "\n$bookabr $chapter:$1\t<p-n>\@$book $chapter:$1</p-n>\t$para$two";
		}
		$para = "";
	}elsif(/<p-q2?>/){
		print $_;
	}
}
