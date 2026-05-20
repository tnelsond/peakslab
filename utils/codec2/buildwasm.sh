#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

D=src/codebook

# --- Step 1: Build generate_codebook natively ---
gcc src/generate_codebook.c -o generate_codebook -lm

# --- Step 2: Generate all codebook .c files ---
./generate_codebook lsp_cb         $D/lsp1.txt $D/lsp2.txt $D/lsp3.txt $D/lsp4.txt $D/lsp5.txt \
                                   $D/lsp6.txt $D/lsp7.txt $D/lsp8.txt $D/lsp9.txt $D/lsp10.txt \
                                   > codebook.c
./generate_codebook lsp_cbd        $D/dlsp1.txt $D/dlsp2.txt $D/dlsp3.txt $D/dlsp4.txt $D/dlsp5.txt \
                                   $D/dlsp6.txt $D/dlsp7.txt $D/dlsp8.txt $D/dlsp9.txt $D/dlsp10.txt \
                                   > codebookd.c
./generate_codebook lsp_cbjmv      $D/lspjmv1.txt $D/lspjmv2.txt $D/lspjmv3.txt > codebookjmv.c
./generate_codebook ge_cb          $D/gecb.txt > codebookge.c
./generate_codebook newamp1vq_cb        $D/train_120_1.txt $D/train_120_2.txt > codebooknewamp1.c
./generate_codebook newamp1_energy_cb   $D/newamp1_energy_q.txt               > codebooknewamp1_energy.c
./generate_codebook newamp2vq_cb        $D/codes_450.txt                      > codebooknewamp2.c
./generate_codebook newamp2_energy_cb   $D/newamp2_energy_q.txt               > codebooknewamp2_energy.c

# --- Step 3: Generate version header ---
VERSION=$(grep -oP '(?<=CODEC2_VERSION ")[^"]+' CMakeLists.txt || echo "1.2.0")
mkdir -p wasm_build/codec2
cat > wasm_build/codec2/version.h << EOF
#define CODEC2_VERSION "$VERSION"
#define CODEC2_VERSION_MAJOR 1
#define CODEC2_VERSION_MINOR 2
#define CODEC2_VERSION_PATCH 0
EOF

# --- Step 4: Compile to WASM (decoder-only sources) ---
emcc \
  codec2_wasm.c \
  codebooknewamp1.c codebooknewamp1_energy.c \
  src/codec2.c \
  src/codec2_fft.c \
  src/sine.c \
  src/nlp.c \
  src/dump.c \
  src/lpc.c \
  src/lsp.c \
  src/quantise.c \
  src/phase.c \
  src/interp.c \
  src/postfilter.c \
  src/kiss_fft.c \
  src/kiss_fftr.c \
  src/newamp1.c \
  src/mbest.c \
  src/linreg.c \
  src/pack.c \
  -I src \
  -I wasm_build \
  -Oz \
  --closure 1 \
  -s FILESYSTEM=0 \
  -s ASSERTIONS=0 \
  -s WASM=1 \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8","HEAP16"]' \
  -s EXPORTED_FUNCTIONS='["_codec2_init","_codec2_decode_frame","_codec2_free","_get_samples_per_frame","_get_bits_per_frame","_get_bytes_per_frame","_malloc","_free"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="Codec2Module" \
  -DCODEC2_MODE_3200_EN=0 \
  -DCODEC2_MODE_2400_EN=0 \
  -DCODEC2_MODE_1600_EN=0 \
  -DCODEC2_MODE_1400_EN=0 \
  -DCODEC2_MODE_1300_EN=0 \
  -DCODEC2_MODE_1200_EN=0 \
  -DCODEC2_MODE_700C_EN=1 \
  -o codec2.js

echo "Done! codec2.js + codec2.wasm ready."
