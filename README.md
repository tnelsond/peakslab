<img style="float:left; width:auto; height:200px" src="/peakslab.svg" alt="PeakSlab">
# Peakslab

See it <a href="https://peakslab.org">live</a>.

A project to make offline (PWA) dictionary webapps and tools for building those for obscure languages.

Current languages:
- Khmer (Cambodian)
- English
- Lao (Laos)
- Chitonga (Tonga)
- Lozi (Silozi)

# License

This project is under the GPL3 license.
This project uses the following libraries:
- <a href="https://github.com/facebook/zstd">Zstandard</a> (BSD License. See ZSTD_LICENSE.txt)
- <a href="https://github.com/ashvardanian/StringZilla">Stringzilla</a> (Apache 2.0 License. See STRINGZILLA_LICENSE.txt)

## Peak file

The peak format is basically a tsv file with tags (for substitutions, like a mini dictionary) and 3 indexes at the beginning. Very simple.
(The first index set must be strictly linear to make data extraction simple, thus the lines are sorted in the generator so that the index is linear)

- 0-7: binarybyte (1 byte); 2: magicnum (3 bytes); 5: magicstr (4 bytes);
- 8-15:	version (2 bytes); features (1 byte); btagdef_idx (1 byte); btag_idx (1 byte); btag1 (1 byte); btag2 (1 byte); bline_idx (1 byte);
- 16-23: tagdef_idx_start (4 bytes); tagdef_idx_len (4 bytes);
- 24-31:  tagdef_start (4 bytes); tagdef_len (4 bytes); 
- 32-39:  tag_idx_start (4 bytes); tag_idx_len (4 bytes);
- 40-47: tag_start (4 bytes); tag_len (4 bytes); 
- 48-55: line_idx_start (4 bytes); line_idx_len (4 bytes);
- 56-63: line_start (4 bytes); line_len (4 bytes);
- 64-71: idx2_start (4 bytes); idx2_len (4 bytes);
- 72-79: idx3_start (4 bytes); idx3_len (4 bytes);
- 80+: Data, can be organized in any order because the header has offsets to all the points. But peakgen generates data in this order:

	- tagdef_idx
	- tagdef
	- tag_idx
	- tag
	- idx2 (you can mark something to be added to this index by putting a '@' before the word. If you want to use an actuall @ in your tsv, double it to escape the index.)
	- idx3 (Same thing as idx2 but we use ^ instead.)
	- line_idx (Main indexes)
	- tsv file or binary slabs
 
The slab format is just like the peak format, the only difference is that it's binary data instead of text with the filenames as keys. The filename of course is ended by a tab, just like tsv data.

These peak files can then be compressed using zstdandard compression which is very quick for decompressing and has a good compression ratio.

## Completed Features
- System TTS integration
- Narrow and wide search
- Offline

## Todo
- make an online editor
- <strike>media support in dictionary</strike>
- <strike>ignore zero width spaces in search</strike>
- History and bookmarking
- <strike>Selection to TTS</strike>
- Sheet music (ABC files)
- Cite sources
- <strike>Rework databases</strike>
- <strike>Make it more modular to make porting languages and data easier.</strike>
- <strike>Rewrite the AI's rust code in C</strike>
- Bundle zstd compressor with peakgen.
- Make an online peakgen.
- Fix strcmp bugs.
- Fix context menu.
- Make it so that files to be included in the slab file can have a metadata file so that there can be  attribution or alttext attached to the file.

## Changes
- Moved from SQLite's wasm backend to a brand new engine and file format. This format allows for really good compression and lightning fast speed as well as speed and lazy loading.
- Rewrote the interface to be more intuitive and simpler.

## History
- Tried SQLite, the database files were too large and the runtime was too bloated. Editing databases was a pain.
- Started using Grok to help me prototype a lot of ideas.
- Tried Pouchdb with javascript, too slow to load from a file.
- Tried rolling my own database from Javascript, parsing was too slow, startup too slow.
- Tried using indexeddb, was good, but writing to indexeddb is just too slow for the first run.
- Tried decompressing database files using decompression streams and gzip compression, slower than SQLite's loading of uncompressed database.
- Switched to decompressing using a javascript zstd decompressor, speed was acceptable, but slower than SQLite.
- Started using zstd wasm modules for decompression, good, but transferring the memory from wasm to javascript was incurring a cost or impossible to implement right.
- Because Grok sucks at writing C wasm modules I switched to rust for the wasm backend. Suddenly had really good speed, kept all the major processing in one wasm module. Thought that 150kb module was much better than the 1MB sqlite wasm module.
- Refactored everything to work with lazy loading and lazy searching to make the app more seamless and less inefficient.
- Rewrote everything from scratch in C because I understand it better, it's faster and most of my previous rust code was unsafe code anyway. Rewrote the html and javascript too. Got the size of the peak decoder from 150kb in rust to 58kb of C.

