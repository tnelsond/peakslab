// Every entry of a .peak(.zst) file, one a line: its rendered text (header<TAB>body), newlines as spaces.
// Build (in the top directory): gcc -O2 -I. utils/peakdump.c -o peakdump. Usage: peakdump x.peak.zst > x.tsv
#include "peak.c"
int main(int argc, char **argv){
	if(argc < 2) return 1;
	FILE *in = fopen(argv[1], "rb"); if(!in) return 2;
	fseek(in, 0, SEEK_END); long size = ftell(in); fseek(in, 0, SEEK_SET);
	uint8_t *src = malloc(size + 1); if(fread(src, 1, size, in) != (size_t)size) return 3; src[size] = 0; fclose(in);
	int compressed = p_endswith(argv[1], ".zst");
	load_peak(src, size, compressed);
	if(compressed) free(src);
	int q = 256, max = 4 << 20;
	uint8_t *buf = malloc(q * 2 + max);
	peak_init(buf, q, buf + q, q, buf + q * 2, max);
	int count = 0;
	for(int i = 0; head_at(i) >= 0; ++i){ ++count;
		int n = render_match(i, INDEX1);
		if(n <= 0) continue;
		for(int j = 0; j < n; ++j) if(g_result_loc[j] == '\n' || g_result_loc[j] == '\r') g_result_loc[j] = ' ';
		fwrite(g_result_loc, 1, n, stdout); fputc('\n', stdout);
	}
	fprintf(stderr, "%d entries\n", count);
	return 0;
}
