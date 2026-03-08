#include <stdio.h>

int main(int argc, char **argv){
	char buffer[256];
	int c;
	while((c = getchar()) != EOF){
		printf("<%c: %d>", (char)c, c);
	}
	return 0;
}
