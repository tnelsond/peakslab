#include "peak.c"

int main(int argc, char **argv){
	if(argc < 2){
		return 1;
	}
	FILE *in = fopen(argv[1], "rb");
	if(!in){
		return 2;
	}
	printf("%s ends with %s? %d\n", argv[1], ".zst", p_endswith(argv[1], ".zst"));
	size_t srcSize = 0;
	uint8_t *src = NULL;
	int c;
	int i = 0;
	while((c = fgetc(in)) != EOF){
		if(i+1 >= srcSize){
			srcSize = srcSize < 8096 ? 8096 : srcSize * 2;
			src = realloc(src, srcSize+1);
			if(src == NULL){
				//printf("Fatal error Drive B\n");
				return -1;
			}
		}
		src[i++] = c;
	}
	src[i] = '\0';
	fclose(in);
	int compressed = p_endswith(argv[1], ".zst");
	load_peak(src, i, compressed);
	if(compressed)
		free(src);
	uint8_t * buf = malloc(BUF_LEN);
	int query_size = 256;
	peak_init(buf, query_size, buf + query_size, query_size, buf + query_size*2, 8096 - query_size*2);

	printf("Loaded header:\n");
	printf("  btag1          = %u\n", ps_h->btag1);         // should be 1
	printf("  btag2          = %u\n", ps_h->btag2);         // should be 2
	printf("  tagdef_idx_len = %u\n", ps_h->tagdef_idx_len); // ~514
	printf("tag_start        = %u\n", ps_h->tag_start);
	printf("tag_len          = %u\n", ps_h->tag_len);
	printf("First tag ptr    = %p\n", (void*)(g_d + ps_h->tag_start));
	printf("Buffer end       ≈ %p\n", (void*)(g_d + g_d_size));
	printf("First 16 raw bytes at tag_start:\n");
	for(int i = 0; i < 16; i++) {
			uint8_t b = (g_d + ps_h->tag_start)[i];
			printf("%02x ", b);
			if ((i & 3) == 3) printf("  ");
	}
	printf("\n");

	int quit = 0;
	int st = 3;
	int len = -1;
	uint8_t buf2[query_size];
	while(!quit){
		printf("\n\n###  Query (return for more): ");
		i = 0;
		while((c = fgetc(stdin)) != EOF){
			if(c == '\n'){
				break;
			}
			buf2[i++] = c;
		}
		buf2[i] = '\0';
		printf("%d, %s\n", i, buf2);
		if(i == 4 && strncmp(buf2, "quit", i) == 0){
			quit = 1;
			break;
		}
		if(i){
			while(i >= 0){
				psa->qloc[i] = buf2[i];
				--i;
			}
			st = INDEX1;
			init_search(st, 1);
		}
		else{
			printf("%s\n", psa->qloc);
		}
		len = -1;
		while(len < 0 && st != 2){
			len = get_result(0);
			if(len < 0){
				++st;
				if(st > 5){
					st = 0;
				}
				continue_search(st);
			}
		}
		if(len > 0){
			printf("(%d) %s\n", st, g_result_loc);
		}
		else{
			printf("END OF RESULTS!\n");
		}
	}
	return 0;
}
