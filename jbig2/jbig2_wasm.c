/* CLAUDE AI Wrote me this */
/* Tnelsond */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#include "jbig2.h"
#include "jbig2_image.h"


#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE ;
#endif

/*
 * Minimal 1-bit PNG encoder — no libpng, no zlib dependency.
 *
 * A PNG file is a sequence of chunks: IHDR, IDAT, IEND.
 * Each chunk is: [4-byte length][4-byte type][data][4-byte CRC].
 *
 * The IDAT payload is a zlib stream. We use zlib's "store" (no
 * compression) mode, which is just a tiny 2-byte zlib header,
 * followed by one or more deflate "stored block" packets, followed
 * by a 4-byte Adler-32 checksum. No compression work required.
 *
 * Each PNG row is prefixed with a 1-byte filter type (0 = None).
 *
 * 1-bit PNG: MSB-first, 0 = black, 1 = white.
 * JBIG2 1-bit: MSB-first, 1 = black, 0 = white.
 * Conversion: invert every byte.
 */

/* ------------------------------------------------------------------ */
/* Output buffer                                                        */
/* ------------------------------------------------------------------ */

typedef struct {
    uint8_t *data;
    size_t   size;
    size_t   capacity;
} Buf;

static int buf_grow(Buf *b, size_t need)
{
    if (b->size + need <= b->capacity)
        return 1;
    size_t cap = b->capacity ? b->capacity * 2 : 65536;
    while (cap < b->size + need)
        cap *= 2;
    uint8_t *p = realloc(b->data, cap);
    if (!p) return 0;
    b->data     = p;
    b->capacity = cap;
    return 1;
}

static void buf_u8(Buf *b, uint8_t v)   { b->data[b->size++] = v; }
static void buf_u32be(Buf *b, uint32_t v)
{
    b->data[b->size++] = (v >> 24) & 0xff;
    b->data[b->size++] = (v >> 16) & 0xff;
    b->data[b->size++] = (v >>  8) & 0xff;
    b->data[b->size++] =  v        & 0xff;
}

/* ------------------------------------------------------------------ */
/* CRC-32 (PNG uses CRC-32 for chunk integrity)                        */
/* ------------------------------------------------------------------ */

static uint32_t crc32_table[256];
static int crc32_ready = 0;

static void crc32_init(void)
{
    for (uint32_t n = 0; n < 256; n++) {
        uint32_t c = n;
        for (int k = 0; k < 8; k++)
            c = (c & 1) ? (0xedb88320u ^ (c >> 1)) : (c >> 1);
        crc32_table[n] = c;
    }
    crc32_ready = 1;
}

static uint32_t crc32_update(uint32_t crc, const uint8_t *data, size_t len)
{
    crc = ~crc;
    for (size_t i = 0; i < len; i++)
        crc = crc32_table[(crc ^ data[i]) & 0xff] ^ (crc >> 8);
    return ~crc;
}

/* ------------------------------------------------------------------ */
/* Adler-32 (zlib uses Adler-32 over the uncompressed data)            */
/* ------------------------------------------------------------------ */

static uint32_t adler32_update(uint32_t adler, const uint8_t *data, size_t len)
{
    uint32_t s1 = adler & 0xffff;
    uint32_t s2 = (adler >> 16) & 0xffff;
    for (size_t i = 0; i < len; i++) {
        s1 = (s1 + data[i]) % 65521;
        s2 = (s2 + s1)      % 65521;
    }
    return (s2 << 16) | s1;
}

/* ------------------------------------------------------------------ */
/* PNG chunk writer                                                     */
/* ------------------------------------------------------------------ */

static int write_chunk(Buf *out, const char type[4],
                        const uint8_t *data, size_t len)
{
    if (!buf_grow(out, 12 + len)) return 0;
    buf_u32be(out, (uint32_t)len);
    size_t type_off = out->size;
    out->data[out->size++] = type[0];
    out->data[out->size++] = type[1];
    out->data[out->size++] = type[2];
    out->data[out->size++] = type[3];
    if (len) memcpy(out->data + out->size, data, len);
    out->size += len;
    uint32_t crc = crc32_update(0, out->data + type_off, 4 + len);
    buf_u32be(out, crc);
    return 1;
}

/* ------------------------------------------------------------------ */
/* IHDR                                                                 */
/* ------------------------------------------------------------------ */

