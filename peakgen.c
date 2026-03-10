#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <ctype.h>

#include <dirent.h>
#include <sys/stat.h>

//#include "strnatcmp.h"
#include "stringzilla/stringzilla.h"
#include "peak.h"

typedef struct {
    uint32_t len, max;
    uint32_t *items;
} VecU32;

typedef struct {
    uint32_t len, max;
    char *data;
} VecChar;

typedef struct {
    uint32_t len, max;
    VecChar *line;
} VecStr;

static int bytes_req(uint32_t val){
	if(val > 0xFFFFFF)
		return 4;
	else if(val > 0xFFFF)
		return 3;
	else if(val > 0xFF)
		return 2;
	return 1;
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

static void vec_str_startnew(VecStr *v) {
    if (v->len >= v->max) {
        v->max = v->max ? v->max * 2 : 256;
        v->line = realloc(v->line, v->max * sizeof(VecChar));
        if (!v->line) exit(1);
    }
		v->line[v->len].max = 0;
		v->line[v->len].len = 0;
		v->line[v->len].data = NULL;
		v->len++;
}

static void vec_str_pushc(VecStr *v, char c){
	vec_char_push(&v->line[v->len-1], c);
}


/*
static void vec_char_append(VecChar *v, const char *s) {
    while (*s) vec_char_push(v, *s++);
}*/

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

/*
static int ps_cmp(const void *a, const void *b){
	char *sa = (char*)a;
	char *sb = (char*)b;
	while(*sa && *sb && tolower(*sa) == tolower(*sb)){
		sa++; sb++;	
	}
	char x = *sa < 0x7F ? tolower(*sa) : *sa;
	char y = *sb < 0x7F ? tolower(*sb) : *sb;
	return x - y;
}*/

// gen 1:10 - gen 1:2
static int ps_cmp(const void *a, const void *b){
	unsigned char *sa = (char*)a;
	unsigned char *sb = (char*)b;
	int i = 0;
	while(sa[i] && sb[i] && tolower(sa[i]) == tolower(sb[i])){
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
	int x = sa[i] < 0x7F ? tolower(sa[i]) : sa[i];
	int y = sb[i] < 0x7F ? tolower(sb[i]) : sb[i];
	return x - y;
}

/*
static int ps_cmp(const void *a, const void *b){
	char *sa = (char*)a;
	char *sb = (char*)b;
	return strnatcasecmp(sa, sb);
}
*/

VecChar textflat = {0, 0, NULL}; // Global so we can lazily use it in qsort

static int idx_cmp(const void *pa, const void *pb){
	uint32_t a = *(uint32_t*)pa;
	uint32_t b = *(uint32_t*)pb;
	//int alen = strlen(a->data);
	//int blen = strlen(b->data);
	//return sz_order(a->data, alen, b->data, blen);
	return ps_cmp(&textflat.data[a], &textflat.data[b]);
}

static int vec_char_cmp(const void *pa, const void *pb){
	VecChar *a = (VecChar*)pa;
	VecChar *b = (VecChar*)pb;
	//int alen = strlen(a->data);
	//int blen = strlen(b->data);
	//return sz_order(a->data, alen, b->data, blen);
	return ps_cmp(a->data, b->data);
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "Usage: peakgen input.tsv output.peak\n\tpeakgen dir/ output.slab\n");
        return 1;
    }

		const char *path = argv[1];
    struct stat st;

    if (stat(path, &st) != 0) {
        perror("stat failed");
        fprintf(stderr, "Cannot access: %s\n", path);
        return 1;
    }

		VecStr files = {0, 0, NULL};

    // ──────────────── DIRECTORY ────────────────
    if (S_ISDIR(st.st_mode)) {
        printf("Files found:\n");

        DIR *dir = opendir(path);
        if (!dir) {
            perror("opendir failed");
            return 1;
        }

        struct dirent *entry;

        while ((entry = readdir(dir)) != NULL) {
            // Skip . and ..
            if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
                continue;

						vec_str_startnew(&files);
						for(char *c = entry->d_name; *c; ++c){
							vec_str_pushc(&files, *c);
						}
						vec_str_pushc(&files, '\0');
            printf("  %s\n", entry->d_name);
        }

        closedir(dir);

				qsort(files.line, files.len, sizeof(files.line[0]), vec_char_cmp);
				//qsort(text.line, text.len, sizeof(text.line[0]), vec_char_cmp);

				VecChar bin = {0, 0, NULL};
				VecU32 bin_idx = {0, 0, NULL};
				vec_u32_push(&bin_idx, bin.len);
				const int BUF_LEN = 512;
				char buf[BUF_LEN];
				int i;
				for(i=0; path[i]; ++i){
					buf[i] = path[i];
				}
				const int path_prefix_len = i;

				for(i=0; i<files.len; ++i){
					int j;
					for(j = 0; files.line[i].data[j]; ++j){
						buf[path_prefix_len + j] = files.line[i].data[j];
						vec_char_push(&bin, files.line[i].data[j]);
					}
					buf[path_prefix_len + j] = '\0';
					vec_char_push(&bin, '\t');
					printf("%s\n", buf);
					FILE *f = fopen(buf, "rb");
					if(f){
						int c;
						while((c = fgetc(f)) != EOF){
							vec_char_push(&bin, c);
						}
						vec_u32_push(&bin_idx, bin.len);
						fclose(f);
					}
				}
	
				//	binarybyte; magicnum; magicstr;
				//	version; features; btagdef_idx;
				//	btag_idx; btag1; btag2; bline_idx;
				//	tagdef_idx_start; tagdef_idx_len;
				//  tagdef_start; tagdef_len; 
				//  tag_idx_start; tag_idx_len;
				//  tag_start; tag_len; 
				//	line_idx_start; line_idx_len;
				//	line_start; line_len;
				//	idx2_start; idx2_len;
				//	idx3_start; idx3_len;
				struct peakslab h = {0, {0xF2, 0xFC, 0xF3}, {'P', 'e', 'a', 'k'},
					0x2, SLAB, 0,
					0, 0, 0, bin.len > 0xFFFF ? 4 : 2,
					0, 0,
					0, 0,
					0, 0,
					0, 0,
					sizeof(struct peakslab), bin_idx.len,
					0, bin.len,
					0, 0,
					0, 0
				};

				h.line_start = h.line_idx_start + h.line_idx_len * h.bline_idx;

				FILE *out = fopen(argv[2], "wb");
				fwrite(&h, sizeof(struct peakslab), 1, out);
			
				for(int i=0; i<bin_idx.len; ++i){
					fwrite(&bin_idx.items[i], h.bline_idx, 1, out);
				}
				fwrite(bin.data, 1, bin.len, out);

        return 0;
    }
    else if (S_ISREG(st.st_mode)) {

			FILE *f = fopen(argv[1], "r");
			if (!f) { perror("open input"); return 1; }

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

			VecStr text = {0, 0, NULL};
			vec_str_startnew(&text);

			VecU32 tag_idx = {0, 0, NULL};
			VecU32 tag = {0, 0, NULL};
		
			int c;
			while((c = fgetc(f)) != EOF){
				if(c == '\n'){
					if(text.line[text.len-1].len > 0){
						vec_str_pushc(&text, '\0');
						vec_str_startnew(&text);
					}
					continue;
				}
				vec_str_pushc(&text, c);
			}
			text.len--; // Remove empty end line

			fclose(f);

			qsort(text.line, text.len, sizeof(text.line[0]), vec_char_cmp);
			/*for(int i = 0; i < text.len; ++i){
				puts(text.line[i].data);
			}*/

			VecU32 line_idx = {0, 0, NULL};
			VecU32 idx2 = {0, 0, NULL};
			VecU32 idx3 = {0, 0, NULL};
			// Remove tags, and put the text in a flat representation and make the line_idx
			for(int i = 0; i < text.len; ++i){
				uint32_t taggap = 0;
				int upper = 0;
				int pupper = 0;
				int upper_idx = 0;
				//printf("\n");
				vec_u32_push(&line_idx, textflat.len);
				vec_u32_push(&tag_idx, tag.len/2);
				int inside = 0;
				for(int j = 0; j < text.line[i].len; ++j){
					int c = text.line[i].data[j];
					if(c == '<'){
						inside = 1;
						vec_u32_push(&tagdef_idx, tagdef.len);
						vec_char_push(&tagdef, c);
					}else if(inside){
						if(tagdef.len > 2 && (!tagdef.data[tagdef.len-2]) && (c == ' ' || c < 0)){
							tagdef_idx.len--;
							tagdef.len--;
							inside = 0;
							++taggap;
							vec_char_push(&textflat, '<');
							vec_char_push(&textflat, c);
						}else{
							vec_char_push(&tagdef, c);
						}
						
						if(c == '>' || c == '\n' || c == '\t'){
							inside = 0;
							vec_char_push(&tagdef, '\0');
							uint32_t tagid = get_tagid(&tagdef_idx, &tagdef);
							vec_u32_push(&tag, taggap);
							//printf("taggap %d\n", taggap);
							taggap = 0;
							vec_u32_push(&tag, tagid);
							//printf("tagid: %u - %u\n", tag.items[tag.len-2], tag.items[tag.len-1]);
						}
					}else if(c == '@'){
						if(idx2.len && textflat.len == idx2.items[idx2.len-1]){ // If there's an escaped/doubled @, remove the previous idx2 and put one @ back in.
							idx2.len--;
							vec_char_push(&textflat, c);
							++taggap;
						}else{
							vec_u32_push(&idx2, textflat.len);
						}
					}else if(c == '^'){
						if(idx3.len && textflat.len == idx3.items[idx3.len-1]){
							idx3.len--;
							vec_char_push(&textflat, c);
							++taggap;
						}else{
							vec_u32_push(&idx3, textflat.len);
						}
					}else if(isupper(c)){
						vec_char_push(&textflat, tolower(c));
						if(!upper){
							upper = 1;
							upper_idx = textflat.len;
							vec_u32_push(&tag, taggap);
							vec_u32_push(&tag, CAPITAL_SINGLE);
							pupper = tag.len - 1;
							taggap = 0;
						}
						++taggap;
					}else{
						if(upper){
							int x = textflat.len - upper_idx + 1;
							//printf("CAP RUN: %d ", x);
							if(x > 1){
								tag.items[pupper] = CAPITAL_RUN_START;
								vec_u32_push(&tag, taggap);
								vec_u32_push(&tag, CAPITAL_RUN_END);
								taggap = 0;
							}
							upper = 0;
						}
						vec_char_push(&textflat, c);
						taggap++;
					}
						uint8_t *uc = textflat.data;
						if(uc[textflat.len-1] == 0x8b && uc[textflat.len-2] == 0x80 && uc[textflat.len-3] == 0xe2){
							textflat.len -= 3;
							taggap -= 3;
							vec_u32_push(&tag, taggap);
							vec_u32_push(&tag, ZWS);
							taggap = 0;
						}/*else if(textflat.data[textflat.len-1] < 0 && textflat.data[textflat.len-2] == ' ' && textflat.data[textflat.len-3] < 0){
							printf("\nXXXXX %d %d %d\n", taggap, textflat.len, tag.len);
							textflat.data[textflat.len-2] = textflat.data[textflat.len-1];
							--textflat.len;
							vec_u32_push(&tag, taggap-2);
							vec_u32_push(&tag, PSPACE);
							taggap = 1;
						}
					}*/
					if(taggap > 255){ // Before this was broken and was putting just out of reach tags, hopefully this fixes it.
						vec_u32_push(&tag, taggap-1);
						vec_u32_push(&tag, NOP);
						taggap = 1;
					}
				}
			}

			vec_u32_push(&tag_idx, tag.len/2); // There's an extra one for the bounds checking
			vec_u32_push(&line_idx, textflat.len);

			if(idx2.len){
				qsort(idx2.items, idx2.len, sizeof(idx2.items[0]), idx_cmp);
			}
			if(idx3.len){
				qsort(idx3.items, idx3.len, sizeof(idx3.items[0]), idx_cmp);
			}

			/*for(int i = 0; i < tagdef_idx.len; ++i){
				puts(&tagdef.data[tagdef_idx.items[i]]);
			}

			printf("\nFLAT TEXT: (%d lines)\n", line_idx.len);
			for(int i = 0; i < textflat.len; ++i){
				int c = textflat.data[i];
				putchar(c ? c : '\n');	
			}

			printf("\nINDEX TEXT:\n");
			for(int i = 0; i < line_idx.len-1; ++i){
				puts(&textflat.data[line_idx.items[i]]);	
			}

			printf("&&&&&&& TAG LEN!!! %d\n", tag.len);

			*/

			/*
			for(int i = 0; i < tag_idx.len - 1; ++i){
				printf("\n");
				for(int j = tag_idx.items[i]; j + 1 < tag_idx.items[i+1]; j+=2){
					printf("%u:<%u %u>; ", j, tag.items[j], tag.items[j+1]);
				}
			}
			printf("\n");
			*/

			printf("\nTAGS DATA: (%d lines)\n", tag_idx.len);
			if(tag.len > 0){
				for(int i = 0; i < tag_idx.len - 1; ++i){
					putchar('\n');
					uint32_t t = tag_idx.items[i]*2;
					char *c = &textflat.data[line_idx.items[i]];
					int upper = 0;
					uint32_t j = 0;
					uint32_t tend = tag_idx.items[i+1]*2;
					printf("\ntag range %d-%d\n", t, tend);
					if(tend < t){
						printf("ERROR with tag order!!!\n");
					}
					while(*c || t + 1 < tend){
						while(j == tag.items[t] && t+1 < tend){
							switch(tag.items[t+1]){
								case CAPITAL_SINGLE:
									upper = 1; break;
								case CAPITAL_RUN_START:
									upper = 2; break;
								case CAPITAL_RUN_END:
									upper = 0; break;
								default:
									break;
							}
							printf("<%u-%u>", tag.items[t], tag.items[t+1]);
							//printf("%s", &tagdef.data[tagdef_idx.items[tag.items[t+1]]]);
							t += 2;
							j = 0;
						}
						if(*c){
							putchar(upper ? toupper(*c) : *c);
							upper = upper == 1 ? 0 : upper;
							c++;
							++j;
						}
						else if(j != tag.items[t]){
							printf("\nIMPOSSIBLE!\n");
							break;
						}
					}
				}
			}

			/*printf("Line starts %d# ", line_idx.len);
			for(int i = 0; i < line_idx.len; ++i){
				printf("%d..", line_idx.items[i]);
			}
			printf("\n");*/

			struct peakslab h = {0, {0xF2, 0xFC, 0xF3}, {'P', 'e', 'a', 'k'},
				0x2, PEAK, bytes_req(tagdef.len),
				bytes_req(tag.len), 1, bytes_req(tagdef_idx.len), textflat.len > 0xFFFF ? 4 : 2,
				0, tagdef_idx.len,
				0, tagdef.len,
				0, tag_idx.len,
				0, tag.len/2,
				0, line_idx.len,
				0, textflat.len,
				0, idx2.len,
				0, idx3.len
			};
		
	//	binarybyte; magicnum; magicstr;
	//	version; features; btagdef_idx;
	//	btag_idx; btag1; btag2; bline_idx;
	//	tagdef_idx_start; tagdef_idx_len;
	//  tagdef_start; tagdef_len; 
	//  tag_idx_start; tag_idx_len;
	//  tag_start; tag_len; 
	//	line_idx_start; line_idx_len;
	//	line_start; line_len;
	//	idx2_start; idx2_len;
	//	idx3_start; idx3_len;

			h.tagdef_idx_start = sizeof(struct peakslab);
			h.tagdef_start = h.tagdef_idx_start + h.tagdef_idx_len * h.btagdef_idx;
			h.tag_idx_start = h.tagdef_start + h.tagdef_len * sizeof(char);
			h.tag_start = h.tag_idx_start + h.tag_idx_len * h.btag_idx;
			/*h.idx2_start = h.tag_start + h.tag_len * (h.btag1 + h.btag2);
			h.idx3_start = h.idx2_start + h.idx2_len * h.bline_idx;
			h.line_idx_start = h.idx3_start + h.idx3_len * h.bline_idx;*/
			h.idx2_start = (h.tag_start + h.tag_len * (h.btag1 + h.btag2) + 3) & ~3u;
			h.idx3_start = (h.idx2_start + h.idx2_len * h.bline_idx + 3) & ~3u;
			h.line_idx_start = (h.idx3_start + h.idx3_len * h.bline_idx + 3) & ~3u;

			h.line_start = h.line_idx_start + h.line_idx_len * h.bline_idx;

			uint32_t size = 0;
			FILE *out = fopen(argv[2], "wb");
			fwrite(&h, sizeof(struct peakslab), 1, out);
			size += sizeof(struct peakslab);
			printf("tagdef_idx: %d\n", size);
			for(int i=0; i<tagdef_idx.len; ++i){
				fwrite(&tagdef_idx.items[i], h.btagdef_idx, 1, out);
				size += h.btagdef_idx;
			}
			printf("tagdef: %d\n", size);
			//fwrite(&tagdef.data[0], sizeof(char), 15, out);
			fwrite(tagdef.data, sizeof(char), tagdef.len, out);
			size += sizeof(char) * tagdef.len;
			printf("tag_idx: %d\n", size);
			printf("btag_idx: %d\n", h.btag_idx);
			printf("bline_idx: %d\n", h.bline_idx);
			for(int i=0; i<tag_idx.len; ++i){
				/*printf("line %d, tag_idx: %d\n", i, tag_idx.items[i]);
				if(i+1 < tag_idx.len){
					uint32_t tagnum = tag_idx.items[i+1] - tag_idx.items[i];
					printf("%d, (%d) items on line: %d\n", tag_idx.items[i], tagnum, i);
				}*/
				fwrite(&tag_idx.items[i], h.btag_idx, 1, out);
				size += h.btag_idx; 
			}

			putchar('\n');
			printf("tag: %d\n", size);
			for(int i=0; i<tag.len; ++i){
				int el = (i & 1) ? h.btag2 : h.btag1;
				fwrite(&tag.items[i], el, 1, out);
				size += el; 
			}
			uint32_t x0 = 0;
			printf("size: %d\n", size);
			while(size < h.idx2_start){
				fwrite(&x0, 1, 1, out);
				++size;
			}
			printf("size: %d\n", size);
			printf("idx2_start: %d\n", size);
			for(int i=0; i<idx2.len; ++i){
				fwrite(&idx2.items[i], h.bline_idx, 1, out);
				size += h.bline_idx;
			}
			printf("size: %d\n", size);
			while(size < h.idx3_start){
				fwrite(&x0, 1, 1, out);
				++size;
			}
			printf("size: %d\n", size);
			printf("idx3_start: %d\n", size);
			for(int i=0; i<idx3.len; ++i){
				fwrite(&idx3.items[i], h.bline_idx, 1, out);
				size += h.bline_idx;
			}
			printf("size: %d\n", size);
			while(size < h.line_idx_start){
				fwrite(&x0, 1, 1, out);
				++size;
			}
			printf("size: %d\n", size);
			printf("line_idx_start: %d\n", size);
			for(int i=0; i<line_idx.len; ++i){
				fwrite(&line_idx.items[i], h.bline_idx, 1, out);
			}
			size += line_idx.len * h.bline_idx; 
			printf("text_flat_start: %d\n", size);
			fwrite(textflat.data, sizeof(char), textflat.len, out);
			size += 1 * textflat.len; 
			printf("text_flat_end: %d\n", size);

			/*printf("Line starts %d# ", line_idx.len);
			for(int i = 0; i < line_idx.len; ++i){
				printf("%d..", line_idx.items[i]);
			}
			printf("\n");*/

			for(int i=0; i<tagdef_idx.len; ++i){
				//printf("%d @%s@\n", i, tagdef.data + tagdef_idx.items[i]);
			}


			fclose(out);
		}

    return 0;
}
