// codec2_wasm.c
#include <stdint.h>
#include <string.h>
#include "src/codec2.h"
#include "walloc.c"

/* ---------- tiny WAV writer ---------- */

static void write_u16le(uint8_t *p, uint16_t v) {
    p[0] = (uint8_t)(v);
    p[1] = (uint8_t)(v >> 8);
}

static void write_u32le(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)(v);
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

#define WAV_HDR_SIZE 44

static void write_wav_header(uint8_t *hdr, uint32_t num_samples,
                             uint32_t sample_rate) {
    uint32_t data_bytes = num_samples * 2;
    memcpy(hdr +  0, "RIFF", 4);
    write_u32le(hdr +  4, 36 + data_bytes);
    memcpy(hdr +  8, "WAVE", 4);
    memcpy(hdr + 12, "fmt ", 4);
    write_u32le(hdr + 16, 16);
    write_u16le(hdr + 20, 1);
    write_u16le(hdr + 22, 1);
    write_u32le(hdr + 24, sample_rate);
    write_u32le(hdr + 28, sample_rate * 2);
    write_u16le(hdr + 32, 2);
    write_u16le(hdr + 34, 16);
    memcpy(hdr + 36, "data", 4);
    write_u32le(hdr + 40, data_bytes);
}

/* ---------- exported functions ---------- */

__attribute__((used))
int32_t decode_to_wav(const uint8_t *c2_data, int32_t c2_len,
                      uint8_t *out_buf,        int32_t out_max)
{
    int header_size = 0;
    if (c2_len >= 3 &&
        c2_data[0] == 0xc0 &&
        c2_data[1] == 0xde &&
        c2_data[2] == 0xc2) {
        header_size = 7;
    }

    struct CODEC2 *c2 = codec2_create(CODEC2_MODE_700C);
    if (!c2) return -2;

    int spf        = codec2_samples_per_frame(c2);
    int bpf        = (codec2_bits_per_frame(c2) + 7) / 8;
    int num_frames = (c2_len - header_size) / bpf;
    int num_samples = num_frames * spf;

    int32_t needed = WAV_HDR_SIZE + num_samples * 2;
    if (needed > out_max) {
        codec2_destroy(c2);
        return -1;
    }

    write_wav_header(out_buf, (uint32_t)num_samples, 8000);
    uint8_t *pcm_out = out_buf + WAV_HDR_SIZE;

    int16_t pcm_frame[spf];

    for (int i = 0; i < num_frames; i++) {
        const uint8_t *bits = c2_data + header_size + i * bpf;
        codec2_decode(c2, pcm_frame, bits);
        for (int s = 0; s < spf; s++) {
            int16_t v = pcm_frame[s];
            *pcm_out++ = (uint8_t)(v);
            *pcm_out++ = (uint8_t)((uint16_t)v >> 8);
        }
    }

    codec2_destroy(c2);
    return needed;
}
