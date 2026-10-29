#define ZSTD_STATIC_LINKING_ONLY
#include "zstddeclib.c"
#include "utils/stringzilla/stringzilla.h"
#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif
#include <stdint.h>
#include <stdio.h>

#include "peak.h"

#ifndef DEBUG
    #define printf(...) ((void)0)
#endif

static uint8_t* g_d = NULL;
static size_t g_d_size = 0;

enum searchtype{
	FULL=0, EXACT1, EXACT2, INDEX1, INDEX2, INDEX3, SPLIT=10,
};
#define MAX_RESULT_TRACK 100

struct peakslab *ps_h = NULL;

struct ptracker{
	uint32_t bytes;
	uint32_t *data;
} tracker = {0, NULL};

void tracker_init(uint32_t entries){
	tracker.bytes = ((entries + 31)/32)*sizeof(uint32_t);
	tracker.data = malloc(tracker.bytes);
}

void tracker_clear(){
	if(tracker.data)
		memset(tracker.data, 0, tracker.bytes);
}

static int tracker_add(uint32_t val) {
	const int byte = val / 32;
	const int bit = val % 32;
	if(!tracker.data){
		return 1;
	}
	if(tracker.data[byte] & (1 << bit)){
		return 0;
	}else{
		tracker.data[byte] |= (1 << bit);
		return 1;
	}
}

#define SEGMAX 10
enum flag{
	ANY=1, NOT=2, BEGIN=4, START=8
};
struct tpat{
	char *s;
	uint8_t flags;
	size_t len;
	char *match;
};

struct pstate{
	enum searchtype st;
	uint32_t idx;
	uint32_t idxlen;
	int line; // We use negative numbers to signify done.
	uint8_t*  qloc;
	uint32_t qlen;
	size_t qmax;
	struct tpat seg[SEGMAX];
	uint8_t lseg;
	uint8_t segend;
};

struct pstate iowa = {INDEX1, 0, 0, 0, NULL, 0, 0, {0}, 0, 0};
struct pstate wis = {INDEX1, 0, 0, 0, NULL, 0, 0, {0}, 0, 0};
struct pstate *psa = &iowa;

static uint8_t*  g_result_loc = NULL;
static size_t g_result_max = 0;


#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE ;
#endif

EMSCRIPTEN_KEEPALIVE
int switchstate(){
	if(psa == &iowa){
		psa = &wis;
		return 1;
	}
	psa = &iowa;
	return 0;
}

// Any unused function is automatically culled by the compiler.
void printbytes(uint8_t *start, int esize, int len){
	if(len < 0)
		return;
	uint32_t b = 0;
	while(len){
		for(int j=esize; j>0; --j){
			printf("%d+", *start++);
		}
		printf("\b, ");
		--len;
	}
	printf("\n");
}

void printbytesi(uint8_t *start, int esize, int len){
	if(len < 0)
		return;
	while(len){
		for(int i=0; i<esize; ++i){
			printf("%d ", *start++);
		}
		--len;
	}
	printf("\n");
}

static int ps_cmp_basic(const void *a, const void *b){
	uint8_t *sa = (uint8_t*)a;
	uint8_t *sb = (uint8_t*)b;
	while(*sa && *sb && *sa == *sb){
		sa++; sb++;	
	}
	if(!*sb)
		return 0;
	return (int)(*sa) - (int)(*sb);
}

static int ps_cmp(const void *a, const void *b){
	uint8_t *sa = (uint8_t*)a;
	uint8_t *sb = (uint8_t*)b;
	int i = 0;
	while(sa[i] && sb[i] && sa[i] == sb[i]){
		i++;
	}
	if(!sb[i]){
		return 0;
	}
	int j = i;
	while(isdigit(sa[j]) && isdigit(sb[j])){
		++j;
	}
	if(isdigit(sa[j]) && !isdigit(sb[j])){
		return 1;
	}
	if(!isdigit(sa[j]) && isdigit(sb[j])){
		return -1;
	}
	return sa[i] - sb[i];
}

static int ps_cmpe(const void *a, const void *b){
	uint8_t *sa = (uint8_t*)a;
	uint8_t *sb = (uint8_t*)b;
	while(*sa && *sb && *sa == *sb){
		sa++; sb++;	
	}
	if(!*sb && (*sa == '\t' || !*sa)){ // For exact search
		return 0;
	}
	return *sa - *sb;
}


// Returns:
//  0  = success
// -1  = unknown decompressed size
// -2  = too big (>512MB)
// -3  = allocation failed
// -4  = decompression error
// -5  = can't allocate memory for noncompressed stuff.
EMSCRIPTEN_KEEPALIVE
int load_peak(uint8_t *src, size_t srcSize, int compressed) {
	// Clean up previous
	free(g_d);
	g_d = NULL;
	g_d_size = 0;
	iowa.line = 0;
	wis.line = 0;
	uint8_t* buf;

	if(compressed){
		unsigned long long fullSize = ZSTD_getFrameContentSize(src, srcSize);
		if (fullSize == ZSTD_CONTENTSIZE_UNKNOWN) return -1;
		if (fullSize == ZSTD_CONTENTSIZE_ERROR)   return -5;
		if (fullSize > 512 * 1024 * 1024)         return -2;

		buf = (uint8_t*)malloc(fullSize);
		if (!buf) return -3;

		size_t const result = ZSTD_decompress(buf, fullSize, src, srcSize);
		if (ZSTD_isError(result)) {
				free(buf);
				return -4;
		}
		g_d_size = result;
	}else{
		g_d_size = srcSize;
		buf = src;
	}

	ps_h = (struct peakslab*) buf; 
	g_d = buf;

	tracker_init(ps_h->line_idx_len);

	return 0;
}


