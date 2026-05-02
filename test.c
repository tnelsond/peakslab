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
};

#define segmax 10
struct pat seg[segmax];
int segend = 0;

#define qmax 64
char query[qmax];

void init_segment(int i, char *s){
	seg[i].s = s;
	seg[i].flags = 0;
	seg[i].len = 0;
	seg[i].match = NULL;
}

char e[] = "hello world. Do you like pie?\0somewhere over the rainbow, way out there, somewhere that I dreamed of once in a lullaby.\0i love you.\0do you love me?\0jesus christ is lord.\0jesus is lord.\0jesus loves me.\0dream team\0jesus knows you.";
size_t elen = sizeof(e);


int main(int argc, char **argv){

	putchar('\n');
	for(int i=0; i<elen; ++i){
			putchar(e[i] ? e[i] : '\n');
	}
	putchar('\n');
	
	while(1){
		int c;
		int lseg = 0;
		segend = 0;
		int a = 0;
		int inspace = 0;
		init_segment(segend, query);
		while((c = getchar()) != EOF){
			if(c == '\n')
				break;
			if(c == ' '){
				inspace = 1;
			}else{
				if(c == '+' || c == '!' || c == '*'){
					if(seg[segend].len){
						inspace = 0;
						if(a && query[a-1]){
							query[a++] = '\0';
						}
						if(seg[segend].len > seg[lseg].len){
							lseg = segend;
						}
						++segend;
						init_segment(segend, query+a);
						seg[segend].flags = c == '+' ? ANY : c == '!' ? NOT : 0;
					}else{
						seg[segend].flags = c == '+' ? ANY : c == '!' ? NOT : 0;
					}
				}else if(inspace){
					inspace = 0;
					if(seg[segend].len){
						query[a++] = ' ';
						++seg[segend].len;
					}
					query[a++] = c;	
					++seg[segend].len;
				}else{
					query[a++] = c;	
					++seg[segend].len;
				}
			}
		}
		query[a] = '\0';

		for(int i=0; i<=segend; ++i){
			printf("(%d) len: %d; %s\n", seg[i].flags, (int) seg[i].len, seg[i].s);
		}

		printf("!!!!!!!\n!!!!!!\n\n\n");
		int i = 0;
		char *l = e;
		char *r = e+elen;
		char *nl = e;
		while(1){
			if(nl < e || nl > e+elen){
				seg[i].match = NULL;
				break;
			}
			if(!i){
				printf("r = e+elen;\n");
				r = e+elen;
			}
			printf("$$ sz_find(nl: %d, r-nl: %d, seg[i].s:%s, seg[i].len:%d);\n", nl-e, r-nl-1, seg[i].s, seg[i].len);
			if(seg[i].flags & ANY)
				seg[i].match = (char *)sz_rfind(l, r-l, seg[i].s, seg[i].len);
			else{
				seg[i].match = (char *)sz_find(nl, r-nl, seg[i].s, seg[i].len);
			}
			printf("## %s : %s\n\n", seg[i].s, seg[i].match ? seg[i].match : "NULL");

			if(seg[i].flags & NOT){
				seg[i].match = seg[i].match ? NULL : nl;
			}
			if(seg[i].match && !i){
				l = (char *)sz_rfind_byte(e, seg[i].match-e, "");
				r = (char *)sz_find_byte(seg[i].match, e+elen-seg[i].match, "");
				nl = seg[i].match + seg[i].len;
				if(!l)
					l = e;
				else
					++l;
				printf("%s\n", l);
			}
			if(!seg[i].match){
				if(!i)
					break;
				--i;
			}else{
				if(i >= segend){
					break;
				}
				++i;
			}
		}

		printf("i: %d, segend:%d\n", i, segend);
		if(seg[i].match){
			printf("TRYING\n");
			char *m = (char *)sz_rfind_byte(e, seg[i].match-e, "");
			m = m ? m + 1 : e;
			printf("MATCH!: %s\n", m);
		}else{
			printf("NOT FOUND\n");
		}
	}
	putchar('\n');
	return 0;
}
