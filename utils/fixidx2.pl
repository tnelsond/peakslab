#!/usr/bin/perl
# Fixes second index (@) marks that don't start a word, in place:
#   fixidx2.pl [--script=Khmer] dict_src/khmer/dict/sonv.tsv ...
# A mark before spaces, tags, entities or punctuation moves on to the
# word after them ("@<p-l> (noun) ក្រដាស" -> "<p-l> (noun) @ក្រដាស"). One
# before a bracketed pronunciation, or before nothing (the field ends),
# is dropped. With --script, the marked words are in that script (a
# Unicode script name): a mark moves on to the first letter in it (not
# a digit: "@១. ក្រដាស" is a numbered sense), not counting
# [pronunciations], and not past the end of the item it's in (</...), or
# is dropped if there's none.
# Prints what it did.
use strict; use warnings; use utf8;
use open qw(:std :encoding(UTF-8));
my $script;
@ARGV = grep { /^--script=(\w+)$/ ? ($script = $1, 0) : 1 } @ARGV;
my $junk = qr/(?:[ \x{A0}\x{200B}]|&#?\w+;|<[^>]*>|[^\p{L}\p{M}\p{N}<&\[])*/;
my ($moved, $dropped);
# The text from a mark to the end of its field (or the next mark), the
# mark taken off: where it goes back, if anywhere
sub fix {
	my $t = shift;
	my $at;
	if ($script) {
		(my $s = $t) =~ s/\[[^\]]*\]/"\0" x length($&)/ge; # Not in [pronunciations]
		$s =~ s/<\/.*//s;                                     # or past the item's end
		$at = $-[0] if $s =~ /(?=\p{$script})\p{L}/;
	} else {
		$t =~ /^$junk/;
		my $end = $+[0];
		$at = $end if substr($t, $end) =~ /^[\p{L}\p{N}]/;
	}
	return '@' . $t if defined $at && $at == 0;
	if (defined $at) { $moved++; return substr($t, 0, $at) . '@' . substr($t, $at) }
	$dropped++;
	return $t;
}
for my $f (@ARGV) {
	open my $in, '<', $f or die "$f: $!";
	my @lines = <$in>;
	close $in;
	($moved, $dropped) = (0, 0);
	for (@lines) {
		next if /^#/;
		s/\@([^\t\n\@]*)/fix($1)/ge;
	}
	open my $out, '>', $f or die "$f: $!";
	print $out @lines;
	close $out;
	print "$f: moved $moved, dropped $dropped\n";
}