EMSCRIPTEN_KEEPALIVE
int peak_init(uint8_t *qptr, int qmax, uint8_t *qptr2, int qmax2, uint8_t *resultptr, int resultmax){
	iowa.qloc = qptr;
	iowa.qmax = qmax;
	wis.qloc = qptr2;
	wis.qmax = qmax2;
	iowa.idx = ps_h->idx2_start;
	iowa.idxlen = ps_h->idx2_len;
	wis.idx = ps_h->idx2_start;
	wis.idxlen = ps_h->idx2_len;
	g_result_loc = resultptr;
	g_result_max = resultmax;
	if(!qptr || !qptr2 || !qmax2 || !resultptr || !qmax || !resultmax)return -1;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
void continue_search(enum searchtype st){
	psa->line = 0;
	psa->st = st;
	if((ps_h->features & NOSORT)){
		if(st == INDEX1 || st == EXACT1){ // Disable first index for non-sorted peak
			++psa->st;
		}else if(st == INDEX2 || st == EXACT2){ // We moved the second index to the first, because the first is absent in NOSORT
			psa->line = -1;
		}
	}
	switch(psa->st){
		case EXACT2:
		case INDEX2:
			psa->idx = ps_h->idx2_start;
			psa->idxlen = ps_h->idx2_len;
			break;
		case INDEX3:
			psa->idx = ps_h->idx3_start;
			psa->idxlen = ps_h->idx3_len;
			break;
		case EXACT1:
		default:
			psa->idx = ps_h->line_idx_start;
			psa->idxlen = ps_h->line_idx_len;
			break;
	}
}

static int p_startline(struct tpat *t);

// sz_find, 16 places at a time in wasm (StringZilla's are x86 and Arm only,
// so wasm gets its serial one): the places with the needle's first, middle
// and last bytes, then the whole needle there; the rest (under 16 + its
// length) is sz_find's.
static const char *p_find(const char *h, size_t h_len, const char *n, size_t n_len){
#if defined(__wasm_simd128__)
	if(n_len && h_len >= n_len + 15){
		size_t mid = n_len / 2, i = 0;
		v128_t f = wasm_i8x16_splat(n[0]), m = wasm_i8x16_splat(n[mid]), l = wasm_i8x16_splat(n[n_len - 1]);
		for(; i + n_len + 15 <= h_len; i += 16){
			v128_t eq = wasm_v128_and(wasm_v128_and(wasm_i8x16_eq(wasm_v128_load(h + i), f),
				wasm_i8x16_eq(wasm_v128_load(h + i + mid), m)), wasm_i8x16_eq(wasm_v128_load(h + i + n_len - 1), l));
			for(uint32_t bits = wasm_i8x16_bitmask(eq); bits; bits &= bits - 1){
				const char *c = h + i + __builtin_ctz(bits);
				if(sz_equal(c, n, n_len))
					return c;
			}
		}
		return sz_find(h + i, h_len - i, n, n_len);
	}
#endif
	return sz_find(h, h_len, n, n_len);
}

EMSCRIPTEN_KEEPALIVE
int init_search(enum searchtype st, int clear) {
	if(clear){
		tracker_clear();
	}
	continue_search(st);
	psa->qlen = 0;

	if(psa->st == FULL){
		printf("HERE WE GO\n");
		psa->lseg = 0;
		int inspace = 0;
		char c;
		int i = 0;
		psa->seg[i].flags = 0;
		psa->seg[i].len = 0;
		psa->seg[i].s = psa->qloc+psa->qlen;
		while (psa->qlen < psa->qmax && psa->qloc[psa->qlen]){
			c = psa->qloc[psa->qlen];
			if(c == '+' || c == '!' || c == '*' || c == '^' || c == '@'){
				if(psa->seg[i].len){
					if(psa->qlen > 0 && psa->qloc[psa->qlen-1] == ' '){
						--psa->seg[i].len;
						psa->qloc[psa->qlen-1] = '\0';
					}
					psa->qloc[psa->qlen] = '\0';
					if(psa->seg[i].flags & START){ // Not matched: where the search starts (its slot is used again)
						psa->line = p_startline(&psa->seg[i]);
					}else if((psa->seg[i].flags & BEGIN) || (!(psa->seg[psa->lseg].flags & BEGIN) && (psa->seg[i].len > psa->seg[psa->lseg].len) && !(psa->seg[i].flags & NOT))){
						psa->lseg = i;
					}
					if(!(psa->seg[i].flags & START) && ++i > SEGMAX-1){
						i = SEGMAX-1;
						printf("EXCEEDED MAX SEARCH GLOBS (%d)!\n", SEGMAX);
						break;
					}
					psa->seg[i].flags = 0;
				}
				psa->seg[i].flags |= c == '+' ? ANY : c == '!' ? NOT : 0;
				psa->seg[i].flags |= c == '^' ? BEGIN : c == '@' ? START : 0;
				psa->seg[i].len = 0;
				psa->seg[i].s = psa->qloc+psa->qlen+1;
			}else if(c == ' ' && !psa->seg[i].len){
				psa->seg[i].s = psa->qloc+psa->qlen+1;
			}else{
				++psa->seg[i].len;
			}
			++psa->qlen;
		}
		if(psa->seg[i].flags & START){
			psa->line = p_startline(&psa->seg[i]);
			if(i){
				--i;
			}else{ // Nothing else: every line from there (an empty ^ matches them all)
				psa->seg[i].flags = BEGIN;
				psa->seg[i].len = 0;
			}
		}
		if(!(psa->seg[psa->lseg].flags & BEGIN) && (psa->seg[i].len > psa->seg[psa->lseg].len) && !(psa->seg[i].flags & NOT)){
			psa->lseg = i;
		}
		psa->segend = i;
		for(int i=0; i<=psa->segend; ++i){
			printf("(%d): %s #len: %d #flags: [%d]\n", i, psa->seg[i].s, psa->seg[i].len, psa->seg[i].flags);
		}
		printf("lseg: %d\n", psa->lseg);
	}else{
		while (psa->qlen < psa->qmax && psa->qloc[psa->qlen] != '\0') {
				psa->qlen++;
		}
		psa->seg[0].len = psa->qlen;
		psa->seg[0].s = psa->qloc;
		psa->seg[0].flags = 0;
		psa->lseg = psa->segend = 0;
	}

	if (!psa->qlen) return -4;
	if (!g_d) return -3;
	return 0;
}


uint32_t p_read_bytes(uint8_t *src, size_t offset_start, size_t i, size_t bytes){
	uint8_t *point = src + offset_start + i * bytes;
	if(bytes == 1){
		return *point;
	}else if(bytes == 2){
		return *(uint16_t*)point;
	}else if(bytes == 3){
		return point[0] | (point[1] << 8) | (point[2] << 16);
	}else{
		return *(uint32_t*)point;
	}
}

/*
uint32_t p_read_bytes(const uint8_t *src, size_t offset_start, size_t i, size_t bytes) {
    const uint8_t *point = src + offset_start + i * bytes;
    uint32_t value = 0;

    // Read byte-by-byte in little-endian order
    for (size_t k = 0; k < bytes && k < 4; ++k) {  // cap at 4 bytes
        value |= ((uint32_t)point[k]) << (k * 8);
    }

    return value;
}*/

uint8_t *p_linetostr(int linenum, enum searchtype st){
	if(st == INDEX2 || st == EXACT2)
		return (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->idx2_start, linenum, ps_h->bline_idx));
	else if(st == INDEX3)
		return (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->idx3_start, linenum, ps_h->bline_idx));
	return (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, linenum, ps_h->bline_idx));
}

