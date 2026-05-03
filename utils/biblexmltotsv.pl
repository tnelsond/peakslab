#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

if($#ARGV < 1){
	print "\nUSAGE: ./script.pl file.xml booknames.tsv\n";
	exit();
}
my ($booknames, $file) = @ARGV;

my %data;
my %eng;
my $i = 1;
open my $fh, '<', "$booknames" or die "Cannot open $booknames: $!";
while (my $line = <$fh>) {
    chomp $line;
    next if $line =~ /^\s*$/;        # skip empty lines
    my ($e, $val) = split /\t/, $line, 2;
    $eng{$i} = $e;
    $data{$i} = $val;
		++$i;
}
close $fh;

my $book = "NULL";
my $chapter = "NULL";
print "#no sort\n";
open my $fh2, '<', $file or die "Can't open '$file': $!\n";
while(<$fh2>){
	if(m#<bible translation="(.*)>#){
		print "#$1\n";
	}
	if(/<book number="([0-9]+)">/){
		$book = $1;
	}
	if(/<chapter number="([0-9]+)">/){
		$chapter = $1;
	}
	if(/<verse number="([0-9]+)">(.*)<\/verse>/){
		print "$eng{$book} $chapter:$1\t\@<p-n>$data{$book} $chapter:$1</p-n>\t$2\n";
	}
}
close $fh2;
