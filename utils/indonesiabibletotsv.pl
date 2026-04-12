#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

my %data;
open my $fh, '<', 'indo-book-list.tsv' or die "Cannot open indo-book-list.tsv: $!";
while (my $line = <$fh>) {
    chomp $line;
    next if $line =~ /^\s*$/;        # skip empty lines
    my ($key, $val1, $val2) = split /\t/, $line, 3;
    $data{$key} = [$val1, $val2];
}
close $fh;

while(<>){
	if(s#\s+<p class="verse"><a href=".*/([^/]*)/([0-9]+)/([0-9]+)">[^<]*</a>#$1 $2:$3\t#){
		s#</p>##;
		my ($book, $num, $rest) = m#(.[^0-9]*)([0-9:]+)\t(.*)#;
		$book =~ s/\s+$//;
		print "$data{$book}[1] $num\t<p-n>$data{$book}[0] $num</p-n>\t$rest\n";
	}
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
}