uint8_t *p_linetotags(size_t linenum){
	//printf("linetotags %d : %d\n", linenum, p_read_bytes(g_d, ps_h->tag_idx_start, linenum, ps_h->btag_idx));
	//return g_d + ps_h->tag_start + linenum;
	uint32_t ioff = p_read_bytes(g_d, ps_h->tag_idx_start, linenum, ps_h->btag_idx);
	//printf("tag_idx_start %d len %d, calcend %d\n", ps_h->tag_idx_start, ps_h->tag_idx_len, ps_h->tag_idx_start + ps_h->tag_idx_len*ps_h->btag_idx);
	//printf("btag_idx: %d xlinetotags %d : %d\n", ps_h->btag_idx, linenum, ioff);
	return g_d + ps_h->tag_start + ioff * (ps_h->btag1 + ps_h->btag2);
}

void p_loadtag(uint8_t *tags, uint32_t *tagoff, uint32_t *tagid){	
	*tagoff =  p_read_bytes(tags, 0, 0, ps_h->btag1);
	tags += ps_h->btag1;
	*tagid =  p_read_bytes(tags, 0, 0, ps_h->btag2);
}

int p_strncpy(uint8_t* dest, size_t dest_size, const uint8_t* src) {
    const uint8_t *nul = (const uint8_t*)sz_find_byte((const char *)src, dest_size - 1, "\0");
    size_t i = nul ? (size_t)(nul - src) : dest_size - 1;
    memcpy(dest, src, i);
    dest[i] = '\0';
    return i;
}

int p_strncpyhead(uint8_t* dest, size_t dest_size, const uint8_t* src){
    size_t i;
    for (i = 0; i < dest_size - 1 && src[i] != '\t'; i++) {
        dest[i] = src[i];
    }
    dest[i] = '\0';
    return i;
}


