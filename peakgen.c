#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <ctype.h>

#include <dirent.h>
#include <sys/stat.h>

#ifndef DEBUG
    #define printf(...) ((void)0)
#endif

#include "utils/stringzilla/stringzilla.h"
#include "peak.h"
#include "zstd.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE ;
#endif

typedef struct {
    uint32_t len, max;
    uint32_t *items;
} VecU32;

typedef struct {
    uint32_t len, max;
    char *data;
} VecChar;

typedef struct {
	uint32_t stroff;
	uint32_t tagstart;
	uint32_t taglen;
	uint32_t idx2start;
	uint32_t idx2len;
	uint32_t idx3start;
	uint32_t idx3len;
	uint32_t sfileoff;
} Peakline;

typedef struct {
	uint32_t len, max;
	Peakline *line;
} VecPeakline;

static int bytes_req(uint32_t val){
	if(val > 0xFFFFFF)
		return 4;
	else if(val > 0xFFFF)
		return 3;
	else if(val > 0xFF)
		return 2;
	return 1;
}

int endswith(char *haystack, char *needle){
	char *he = haystack;
	char *ne = needle;
	while(*he)
		he++;
	while(*ne)
		ne++;
	while(he > haystack && ne > needle && *he == *ne){
		--he;
		--ne;
	}
	return *ne == *he;
}

static void vec_u32_push(VecU32 *v, uint32_t val) {
    if (v->len >= v->max) {
        v->max = v->max ? v->max * 2 : 1024;
        v->items = realloc(v->items, v->max * sizeof(uint32_t));
        if (!v->items) exit(1);
    }
    v->items[v->len++] = val;
}

static void vec_char_push(VecChar *v, char c) {
    if (v->len >= v->max) {
        v->max = v->max ? v->max * 2 : 256;
        v->data = realloc(v->data, v->max);
        if (!v->data) exit(1);
    }
    v->data[v->len++] = c;
}

static void vec_peakline_expand(VecPeakline *v){
    if (v->len >= v->max) {
        v->max = v->max ? v->max * 2 : 256;
        v->line = realloc(v->line, v->max * sizeof(Peakline));
        if (!v->line) exit(1);
    }
		v->len++;
}

static uint32_t get_tagid(VecU32 *tagidx, VecChar *tag){
    for (uint32_t i = 3; i < tagidx->len-1; i++) {
        if (strcmp(&tag->data[tagidx->items[i]], &tag->data[tagidx->items[tagidx->len-1]]) == 0){
						tag->len = tagidx->items[tagidx->len-1];
						tagidx->len--;
            return i;
				}
    }
		return tagidx->len - 1;
}

