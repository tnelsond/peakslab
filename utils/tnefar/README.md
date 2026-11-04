# tnefar

A speech codec for a dictionary's word recordings: about 1 kbps (a word is ~150 bytes, against
~4.5 kB as 16 kbps Opus), decoded in the browser by `tnefar.wasm` and played while it decodes.

A `.tnefar` file is an [fcq](../../../opus2/zclaude) bitstream: FARGAN's 20 speech features a
frame, quantized against one speaker's codebook (anchor frames, residual VQ, a range coder). The
decoder turns it back into features, corrects them with a small learned postfilter, and FARGAN
(opus' neural vocoder) makes 16 kHz speech from them.

| part | size in tnefar.wasm | quantized |
|---|---|---|
| FARGAN (opus' weights_blob.bin) | 876 kB | int8 matrices (811 kB), float biases/small layers |
| a voice's codebook (`voice/*.fcq`) | ~23 kB | int8 codewords |
| a voice's postfilter (`voice/*.nnf`) | see `du -b voice/*` | int8 weights (NXF3) |
| code | ~40 kB | |

FARGAN is the slow part (int8 kernels with wasm SIMD, `opus/vec_wasm.h`), so the page runs it in
a worker a few 10 ms frames at a time and plays each piece with Web Audio as it comes (app.js,
`tnefarPlay`): sound starts after the first ~40 ms of audio is made. A recording, once decoded,
is kept to play again.

## Files
- `tnefar.c`: the decoder API (`tnefar_open` / `tnefar_seek` / `tnefar_run` / `tnefar_pcm` / `tnefar_close`) and the
  built-in data (`fargan.bin`, `voice/`). `tnefar_cli.c`: the same decoder to a .wav (`make native`).
- `fcq/`: the codec, copied unchanged from opus2/zclaude (codec.c, rc.c, rvq.c, pf.c, nnf.c).
  The encoder and decoder must be the same version: copy them again (and re-encode) when it changes.
- `opus/`: FARGAN from opus' dnn/ (BSD, `opus/COPYING`), `fargan_init.c` is the generated
  `init_fargan()` from dnn/fargan_data.c without its arrays.
- `encode.sh`, `slice.py`: making .tnefar files (below).

## Build
`make` (needs Emscripten) writes `../../tnefar.wasm`; add it to the app's files with
`./createmeta.sh tnefar.wasm && make filelist` in the top folder.

## Making recordings (the Khmer `audio2-tnefar` slab)
Needs `fcq` and `fargan_demo` (opus2/zclaude). For dictworking/khmer/rithaudio:
1. Each raw recording to 16 kHz mono PCM, then features: `fargan_demo -features x.pcm x.f32`.
2. The voice: `fcq train -i all.f32 -o rith.fcq --clmode 2 --clbps 700 --clrates 500,900`
   (all ~75 min of the speaker), and its postfilter: pairs = the recordings encoded at 800/1000/1200 bps
   and decoded (`fcq decode ... --mask`), then
   `pftrain --dir pairs --sets r0:800,... --cond postfilter/cw.bin --spec 1:128:r,3/1:128:r:+,3/2:128:r:+,3/4:128:r:+,3/8:128:r:+,3/1:128:r:+,1:19:n --dims c0cep --epochs 5 --quant -o rith.nnf`.
   Copy both to `voice/` and rebuild.
3. The words: `python3 slice.py split/index.tsv raw_features/ clips/` cuts each word's features out
   of its recording's (better than the clip alone: the pitch tracker has the speech before it), named as
   towebm.py names the .webm files. Then
   `FCQ=... ./encode.sh voice/rith.fcq 1000 ../../dict_src/khmer/media/audio2-tnefar clips/*.f32`.

A new speaker needs their own voice (codebook + postfilter, ~30 min of their speech is plenty):
add it to `voices[]` in tnefar.c. Files name their voice by the codebook's id byte.