//	binarybyte; magicnum; magicstr;
//	version; features; btagdef_idx; btag_idx; btag1; btag2; bline_idx; 
//	tagdef_idx_start; tagdef_idx_len;
//  tagdef_start; tagdef_len; 
//  tag_idx_start; tag_idx_len;
//  tag_start; tag_len; 
//	line_idx_start; line_idx_len;
//	line_start; line_len;
//	idx2_start; idx2_len;
//	idx3_start; idx3_len;
int p_render(uint8_t *dest, size_t dest_size, size_t i){
	int len = 0;
	uint8_t *str = p_linetostr(i, INDEX1);
	uint8_t *tags = p_linetotags(i);
	uint8_t *tagend = p_linetotags(i+1);
	uint32_t tagoff, tagid;
	p_loadtag(tags, &tagoff, &tagid);
	uint8_t *c = str;
	uint8_t *lineend = p_linetostr(i+1, INDEX1); // (line_idx has an extra end entry)
	uint8_t *end = (uint8_t*)sz_find_byte((const char *)str, lineend - str, "\0");
	if(!end)
		end = lineend;
	int upper = 0;
	uint32_t j = 0;
	//printf("About to enter rendering loop:\n");
	while(c < end || tags < tagend){
		while(j == tagoff && tags < tagend){
			switch(tagid){
				case CAPITAL_SINGLE:
					upper = 1; break;
				case CAPITAL_RUN_START:
					upper = 2; break;
				case CAPITAL_RUN_END:
					upper = 0; break;
			}
			//printf("<%d-%d>", tagoff, tagid);
			//printf("%s", &tagdef.data[tagdef_idx.items[tag.items[t+1]]]);
//int p_strncpy(char* dest, size_t dest_size, const char* src) {
			len += p_strncpy(dest + len, dest_size-len, (uint8_t*)(g_d + ps_h->tagdef_start + p_read_bytes(g_d, ps_h->tagdef_idx_start, tagid, ps_h->btagdef_idx)));
			//printf(g_d + ps_h->tagdef_start + p_read_bytes(g_d, ps_h->tagdef_idx_start, tagid, 1));
			tags += ps_h->btag1 + ps_h->btag2;
			if(tags < tagend){
				p_loadtag(tags, &tagoff, &tagid);
				j = 0;
			}
		}
		if(c < end){ // The text up to the next tag, at once
			if(len + 3 > dest_size){
				//puts("Exceeded result buffer size");
				break;
			}
			size_t run = end - c;
			if(tags < tagend && tagoff > j && tagoff - j < run)
				run = tagoff - j;
			if(run > dest_size - 2 - len)
				run = dest_size - 2 - len;
			memcpy(dest + len, c, run);
			for(size_t k = 0; upper && k < (upper == 1 ? 1 : run); ++k)
				dest[len + k] = toupper(dest[len + k]);
			upper = upper == 1 ? 0 : upper;
			len += run;
			c += run;
			j += run;
		}else if(j != tagoff){
			//printf("\n\n#####tagoff: %d; Error with tagoffset at the end of the line!!\n", tagoff);
			break;
		}
	}
	dest[len++] = '\n';
	//putchar('\n');
	dest[len] = '\0';
	return len;
}

int p_getline(uint8_t *match) {
    if (!match || !g_d || !ps_h) {
        return -1;
    }

    ptrdiff_t charoff = match - (uint8_t *)g_d - ps_h->line_start;

    // Optional: sanity check
    if (charoff < 0 || (size_t)charoff >= ps_h->line_len) {
        return -1;   // out of bounds
    }

    int l = 0;
    int r = ps_h->line_idx_len;

    while (l + 1 < r) {           // safer loop condition
        int m = l + (r - l) / 2;  // avoid potential overflow
        uint32_t guess = p_read_bytes(g_d, ps_h->line_idx_start, m, ps_h->bline_idx);
        if (guess < (uint32_t)charoff) {
            l = m;
        } else if (guess > (uint32_t)charoff) {
            r = m;
        } else {
            return m;
        }
    }
		return l;
}

// Translate mode: splits a text (any length, its own buffer) into
// headwords. init_translate() picks the split with the fewest unmatched
// characters, then the fewest words; translate_next() hands out one piece
// per call.
#define TR_UNMATCHED 1000
static uint8_t *tr_text = NULL;
static uint32_t tr_textlen = 0;
static uint32_t tr_pos = 0;
static uint32_t *tr_cost = NULL;
static uint16_t *tr_len = NULL;
static int32_t *tr_match = NULL;

static uint32_t p_utf8(const uint8_t *s){
	if(s[0] < 0x80) return s[0];
	if(s[0] < 0xE0) return ((s[0] & 0x1F) << 6) | (s[1] & 0x3F);
	if(s[0] < 0xF0) return ((s[0] & 0x0F) << 12) | ((s[1] & 0x3F) << 6) | (s[2] & 0x3F);
	return ((s[0] & 0x07) << 18) | ((s[1] & 0x3F) << 12) | ((s[2] & 0x3F) << 6) | (s[3] & 0x3F);
}