// gen 1:10 - gen 1:2
static int ps_cmp(const void *a, const void *b){
	uint8_t *sa = (uint8_t*)a;
	uint8_t *sb = (uint8_t*)b;
	int i = 0;
	while(sa[i] && sb[i] && sa[i] == sb[i]){
		i++;	
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

uint32_t gsize = 0;
VecChar textflat2 = {0, 0, NULL};
VecChar textflat3 = {0, 0, NULL};

static int idx_cmp(const void *pa, const void *pb){
	uint32_t a = *(uint32_t*)pa;
	uint32_t b = *(uint32_t*)pb;
	return ps_cmp(&textflat3.data[a], &textflat3.data[b]);
}

static int peakline_cmp(const void *pa, const void *pb){
	Peakline *a = (Peakline*)pa;
	Peakline *b = (Peakline*)pb;
	return ps_cmp(textflat2.data + a->stroff, textflat2.data + b->stroff);
}

EMSCRIPTEN_KEEPALIVE
uint32_t peakslab_getsize(){
	return gsize;
}

EMSCRIPTEN_KEEPALIVE
uint8_t * peakslab_gen(char *src, size_t len, const char *path, int compress){
	VecU32 tagdef_idx = {0, 0, NULL};
	VecChar tagdef = {0, 0, NULL};
	vec_char_push(&tagdef, '\0');
	vec_u32_push(&tagdef_idx, 0); // NOP 
	vec_u32_push(&tagdef_idx, 0); // CAPITAL_SINGLE
	vec_u32_push(&tagdef_idx, 0); // CAPITAL_RUN_START
	vec_u32_push(&tagdef_idx, 0); // CAPITAL_RUN_END

	// ZWS Stuff
	vec_u32_push(&tagdef_idx, tagdef.len); // ZWS
	vec_char_push(&tagdef, 0xe2);
	vec_char_push(&tagdef, 0x80);
	vec_char_push(&tagdef, 0x8b);
	vec_char_push(&tagdef, 0);

	vec_u32_push(&tagdef_idx, tagdef.len); // Normal Space 
	vec_char_push(&tagdef, ' ');
	vec_char_push(&tagdef, 0);

	VecU32 tag_idx = {0, 0, NULL};
	VecU32 tag = {0, 0, NULL};
	VecU32 tag2 = {0, 0, NULL};

	const int BUF_LEN = 1024;
	char buf[BUF_LEN]; // For slab
	int path_prefix_len = 0;

	int isslab = path != NULL;
	VecChar textflat = {len, len, src};
	if (isslab) {
		//printf("Files found:\n");
		DIR *dir = opendir(path);
		if (!dir) {
				perror("opendir failed");
				return NULL;
		}

		struct dirent *entry;

		while ((entry = readdir(dir)) != NULL) {
				// Skip . and ..
				if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
						continue;

				char *c;
				for(c = entry->d_name; *c; ++c){
					vec_char_push(&textflat, *c);
				}
				vec_char_push(&textflat, *c); // '\0'
		}

		closedir(dir);

		int i;
		for(i=0; path[i]; ++i){
			buf[i] = path[i];
		}
		path_prefix_len = i;
	}
		
	VecPeakline peaklines = {0, 0, NULL};
	VecU32 line_idx = {0, 0, NULL};
	VecU32 idx2 = {0, 0, NULL};
	VecU32 idx3 = {0, 0, NULL};

	uint32_t taggap = 0;
	int upper = 0;
	int pupper = 0;
	int upper_idx = 0;
	int inside = 0;
	int lastperiod = -1;
	vec_peakline_expand(&peaklines);
	Peakline *p = peaklines.line;
	p->stroff = 0;
	p->sfileoff = 0;
	p->tagstart = 0;
	p->idx2start = 0;
	p->idx3start = 0;

	int skip = 0;
	int nosort = 0;
	while(textflat.data[skip]){
		int beg = 1;
		if(beg){
			if(textflat.data[skip] == '#'){
				if(!ps_cmpe(textflat.data+skip, "#no sort")){
					printf("NO SORT enabled.\n");
					nosort = 1;
				}
			}else{
				break;
			}
			beg = 0;
		}else{
			if(textflat.data[skip] == '\n'){
				beg = 1;
			}
		}
		++skip;
	}

	if(nosort){
		vec_u32_push(&idx2, 0); // First second index item
	}

	for(int a = skip; a < textflat.len; ++a){
		uint8_t c = textflat.data[a];
		if(!c || (c == '\n' && !isslab)){
			if(lastperiod >= 0){
				textflat2.data[lastperiod] = '\t'; // Separate the extension from the name
				lastperiod = -1;
			}
			vec_char_push(&textflat2, '\0'); // null delimited strings
			taggap = 0;
			upper = 0;
			pupper = 0;
			upper_idx = 0;
			p->taglen = tag.len - p->tagstart;
			p->idx2len = idx2.len - p->idx2start;
			p->idx3len = idx3.len - p->idx3start;
			vec_peakline_expand(&peaklines);
			Peakline *pold = peaklines.line + peaklines.len - 2;
			p = peaklines.line + peaklines.len - 1;
			inside = 0;
			p->stroff = textflat2.len;
			p->sfileoff = a + 1;
			p->tagstart = pold->tagstart + pold->taglen;
			p->idx2start = pold->idx2start + pold->idx2len;
			p->idx3start = pold->idx3start + pold->idx3len;
			if(nosort){
				vec_u32_push(&idx2, textflat2.len - p->stroff);
			}
			continue;
		}
		if(c == ' ' && textflat2.data[textflat2.len-1] == ' '){
			continue;
		}
		if(isslab){
			if(c == '.'){
				lastperiod = textflat2.len;
			}else if(c == '|'){
				c = '\t';
			}
		}
		if(c == '<'){
			inside = 1;
			vec_u32_push(&tagdef_idx, tagdef.len);
			vec_char_push(&tagdef, c);
		}else if(inside){
			if(tagdef.len > 2 && (!tagdef.data[tagdef.len-2]) && (c == ' ' || c < 0)){
				tagdef_idx.len--;
				tagdef.len--;
				inside = 0;
				taggap += 2;
				vec_char_push(&textflat2, '<');
				vec_char_push(&textflat2, c);
			}else{
				vec_char_push(&tagdef, c);
			}
			
			if(c == '>' || c == '\n' || c == '\t'){
				inside = 0;
				vec_char_push(&tagdef, '\0');
				uint32_t tagid = get_tagid(&tagdef_idx, &tagdef);
				vec_u32_push(&tag, taggap);
				taggap = 0;
				vec_u32_push(&tag, tagid);
			}
		}else if(c == '\t' && textflat2.data[textflat2.len-1] == ' '){
			--textflat2.len;
			vec_char_push(&textflat2, c);
		}else if(c == '@'){
			if(idx2.len && textflat2.len == idx2.items[idx2.len-1]){ // If there's an escaped/doubled @, remove the previous idx2 and put one @ back in.
				idx2.len--;
				vec_char_push(&textflat2, c);
				++taggap;
			}else{
				vec_u32_push(&idx2, textflat2.len - p->stroff);
			}
		}else if(c == '^'){
			if(idx3.len && textflat2.len == idx3.items[idx3.len-1]){
				idx3.len--;
				vec_char_push(&textflat2, c);
				++taggap;
			}else{
				vec_u32_push(&idx3, textflat2.len - p->stroff);
			}
		}else if(isupper(c)){
			vec_char_push(&textflat2, tolower(c));
			if(!upper){
				upper = 1;
				upper_idx = textflat2.len;
				vec_u32_push(&tag, taggap);
				vec_u32_push(&tag, CAPITAL_SINGLE);
				pupper = tag.len - 1;
				taggap = 0;
			}
			++taggap;
		}else{
			if(upper){
				int x = textflat2.len - upper_idx + 1;
				if(x > 1){
					tag.items[pupper] = CAPITAL_RUN_START;
					vec_u32_push(&tag, taggap);
					vec_u32_push(&tag, CAPITAL_RUN_END);
					taggap = 0;
				}
				upper = 0;
			}
			vec_char_push(&textflat2, c);
			taggap++;
		}
		uint8_t *uc = (uint8_t *)textflat2.data;
		if(uc[textflat2.len-1] == 0x8b && uc[textflat2.len-2] == 0x80 && uc[textflat2.len-3] == 0xe2){
			textflat2.len -= 3;
			taggap -= 3;
			vec_u32_push(&tag, taggap);
			vec_u32_push(&tag, ZWS);
			taggap = 0;
		}
		if(taggap > 255){ // Before this was broken and was putting just out of reach tags, hopefully this fixes it.
			vec_u32_push(&tag, taggap-1);
			vec_u32_push(&tag, NOP);
			taggap = 1;
		}
	}
	peaklines.len--; //Remove empty last line

	if(!isslab){
		textflat.data = NULL;
		textflat.len = 0;
		textflat.max = 0;
	}

	if(!nosort){
		qsort(peaklines.line, peaklines.len, sizeof(Peakline), peakline_cmp);
	}

	printf("tag_idx.len: %d\n", tag_idx.len);

	for(int x=0; x<peaklines.len; ++x){
		p = peaklines.line + x;
		vec_u32_push(&tag_idx, tag2.len/2);
		vec_u32_push(&line_idx, textflat3.len);
		for(int i = p->tagstart; i < p->tagstart + p->taglen; ++i){
	//		printf("%d: %d (%d)\n", x, i, tag.items[i]);
			vec_u32_push(&tag2, tag.items[i]);
		}
		for(int i=p->idx2start; i < p->idx2start + p->idx2len; ++i){
			idx2.items[i] += textflat3.len; // Introduce proper offset into sorted lines
		}
		for(int i=p->idx3start; i < p->idx3start + p->idx3len; ++i){
			idx3.items[i] += textflat3.len; // Introduce proper offset into sorted lines
		}
		uint8_t *str = (uint8_t*) textflat2.data + p->stroff;
		uint32_t temp = textflat3.len;
		do{
			vec_char_push(&textflat3, *str);
		}
		while(*str++);
		if(isslab){
			buf[path_prefix_len] = '\0'; // Reset buf length
			strncat(buf, textflat.data + p->sfileoff, BUF_LEN - path_prefix_len);
			FILE *f = fopen(buf, "rb");
			if(f){
				int c;
				while((c = fgetc(f)) != EOF){
					vec_char_push(&textflat3, c);
				}
				fclose(f);
			}
			else{
				printf("File not found!: %s\n", buf);
			}
		}
	/*	printf("!!!%s\n", textflat3.data + temp);
		for(int i=p->idx2start; i < p->idx2start + p->idx2len; ++i){
			printf("@@@%.25s\n", textflat3.data + idx2.items[i]);
		}*/
	}

	free(textflat2.data);
	textflat2.data = NULL;
	textflat2.len = 0;
	textflat2.max = 0;
	if(isslab){
		free(textflat.data);
		textflat.data = NULL;
		textflat.len = 0;
		textflat.max = 0;
	}

	vec_u32_push(&line_idx, textflat3.len); // Extra for bounds checking
	vec_u32_push(&tag_idx, tag2.len/2); 

	if(idx2.len){
		qsort(idx2.items, idx2.len, sizeof(idx2.items[0]), idx_cmp);
	}
	if(idx3.len){
		qsort(idx3.items, idx3.len, sizeof(idx3.items[0]), idx_cmp);
	}


	struct peakslab h = {0, {0xF2, 0xFC, 0xF3}, {'P', 'e', 'a', 'k'},
		0x2, (isslab ? SLAB : PEAK) | (nosort?NOSORT:0), bytes_req(tagdef.len),
		bytes_req(tag2.len), 1, bytes_req(tagdef_idx.len), textflat3.len > 0xFFFF ? 4 : 2,
		0, tagdef_idx.len,
		0, tagdef.len,
		0, tag_idx.len,
		0, tag2.len/2,
		0, line_idx.len,
		0, textflat3.len,
		0, idx2.len,
		0, idx3.len
	};

	h.tagdef_idx_start = sizeof(struct peakslab);
	h.tagdef_start = h.tagdef_idx_start + h.tagdef_idx_len * h.btagdef_idx;
	h.tag_idx_start = h.tagdef_start + h.tagdef_len * sizeof(char);
	h.tag_start = h.tag_idx_start + h.tag_idx_len * h.btag_idx;
	h.idx2_start = (h.tag_start + h.tag_len * (h.btag1 + h.btag2) + 3) & ~3u;
	h.idx3_start = (h.idx2_start + h.idx2_len * h.bline_idx + 3) & ~3u;
	h.line_idx_start = (h.idx3_start + h.idx3_len * h.bline_idx + 3) & ~3u;

	h.line_start = h.line_idx_start + h.line_idx_len * h.bline_idx;

	uint8_t *uncomp = malloc(h.line_start + textflat3.len);
	if(!uncomp){
		exit(-8);
	}
	gsize = 0;
	memcpy(uncomp + gsize, &h, sizeof(struct peakslab));
	gsize += sizeof(struct peakslab);
	printf("tagdef_idx: %d\n", gsize);
	for(int i=0; i<tagdef_idx.len; ++i){
		memcpy(uncomp + gsize, &tagdef_idx.items[i], h.btagdef_idx);
		gsize += h.btagdef_idx;
	}
	printf("tagdef: %d\n", gsize);
	memcpy(uncomp + gsize, tagdef.data, tagdef.len);
	gsize += sizeof(char) * tagdef.len;
	printf("tag_idx: %d\n", gsize);
	printf("btag_idx: %d\n", h.btag_idx);
	printf("bline_idx: %d\n", h.bline_idx);
	for(int i=0; i<tag_idx.len; ++i){
		memcpy(uncomp + gsize, &tag_idx.items[i], h.btag_idx);
		gsize += h.btag_idx; 
	}

	putchar('\n');
	printf("tag: %d\n", gsize);
	for(int i=0; i<tag2.len; ++i){
		int el = (i & 1) ? h.btag2 : h.btag1;
		memcpy(uncomp + gsize, &tag2.items[i], el);
		gsize += el;
	}
	uint32_t x0 = 0;
	printf("size: %d\n", gsize);
	while(gsize < h.idx2_start){
		memcpy(uncomp + gsize, &x0, 1);
		++gsize;
	}
	printf("size: %d\n", gsize);
	printf("idx2_start: %d\n", gsize);
	for(int i=0; i<idx2.len; ++i){
		memcpy(uncomp + gsize, &idx2.items[i], h.bline_idx);
		gsize += h.bline_idx;
	}
	printf("size: %d\n", gsize);
	while(gsize < h.idx3_start){
		memcpy(uncomp + gsize, &x0, 1);
		++gsize;
	}
	printf("size: %d\n", gsize);
	printf("idx3_start: %d\n", gsize);
	for(int i=0; i<idx3.len; ++i){
		memcpy(uncomp + gsize, &idx3.items[i], h.bline_idx);
		gsize += h.bline_idx;
	}
	printf("size: %d\n", gsize);
	while(gsize < h.line_idx_start){
		memcpy(uncomp + gsize, &x0, 1);
		++gsize;
	}
	printf("size: %d\n", gsize);
	printf("line_idx_start: %d\n", gsize);
	for(int i=0; i<line_idx.len; ++i){
		memcpy(uncomp + gsize, &line_idx.items[i], h.bline_idx);
		gsize += h.bline_idx; 
	}
	printf("text_flat_start: %d\n", gsize);

	memcpy(uncomp + gsize, textflat3.data, textflat3.len);
	gsize += textflat3.len; 
	printf("text_flat_end: %d\n", gsize);

	free(textflat3.data);
	textflat3.len = 0;
	textflat3.max = 0;
	textflat3.data = NULL;

	if(compress){
		printf("COMPRESSING\n");
		size_t const cBound = ZSTD_compressBound(gsize);
    uint8_t *comp = malloc(cBound);
    if (!comp){
			fprintf(stderr, "Out of memory\n");
			free(uncomp);
			return NULL;
		}

    size_t const clen = ZSTD_compress(comp, cBound, uncomp, gsize, 19);
    if (ZSTD_isError(clen)) {
        fprintf(stderr, "Zstd compression error: %s\n", ZSTD_getErrorName(clen));
        free(comp);
				free(uncomp);
        return NULL;
    }
		printf("Compressed from %ld -> %zu bytes (%.2f%%)\n", gsize, clen, 100.0 * clen / gsize);
		gsize = clen;

		free(uncomp);
		return comp;
	}

	return uncomp;
}

int main(int argc, char **argv) {
	if (argc != 3) {
			fprintf(stderr, "Usage: peakgen input.tsv output.peak\n\tpeakgen dir/ output.slab\n");
			return 1;
	}
	const char *path = argv[1];
	struct stat st;
	uint8_t *data = NULL;
	int compress = endswith(argv[2], ".zst");
	if (stat(path, &st) != 0) {
			perror("stat failed");
			fprintf(stderr, "Cannot access: %s\n", path);
			return 1;
	}
	if(S_ISDIR(st.st_mode)){
		data = peakslab_gen(NULL, 0, path, compress);
	}
  else if (S_ISREG(st.st_mode)) {
		FILE *f = fopen(argv[1], "r");
		if (!f) { perror("open input"); return 1; }
		
		int c;
		VecChar raw_tsv = {0, 0, NULL};
		while((c = fgetc(f)) != EOF){
			if(c == '\n'){
				vec_char_push(&raw_tsv, '\0');
				continue;
			}
			vec_char_push(&raw_tsv, c);
		}

		fclose(f);
		data = peakslab_gen(raw_tsv.data, raw_tsv.len, NULL, compress);
		free(raw_tsv.data);
	}

	FILE *out = fopen(argv[2], "wb");
	size_t len = peakslab_getsize();
	fwrite(data, 1, len, out);
	free(data);
	fclose(out);

	return 0;
}
