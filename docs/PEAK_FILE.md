# Peak file

The peak format is basically a tsv file with tags (for substitutions, like a mini dictionary) and 3 indexes at the beginning. Very simple.
(The first index set must be strictly linear to make data extraction simple, thus the lines are sorted in the generator so that the index is linear)

## Peak Header
<table>
<tr><td>binarybyte: 0x0</td><td colspan="3">magicnum[3]: 0xF2,0xFC,0xF3</td><td colspan="4">magicstr[4]: 'P' 'e' 'a' 'k'</td></tr>
<tr><td colspan="2">uint16\_t version: 0x2</td><td>features: FLAGS (SLAB)</td><td>btagdef\_idx</td><td>btag\_idx</td><td>btag1</td><td>btag2</td><td>bline\_idx</td></tr>
<tr><td colspan="4">tagdef\_idx\_start</td><td colspan="4">tagdef\_idx\_len</td></tr>
<tr><td colspan="4">tagdef\_start</td><td colspan="4">tagdef\_len</td></tr>
<tr><td colspan="4">tag\_idx\_start</td><td colspan="4">tag\_idx\_len</td></tr>
<tr><td colspan="4">tag\_start</td><td colspan="4">tag\_len</td></tr>
<tr><td colspan="4">line\_idx\_start</td><td colspan="4">line\_idx\_len</td></tr>
<tr><td colspan="4">line\_start</td><td colspan="4">line\_len</td></tr>
<tr><td colspan="4">idx2\_start</td><td colspan="4">idx2\_len</td></tr>
<tr><td colspan="4">idx3\_start</td><td colspan="4">idx3\_len</td></tr>
</table>

- 80+: Data, can be organized in any order because the header has offsets to all the points. But peakgen generates data in this order:

	- tagdef_idx
	- tagdef
	- tag_idx
	- tag
	- idx2 (you can mark something to be added to this index by putting a '@' before the word. If you want to use an actuall @ in your tsv, double it to escape the index.)
	- idx3 (Same thing as idx2 but we use ^ instead.)
	- line_idx (Main indexes)
	- tsv file or binary slabs
 
The slab format is just like the peak format with a tab delimited header, however that header is ended by a null character to signify the start of binary data.

These peak files can then be compressed using zstdandard compression which is very quick for decompressing and has a good compression ratio.

There's an <a href="https://peakslab.org/peakgen.html">online version of the PeakSlab Generator</a> because I hate when a dictionary converter stops working or has 100 dependencies and you can't compile it any more without rewriting it. (Only works for Peak files at the moment).