// Vowel signs and other marks that belong to the character before them
static int p_ismark(uint32_t c){
	return (c >= 0x17B4 && c <= 0x17D3) || c == 0x17DD // Khmer
		|| c == 0x0EB1 || (c >= 0x0EB4 && c <= 0x0EBC) || (c >= 0x0EC8 && c <= 0x0ECD) // Lao
		|| c == 0x0E31 || (c >= 0x0E34 && c <= 0x0E3A) || (c >= 0x0E47 && c <= 0x0E4E) // Thai
		|| (c >= 0x0900 && c <= 0x0903) || (c >= 0x093A && c <= 0x094F) || (c >= 0x0951 && c <= 0x0957) || c == 0x0962 || c == 0x0963 // Devanagari
		|| (c >= 0x0300 && c <= 0x036F) || c == 0x200C || c == 0x200D;
}

// Latin letters and digits: words in these are only matched whole
static int p_isletter(uint32_t c){
	return (c < 0x80 && (isdigit(c) || (unsigned)((c | 0x20) - 'a') < 26)) || (c >= 0xC0 && c < 0x250 && c != 0xD7 && c != 0xF7);
}

// Can a piece start or end at byte p of the query?
static int p_boundary(const uint8_t *q, uint32_t p, uint32_t len){
	if(p == 0 || p >= len) return 1;
	if((q[p] & 0xC0) == 0x80) return 0; // Inside a UTF-8 character
	uint32_t c = p_utf8(q + p);
	if(p_ismark(c)) return 0;
	uint32_t b = p - 1;
	while(b > 0 && (q[b] & 0xC0) == 0x80) --b;
	uint32_t prev = p_utf8(q + b);
	if(prev == 0x17D2) return 0; // Khmer coeng, joins the next consonant
	return !(p_isletter(prev) && p_isletter(c));
}

// First entry >= q (ps_cmp order, the order the lines were sorted in).
static int p_lowerbound(enum searchtype st, int n, const uint8_t *q){
	int l = 0, r = n;
	while(l < r){
		int m = l + (r - l) / 2;
		if(ps_cmp(p_linetostr(m, st), q) < 0){
			l = m + 1;
		}else{
			r = m;
		}
	}
	return l;
}

// The line an @ segment starts the search at: with ^ the first headword
// starting with it (a binary search; a Bible's headwords are in its second
// index), else the first line with it anywhere. -1: none.
static int p_startline(struct tpat *t){
	if(t->flags & BEGIN){
		enum searchtype st = ps_h->features & NOSORT ? INDEX2 : INDEX1;
		int n = st == INDEX2 ? ps_h->idx2_len : ps_h->line_idx_len - 1; // line_idx has an extra end entry
		int m = p_lowerbound(st, n, (uint8_t*)t->s);
		if(m >= n || ps_cmp_basic(p_linetostr(m, st), t->s))
			return -1;
		return st == INDEX2 ? p_getline(p_linetostr(m, st)) : m;
	}
	uint8_t *start = g_d + ps_h->line_start;
	uint8_t *match = (uint8_t*)p_find((const char *)start, ps_h->line_len, t->s, t->len);
	return match ? p_getline(match) : -1;
}

// text needs len+1 bytes and has to stay there until the last translate_next().
// Returns:
//  0  = ready
// -3  = not loaded
// -4  = empty text
// -5  = out of memory
EMSCRIPTEN_KEEPALIVE
int init_translate(uint8_t *text, uint32_t len){
	tr_pos = 0;
	tr_textlen = 0;
	free(tr_cost);
	free(tr_len);
	free(tr_match);
	tr_cost = NULL;
	tr_len = NULL;
	tr_match = NULL;
	if(!ps_h || !g_d) return -3;
	if(!text || !len) return -4;
	tr_cost = malloc((len + 1) * sizeof(*tr_cost));
	tr_len = malloc((len + 1) * sizeof(*tr_len));
	tr_match = malloc((len + 1) * sizeof(*tr_match));
	if(!tr_cost || !tr_len || !tr_match) return -5;
	tr_text = text;
	tr_textlen = len;
	enum searchtype st = ps_h->features & NOSORT ? INDEX2 : INDEX1;
	int n = st == INDEX2 ? ps_h->idx2_len : ps_h->line_idx_len - 1; // line_idx has an extra end entry
	uint8_t *q = text;
	uint8_t end = q[len];
	q[len] = '\0';
	tr_cost[len] = 0;
	for(int i = len - 1; i >= 0; --i){
		tr_cost[i] = UINT32_MAX;
		if(!p_boundary(q, i, len))
			continue;
		uint8_t *s = q + i;
		uint32_t rest = len - i;
		// Every headword that starts s sorts between itself and s, so the
		// entries around where s would go share at least that much with it.
		int lb = p_lowerbound(st, n, s);
		uint32_t k = 0;
		for(int m = lb - 1; m <= lb; ++m){
			if(m < 0 || m >= n) continue;
			uint8_t *e = p_linetostr(m, st);
			uint32_t j = 0;
			while(j < rest && e[j] == s[j]) ++j;
			if(j > k) k = j;
		}
		for(; k > 0; --k){ // Longest first, so it wins ties
			if(!p_boundary(q, i + k, len) || tr_cost[i + k] == UINT32_MAX || 1 + tr_cost[i + k] >= tr_cost[i])
				continue;
			uint8_t c = s[k];
			s[k] = '\0';
			int m = p_lowerbound(st, n, s);
			if(m < n && !ps_cmpe(p_linetostr(m, st), s)){
				tr_cost[i] = 1 + tr_cost[i + k];
				tr_len[i] = k;
				tr_match[i] = m;
			}
			s[k] = c;
		}
		uint32_t u = 1; // Or leave the next character unmatched
		while(!p_boundary(q, i + u, len)) ++u;
		if(tr_cost[i + u] != UINT32_MAX && TR_UNMATCHED + tr_cost[i + u] < tr_cost[i]){
			tr_cost[i] = TR_UNMATCHED + tr_cost[i + u];
			tr_len[i] = u;
			tr_match[i] = -1;
		}
	}
	q[len] = end;
	return 0;
}

