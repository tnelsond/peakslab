#pragma once
/* No I/O in the wasm build. */
#define printf(...) ((void)0)
#define fprintf(...) ((void)0)
#define putchar(c) ((void)0)
#define puts(s) ((void)0)
