int peakcmp(char *a, char *b){ // Both strings should be lowercased already
	int i = 0;
	while(a[i] && b[i] && a[i] == b[i]){
		++i;
	}
	return a[i] - b[i];
}