// Writes the piece of the query it used up, '\0', then the rendered entry
// (nothing when it's unmatched text) into the result buffer.
// Returns:
//  >0 = bytes written
//  -1 = nothing left to translate
//  -3 = not loaded
EMSCRIPTEN_KEEPALIVE
int translate_next(){
	if(!ps_h || !g_d)
		return -3;
	if(tr_pos >= tr_textlen)
		return -1;
	uint32_t start = tr_pos;
	int match = tr_match[tr_pos];
	tr_pos += tr_len[tr_pos];
	while(match < 0 && tr_pos < tr_textlen && tr_match[tr_pos] < 0){ // Join unmatched text
		tr_pos += tr_len[tr_pos];
	}
	int len = tr_pos - start;
	if(len + 2 > (int)g_result_max)
		len = g_result_max - 2;
	memcpy(g_result_loc, tr_text + start, len);
	g_result_loc[len++] = '\0';
	if(match >= 0){
		enum searchtype st = ps_h->features & NOSORT ? INDEX2 : INDEX1;
		int line = st == INDEX2 ? p_getline(p_linetostr(match, st)) : match;
		len += p_render(g_result_loc + len, g_result_max - len, line);
	}
	return len;
}

// Matching mode, for translating with several dictionaries at once: the
// longest headword at one place in a text (its own buffer, any length).
// The page goes through the text and picks between the dictionaries.
static int32_t m_match = -1;
static int m_index = INDEX1;

// The longest match in index st at text+pos (text[len] is '\0' here), no
// longer than maxk bytes (0: any), or 0.
// Exactly a headword or second index word, as the exact searches (EXACT1,
// EXACT2) compare: so a word's gloss is what a search for it finds.
static int m_longest(enum searchtype st, int n, uint8_t *text, uint32_t len, uint32_t pos, uint32_t maxk){
	uint8_t *s = text + pos;
	uint32_t rest = len - pos;
	// Every headword that starts s sorts between itself and s, so the
	// entries around where s would go share at least that much with it.
	int lb = p_lowerbound(st, n, s);
	uint32_t k = 0;
	for(int m = lb - 1; m <= lb; ++m){
		if(m < 0 || m >= n) continue;
		uint8_t *e = p_linetostr(m, st);
		uint32_t j = 0;
		while(j < rest && e[j] == s[j]) ++j;
		if(j > k) k = j;
	}
	if(maxk && k > maxk)
		k = maxk;
	for(; k > 0; --k){ // Longest first
		if(!p_boundary(text, pos + k, len) || text[pos + k - 1] == ' ' || text[pos + k - 1] == '\n')
			continue; // (a match doesn't take the space after a word)
		uint8_t c = s[k];
		s[k] = '\0';
		int m = p_lowerbound(st, n, s);
		int found = m < n && !ps_cmpe(p_linetostr(m, st), s) ? m : -1;
		s[k] = c;
		if(found >= 0){
			m_match = found;
			m_index = st;
			return k;
		}
	}
	return 0;
}

// pos is a byte offset into text, which needs len+1 bytes. Looks in the
// headwords, or with second, in the second index (words marked in the
// entries). With maxk, no longer than that: called again with the last
// length - 1, it gives the shorter ones too.
// Returns:
// >0 = how many bytes the longest match there is; last_match() and
//      last_index() say which one, for render_match()
//  0 = nothing starts there
// -1 = a piece can't start there (inside a character, a word or a cluster)
// -3 = not loaded
EMSCRIPTEN_KEEPALIVE
int match_at(uint8_t *text, uint32_t len, uint32_t pos, uint32_t maxk, int second){
	m_match = -1;
	if(!ps_h || !g_d) return -3;
	if(!text || pos >= len || !p_boundary(text, pos, len)) return -1;
	int nosort = ps_h->features & NOSORT; // Its headwords are in the second index
	if(second && (nosort || !ps_h->idx2_len)) return 0;
	uint8_t end = text[len];
	text[len] = '\0';
	int k = nosort || second ? m_longest(INDEX2, ps_h->idx2_len, text, len, pos, maxk)
		: m_longest(INDEX1, ps_h->line_idx_len - 1, text, len, pos, maxk); // line_idx has an extra end entry
	text[len] = end;
	return k;
}

