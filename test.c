#include <stdio.h>
#include "utils/stringzilla/stringzilla.h"

enum flag{
	ANY=1, NOT=2
};

struct pat{
	char *s;
	uint8_t flags;
	size_t len;
};

#define segmax 10
struct pat segments[segmax];
int seglen = 0;

#define qmax 64
char query[qmax];

void init_segment(char *s){
	segments[seglen].s = s;
	segments[seglen].flags = 0;
	segments[seglen].len = 0;
}

char e[] = "Hello world. Do you like pie?\0Somewhere over the rainbow, way out there, somewhere that I dreamed of once in a lullaby.\0I love you.\0Do you love me?";
size_t len = sizeof(e);

int main(int argc, char **argv){
	char * l = e;
	char * r = e + len;
	putchar('\n');
	for(int i=0; i<len; ++i){
			putchar(e[i] ? e[i] : '\n');
	}
	putchar('\n');
	
	while(1){
		int c;
		int a = 0;
		init_segment(query);
		while((c = getchar()) != EOF){
			if(c == '\n')
				break;
			if(c == '*' || c == '+' || c == '-'){
				if(a > 0 && query[a-1] == ' '){
					--a;
					--segments[seglen].len;
				}
				query[a] = '\0';
				if(segments[seglen].len){
					++seglen;
					init_segment(query + a + 1);
				}
				if(seglen > sizeof(segments)){
					printf("TOO MANY SEGMENTS!\n");
				}
				if(c == '*'){
					segments[seglen].flags = 0;
				}else if(c == '+'){
					segments[seglen].flags = ANY;
				}else if(c == '-'){
					segments[seglen].flags = NOT;	
				}
			}else{
				query[a] = c;
			}
			++segments[seglen].len;
			++a;
		}
		query[a] = '\0';

		for(int i=0; i<=seglen; ++i){
			printf("(%d) len: %d; %s\n", segments[i].flags, segments[i].len, segments[i].s);
		}
		l = query;
		r = query + a;
		int fail = 0;
		while(l < r && !fail){
			char *m = NULL;
			for(int i=0; i<= seglen; ++i){
				if(i > 0){
					if(segments[i].flags | ANY){
						m = (char *)sz_find(l, r-l, segments[i].s, segments[i].len);
						if(((segments[i].flags | NOT) && m) || !m){
							fail = 1;
							break;
						}
					}else{
						int b = m+segments[i-1].len+1;
						m = (char *)sz_find(b, r-b, segments[i].s, segments[i].len);
					}
				}else{
					m = (char *)sz_find(l, r-l, segments[i].s, segments[i].len);
					if(!m){
						fail = 1;
						break;
					}
					l = (char *)sz_rfind_byte(e, ptr-e, "\0")+1;
					r = (char *)sz_find_byte(ptr, e-ptr+len, "\0");
				}
			}
			if(!fail){
				break;
			}
			l = r;
			r = query + a;
		}
		if(fail){
			printf("NO MATCH FOUND");
		}
		char *ptr = (char *)sz_find(l, len, "dream", 4);
		if(!ptr){
			break;
		}
		l = (char *)sz_rfind_byte(e, ptr-e, "\0")+1;
		r = (char *)sz_find_byte(ptr, e-ptr+len, "\0");
		char *ptr2 = (char *)sz_find(l, r-l, "once", 4);
		if(ptr2){
			printf(l);
			break;
		}
		else{
			l = r + 1;
			if(l > e+len)
				break;
		}
	}
	putchar('\n');
	return 0;
}
