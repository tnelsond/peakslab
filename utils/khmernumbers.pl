#!/usr/bin/perl
use strict;
use warnings;
use utf8;

binmode STDIN, ":utf8";
binmode STDOUT, ":utf8";
binmode STDERR, ":utf8";
use open qw/ :std :encoding(UTF-8) /;

while (<>) {
  if (m#^([^\t]*)(.*)\n#) {
    my ($a, $b) = ($1, $2);
    $b =~ tr/0-9/\x{17E0}-\x{17E9}/;
    print "$a$b\n";
  } else {
    print $_;
  }
}
