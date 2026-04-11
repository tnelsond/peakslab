#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

open my $fh, '<', 'bibletranswordsubs.tsv' or die "Cannot open file: $!";
my %subs = map {
    chomp;
    split /\t/;
} <$fh>;
close $fh;

my $bookabr = "NULL";
my $book = "NULL";
my $chapter = "NULL";
while(<>){
	last if(/^<\/style>/);
}
my ($prev) = m#(<div id=[^>]*></div>)$#;
while(<>){
	chomp;
	if(s/<hr>//){
		$prev =~ s#.*?<div id="([^"]*)"></div>#$1\t#;
		$prev =~ s#(?>.*?)<h2 id="[^"]*">(.*?)</h2>#\@$1\t#;
		$prev =~ s#<a href="[^>]*>([^<]*)</a>#<p-a>$1</p-a>#g;
		$prev =~ s#<p-a>https://.*?/([a-z-]+)\.md</p-a>#<p-a>$1</p-a>#g;
		my @s = split('\t', $prev);
		$s[0] = $subs{$s[0]} if exists $subs{$s[0]};
		$s[1] =~ s#, #\t@#g;
		print "\n";
		print join("\t", @s);
		$prev = "";
	}
	last if(/<!--\/-->/);
	#if(/^\\id (.*)/){
	#	$bookabr = $abr{$1};
	#	if(!$bookabr){$bookabr = $1}
	#}elsif(/^\\h (.*)/){
	#	$book = $1;
	#}elsif(/^\\c (.*)/){
	#	$chapter = $1;
	#}elsif(/^\\v ([0-9]+) (.*)/){
	#	print "$bookabr $chapter:$1\t<p-n>\@$book $chapter:$1</p-n>\t$2\n"
	#}
	$prev .= $_;
}
