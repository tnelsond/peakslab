#!/usr/bin/perl
# Reads the Chuon Nath dictionary's pronunciations (nath2022.tsv's khph
# column: Khmer respelled a syllable at a time, [ជំ-នឿ], alternatives
# joined with ឬ) and writes them in G2K's phonetics, like g2k.tsv:
#   nathtog2k.pl nath2022.tsv > nath-g2k.tsv
# With --compare g2k.tsv, only the words whose pronunciation differs from
# g2k's: word, respelling, Nath's (in G2K), g2k's.
# Each syllable is read the regular way: the onset's series (or ៉/៊),
# the vowel signs, and the final consonant, with ់ or ័ shortening.
use strict; use warnings; use utf8;
use open qw(:std :encoding(UTF-8));

my $compare;
@ARGV = grep { /^--compare=?(.*)$/ ? ($compare = $1 || 1, 0) : 1 } @ARGV;
$compare = shift @ARGV if $compare && $compare eq '1';

my %ONSET = (
	'ក'=>'k','ខ'=>'kʰ','គ'=>'k','ឃ'=>'kʰ','ង'=>'ŋ','ច'=>'c','ឆ'=>'cʰ','ជ'=>'c','ឈ'=>'cʰ','ញ'=>'ɲ',
	'ដ'=>'ɗ','ឋ'=>'tʰ','ឌ'=>'ɗ','ឍ'=>'tʰ','ណ'=>'n','ត'=>'t','ថ'=>'tʰ','ទ'=>'t','ធ'=>'tʰ','ន'=>'n',
	'ប'=>'ɓ','ផ'=>'pʰ','ព'=>'p','ភ'=>'pʰ','ម'=>'m','យ'=>'j','រ'=>'r','ល'=>'l','វ'=>'w','ស'=>'s',
	'ហ'=>'h','ឡ'=>'l','អ'=>'ʔ',
);
my %CODA = (
	'ក'=>'k','ខ'=>'k','គ'=>'k','ឃ'=>'k','ង'=>'ŋ','ច'=>'c','ឆ'=>'c','ជ'=>'c','ឈ'=>'c','ញ'=>'ɲ',
	'ដ'=>'t','ឋ'=>'t','ឌ'=>'t','ឍ'=>'t','ណ'=>'n','ត'=>'t','ថ'=>'t','ទ'=>'t','ធ'=>'t','ន'=>'n',
	'ប'=>'p','ផ'=>'p','ព'=>'p','ភ'=>'p','ម'=>'m','យ'=>'j','រ'=>'','ល'=>'l','វ'=>'w','ស'=>'h',
	'ហ'=>'h','ឡ'=>'l','អ'=>'',
);
my $S1 = 'កខចឆដឋណតថបផសហឡអ';
my $SONORANT = 'ងញនមយរលវ';
# Independent vowels: onset and vowel signs they stand for
my %INDEP = ('ឥ'=>['អ','ិ'],'ឦ'=>['អ','ី'],'ឧ'=>['អ','ុ'],'ឩ'=>['អ','ូ'],'ឪ'=>['អ','ៅ'],'ឫ'=>['រ','ឹ'],'ឬ'=>['រ','ឺ'],
	'ឭ'=>['ល','ឹ'],'ឮ'=>['ល','ឺ'],'ឯ'=>['អ','ែ'],'ឰ'=>['អ','ៃ'],'ឱ'=>['អ','ោ'],'ឳ'=>['អ','ៅ']);
# Vowel signs -> [first series, second series]; "o" for an open syllable,
# "c" closed, "s" shortened (់ or ័) when they differ
my %V = (
	''    => {o=>['ɔ','o'], s=>['ɔ','ọ']},
	'ា'   => {o=>['a','iᵊ'], s=>['a','oᵃ']},
	'ិ'   => {o=>['eʔ','iʔ'], c=>['ə','ə']},
	'ី'   => {o=>['eʲ','i'], c=>['i','i']},
	'ឹ'   => {o=>['əʔ','ɯʔ'], c=>['ə','ə']},
	'ឺ'   => {o=>['ə','ɯ']},
	'ុ'   => {o=>['oʔ','uʔ'], c=>['o','ọ']},
	'ូ'   => {o=>['oᶷ','u']},
	'ួ'   => {o=>['uᵊ','uᵊ']},
	'ើ'   => {o=>['aᵊ','ɨ']},
	'ឿ'   => {o=>['ɯᵊ','ɯᵊ']},
	'ៀ'   => {o=>['iᵊ','iᵊ']},
	'េ'   => {o=>['e','ɛᵉ']},
	'ែ'   => {o=>['aᵋ','ɛ']},
	'ៃ'   => {o=>['aʲ','ɛʲ']},
	'ោ'   => {o=>['aᵒ','ọ']},
	'ៅ'   => {o=>['aᶭ','əⁱ']},
	'ំ'   => {o=>['ɔm','ʊm']},
	'ុំ'  => {o=>['om','ʊm']},
	'ាំ'  => {o=>['am','oᵃm']},
	'ាំង' => {o=>['a','eᵃ']},
	'ះ'   => {o=>['ah','eᵃh']},
	'ាះ'  => {o=>['ah','eᵃh']},
	'ិះ'  => {o=>['ih','ih']},
	'ឹះ'  => {o=>['əh','ɯh']},
	'ឺះ'  => {o=>['əh','ɯh']},
	'ែះ'  => {o=>['ɛh','ɛh']},
	'ុះ'  => {o=>['oh','uh']},
	'េះ'  => {o=>['eh','ɛᵉh']},
	'ោះ'  => {o=>['ɔh','uᵊh']},
	'ៈ'   => {o=>['aʔ','eᵃʔ']},
	'័'   => {o=>['a','a']},
);
# Words not read by the vowel charts
my %EXCEPT = ('នេះ' => 'nih', 'នោះ' => 'nuh');
my %GLOTTAL_K = map { $_ => 1 } ('a', 'ɔ', 'eᵃ', 'oᵃ', 'iᵊ', 'uᵊ'); # final ក is ʔ after these
my %PALATAL_K = map { $_ => 1 } ('aᵋ', 'e', 'ɛᵉ');                   # and c after these

