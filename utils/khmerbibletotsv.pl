#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

my %data;
my %num;
open my $fh, '<', 'khmer-book-list.tsv' or die "Cannot open khmer-book-list.tsv: $!";
while (my $line = <$fh>) {
    chomp $line;
    next if $line =~ /^\s*$/;        # skip empty lines
    my ($key, $val, $n) = split /\t/, $line, 3;
    $data{$key} = $val;
		$num{$key} = $n;
}
close $fh;

my $book = "";
my $chapter = "";
my @stack;
my $section = "";
my $d = "";

while(<>){
	chomp;
	if(/^<div class='c'>/){
		($chapter) = />([^<]+)/;
	}elsif(s/^<div class='s'>([^<]*)<\/div>//g){
		($section) = "<h3>$1</h3>";
	}elsif(s/^<div class='d'>([^<]*)<\/div>//g){
		($d) = "<h4>$1</h4>";
	}elsif(/<a class='location/ && /<a class='home'/){
		($book) = m#<a class='location[^>]*>([^<]*)<\/a>#;
		$book =~ s/(.*) [0-9]+/$1/;
	}elsif(/data-id=.*v-num/){
		s#^<span.*data-id='(..)([0-9]+)_([0-9]+)'><span[^>]*>([^&]*)[^>]*>(.*)</span>#($num{$1}) \@$data{$1} $2:$3\t\@<p-n>$book $chapter:$4</p-n>\t<$stack[-1]$5#;
		s#(?<=</)div>#pop @stack#e;
		s#<span class='nd'>([^<]*)</span>#<b>$1</b>#g;
		s#</div>##g;
		s#<span[^>]*><a[^>]*>[^<]*</a> *</span>##g;
		print "\n";
		if($section){
			s#.*\t#$&$section\t#;
			$section = "";
		}
		if($d){
			s#.*\t#$&$d\t#;
			$d = "";
		}
		print $_;
	}elsif(/data-id/ && !/lang='/){
		s#^#<$stack[-1]#;
		s#<span[^>]*>(.*)</span>#$1#;
		s#(?<=</)div>#pop @stack#e;
		s#<span class='nd'>([^<]*)</span>#<b>$1</b>#g;
		s#</div>##g;
		s#<span[^>]*><a[^>]*>[^<]*</a> *</span>##g;
		print $_;
	}elsif(/<div class='(q.*)'>/){
		push @stack, "p-$1>";
	}elsif(/<div class='p'>/){
		push @stack, "p>";
	}elsif(/<div class='nb'>/){
		push @stack, "p>";
	}elsif(/<div class='m'>/){
		push @stack, "p>";
	}elsif(/<span class='qt'>/){
		push @stack, "p-qt>";
	}
}
