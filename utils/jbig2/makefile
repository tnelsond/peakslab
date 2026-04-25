# =============================================================================
# jbig2dec → WebAssembly  (Emscripten)
# =============================================================================
#
# QUICK START
#   emmake make            → development build (assertions, source maps)
#   emmake make release    → optimised build
#   emmake make tiny       → minimum-size build (no emscripten boilerplate,
#                            pure wasm + thin JS loader)
#
# SIZE-REDUCTION LEVERS  (flip one at a time, measure with: wc -c *.wasm)
#   CLOSURE=1              run Closure Compiler on the JS glue
#   LTO=1                  link-time optimisation (requires -flto on CFLAGS too)
#   STRIP_EM=1             replace Emscripten JS with a minimal hand-rolled loader
#   OPT=3                  -O3  instead of -Os  (sometimes smaller, sometimes not)
#
# =============================================================================

# ---------------------------------------------------------------------------
# Toolchain
# ---------------------------------------------------------------------------
CC      = emcc
AR      = emar

# ---------------------------------------------------------------------------
# Tuneable knobs (override on the command line)
# ---------------------------------------------------------------------------
CLOSURE  ?= 0
LTO      ?= 0
STRIP_EM ?= 0
OPT      ?= z          # s = optimise for size; z = even smaller; 2/3 = speed

# ---------------------------------------------------------------------------
# Directories
# ---------------------------------------------------------------------------
SRCDIR   = .
OUTDIR   = dist

# ---------------------------------------------------------------------------
# Source files
#
# Excluded intentionally:
#   jbig2dec.c           — CLI binary, has its own main()
#   jbig2_image_png.c    — requires libpng
#   jbig2_image_pbm.c    — PBM output, not needed
#   jbig2_image_rw.c     — dispatcher for png/pbm, not needed
#   pbm2png.c            — standalone tool
#   memcmp.c             — libc replacement, emscripten has its own
#   memento.c            — debug allocator, opt-in only
#   getopt.c / getopt1.c — CLI parsing
#   sha1.c               — only used by the CLI test harness
# ---------------------------------------------------------------------------
LIB_SRCS = \
    $(SRCDIR)/jbig2.c             \
    $(SRCDIR)/jbig2_arith.c       \
    $(SRCDIR)/jbig2_arith_iaid.c  \
    $(SRCDIR)/jbig2_arith_int.c   \
    $(SRCDIR)/jbig2_generic.c     \
    $(SRCDIR)/jbig2_halftone.c    \
    $(SRCDIR)/jbig2_huffman.c     \
    $(SRCDIR)/jbig2_hufftab.c     \
    $(SRCDIR)/jbig2_image.c       \
    $(SRCDIR)/jbig2_mmr.c         \
    $(SRCDIR)/jbig2_page.c        \
    $(SRCDIR)/jbig2_refinement.c  \
    $(SRCDIR)/jbig2_segment.c     \
    $(SRCDIR)/jbig2_symbol_dict.c \
    $(SRCDIR)/jbig2_text.c

WASM_IFACE = $(SRCDIR)/jbig2_wasm.c

LIB_OBJS  = $(LIB_SRCS:$(SRCDIR)/%.c=$(OUTDIR)/%.o)
IFACE_OBJ = $(OUTDIR)/jbig2_wasm.o

# ---------------------------------------------------------------------------
# Base compiler flags
# ---------------------------------------------------------------------------
CFLAGS_BASE = \
    -O$(OPT)             \
    -I$(SRCDIR)          \
    -DMEMENTO_MUPDF_HACKS=0 \
		-std=c99 \
    -fno-exceptions      

# LTO support
ifeq ($(LTO),1)
CFLAGS_BASE += -flto
endif

CFLAGS = $(CFLAGS_BASE)

# ---------------------------------------------------------------------------
# Emscripten linker flags
# ---------------------------------------------------------------------------

# Functions we export from jbig2_wasm.c
EXPORTED_FUNCTIONS = \
    _jbig2_decode_to_png  \
    _jbig2_get_result_ptr \
    _jbig2_get_result_size \
    _jbig2_free_result    \
    _malloc               \
    _free


EM_FLAGS = \
    -O$(OPT)                                      \
    -s WASM=1                                     \
    -s MODULARIZE=1                               \
    -s EXPORT_NAME=createJbig2Module              \
		-s EXPORTED_FUNCTIONS='["_jbig2_decode_to_png","_jbig2_get_result_ptr","_jbig2_get_result_size","_jbig2_free_result","_malloc","_free"]' \
    -s ALLOW_MEMORY_GROWTH=1                      \
    -s INITIAL_MEMORY=16777216                    \
    -s ENVIRONMENT=web                            \
    -s FILESYSTEM=0                               \
    -s ASSERTIONS=0

ifeq ($(LTO),1)
EM_FLAGS += -flto
endif

ifeq ($(CLOSURE),1)
EM_FLAGS += --closure 1
endif

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------
.PHONY: all dev release tiny clean

all: dev

# ---- Development build: assertions + readable output --------------------
dev: CFLAGS  += -g2 -DDEBUG
dev: EM_FLAGS += -s ASSERTIONS=1 -g2
dev: $(OUTDIR)/jbig2.js

# ---- Release build: -Os, no debug info ----------------------------------
release: $(OUTDIR)/jbig2.js

# ---- Tiny build: swap Emscripten glue for a hand-rolled loader ----------
# This produces jbig2.wasm + jbig2_loader.js only.
# No Emscripten runtime, no FS, no dynamic linking infrastructure.
tiny: STRIP_EM := 1
tiny: EM_FLAGS += \
    -s STANDALONE_WASM=1   \
    --no-entry             \
    -s MINIMAL_RUNTIME=2   \
    -s SUPPORT_LONGJMP=0
tiny: $(OUTDIR)/jbig2.wasm
	@echo ""
	@echo "Tiny build complete. Pair with dist/jbig2_loader.js"
	@$(MAKE) $(OUTDIR)/jbig2_loader.js

# ---------------------------------------------------------------------------
# Compile library objects
# ---------------------------------------------------------------------------
$(OUTDIR)/%.o: $(SRCDIR)/%.c | $(OUTDIR)
	$(CC) $(CFLAGS) -c $< -o $@

# Interface object (same flags, but always compiled)
$(IFACE_OBJ): $(WASM_IFACE) | $(OUTDIR)
	$(CC) $(CFLAGS) -c $< -o $@

# ---------------------------------------------------------------------------
# Link (standard Emscripten build → .js + .wasm pair)
# ---------------------------------------------------------------------------
$(OUTDIR)/jbig2.js: $(LIB_OBJS) $(IFACE_OBJ)
	$(CC) $(EM_FLAGS) $^ -o $@
	@echo ""
	@echo "Built: $@ + $(OUTDIR)/jbig2.wasm"
	@ls -lh $(OUTDIR)/jbig2.wasm $(OUTDIR)/jbig2.js

# Standalone wasm-only (for tiny target)
$(OUTDIR)/jbig2.wasm: $(LIB_OBJS) $(IFACE_OBJ)
	$(CC) $(EM_FLAGS) $^ -o $@
	@ls -lh $(OUTDIR)/jbig2.wasm

# ---------------------------------------------------------------------------
# Minimal hand-rolled JS loader (used by `make tiny`)
#
# Replaces the Emscripten glue entirely. You must manage the wasm memory
# yourself; see comments inside for usage.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
$(OUTDIR):
	mkdir -p $(OUTDIR)

clean:
	rm -rf $(OUTDIR)