static int write_ihdr(Buf *out, uint32_t w, uint32_t h)
{
    uint8_t ihdr[13];
    ihdr[0]  = (w >> 24) & 0xff; ihdr[1]  = (w >> 16) & 0xff;
    ihdr[2]  = (w >>  8) & 0xff; ihdr[3]  =  w        & 0xff;
    ihdr[4]  = (h >> 24) & 0xff; ihdr[5]  = (h >> 16) & 0xff;
    ihdr[6]  = (h >>  8) & 0xff; ihdr[7]  =  h        & 0xff;
    ihdr[8]  = 1;    /* bit depth: 1 */
    ihdr[9]  = 0;    /* colour type: grayscale */
    ihdr[10] = 0;    /* compression: deflate */
    ihdr[11] = 0;    /* filter: adaptive */
    ihdr[12] = 0;    /* interlace: none */
    return write_chunk(out, "IHDR", ihdr, 13);
}

/* ------------------------------------------------------------------ */
/* IDAT — deflate "stored" blocks, zlib wrapper                        */
/*                                                                      */
/* Deflate stored block layout (per RFC 1951 §3.2.4):                  */
/*   1 byte : BFINAL | (BTYPE=00 << 1)  — 0x01 for last block, else 0 */
/*   2 bytes: LEN  (little-endian)                                      */
/*   2 bytes: NLEN (one's complement of LEN, little-endian)            */
/*   N bytes: literal data                                              */
/*                                                                      */
/* Maximum payload per deflate block: 65535 bytes.                     */
/* Zlib stream wrapper (RFC 1950):                                      */
/*   2 bytes header: 0x78 0x01 (CM=8 CINFO=7, FCHECK, no dict)        */
/*   deflate blocks                                                     */
/*   4 bytes: Adler-32 of uncompressed data (big-endian)               */
/* ------------------------------------------------------------------ */

#define DEFLATE_BLOCK_MAX 65535u

static int write_idat(Buf *out, const uint8_t *image_data,
                       int stride, uint32_t width, uint32_t height)
{
    /* PNG row width in bytes (1-bit, packed) */
    size_t row_bytes = (width + 7) / 8;

    /* Each PNG row has a 1-byte filter prefix (0 = None) */
    size_t filtered_row = 1 + row_bytes;

    /* Total uncompressed bytes for the zlib stream */
    size_t total_raw = filtered_row * height;

    /*
     * How many deflate blocks do we need?
     * We emit each row as its own block for simplicity — filter byte
     * and pixel data together. Any rows that don't fill a block are
     * padded by keeping blocks small.
     */
    size_t n_blocks = (total_raw + DEFLATE_BLOCK_MAX - 1) / DEFLATE_BLOCK_MAX;
    /* Upper bound on IDAT payload size:
       2 (zlib hdr) + n_blocks*5 (block hdrs) + total_raw + 4 (adler) */
    size_t idat_max = 2 + n_blocks * 5 + total_raw + 4;

    Buf idat = {0};
    idat.capacity = idat_max + 16;
    idat.data     = malloc(idat.capacity);
    if (!idat.data) return 0;

    /* Zlib stream header: CMF=0x78 (deflate, window=32k), FLG=0x01
       0x7801 is divisible by 31 (FCHECK condition).                   */
    buf_u8(&idat, 0x78);
    buf_u8(&idat, 0x01);

    uint32_t adler = 1; /* Adler-32 initial value */

    /* Build a temporary row buffer (filter byte + inverted pixels) */
    uint8_t *row = malloc(filtered_row);
    if (!row) { free(idat.data); return 0; }
    row[0] = 0; /* filter type None */

    size_t bytes_in_block = 0; /* bytes queued for current block */
    size_t raw_offset     = 0; /* offset into the uncompressed stream */

    for (uint32_t y = 0; y < height; y++) {
        const uint8_t *src = image_data + y * stride;
        for (size_t b = 0; b < row_bytes; b++)
            row[1 + b] = ~src[b]; /* invert: JBIG2 → PNG polarity */

        /* Update Adler-32 over the filtered row (filter byte + pixels) */
        adler = adler32_update(adler, row, filtered_row);

        /* Emit deflate stored block(s) covering this row.
           We emit each row as one or more stored blocks.               */
        size_t row_offset = 0;
        while (row_offset < filtered_row) {
            size_t chunk = filtered_row - row_offset;
            size_t room  = DEFLATE_BLOCK_MAX - bytes_in_block;
            if (chunk > room) chunk = room;

            /* Check if we're starting a new block */
            if (bytes_in_block == 0) {
                /* Figure out how large this block will be:
                   min(remaining uncompressed data, DEFLATE_BLOCK_MAX) */
                size_t remaining = total_raw - raw_offset;
                size_t block_len = remaining < DEFLATE_BLOCK_MAX
                                 ? remaining : DEFLATE_BLOCK_MAX;
                int is_last = (raw_offset + block_len >= total_raw) ? 1 : 0;
                uint16_t len  = (uint16_t)block_len;
                uint16_t nlen = (uint16_t)(~block_len);
                buf_u8(&idat, is_last ? 0x01 : 0x00);
                buf_u8(&idat, len  & 0xff);
                buf_u8(&idat, len  >> 8);
                buf_u8(&idat, nlen & 0xff);
                buf_u8(&idat, nlen >> 8);
            }

            memcpy(idat.data + idat.size, row + row_offset, chunk);
            idat.size      += chunk;
            row_offset     += chunk;
            raw_offset     += chunk;
            bytes_in_block += chunk;

            if (bytes_in_block == DEFLATE_BLOCK_MAX)
                bytes_in_block = 0; /* block is full, next iteration starts new one */
        }
    }

    free(row);

    /* Adler-32 checksum (big-endian) */
    buf_u8(&idat, (adler >> 24) & 0xff);
    buf_u8(&idat, (adler >> 16) & 0xff);
    buf_u8(&idat, (adler >>  8) & 0xff);
    buf_u8(&idat,  adler        & 0xff);

    int ok = write_chunk(out, "IDAT", idat.data, idat.size);
    free(idat.data);
    return ok;
}