# The series a syllable's vowel follows: the last consonant of the onset,
# but a subscript sonorant keeps the base's; ៉ and ៊ change it
sub series {
	my ($cons, $shift) = @_;
	return $shift if $shift;
	my $c = @$cons > 1 && index($SONORANT, $cons->[-1]) >= 0 ? $cons->[0] : $cons->[-1];
	return index($S1, $c) >= 0 ? 1 : 2;
}

sub syllable {
	my ($syl, $first, $last) = @_;
	my @ch = split //, $syl;
	return '' unless @ch;
	return $EXCEPT{$syl} if $EXCEPT{$syl};
	my @cons;
	my ($vowel, $shift, $short, $final) = ('', 0, 0, undef);
	my $c = shift @ch;
	if ($INDEP{$c}) { @cons = ($INDEP{$c}[0]); $vowel = $INDEP{$c}[1] }
	elsif ($ONSET{$c}) { @cons = ($c) }
	else { return undef }
	while (@ch >= 2 && $ch[0] eq '្' && $ONSET{$ch[1]}) { push @cons, $ch[1]; splice @ch, 0, 2 } # subscripts
	while (@ch) {
		my $x = shift @ch;
		if ($x eq '៉') { $shift = 1 }
		elsif ($x eq '៊') { $shift = 2 }
		elsif ($x eq '់') { $short = 1 }
		elsif ($x eq '័') { $short = 1; $vowel .= $x if $vowel eq '' }
		elsif ($x =~ /[\x{17B6}-\x{17C5}\x{17C6}\x{17C7}\x{17C8}]/) { $vowel .= $x unless defined $final } # after the final: silent (ភូមិ)
		elsif ($ONSET{$x} && !defined $final) { $final = $x }
		elsif ($x eq '្') { shift @ch } # a subscript after the final: silent
		# anything else (៍ ៌ ៎ ៏, zero width joiners) is silent
	}
	my $ser = series(\@cons, $shift);
	if ($vowel =~ /ំ$/ && defined $final && $final eq 'ង') { $vowel =~ s/ំ$//; $vowel = 'ាំង' if $vowel eq 'ា' } # ាំង aŋ
	my $coda = defined $final ? $CODA{$final} : '';
	if (!$V{$vowel} && $vowel =~ /^(.+)ះ$/ && $V{$1} && !defined $final) { $vowel = $1; $coda = 'h'; $final = 'ហ' } # ៀះ iᵊh
	my $v = $V{$vowel} or return undef;
	my $kind = $short && $v->{s} ? 's' : defined $final && $v->{c} ? 'c' : 'o';
	my $nuc = ($v->{$kind} || $v->{o})->[$ser - 1];
	$nuc = $ser == 1 ? 'ɔ' : 'o' if $vowel eq '' && !defined $final && !$short && !$last; # ពពក popok: unstressed
	$nuc =~ s/ʔ$// if defined $final;                          # the glottal stop of an open ិ ុ
	$nuc = 'uᵊ' if $vowel eq '' && $short && $ser == 2 && $coda =~ /^[kh]$/; # គក់ kuᵊʔ, ពស់ puᵊh
	$nuc = 'eᵃ' if $vowel eq '័' && $ser == 2 && $coda eq 'k';           # រ័ក reᵃʔ
	$nuc = 'ɛ' if $vowel eq 'េ' && $ser == 2 && $coda =~ /^[ɲc]$/;        # ពេញ pɛɲ, គេច kɛc
	$nuc = 'eᵃ' if $vowel eq 'ា' && $short && $ser == 2 && $coda eq 'k'; # គាក់ keᵃʔ
	$nuc = $ser == 1 ? 'aʲ' : 'ɛʲ', $coda = '' if $vowel eq '័' && $coda eq 'j'; # ឆ័យ cʰaʲ, ជ័យ cɛʲ
	if ($vowel eq 'ិ' && ($coda =~ /^[ɲc]$/ || $coda eq 't' && $ser == 1)) { $nuc = $coda eq 'c' ? 'e' : 'ɛ' } # វិញ wɛɲ, ចិត្ត cɛt, តិច tec (but បណ្ឌិត ɓɔnɗət)
	$nuc = 'ʊ' if $nuc eq 'ọ' && $coda eq 'm';                    # ុំ cʊm
	$nuc = 'u' if $nuc eq 'ọ' && $vowel eq 'ុ' && $coda eq 'h';   # នុះ nuh, មៈ-នុស (but ទោស tọh)
	$nuc = 'aᵒ' if $nuc eq 'aᵊ' && $coda eq 'c';                 # សើច saᵒc
	$nuc = 'aɯ', $coda = '' if $nuc eq 'a' && $coda eq 'w';       # ាវ aɯ
	$nuc = 'əⁱ', $coda = '' if $vowel eq 'ូ' && $coda eq 'w';      # ូវ kəⁱ
	$nuc = 'a' if $vowel eq '' && $short && $ser == 1 && $coda eq 'ɲ'; # កញ់ kaɲ
	if ($coda eq 'k') { $coda = 'ʔ' if $GLOTTAL_K{$nuc}; $coda = 'c' if $PALATAL_K{$nuc} }
	$coda = 'ɲ' if $coda eq 'ŋ' && $nuc =~ /^(i|e|ɛ|aᵋ|ɛᵉ)$/;   # មីង miɲ, ក្មេង kʰmeɲ
	my $o = join '', map { $ONSET{$_} } @cons;
	$o =~ s/^ɓ/p/ if ($shift == 1 || @cons > 1) && $cons[0] eq 'ប';  # ប៉ p, ប្រ pr
	$o =~ s/^k([mnl])/kʰ$1/;                                        # ក្មេង kʰmeɲ, ក្នុង kʰnoŋ, ក្លាយ kʰlaj
	$o = 'pʰ' . substr($o, 1) if $o =~ /^[ɓp]ʔ/ || ($first && $o =~ /^[ɓp]ɗ/); # ប្អូន pʰʔoᶷn, ប្តី pʰɗeʲ
	$o =~ s/^([kct])ʔ/$1ʰʔ/;                                        # ក្អក kʰʔɔʔ
	$o =~ s/tj/c/;                                                  # វិទ្យាល័យ wiʔciᵊlaʲ
	$o =~ s/^ʔh/ʔ/;                                                 # អ្ហ: an emphatic អ
	if ($o eq 'ʔ') { $o = '' }                                      # no glottal stop before a vowel
	elsif ($first && $o =~ /^ʔ/) { $o = 'ə' . substr($o, 1) }       # អ្វី əweʲ
	return $o . $nuc . $coda;
}

# A respelling ("[ជំ-នឿ] ឬ [...]"): the first one, in G2K
sub convert {
	my $r = shift;
	$r =~ s/<[^>]*>//g;
	($r) = $r =~ /\[([^\]]*)\]/ or return undef;
	$r =~ s/[\x{200B}\x{200C}\x{200D}—()]//g;
	$r =~ s/\x{17C6}\x{17B6}/\x{17B6}\x{17C6}/g; # ំា typed in the wrong order
	$r =~ s/^\s+|\s+$//g;
	return undef if $r eq '';
	my @out;
	my @syls = split /[-\s]+/, $r;
	for my $n (0 .. $#syls) {
		my $p = syllable($syls[$n], $n == 0, $n == $#syls);
		return undef unless defined $p;
		push @out, $p;
	}
	return join '.', @out; # syllables split with periods, as in IPA
}

my %g2k;
if ($compare) {
	open my $g, '<', $compare or die "$compare: $!";
	while (<$g>) { chomp; next if /^#/; my ($k, $v) = split /\t/; $g2k{$k} = $v if defined $v }
}
my ($same, $diff, $none) = (0, 0, 0);
open my $in, '<', $ARGV[0] or die "usage: nathtog2k.pl [--compare g2k.tsv] nath2022.tsv\n";
while (<$in>) {
	next if /^#/;
	chomp;
	my ($word, $khph) = split /\t/;
	next unless defined $khph;
	my $ipa = convert($khph);
	unless (defined $ipa) { $none++; next }
	if (!$compare) { print "$word\t$ipa\n"; next }
	next unless defined $g2k{$word};
	if ($g2k{$word} eq $ipa) { $same++; next }
	$diff++;
	(my $r = $khph) =~ s/<[^>]*>//g;
	print "$word\t$r\t$ipa\t$g2k{$word}\n";
}
print STDERR $compare ? "same as g2k: $same, different: $diff, couldn't read: $none\n" : "couldn't read: $none\n";
