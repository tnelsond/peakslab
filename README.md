<img style="float:left; width:auto; height:200px" src="/peakslab.svg" alt="PeakSlab">

# Peakslab

Defeating AI by making knowledge accessible to Humans.

See it <a href="https://peakslab.org">live</a>.

A project to make offline (PWA) dictionary webapps and tools for building those for obscure languages.

Current languages:
- Khmer (Cambodian)
- English (This is mainly so that we can load English resources to combine with other dictionaries.)
- Lao (Laos)
- Chitonga (Tonga)
- Lozi (Silozi)
- German
- Spanish
- Indonesian
- Levantine (Lebanese Arabic)

# AI Rant

People go through great effort to gather proper data for AI to learn, so my question is, why don't we make knowledge and data accessible to humans instead so that we can learn? I'm sick of people using AI as a dictionary, it's slow, internet dependent, prone to hallucinations, and untrustworthy. The only advantage AI has versus us is more data and better ways to access it, so let's remedy that.

# Mobile Benchmark
For these tests I ran my laptop connected to my Phone's hotspot to serve the page. Files are cached to my Moto G Power 2024 running Brave and the page is refreshed at > 5 second intervals to measure load time from cache.

## Load speed
| Format    | Loadtime | Speed | Filesize |
|-----------|----------|-------|----------|
| SQLite3   | 789ms    | 1.0x  | 84mb     |
| .peak     | 481ms    | 1.64x | 49mb     |
| .peak split | **391ms**  | **2.02x** | 58mb     |
| .peak split (dual worker)| 380ms  | 2.08x | 58mb     |
| .peak.zst | 712ms    | 1.11x | **9.3mb**    |
| .peak.zst split | 570ms  | 1.38x | 11mb     |
| .peak.zst split (dual worker)| 479ms  | 1.65x | 11mb     |

## Format File size 
|  Format       | File size | Percentage |
|---------------|-----------|------------|
|.tsv (src file)| 52mb      | 100%       |
|SQLite3        | 84mb      | 162%       |
|.peak          | **49mb**      | **94%**        |
------------------------------------------
|.tsv.zst       | **7.9mb**     | **15%**        |
|SQLite3.zst    | 14mb      | 27%        |
|.peak.zst      | 9.3mb     | 18%        |
------------------------------------------
|.tsv (split)   | 60mb      | 115%       |
|.peak (split)  | 58mb      | 112%       |
------------------------------------------
|.tsv.zst (split)| 9.1mb    | 17%        |
|.peak.zst (split)| 11mb    | 21%        |

## Runtime size
|  Program        | Core   |   Glue  |  App HTML .js   |  Total |
|-----------------|--------|---------|-----------------|--------|
|PeakSlab SQLite3 | 832kb  | 384kb   |    **32kb**         | 1.3mb  |
|PeakSlab PeakSlab| **40kb**   | **12kb**    |    40kb         | **92kb**   |
|-----------------|--------|---------|-----------------|--------|
|PeakSlab PeakSlab| **5%**     | **3%**      |    125%         | **7%**     |

The SQLite3 version is the old version of PeakSlab before I wrote the custom file format. The advantages of the custom format are smaller file sizes, instant loading (cast to a struct), and versatile indexes. The reason that .peak slabs are smaller than .tsv files is because peak removes all capitalization and HTML tags and puts them in a tags (or dictionary) section to be reinserted on render.

As you can see the runtime is drastically smaller, the files are smaller, and the load speed is faster even with decompressing the files on every load. Loading uncompressed files is 1.64x faster or 2x faster if the files are split (even though the split files take up more space than the one).

# License

This project is under the GPL3 license.
This project uses the following libraries:
- <a href="https://github.com/facebook/zstd">Zstandard</a> (BSD License. See ZSTD_LICENSE.txt)
- <a href="https://github.com/ashvardanian/StringZilla">Stringzilla</a> (Apache 2.0 License. See STRINGZILLA_LICENSE.txt)

## Design Goals
- Client Side (Offline, power to the user)
- Modular (Can load and run many different dictionary files in parallel)
- Scalable (Same as above)
- Lightweight (Written from scratch)
- Fast (Loading and searching)
- Libre Open Source (GPL3)
- Simple (You just edit the source tsv file and then use peakgen to turn it into an indexed peak file. Or give it a full directory and it will generate a slab file with all the files in that folder). Each line is already it's own index item, but if you put an '@' anywhere it'll put everything after that as an item in the secondary index. '^' for tertiary index. Duplicate the '@' or '^' to escape them. To load a peak file we literally just cast the raw data to a struct, works great, this is why we write in C.
- Sane Defaults (Most relevant results first, fallback to less relevant)
- Powerful

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
 
The slab format is just like the peak format with a tab delimited header, however that header is ended by a null character to signify the start of binary data.

These peak files can then be compressed using zstdandard compression which is very quick for decompressing and has a good compression ratio.

