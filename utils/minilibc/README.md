# minilibc

Just enough of a C library to build `peak.wasm` with plain clang
(`--target=wasm32 -nostdlib`), without Emscripten. See the `peak.wasm` rule in
the Makefile.

- `libc.c`: `memcpy`/`memmove`/`memset` (compiled to the single wasm
  `memory.copy`/`memory.fill` instructions via `-mbulk-memory`), `memcmp`,
  `strlen`, `calloc`, `abort`.
- `malloc`/`free` come from `utils/walloc-master/walloc.c`.
- The headers only declare what peak.c, zstd's single-file decoder and
  StringZilla actually use. `stdio.h` turns `printf` and friends into no-ops.
