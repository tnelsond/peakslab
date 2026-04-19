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
    my ($key, $val) = split /\t/, $line, 2;
    $data{$key} = $val;
}
close $fh;

my $book = "";
my $chapter = "";
my @stack;

while(<>){
	chomp;
	if(/^<div class='c'>/){
		($chapter) = />([^<]+)/;
	}elsif(/^<title>/){
		($book) = /(?:الكتاب المقدس باللغة العربية، فان دايك )([^<]*)/;
		$book =~ s/(.*) [0-9]+/$1/;
	}elsif(/data-id=.*v-num/){
		s#^<span.*data-id='(..)([0-9]+)_([0-9]+)'><span[^>]*>([^&]*)[^>]*>(.*)</span>#$data{$1} $2:$3\t\@<p-n>$book $chapter:$4</p-n>\t<$stack[-1]$5#;
		s#(?<=</)div>#pop @stack#e;
		s#<span class='nd'>([^<]*)</span>#<b>$1</b>#g;
		s#</div>##g;
		print "\n$_";
	}elsif(/data-id/ && !/chapter section/){
		s#^#<$stack[-1]#;
		s#<span[^>]*>(.*)</span>#$1#;
		s#(?<=</)div>#pop @stack#e;
		s#<span class='nd'>([^<]*)</span>#<b>$1</b>#g;
		s#</div>##g;
		print $_;
	}elsif(/<div class='(q.*)'>/){
		push @stack, "p-$1>";
	}elsif(/<div class='p'>/){
		push @stack, "p>";
	}elsif(/<div class='nb'>/){
		push @stack, "p>";
	}elsif(/<div class='m'>/){
		push @stack, "p>";
	}elsif(/<div class='s'>/){
		push @stack, "h3>";
	}elsif(/<span class='qt'>/){
		push @stack, "p-qt>";
	}
}