/* ------------------------------------------------------------------ */
/* Module-level result storage                                          */
/* ------------------------------------------------------------------ */

static uint8_t *g_png_data = NULL;
static size_t   g_png_size = 0;

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

EMSCRIPTEN_KEEPALIVE
int jbig2_decode_to_png(const uint8_t *buf, int buf_len)
{
    if (g_png_data) { free(g_png_data); g_png_data = NULL; g_png_size = 0; }
    if (!buf || buf_len <= 0) return 0;

    if (!crc32_ready) crc32_init();

    /* ---- Decode JBIG2 ---- */
    Jbig2Ctx *ctx = jbig2_ctx_new(NULL, 0, NULL, NULL, NULL);
    if (!ctx) return 0;

    if (jbig2_data_in(ctx, buf, (size_t)buf_len) < 0 ||
        jbig2_complete_page(ctx) < 0) {
        jbig2_ctx_free(ctx);
        return 0;
    }

    Jbig2Image *image = jbig2_page_out(ctx);
    if (!image) { jbig2_ctx_free(ctx); return 0; }

    uint32_t width  = image->width;
    uint32_t height = image->height;
    int      stride = image->stride;

    /* ---- Encode PNG ---- */
    Buf out = {0};

    /* PNG signature */
    if (!buf_grow(&out, 8)) goto fail;
    static const uint8_t sig[8] = {137,80,78,71,13,10,26,10};
    memcpy(out.data, sig, 8);
    out.size = 8;

    if (!write_ihdr(&out, width, height))                          goto fail;
    if (!write_idat(&out, image->data, stride, width, height))    goto fail;
    if (!write_chunk(&out, "IEND", NULL, 0))                      goto fail;

    jbig2_image_release(ctx, image);
    jbig2_ctx_free(ctx);

    g_png_data = out.data;
    g_png_size = out.size;
    return (int)g_png_size;

fail:
    free(out.data);
    jbig2_image_release(ctx, image);
    jbig2_ctx_free(ctx);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t *jbig2_get_result_ptr(void)  { return g_png_data; }

EMSCRIPTEN_KEEPALIVE
int      jbig2_get_result_size(void) { return (int)g_png_size; }

EMSCRIPTEN_KEEPALIVE
void jbig2_free_result(void)
{
    free(g_png_data);
    g_png_data = NULL;
    g_png_size = 0;
}
