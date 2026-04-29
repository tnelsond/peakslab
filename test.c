#include <stdio.h>
#include "utils/stringzilla/stringzilla.h"

enum flag{
	ANY=1, NOT=2
};

struct pat{
	char *s;
	uint8_t flags;
	size_t len;
	char *match;
	int done;
};

#define segmax 10
struct pat seg[segmax];
int seglen = 0;

#define qmax 64
char query[qmax];

void init_segment(int i, char *s){
	seg[i].s = s;
	seg[i].flags = 0;
	seg[i].len = 0;
	seg[i].match = NULL;
	seg[i].done = 1;
}

char e[] = "hello world. Do you like pie?\0somewhere over the rainbow, way out there, somewhere that I dreamed of once in a lullaby.\0i love you.\0do you love me?\0jesus christ is lord.\0jesus is lord.\0jesus loves me.";
size_t elen = sizeof(e);


int main(int argc, char **argv){
	char * l = e;
	char * r = e + elen;
	putchar('\n');
	for(int i=0; i<elen; ++i){
			putchar(e[i] ? e[i] : '\n');
	}
	putchar('\n');
	
	while(1){
		int c;
		int lseg = 0;
		int a = 0;
		int inspace = 0;
		init_segment(seglen, query);
		while((c = getchar()) != EOF){
			if(c == '\n')
				break;
			if(c == ' '){
				inspace = 1;
			}else{
				if(c == '+' || c == '-' || c == '*'){
					inspace = 0;
					query[a++] = '\0';
					if(seg[seglen].len > seg[lseg].len){
						lseg = seglen;
					}
					++seglen;
					init_segment(seglen, query+a);
					seg[seglen].flags = c == '+' ? ANY : c == '-' ? NOT : 0;
				}else if(inspace){
					inspace = 0;
					if(seg[seglen].len){
						query[a++] = ' ';
						++seg[seglen].len;
					}
					query[a++] = c;	
					++seg[seglen].len;
				}else{
					query[a++] = c;	
					++seg[seglen].len;
				}
			}
		}
		query[a] = '\0';

		for(int i=0; i<=seglen; ++i){
			printf("(%d) len: %d; %s\n", seg[i].flags, seg[i].len, seg[i].s);
		}

		int i = 0;
		char *l = e;
		char *r = e+elen;
		char *nl = e;
		while(1){
			char *m = NULL;
			if(seg[i].match){
				nl = seg[i].match + seg[i].len;
			}else{
				nl = l;
			}
			if(!i){
				r = e+elen;
			}
			seg[i].match = (char *)sz_find(nl, r-nl), seg[i].s, seg[i].len);
			if(!i){
				l = (char *)sz_rfind_byte(e, m-e, "\0")+1;
			}
			if(!seg[i].match){
				seg[i].done = 1;
				--i;
				if(i < 0)
					break;
			}else if(i == seglen-1){
				break;
			}
//	m = (char *)sz_find(b, r-b, seg[i].s, seg[i].len);
//	l = (char *)sz_rfind_byte(e, m-e, "\0")+1;
		}

		if(seg[0].match){
			printf("MATCH!: %s\n", match);
		}else{
			printf("NOT FOUND");
		}
	}
	putchar('\n');
	return 0;
}
