# Peakslab

A project to make offline dictionary webapps and tools for building those for obscure languages.

Current languages:
- Khmer (Cambodian)
- Lao (Laos)
- Chitonga (Tonga)
- Lozi (Silozi)

## Peak file

The peak format is basically a tsv file with an index or two at the beginning. Very simple.
(The first index set must be strictly linear to make data extraction simple, thus the tsv is sorted so that the index is linear)

- 1. 4 bytes that declare how many sets of indexes there are.
- 2. For each set of indexes:
  - 2a. 4 bytes that declare how many values are in this index set.
  - 2b. An array of offsets (4 byte values) into the data part.
- 3. The tsv file (It may or may not have newlines since those are unnecessary).

The slab format is just like the peak format, the only difference is that it's binary data instead of text with the filenames as keys. The filename of course is ended by a tab, just like tsv data.

These peak files can then be compressed using zstdandard compression which is very quick for decompressing and has a good compression ratio.

## Completed Features
- System TTS integration
- Narrow and wide search
- Offline

## Todo
- make an online editor
- media support in dictionary
- ignore zero width spaces in search
- History and bookmarking
- <strike>Selection to TTS</strike>
- Sheet music (ABC files)
- Cite sources
- Rework databases
- Make it more modular to make porting languages and data easier.

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
- Because Grok sucks at writing C wasm modules I switched to rust for the wasm backend. Suddenly had really good speed, kept all the major processing in one wasm module.
- Refactored everything to work with lazy loading and lazy searching to make the app more seamless and less inefficient.

Using AI to write an app is frustrating and takes many many many attempts, but it allowed me to try all the different possibilities of where to go with this. I may rewrite the code someday when I have the time.