// The match match_at() found last, and which index it's in
EMSCRIPTEN_KEEPALIVE
int last_match(){
	return m_match;
}
EMSCRIPTEN_KEEPALIVE
int last_index(){
	return m_index;
}

// Writes the entry a match (in index st, from last_index()) is in into the
// result buffer.
// Returns:
// >0 = bytes written
// -1 = no such match
// -3 = not loaded
// Line i's headword (in the file's order: a Bible text's is the Bible's),
// in the result buffer; its length, or -1 past the end
EMSCRIPTEN_KEEPALIVE
int head_at(int i){
	if(!ps_h || !g_d)
		return -3;
	if(i < 0 || i >= (int)ps_h->line_idx_len - 1)
		return -1;
	uint8_t *s = p_linetostr(i, INDEX1);
	int n = 0;
	while(n < (int)g_result_max - 1 && s[n] && s[n] != '\t'){
		g_result_loc[n] = s[n];
		++n;
	}
	g_result_loc[n] = 0;
	return n;
}

EMSCRIPTEN_KEEPALIVE
int render_match(int32_t match, int st){
	if(!ps_h || !g_d)
		return -3;
	int n = st == INDEX2 ? ps_h->idx2_len : ps_h->line_idx_len - 1;
	if(match < 0 || match >= n)
		return -1;
	int line = st == INDEX2 ? p_getline(p_linetostr(match, INDEX2)) : match;
	if(line < 0)
		return -1;
	return p_render(g_result_loc, g_result_max, line);
}

int p_binarysearch(){
	if(psa->line > psa->idxlen-1 || psa->line < 0){
		return -1;
	}
	if(!psa->idxlen)
		return -2;
	int cmpr = -1;
	int match = -1;
	uint8_t *guess = NULL;
	int l = psa->line;
	if(l > 0){ // For extra results after the first result is already found
		guess = p_linetostr(psa->line, psa->st);
		//printf("guess %d: %s\n", l, guess);
		if(psa->st == EXACT1 || psa->st == EXACT2){
			cmpr = ps_cmpe(guess, psa->qloc);
		}else{
			cmpr = ps_cmp_basic(guess, psa->qloc);
		}
		//cmpr = ps_cmp(guess, psa->qloc);
		if(cmpr == 0)
			return l;
		else
			return -1;
	}
	int r = psa->idxlen - 1;
	while(l < r){ // Our typical binary search algorithm
		int m = l + (r - l) / 2;
		uint32_t offset      = p_read_bytes(g_d, psa->idx, m,     ps_h->bline_idx);
		//uint32_t next_offset = p_read_bytes(g_d, ps_h->line_idx_start, m + 1, ps_h->bline_idx);
		guess = (uint8_t*)(g_d + ps_h->line_start + offset);
		//size_t line_len = next_offset - offset;
		//cmpr = sz_order(guess, psa->qlen, psa->qloc, psa->qlen);
		cmpr = ps_cmp(guess, psa->qloc);
//		printf("\n@ (%d-%d) %d: %.10s\n", l, r, cmpr, guess);
		if(cmpr < 0){
			l = m+1;
		}else{
			if(cmpr == 0){
				match = m;
			}
			r = m;
		}
	}
	if(psa->st == EXACT1 || psa->st == EXACT2){
		uint32_t offset = p_read_bytes(g_d, psa->idx, l, ps_h->bline_idx);
		guess = (uint8_t*)(g_d + ps_h->line_start + offset);
		if(!ps_cmpe(guess, psa->qloc))
			return l;
		return -1;
	}else if(match == -1){
		printf("match == -1 : %s: %s\n", guess, psa->qloc);
		if(!ps_cmp_basic(guess, psa->qloc)){
			return l;
		}
	}
	return match;
}