There's an <a href="https://peakslab.org/peakgen.html">online version of the PeakSlab Generator</a> because I hate when a dictionary converter stops working or has 100 dependencies and you can't compile it any more without rewriting it. (Only works for Peak files at the moment).

## input file support
- tsv file
- WEBP images
- WEBM Opus audio
- JBIG2 images via custom decoder

## Completed Features
- System TTS integration
- Narrow and wide search
- Offline
- Selection Menu
- Online Peak Generator from .tsv source

## Todo
- Regex or Glob support
- <strike>Expand Exact Search to work with 2nd index too.</strike>
- make an online editor
- <strike>media support in dictionary</strike>
- <strike>ignore zero width spaces in search</strike>
- History and bookmarking
- <strike>Selection to TTS</strike>
- Sheet music (ABC files)
- Remove javascript glue code for peak.wasm (peak.js).
- <strike>JBIG2 image support</strike>
- <strike>Cite sources</strike>
- Allow users to upload their own custom PeakSlab files which will stay cached in Indexeddb.
- <strike>Rework databases</strike>
- Rewrite the AI's service worker.
- <strike>Make it more modular to make porting languages and data easier.</strike>
- <strike>Rewrite the AI's rust code in C</strike>
- <strike>Bundle zstd compressor with peakgen.</strike>
- <strike>Make an online peakgen.</strike>
- Add .slab support to online peakgen.
- <strike>Fix strcmp bugs.</strike>
- <strike>Fix context menu.</strike>
- Make a custom regex-like language for substitution and character unfolding.
- Make it so that files to be included in the slab file can have a metadata file so that there can be  attribution or alttext attached to the file.
- <strike>Make the combiner combine the entries with the same headword in order</strike>
- Enable custom html for the combining of dictionary entries.

## Changes
- Added JBIG2 image support.
- Rewrote the interface to be more intuitive and simpler.
- Moved from SQLite's wasm backend to a brand new engine and file format. This format allows for really good compression and lightning fast speed as well as speed and lazy loading.

## History
- Be me, a missionary in Cambodia. All the Khmer dictionary apps are full of ads, or require internet connection or just incomplete. So I decide to make my own Khmer dictionary modules for Aard. The process is messy and it's difficult to share with other people. There's no  Aard dictionary app on iOS.
- Tried Stardict and other things, a lot of the programs were outdated and just didn't work anymore; so I decided to make my own.
- Tried SQLite, it worked pretty good. But the database files were too large and the runtime was too bloated. (Though when properly compressed SQLite files are 10% smaller than Peak files, but I think this is because my peakslab indexes are more thorough then the default of no indexes in SQLite) Editing databases was a pain. Left join right join all join? I figured out that github pages would send a compressed form if I saved the database file with a **.html** extension. Still downloads really slowly on iOS. Decide that I don't need all the features that SQLite offers, I just need to be able to read from the database. Also wanted the ability to remove tags and such from search without having duplicated data.
- Started using Grok to help me prototype a lot of ideas.
- Tried Pouchdb with javascript, too slow to load from a file.
- Tried rolling my own database from Javascript, parsing was too slow, startup too slow.
- Tried using indexeddb, was good, but writing to indexeddb is just too slow for the first run. Like really slow.
- Tried decompressing database files using decompression streams and gzip compression, still slower than SQLite's loading of uncompressed database.
- Switched to decompressing using a javascript zstd decompressor, speed was acceptable, but still slower than SQLite.
- Started using zstd wasm modules for decompression, good, but transferring the memory from wasm to javascript was incurring a cost or impossible to implement right.
- Because Grok sucks at writing C wasm modules I switched to rust for the wasm backend. Suddenly had really good speed, kept all the major processing in one wasm module. Thought that 150kb module was much better than the 1MB sqlite wasm module.
- Refactored everything to work with lazy loading and lazy searching to make the app more seamless and less inefficient.
- Rewrote everything from scratch in C because I understand it better, it's faster and most of my previous rust code was unsafe code anyway. Rewrote the html and javascript too. Got the size of the peak decoder binary from 150kb in rust to 52kb in C.
- Had 800mb of sheet music I wanted to compress down and looked around for jbig2 support. I could turn each page into a tiny pdf, but the pdfs don't open on mobile and I wanted them to show up just as an image with no controls or nonsense. Couldn't find any readily available jbig2 decoders for javascript or wasm. (Other than the ones inside pdf.js and pdfium etc. but getting those to work with my code wasn't happening. I tried using pdf.js but it was slow, huge, and still ugly. So I had Claude AI guide me through adapting ghostscript's jbig2dec. I was gonna use libpng but that made the wasm decoder 178kb, the largest part of PeakSlab yet. I didn't like that, so I had Claude write a new frontend to jbig2dec that did custom 1-bit PNG encoding from scratch. The wasm for that is down to 92kb and it works great.
- Changed some compile flags, got the core peak wasm module down to 37kb. Used Claude AI to remove jbig2.js for more space savings.
- Aggressively disabled code for the generation of jbig2.wasm, got it down to 26kb. 
