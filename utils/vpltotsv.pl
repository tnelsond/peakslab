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

while(<>){
	s#(...) ([0-9]+:[0-9]+) #($data{$1}) \@$1 $2\t#;
	print $_;
}