// Returns:
//  >0  = bytes written to out_buffer (without null terminator)
//  -1  = no more matches
//  -2  = output buffer too small
//  -3  = not loaded or no active search
//  -4  = no search query
EMSCRIPTEN_KEEPALIVE
int get_result(int skip){
		if(!ps_h || !g_d)
			return -3;
		if(psa->line < 0)
			return -1;
		if(!psa->qlen)
			return -4;
		int tline = 0;
		if(ps_h->features & SLAB){
			uint8_t* match = NULL;
			uint8_t *start = NULL;
			uint8_t *end = NULL;
			int len = 0;
			if(psa->st == FULL){
				do{
					tline = psa->line;
					++psa->line;
					if(tline+1 >= ps_h->line_idx_len-1){
						psa->line = -1;
						return -1;
					}
					start = (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, tline, ps_h->bline_idx));
					end = (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, tline+1, ps_h->bline_idx));
					//printf("len: %d\n", len);
					len = end - start;
					size_t header_len = (uint8_t*)sz_find_byte((const char *)start, len, "\0") - start;
					match = (uint8_t*)p_find((const char *)start, header_len, (const char *)psa->qloc, psa->qlen);
				}while(!match || !(skip || tracker_add(tline)));
			}
			else{
			//char* match = NULL;
				do{
					tline = psa->line = p_binarysearch();
					if(psa->line < 0)
						return -1;
					//match = p_linetostr(bsea, psa->st);
					match = p_linetostr(psa->line, psa->st);
					tline = p_getline(match);
					++psa->line;
				}while(!(skip || tracker_add(tline)));
				start = (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, tline, ps_h->bline_idx));
				end = (uint8_t*)(g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, tline+1, ps_h->bline_idx));
				len = end - start;
			}
			if(match){
				int ret = p_render(g_result_loc, g_result_max, tline);
				if(len > g_result_max-ret)
					len = g_result_max-ret;
				start = (uint8_t*)sz_find_byte((const char *)start, len, "\0");
				memcpy(g_result_loc+ret, start, len);
				return len + ret;
			}
			return -1;
		}
		uint8_t* match = NULL;
		if(psa->st != FULL){
			do{
				psa->line = p_binarysearch();
				if(psa->line < 0)
					return -1;
				match = p_linetostr(psa->line, psa->st);
				tline = p_getline(match);
				++psa->line;
			}while(!(skip || tracker_add(tline)));
		}else{
			do{ // FULL

				uint8_t *start = (uint8_t*) (g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, psa->line, ps_h->bline_idx));
				uint8_t *last = (uint8_t*) (g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, ps_h->line_idx_len-1, ps_h->bline_idx));
				char *l = NULL;
				char *r = NULL;
				int i=psa->lseg;
				/* This goes through the glob segments starting with the longest one, then matches subsequent segments going backwards, then going forwards after that */
				while(i <= psa->segend){
					uint32_t flags = psa->seg[psa->lseg].flags;
					if(psa->line >= ps_h->line_idx_len - 1){ // (the last entry is the end of the last line)
						psa->line = -1;
						return -1;
					}

					// FIRST (LONGEST) SEGMENT
					if(i == psa->lseg){
						if(flags & BEGIN){
							int cmp;
							r = p_linetostr(psa->line, psa->st);
							do{
								l = r;
								r = p_linetostr(psa->line+1, psa->st);
								cmp = sz_equal((const char *)l, (const char *)psa->seg[i].s, psa->seg[i].len);
								if(flags & NOT){
									cmp = !cmp;
								}
								++psa->line;
							}while(!cmp && psa->line < ps_h->line_idx_len);
							match = cmp ? l : NULL;
							if(!match){
								psa->line = -1;
								return -1;
							}
						}else if(flags & NOT){
							r = p_linetostr(psa->line, psa->st);
							do{
								l = r;
								r = p_linetostr(psa->line+1, psa->st);
								match = (uint8_t*)p_find((const char *)l, r - l, (const char *)psa->seg[i].s, psa->seg[i].len);
								++psa->line;
							}while(match && psa->line < ps_h->line_idx_len);
							match = match ? NULL : l;
						}else{
							if(l){
								start = (uint8_t*) (g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, psa->line, ps_h->bline_idx));
							}
							match = (uint8_t*)p_find((const char *)start, last - start, (const char *)psa->seg[i].s, psa->seg[i].len);
							if(match){
								psa->line = p_getline(match);
								l = p_linetostr(psa->line, psa->st);
								r = p_linetostr(psa->line+1, psa->st);
							}else{
								psa->line = -1;
								return -1;
							}
							++psa->line;
						}
					}

					// OTHER SEGMENTS
					else{
						match = (uint8_t*)p_find((const char *)l, r - l, (const char *)psa->seg[i].s, psa->seg[i].len);
						if(psa->seg[i].flags & NOT){
							match = match ? NULL : l;
						}
						if(!match){
							i = psa->lseg;
							continue;
						}
					}

					if(i <= psa->lseg){
						if(i){
							--i;
						}else{
							i = psa->lseg+1;
						}
					}else{
						++i;
					}
				}
				tline = psa->line-1;
				//char *match = sz_find(start, ps_h->line_len, gquery, gquery_len);
				//int ret = p_strncpy(out_buffer, out_capacity, g_d + ps_h->line_start + p_read_bytes(g_d, ps_h->line_idx_start, psa->line, ps_h->bline_idx));
			}while(!(skip || tracker_add(tline)));
		}
		if(match){
				//char *str = p_linetostr(psa->line);
				//int ret = p_strncpy(g_result_loc, g_result_max, str);
				int ret = p_render(g_result_loc, g_result_max, tline);
				return ret;
		}
		else{
			psa->line = -1;
		}
    return -1;
}

// Clean up
EMSCRIPTEN_KEEPALIVE
void free_peak(void) {
		if(g_d){
			free(g_d);
			g_d = NULL;
		}
		ps_h = NULL;
		if(iowa.qloc){
			free(iowa.qloc);
			iowa.qloc = NULL;
		}
		wis.qloc = NULL;
		free(tracker.data);
		tracker.data = NULL;
}

int p_endswith(uint8_t *a, uint8_t *b){
	int i, j;
	for(i=0; a[i]; ++i);
	for(j=0; b[j]; ++j);
	if(j > i)
		return 0;
	i -= j;
	while(j >= 0 && a[i+j] == b[j])
		--j;
	return j<0;
}
