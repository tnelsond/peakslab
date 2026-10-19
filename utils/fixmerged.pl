#!/usr/bin/perl
# Untangles definitions that were merged with ## (h97: "+ ADJ + ក៏ ... ##
# v to say, tell"), in place:
#   fixmerged.pl dict_src/khmer/dict/h97.tsv
# The parts after a ## come first, and grammar patterns ("+ VERB ...")
# after the other senses, in their order; the ##s go.
use strict; use warnings; use utf8;
use open qw(:std :encoding(UTF-8));
sub text { (my $t = shift) =~ s/<[^>]*>//g; $t } # without the tags
for my $f (@ARGV) {
	open my $in, '<', $f or die "$f: $!";
	my @lines = <$in>;
	close $in;
	my $n = 0;
	for (@lines) {
		next if /^#/ || !/##/;
		chomp;
		my @fields = map {
			my @parts = grep { text($_) =~ /\S/ } split /\s*##\s*/;
			join ' ', (reverse grep { text($_) !~ /^\s*\+/ } @parts), (grep { text($_) =~ /^\s*\+/ } @parts);
		} split /\t/, $_, -1;
		$_ = join("\t", @fields) . "\n";
		$n++;
	}
	open my $out, '>', $f or die "$f: $!";
	print $out @lines;
	close $out;
	print "$f: $n entries\n";
}
