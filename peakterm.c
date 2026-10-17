/* peakterm: a multi-dictionary terminal interface for PeakSlab (.peak/.slab)
 * dictionaries, like peakslab.org but on the command line.
 *
 * peak.c is used as is. It keeps its search state in globals (on the website
 * every dictionary gets its own wasm instance), so here each dictionary keeps
 * its own copy of those globals and they're switched in before it's used.
 * Two loader threads read and decompress the files in the background.
 *
 *   peakterm [-r root] [page | file.peak.zst ...]
 *   peakterm -q "query" [-n groups] [-w width] [page]   (print and exit)
 *   peakterm -l [page]                                 (list dictionaries)
 */
#define TB_IMPL
#define TB_OPT_ATTR_W 32
#define TB_OPT_EGC
#include "utils/termbox2/termbox2.h"
#include "peak.c"
#undef printf

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define QMAX 512      // query buffer per search state (same as the website)
#define BATCH 16      // results fetched per request in the main search
#define FILLMAX 64    // results per dictionary when gathering a headword's entries
#define POPMAX 100    // results per dictionary in a lookup popup
#define MAXPOP 16

/* ---------- small helpers ---------- */

static void die(const char *m){ fprintf(stderr, "peakterm: %s\n", m); exit(1); }
static void *xmalloc(size_t n){ void *p = malloc(n ? n : 1); if(!p) die("out of memory"); return p; }
static void *xrealloc(void *p, size_t n){ p = realloc(p, n ? n : 1); if(!p) die("out of memory"); return p; }
static char *xstrndup(const char *s, size_t n){ char *r = xmalloc(n+1); memcpy(r, s, n); r[n] = 0; return r; }
static char *xstrdup(const char *s){ return xstrndup(s, strlen(s)); }

#define VEC(T) struct { T *v; int n, cap; }
#define VPUSH(a, x) do{ if((a).n >= (a).cap){ (a).cap = (a).cap ? (a).cap*2 : 8; \
	(a).v = xrealloc((a).v, (size_t)(a).cap*sizeof(*(a).v)); } (a).v[(a).n++] = (x); }while(0)

typedef VEC(char) sbuf;
typedef VEC(int) ivec;
static void sb_add(sbuf *b, const char *s, size_t n){
	if(b->n + (int)n + 1 > b->cap){
		b->cap = (b->n + n + 1) * 2;
		b->v = xrealloc(b->v, b->cap);
	}
	memcpy(b->v + b->n, s, n);
	b->n += n;
	b->v[b->n] = 0;
}

static long long now_ms(void){
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return t.tv_sec*1000LL + t.tv_nsec/1000000;
}

static uint64_t fnv(const void *p, size_t n){
	const uint8_t *s = p;
	uint64_t h = 1469598103934665603ULL;
	while(n--){ h ^= *s++; h *= 1099511628211ULL; }
	return h;
}

static int u8dec(const unsigned char *s, size_t len, uint32_t *cp){
	unsigned c = s[0];
	if(c < 0x80){ *cp = c; return 1; }
	int n = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 0;
	if(!n || (size_t)n > len){ *cp = 0xfffd; return 1; }
	uint32_t v = c & (0x7f >> n);
	for(int i = 1; i < n; ++i){
		if((s[i] & 0xc0) != 0x80){ *cp = 0xfffd; return 1; }
		v = v << 6 | (s[i] & 0x3f);
	}
	*cp = v;
	return n;
}

static int u8enc(uint32_t c, char *o){
	if(c < 0x80){ o[0] = c; return 1; }
	if(c < 0x800){ o[0] = 0xc0 | c >> 6; o[1] = 0x80 | (c & 63); return 2; }
	if(c < 0x10000){ o[0] = 0xe0 | c >> 12; o[1] = 0x80 | ((c >> 6) & 63); o[2] = 0x80 | (c & 63); return 3; }
	o[0] = 0xf0 | c >> 18; o[1] = 0x80 | ((c >> 12) & 63); o[2] = 0x80 | ((c >> 6) & 63); o[3] = 0x80 | (c & 63);
	return 4;
}

static int wr_all(int fd, const void *p, size_t n){
	const char *c = p;
	while(n){
		ssize_t r = write(fd, c, n);
		if(r < 0 && errno == EINTR) continue;
		if(r <= 0) return 0;
		c += r; n -= r;
	}
	return 1;
}

/* Like the website's updateQuery(): lowercase (peak stores text lowercased,
 * ASCII only), drop zero width spaces, "\t" means a tab. */
static void normq(const char *s, char *out, int max){
	int o = 0;
	for(const unsigned char *c = (const unsigned char *)s; *c && o < max-1; ++c){
		if(c[0] == 0xe2 && c[1] == 0x80 && c[2] == 0x8b){ c += 2; continue; }
		if(c[0] == '\\' && c[1] == 't'){ out[o++] = '\t'; ++c; continue; }
		out[o++] = tolower(*c);
	}
	out[o] = 0;
}

/* Grouping key of a headword: as it is stored in the dictionary (no tags,
 * lowercase, no zero width spaces), trimmed. */
static char *normkey(const char *s, int n){
	char *k = xmalloc(n+1);
	int o = 0, intag = 0;
	for(int i = 0; i < n; ++i){
		unsigned char c = s[i];
		if(c == '<'){ intag = 1; continue; }
		if(intag){ if(c == '>') intag = 0; continue; }
		if(c == 0xe2 && i+2 < n && (uint8_t)s[i+1] == 0x80 && (uint8_t)s[i+2] == 0x8b){ i += 2; continue; }
		k[o++] = tolower(c);
	}
	while(o && isspace((unsigned char)k[o-1])) --o;
	k[o] = 0;
	int b = 0;
	while(isspace((unsigned char)k[b])) ++b;
	if(b) memmove(k, k+b, o-b+1);
	return k;
}

static int isglob(const char *q){ return strpbrk(q, "!+*^") != NULL; }

/* ---------- a tiny JSON reader (for files.json) ---------- */

typedef struct jv { char t; double num; char *s; struct jv *a; char **k; int n; } jv;
static const char *jp;

static void jws(void){ while(*jp == ' ' || *jp == '\n' || *jp == '\r' || *jp == '\t') ++jp; }

static uint32_t jhex4(void){
	uint32_t u = 0;
	for(int i = 0; i < 4; ++i){
		char c = *jp;
		if(!isxdigit((unsigned char)c)) return u;
		u = u*16 + (isdigit((unsigned char)c) ? c-'0' : (tolower(c)-'a'+10));
		++jp;
	}
	return u;
}

static char *jstr(void){
	sbuf b = {0};
	sb_add(&b, "", 0);
	++jp;
	while(*jp && *jp != '"'){
		if(*jp == '\\' && jp[1]){
			++jp;
			char c = *jp++, o[4];
			switch(c){
				case 'n': sb_add(&b, "\n", 1); break;
				case 't': sb_add(&b, "\t", 1); break;
				case 'r': case 'b': case 'f': break;
				case 'u': {
					uint32_t u = jhex4();
					if(u >= 0xd800 && u < 0xdc00 && jp[0] == '\\' && jp[1] == 'u'){
						jp += 2;
						uint32_t l = jhex4();
						u = 0x10000 + ((u - 0xd800) << 10) + (l - 0xdc00);
					}
					sb_add(&b, o, u8enc(u, o));
					break;
				}
				default: sb_add(&b, &c, 1);
			}
		}else{
			sb_add(&b, jp++, 1);
		}
	}
	if(*jp == '"') ++jp;
	return b.v;
}

static int jparse(jv *v){
	jws();
	memset(v, 0, sizeof *v);
	if(*jp == '{' || *jp == '['){
		char end = *jp == '{' ? '}' : ']';
		v->t = *jp++;
		VEC(jv) a = {0};
		VEC(char*) k = {0};
		for(;;){
			jws();
			if(*jp == end){ ++jp; break; }
			if(!*jp) return -1;
			if(end == '}'){
				if(*jp != '"') return -1;
				char *key = jstr();
				jws();
				if(*jp++ != ':') return -1;
				VPUSH(k, key);
			}
			jv x;
			if(jparse(&x)) return -1;
			VPUSH(a, x);
			jws();
			if(*jp == ',') ++jp;
		}
		v->a = a.v; v->k = k.v; v->n = a.n;
		return 0;
	}
	if(*jp == '"'){ v->t = 's'; v->s = jstr(); return 0; }
	if(*jp == '-' || isdigit((unsigned char)*jp)){ char *e; v->t = 'n'; v->num = strtod(jp, &e); jp = e; return 0; }
	if(!strncmp(jp, "true", 4)){ v->t = 'b'; v->num = 1; jp += 4; return 0; }
	if(!strncmp(jp, "false", 5)){ v->t = 'b'; jp += 5; return 0; }
	if(!strncmp(jp, "null", 4)){ v->t = 'z'; jp += 4; return 0; }
	return -1;
}

static jv *jget(jv *o, const char *key){
	if(!o || o->t != '{') return NULL;
	for(int i = 0; i < o->n; ++i)
		if(!strcmp(o->k[i], key)) return &o->a[i];
	return NULL;
}

/* ---------- dictionaries ---------- */

enum { D_OFF, D_LOADING, D_DECODED, D_READY, D_FAILED };

// One dictionary's copy of peak.c's globals, switched in before it's used.
struct pctx {
	uint8_t *g_d;
	size_t g_d_size;
	struct peakslab *ps_h;
	struct ptracker tracker;
	struct pstate iowa, wis;
	int alt; // psa == &wis
};

typedef struct {
	char *path, *full, *name, *desc, *lang, *cat;
	int prio, has_prio, slab, zst;
	// page
	int inpage, primary, enabled, collapsed, order, rank, mc;
	// loading: a loader thread fills buf/size/code/ms/resmax, then sets state to D_DECODED
	int state, want, ms, code;
	uint8_t *buf;
	size_t size, resmax;
	char err[64];
	// loaded
	struct pctx ctx;
	uint8_t *qbuf;
	int insearch;
} dict;

static dict *D;
static int ND;
static int *P, NP; // the dictionaries of the current page, in display order

/* --- switching between dictionaries --- */

static dict *cur; // whose state is in peak.c's globals right now
static uint8_t *resbuf;
static size_t resmax;

static void ctx_save(dict *d){
	struct pctx *c = &d->ctx;
	c->g_d = g_d; c->g_d_size = g_d_size; c->ps_h = ps_h; c->tracker = tracker;
	c->iowa = iowa; c->wis = wis; c->alt = psa == &wis;
}

static void ctx_load(dict *d){
	struct pctx *c = &d->ctx;
	g_d = c->g_d; g_d_size = c->g_d_size; ps_h = c->ps_h; tracker = c->tracker;
	iowa = c->iowa; wis = c->wis; psa = c->alt ? &wis : &iowa;
}

static void use(dict *d){
	if(cur == d) return;
	if(cur) ctx_save(cur);
	ctx_load(d);
	cur = d;
}

/* --- loading, on two background threads (like the website's two workers) --- */

#define LOADERS 2
static pthread_mutex_t lmu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t lcv = PTHREAD_COND_INITIALIZER;
static ivec lq;          // dictionaries waiting to be loaded
static int lqh;
static int wakefd[2] = {-1, -1}; // a loader writes a byte here when it's done with one
static int loaders;

static int check_peak(const uint8_t *g, size_t sz){
	const struct peakslab *h = (const struct peakslab *)g;
	if(sz < sizeof *h || memcmp(h->magicstr, "Peak", 4)) return 0;
	#define FITS(start, len, w) ((uint64_t)(start) + (uint64_t)(len)*(w) <= sz)
	return FITS(h->line_start, h->line_len, 1) && FITS(h->line_idx_start, h->line_idx_len, h->bline_idx) &&
		FITS(h->tagdef_start, h->tagdef_len, 1) && FITS(h->tagdef_idx_start, h->tagdef_idx_len, h->btagdef_idx) &&
		FITS(h->tag_idx_start, h->tag_idx_len, h->btag_idx) && FITS(h->tag_start, h->tag_len, 1) &&
		FITS(h->idx2_start, h->idx2_len, h->bline_idx) && FITS(h->idx3_start, h->idx3_len, h->bline_idx);
	#undef FITS
}

/* The biggest result get_result() can produce: the longest line with all its
 * tags put back (twice the line for .slab, which copies the raw bytes too). */
static size_t calc_resmax(uint8_t *g){
	struct peakslab *h = (struct peakslab *)g;
	size_t tagmax = 0;
	for(uint32_t t = 0; t < h->tagdef_idx_len; ++t){
		uint32_t off = p_read_bytes(g, h->tagdef_idx_start, t, h->btagdef_idx);
		if(off >= h->tagdef_len) continue;
		size_t l = strnlen((char*)g + h->tagdef_start + off, h->tagdef_len - off);
		if(l > tagmax) tagmax = l;
	}
	size_t mx = 0;
	for(uint32_t i = 0; i + 1 < h->line_idx_len; ++i){
		size_t ll = p_read_bytes(g, h->line_idx_start, i+1, h->bline_idx) - p_read_bytes(g, h->line_idx_start, i, h->bline_idx);
		size_t nt = 0;
		if(i + 1 < h->tag_idx_len)
			nt = p_read_bytes(g, h->tag_idx_start, i+1, h->btag_idx) - p_read_bytes(g, h->tag_idx_start, i, h->btag_idx);
		size_t tot = 2*ll + nt*tagmax;
		if(tot > mx) mx = tot;
	}
	return mx + 4096;
}

/* peak.c's binary and glob searches can compare a little past the end of the
 * data (harmless inside wasm memory): a zeroed tail longer than any query
 * makes those comparisons stop there. */
#define PAD (QMAX + 64)

// In a loader thread: read and decompress. Touches none of peak.c's globals.
static void load_file(dict *d){
	long long t0 = now_ms();
	int code = 0;
	uint8_t *src = NULL, *buf = NULL;
	size_t n = 0, size = 0;
	FILE *f = fopen(d->full, "rb");
	if(!f) code = -10;
	else{
		struct stat st;
		if(fstat(fileno(f), &st) || st.st_size <= 0) code = -11;
		else{
			n = st.st_size;
			src = malloc(n + PAD);
			if(!src || fread(src, 1, n, f) != n) code = -11;
		}
		fclose(f);
	}
	if(!code && d->zst){
		unsigned long long fs = ZSTD_getFrameContentSize(src, n);
		if(fs == ZSTD_CONTENTSIZE_UNKNOWN) code = -1;
		else if(fs == ZSTD_CONTENTSIZE_ERROR) code = -5;
		else if(fs > 512ULL * 1024 * 1024) code = -2;
		else if(!(buf = malloc(fs + PAD))) code = -3;
		else{
			size = ZSTD_decompress(buf, fs, src, n);
			if(ZSTD_isError(size)) code = -4;
			else memset(buf + size, 0, PAD);
		}
		free(src);
	}else if(!code){
		buf = src;
		size = n;
		memset(buf + size, 0, PAD);
	}else{
		free(src);
	}
	if(!code && !check_peak(buf, size)) code = -12;
	if(!code) d->resmax = calc_resmax(buf);
	if(code){ free(buf); buf = NULL; }
	d->buf = buf;
	d->size = size;
	d->code = code;
	d->ms = now_ms() - t0;
	__atomic_store_n(&d->state, D_DECODED, __ATOMIC_RELEASE);
	char c = 1;
	while(write(wakefd[1], &c, 1) < 0 && errno == EINTR);
}

static void *loader(void *arg){
	(void)arg;
	for(;;){
		pthread_mutex_lock(&lmu);
		while(lqh == lq.n) pthread_cond_wait(&lcv, &lmu);
		int i = lq.v[lqh++];
		pthread_mutex_unlock(&lmu);
		load_file(&D[i]);
	}
	return NULL;
}

static int dstate(dict *d){ return __atomic_load_n(&d->state, __ATOMIC_ACQUIRE); }

static void dict_start(int di){
	dict *d = &D[di];
	d->want = 1;
	if(dstate(d) != D_OFF) return;
	if(wakefd[0] < 0){
		if(pipe(wakefd)) die("pipe failed");
		fcntl(wakefd[0], F_SETFL, O_NONBLOCK);
		fcntl(wakefd[0], F_SETFD, FD_CLOEXEC);
		fcntl(wakefd[1], F_SETFD, FD_CLOEXEC);
	}
	d->state = D_LOADING;
	d->err[0] = 0;
	pthread_mutex_lock(&lmu);
	VPUSH(lq, di);
	pthread_cond_signal(&lcv);
	pthread_mutex_unlock(&lmu);
	for(; loaders < LOADERS; ++loaders){
		pthread_t t;
		if(pthread_create(&t, NULL, loader, NULL)) break;
		pthread_detach(t);
	}
}

static void dict_stop(int di){
	dict *d = &D[di];
	d->want = 0;
	if(dstate(d) != D_READY) return; // a dictionary still loading is dropped when it arrives
	if(cur == d) cur = NULL;
	free(d->ctx.g_d);
	free(d->ctx.tracker.data);
	free(d->qbuf);
	memset(&d->ctx, 0, sizeof d->ctx);
	d->qbuf = NULL;
	d->insearch = 0;
	d->state = D_OFF;
}

static const char *load_error(int code){
	switch(code){
		case -1: return "unknown size";
		case -2: return "too big";
		case -3: return "out of memory";
		case -4: return "bad zstd data";
		case -5: return "bad zstd frame";
		case -10: return "can't open file";
		case -11: return "can't read file";
		case -12: return "not a peak file";
	}
	return "load failed";
}

// A loader thread is done with it: hand the bytes to peak.c.
static void dict_finish(dict *d){
	if(d->code){
		d->state = D_FAILED;
		snprintf(d->err, sizeof d->err, "%s", load_error(d->code));
		return;
	}
	if(!d->want){
		free(d->buf);
		d->buf = NULL;
		d->state = D_OFF;
		return;
	}
	if(cur){ ctx_save(cur); cur = NULL; }
	g_d = NULL; g_d_size = 0; ps_h = NULL;
	tracker.bytes = 0; tracker.data = NULL;
	memset(&iowa, 0, sizeof iowa);
	memset(&wis, 0, sizeof wis);
	psa = &iowa;
	if(d->resmax > resmax){
		resmax = d->resmax;
		resbuf = xrealloc(resbuf, resmax);
	}
	load_peak(d->buf, d->size, 0); // already decompressed: peak.c keeps the buffer
	d->buf = NULL;
	d->qbuf = xmalloc(QMAX*2);
	peak_init(d->qbuf, QMAX, d->qbuf + QMAX, QMAX, resbuf, resmax);
	ctx_save(d);
	cur = d;
	d->state = D_READY;
}

// Takes in whatever the loaders finished. Returns how many became ready.
static int poll_loaded(void){
	char junk[64];
	if(wakefd[0] >= 0) while(read(wakefd[0], junk, sizeof junk) > 0);
	int n = 0;
	for(int i = 0; i < ND; ++i){
		if(dstate(&D[i]) != D_DECODED) continue;
		dict_finish(&D[i]);
		n += D[i].state == D_READY;
	}
	// a smaller result buffer may have been replaced: point peak.c at the current one
	g_result_loc = resbuf;
	g_result_max = resmax;
	return n;
}

static int is_loading(int di){ int s = dstate(&D[di]); return s == D_LOADING || s == D_DECODED; }

static int usable(int di){ return D[di].state == D_READY && D[di].enabled && D[di].inpage; }

/* ---------- search results ---------- */

typedef struct { uint32_t cp; uintattr_t fg, bg; uint32_t act; int8_t w; } glyph;
typedef struct { glyph *g; int n; } dline;

// Glyph actions (what clicking / Enter on it does)
#define A_LINK 1u
#define A_DICT 2u
#define A_OPEN 3u
#define AKIND(a) ((a) >> 28)
#define AVAL(a) ((a) & 0xfffffffu)
#define ACT(k, v) (((uint32_t)(k) << 28) | ((v) & 0xfffffffu))

typedef struct {
	int d;
	char *body; int blen;   // html after the headword
	int slab;
	char *ftype, *subs;     // slab: file type and tab separated sub headers
	char *bin; size_t binlen;
} entry;

typedef struct {
	char *key, *hdr;
	VEC(entry) e;
	dline *lines; int nl;
	int dirty;
} group;

typedef struct { uint32_t *v; int n; } term;

typedef struct {
	VEC(group) g;
	int *gh; int ghcap;          // key -> group+1
	uint64_t *eh; int ehcap, ehn; // seen results (dedupe)
	char q[QMAX];
	int st, cdic, done, popup, nent;
	int scroll, width, total, dirty;
	uint32_t sel;                // selected link
	term hl[SEGMAX]; int nhl;    // highlight terms
	struct { int g, l; } rows[1024];
	int nrows;
} rset;

static int opt_mark = 1, opt_chords = 0;
static uint32_t linkctr = 0;

static void rs_free(rset *rs){
	for(int i = 0; i < rs->g.n; ++i){
		group *g = &rs->g.v[i];
		for(int k = 0; k < g->e.n; ++k){
			entry *e = &g->e.v[k];
			free(e->body); free(e->ftype); free(e->subs); free(e->bin);
		}
		free(g->e.v);
		for(int l = 0; l < g->nl; ++l) free(g->lines[l].g);
		free(g->lines);
		free(g->key); free(g->hdr);
	}
	free(rs->g.v);
	free(rs->gh);
	free(rs->eh);
	for(int i = 0; i < rs->nhl; ++i) free(rs->hl[i].v);
	int w = rs->width;
	memset(rs, 0, sizeof *rs);
	rs->width = w;
}

static void add_term(rset *rs, const char *s, int n){
	while(n && *s == ' '){ ++s; --n; }
	while(n && s[n-1] == ' ') --n;
	if(!n || rs->nhl >= SEGMAX) return;
	term t = {xmalloc((n+1)*sizeof(uint32_t)), 0};
	for(int i = 0; i < n; ){
		uint32_t cp;
		i += u8dec((const unsigned char*)s+i, n-i, &cp);
		t.v[t.n++] = cp < 128 ? (uint32_t)tolower(cp) : cp;
	}
	rs->hl[rs->nhl++] = t;
}

// Highlight terms: the query, or a glob's wanted (not "!") parts.
static void set_terms(rset *rs){
	const char *q = rs->q;
	if(!isglob(q)){ add_term(rs, q, strlen(q)); return; }
	int neg = 0;
	const char *s = q;
	for(const char *c = q; ; ++c){
		if(!*c || strchr("!+*^", *c)){
			if(!neg) add_term(rs, s, c - s);
			if(!*c) break;
			neg = *c == '!';
			s = c + 1;
		}
	}
}

static int find_group(rset *rs, const char *key, int create, int *isnew){
	if(rs->g.n*2 >= rs->ghcap){
		int cap = rs->ghcap ? rs->ghcap*2 : 64;
		int *t = calloc(cap, sizeof(int));
		if(!t) die("out of memory");
		for(int i = 0; i < rs->g.n; ++i){
			uint64_t h = fnv(rs->g.v[i].key, strlen(rs->g.v[i].key)) & (cap-1);
			while(t[h]) h = (h+1) & (cap-1);
			t[h] = i+1;
		}
		free(rs->gh);
		rs->gh = t;
		rs->ghcap = cap;
	}
	uint64_t h = fnv(key, strlen(key)) & (rs->ghcap-1);
	while(rs->gh[h]){
		if(!strcmp(rs->g.v[rs->gh[h]-1].key, key)){ *isnew = 0; return rs->gh[h]-1; }
		h = (h+1) & (rs->ghcap-1);
	}
	if(!create) return -1;
	group g = {0};
	VPUSH(rs->g, g);
	rs->gh[h] = rs->g.n;
	*isnew = 1;
	return rs->g.n-1;
}

// Returns 1 if this result was already seen.
static int seen(rset *rs, int di, const char *buf, uint32_t len){
	uint64_t h = fnv(buf, len) ^ ((uint64_t)(di+1) * 0x9e3779b97f4a7c15ULL);
	if(!h) h = 1;
	if(rs->ehn*2 >= rs->ehcap){
		int cap = rs->ehcap ? rs->ehcap*2 : 256;
		uint64_t *t = calloc(cap, sizeof *t);
		if(!t) die("out of memory");
		for(int i = 0; i < rs->ehcap; ++i){
			if(!rs->eh[i]) continue;
			int j = rs->eh[i] & (cap-1);
			while(t[j]) j = (j+1) & (cap-1);
			t[j] = rs->eh[i];
		}
		free(rs->eh);
		rs->eh = t;
		rs->ehcap = cap;
	}
	int j = h & (rs->ehcap-1);
	while(rs->eh[j]){
		if(rs->eh[j] == h) return 1;
		j = (j+1) & (rs->ehcap-1);
	}
	rs->eh[j] = h;
	rs->ehn++;
	return 0;
}

static char *trimdup(const char *s, int n){
	while(n && isspace((unsigned char)*s)){ ++s; --n; }
	while(n && isspace((unsigned char)s[n-1])) --n;
	return xstrndup(s, n);
}

/* Adds one get_result() buffer, grouped by headword like the website.
 * Returns the group, or -1 for a duplicate. */
static int add_result(rset *rs, int di, const char *buf, uint32_t len, int *isnew){
	*isnew = 0;
	if(seen(rs, di, buf, len)) return -1;
	entry e = {0};
	e.d = di;
	char *hdr;
	if(D[di].slab){
		// header \t subheader... \t filetype \n \0 bytes
		const char *z = memchr(buf, 0, len);
		int hl = z ? z - buf : (int)len;
		char *t = trimdup(buf, hl);
		char *parts[64];
		int np = 0;
		for(char *c = t; np < 64; ){
			parts[np++] = c;
			c = strchr(c, '\t');
			if(!c) break;
			*c++ = 0;
		}
		hdr = xstrdup(parts[0]);
		e.slab = 1;
		e.ftype = xstrdup(np > 1 ? parts[np-1] : "");
		sbuf s = {0};
		sb_add(&s, "", 0);
		for(int i = 1; i < np-1; ++i){
			if(i > 1) sb_add(&s, "\t", 1);
			sb_add(&s, parts[i], strlen(parts[i]));
		}
		e.subs = s.v;
		free(t);
		if(z){
			e.binlen = len - hl - 1;
			e.bin = xmalloc(e.binlen ? e.binlen : 1);
			memcpy(e.bin, z+1, e.binlen);
		}
	}else{
		while(len && buf[len-1] == '\n') --len;
		const char *tab = memchr(buf, '\t', len);
		int hl = tab ? tab - buf : (int)len;
		hdr = trimdup(buf, hl);
		e.blen = tab ? (int)(len - hl - 1) : 0;
		e.body = xstrndup(tab ? tab+1 : "", e.blen);
	}
	char *key = normkey(hdr, strlen(hdr));
	int gi = find_group(rs, key, 1, isnew);
	group *g = &rs->g.v[gi];
	if(*isnew){
		g->key = key;
		g->hdr = hdr;
	}else{
		free(key);
		free(hdr);
	}
	// keep each headword's entries in dictionary order
	VPUSH(g->e, e);
	int k = g->e.n - 1;
	while(k > 0 && D[g->e.v[k-1].d].order > D[di].order){
		entry t = g->e.v[k]; g->e.v[k] = g->e.v[k-1]; g->e.v[k-1] = t;
		--k;
	}
	g->dirty = 1;
	rs->dirty = 1;
	rs->nent++;
	return gi;
}

/* get_result(), except for an index with exactly one entry: p_binarysearch()
 * then never sets `guess` and compares through a NULL pointer (harmless in
 * wasm, where address 0 is readable, but a crash here), so it's skipped. */
static int peak_get(int skip){
	if(psa->st != FULL && psa->idxlen == 1 && psa->line == 0) return -1;
	return get_result(skip);
}

static void setq(const char *q){
	size_t n = strlen(q);
	if(n > QMAX-1) n = QMAX-1;
	memcpy(psa->qloc, q, n);
	psa->qloc[n] = 0;
}

/* A side search in one dictionary that leaves its main search where it was
 * (the website's "tempsearch"): peak.c's second search state. */
static void side_search(rset *rs, int di, int st, const char *q, int max, ivec *fresh){
	use(&D[di]);
	switchstate();
	setq(q);
	init_search(st, 0);
	for(int k = 0; k < max; ++k){
		int r = peak_get(rs->popup);
		if(r <= 0) break;
		int isnew;
		int gi = add_result(rs, di, (char*)g_result_loc, r, &isnew);
		if(isnew && fresh) VPUSH(*fresh, gi);
	}
	switchstate();
}

static void broadcast_exact(rset *rs, int st, const char *q, int except, int max, ivec *fresh){
	for(int i = 0; i < NP; ++i)
		if(P[i] != except && usable(P[i])) side_search(rs, P[i], st, q, max, fresh);
}

// A new headword: gather its entries from the other dictionaries.
static void fill_group(rset *rs, int gi, int src){
	char *key = xstrdup(rs->g.v[gi].key);
	broadcast_exact(rs, EXACT1, key, src, FILLMAX, NULL);
	free(key);
}

static void search_start(rset *rs, const char *q){
	rs_free(rs);
	snprintf(rs->q, sizeof rs->q, "%s", q);
	set_terms(rs);
	rs->st = isglob(q) ? FULL : INDEX1;
	for(int i = 0; i < ND; ++i) D[i].insearch = 0;
	for(int i = 0; i < NP; ++i){
		if(!usable(P[i])) continue;
		use(&D[P[i]]);
		setq(q);
		init_search(rs->st, 1);
		D[P[i]].insearch = 1;
	}
}

// The website's search order: index 1, 2, 3, then the full text (globs: full text only).
static int next_st(rset *rs){
	if(rs->st == FULL || rs->st == EXACT2) return 0;
	if(++rs->st > INDEX3) rs->st = FULL;
	return 1;
}

// Takes the next main search result, dictionary by dictionary. Returns its group or -1 when done.
static int fetch_one(rset *rs){
	for(;;){
		if(rs->done) return -1;
		if(rs->cdic >= NP){
			if(!next_st(rs)){ rs->done = 1; return -1; }
			for(int i = 0; i < NP; ++i){
				if(!D[P[i]].insearch || D[P[i]].state != D_READY) continue;
				use(&D[P[i]]);
				continue_search(rs->st);
			}
			rs->cdic = 0;
			continue;
		}
		int di = P[rs->cdic];
		if(D[di].insearch && D[di].state == D_READY){
			use(&D[di]);
			int r = peak_get(0);
			if(r > 0){
				int isnew;
				int gi = add_result(rs, di, (char*)g_result_loc, r, &isnew);
				if(gi < 0) continue;
				if(isnew) fill_group(rs, gi, di);
				return gi;
			}
		}
		rs->cdic++;
	}
}

// The popup lookup: exact headwords, then the second index (website: tempsearch st 1 and 2).
static void popup_search(rset *rs, const char *q){
	rs_free(rs);
	rs->popup = 1;
	snprintf(rs->q, sizeof rs->q, "%s", q);
	set_terms(rs);
	ivec fresh = {0};
	broadcast_exact(rs, EXACT1, q, -1, POPMAX, NULL);
	broadcast_exact(rs, EXACT2, q, -1, POPMAX, &fresh);
	for(int i = 0; i < fresh.n; ++i){
		group *g = &rs->g.v[fresh.v[i]];
		fill_group(rs, fresh.v[i], g->e.v[0].d);
	}
	free(fresh.v);
	rs->done = 1;
}

/* ---------- laying out text into lines of glyphs ---------- */

typedef struct {
	VEC(dline) out;
	VEC(glyph) cur;
	int W, curw, cstart, fresh;
	int bend, bstart;          // where the line can be broken: ends at bend, continues at bstart
	int pend; uintattr_t pendbg; // a collapsed space waiting for the next glyph
	int pendsep;               // a column separator (tab) waiting for the next glyph on this line
	int indent, quote;
	glyph mk[16]; int nmk, mkw; // list marker for the next line
	uintattr_t bar;            // the group's left accent bar
	glyph fl[96]; int nfl, flw; // label floated to the right of the first line
	int blank, limit, dim;
} lb;

static void lb_push(lb *L, uint32_t cp, uintattr_t fg, uintattr_t bg, uint32_t act){
	int w = tb_wcwidth(cp);
	glyph g = {cp, fg, bg, act, w < 0 ? 1 : w};
	VPUSH(L->cur, g);
	L->curw += g.w;
}

static void lb_prefix(lb *L){
	L->cur.n = 0;
	L->curw = 0;
	if(L->bar){
		lb_push(L, 0x258e, L->bar, 0, 0);
		lb_push(L, ' ', 0, 0, 0);
	}
	for(int q = 0; q < L->quote; ++q){
		lb_push(L, 0x2502, TB_DIM, 0, 0);
		lb_push(L, ' ', 0, 0, 0);
	}
	int ind = L->indent;
	if(L->nmk){
		for(int i = L->mkw; i < ind; ++i) lb_push(L, ' ', 0, 0, 0);
		for(int i = 0; i < L->nmk; ++i) VPUSH(L->cur, L->mk[i]);
		L->curw += L->mkw;
		L->nmk = 0;
	}else{
		for(int i = 0; i < ind; ++i) lb_push(L, ' ', 0, 0, 0);
	}
	L->cstart = L->cur.n;
	L->fresh = 0;
	L->bend = -1;
}

static int lb_avail(lb *L){ return L->W - (L->nfl ? L->flw + 1 : 0); }
static int lb_has(lb *L){ return !L->fresh && L->cur.n > L->cstart; }

static void lb_emit(lb *L){
	if(L->fresh) lb_prefix(L);
	while(L->cur.n > L->cstart && L->cur.v[L->cur.n-1].cp == ' ' && !L->cur.v[L->cur.n-1].bg){
		L->cur.n--;
		L->curw--;
	}
	int content = L->cur.n > L->cstart;
	if(L->nfl){
		while(L->curw < L->W - L->flw) lb_push(L, ' ', 0, 0, 0);
		for(int i = 0; i < L->nfl; ++i) VPUSH(L->cur, L->fl[i]);
		L->nfl = 0;
		content = 1;
	}
	if(!L->limit || L->out.n < L->limit){
		dline d = {xmalloc(L->cur.n * sizeof(glyph)), L->cur.n};
		memcpy(d.g, L->cur.v, L->cur.n * sizeof(glyph));
		if(L->dim)
			for(int i = 0; i < d.n; ++i) d.g[i].fg |= TB_DIM;
		VPUSH(L->out, d);
	}
	L->blank = content ? 0 : L->blank + 1;
	L->fresh = 1;
	L->cur.n = L->curw = 0;
	L->pend = L->pendsep = 0;
	L->bend = -1;
}

static void lb_glyph(lb *L, uint32_t cp, uintattr_t fg, uintattr_t bg, uint32_t act){
	if(cp == 0x200b){ // zero width space: a place to break
		if(!L->fresh) L->bend = L->bstart = L->cur.n;
		return;
	}
	if(cp == 0xad) return; // soft hyphen
	if(cp == 0xa0) cp = ' ';
	int w = tb_wcwidth(cp);
	if(w < 0) return;
	if(L->fresh) lb_prefix(L);
	if(w == 0){ // combining: joins the glyph before it
		if(L->cur.n > L->cstart){
			glyph g = {cp, fg, bg, act, 0};
			VPUSH(L->cur, g);
		}
		return;
	}
	if(L->pendsep){
		L->pendsep = 0;
		if(L->cur.n > L->cstart){
			L->pend = 1;
			lb_glyph(L, 0xb7, TB_DIM, 0, 0);
			L->pend = 1;
		}
	}
	if(L->pend){
		L->pend = 0;
		if(L->cur.n > L->cstart){
			if(L->curw + 1 >= lb_avail(L)){
				lb_emit(L);
				lb_prefix(L);
			}else{
				L->bend = L->cur.n;
				L->bstart = L->cur.n + 1;
				lb_push(L, ' ', 0, L->pendbg, 0);
			}
		}
	}
	if(w == 2 && L->cur.n > L->cstart) L->bend = L->bstart = L->cur.n;
	while(L->curw + w > lb_avail(L) && L->cur.n > L->cstart){
		if(L->bend > L->cstart){ // wrap at the last break, carrying the rest over
			int tn = L->cur.n - L->bstart;
			glyph *t = xmalloc((tn ? tn : 1) * sizeof(glyph));
			memcpy(t, L->cur.v + L->bstart, tn * sizeof(glyph));
			L->cur.n = L->bend;
			lb_emit(L);
			lb_prefix(L);
			for(int i = 0; i < tn; ++i){
				VPUSH(L->cur, t[i]);
				L->curw += t[i].w;
			}
			free(t);
		}else{
			lb_emit(L);
			lb_prefix(L);
		}
	}
	glyph g = {cp, fg, bg, act, w};
	VPUSH(L->cur, g);
	L->curw += w;
	if(cp == '-' || cp == '/' || cp == 0x17d4 || cp == 0x17d5 || cp == 0x2013 || cp == 0x2014 || w == 2)
		L->bend = L->bstart = L->cur.n;
}

static void lb_text(lb *L, const char *s, uintattr_t fg, uintattr_t bg, uint32_t act){
	size_t n = strlen(s);
	for(size_t i = 0; i < n; ){
		uint32_t cp;
		i += u8dec((const unsigned char*)s+i, n-i, &cp);
		if(cp == ' ') { if(lb_has(L)) { L->pend = 1; L->pendbg = 0; } }
		else lb_glyph(L, cp, fg, bg, act);
	}
}

static void lb_space(lb *L){ if(lb_has(L)){ L->pend = 1; L->pendbg = 0; } }
static void lb_block(lb *L){ if(lb_has(L)) lb_emit(L); else if(!L->fresh){ L->fresh = 1; L->cur.n = L->curw = 0; } L->pendsep = 0; }
static void lb_br(lb *L){ if(lb_has(L)) lb_emit(L); else if(L->blank < 1) lb_emit(L); }
static void lb_finish(lb *L){ if(lb_has(L) || L->nfl) lb_emit(L); }

static void lb_float(lb *L, const char *s, uintattr_t fg, uint32_t act){
	L->nfl = L->flw = 0;
	size_t n = strlen(s);
	for(size_t i = 0; i < n && L->nfl < 96; ){
		uint32_t cp;
		i += u8dec((const unsigned char*)s+i, n-i, &cp);
		int w = tb_wcwidth(cp);
		if(w < 0) continue;
		glyph g = {cp, fg, 0, act, w};
		L->fl[L->nfl++] = g;
		L->flw += w;
	}
	if(L->flw > L->W/2) L->nfl = L->flw = 0;
}

/* ---------- HTML to styled text ---------- */

typedef struct {
	char name[16];
	uintattr_t fg, bg;
	uint32_t act;
	uint8_t block, quote, indent, list, sup, skip;
	int lnum;
} tst;

typedef struct {
	lb *L;
	tst st[64];
	int sp;
	rset *rs;
} rctx;

static const struct { const char *n; uint32_t c; } ents[] = {
	{"amp",'&'},{"lt",'<'},{"gt",'>'},{"quot",'"'},{"apos",'\''},{"nbsp",0xa0},{"ndash",0x2013},
	{"mdash",0x2014},{"hellip",0x2026},{"laquo",0xab},{"raquo",0xbb},{"lsquo",0x2018},{"rsquo",0x2019},
	{"ldquo",0x201c},{"rdquo",0x201d},{"middot",0xb7},{"bull",0x2022},{"copy",0xa9},{"reg",0xae},
	{"deg",0xb0},{"times",0xd7},{"divide",0xf7},{"para",0xb6},{"sect",0xa7},{"shy",0xad},{"zwj",0x200d},
	{"zwnj",0x200c},{"thinsp",0x2009},{"ensp",0x2002},{"emsp",0x2003},{"prime",0x2032},{"larr",0x2190},
	{"rarr",0x2192},{"uarr",0x2191},{"darr",0x2193},{"harr",0x2194},{"frac12",0xbd},{"frac14",0xbc},
	{"frac34",0xbe},{"sup1",0xb9},{"sup2",0xb2},{"sup3",0xb3},{"aelig",0xe6},{"oelig",0x153},
	{"eacute",0xe9},{"egrave",0xe8},{"agrave",0xe0},{"aacute",0xe1},{"uuml",0xfc},{"ouml",0xf6},
	{"auml",0xe4},{"szlig",0xdf},{"ccedil",0xe7},{"ntilde",0xf1},{"iexcl",0xa1},{"iquest",0xbf},
};

static int entity(const char *s, int n, uint32_t *cp){
	int e = 1;
	while(e < n && e < 12 && s[e] != ';' && (isalnum((unsigned char)s[e]) || s[e] == '#')) ++e;
	if(e >= n || s[e] != ';') return 0;
	if(s[1] == '#'){
		*cp = (s[2] == 'x' || s[2] == 'X') ? strtoul(s+3, NULL, 16) : strtoul(s+2, NULL, 10);
		if(!*cp || *cp > 0x10ffff) *cp = 0xfffd;
		return e+1;
	}
	for(size_t i = 0; i < sizeof ents / sizeof *ents; ++i)
		if((int)strlen(ents[i].n) == e-1 && !strncmp(s+1, ents[i].n, e-1)){ *cp = ents[i].c; return e+1; }
	return 0;
}

static uint32_t supsub(uint32_t c, int sub){
	static const uint32_t sup[] = {0x2070,0xb9,0xb2,0xb3,0x2074,0x2075,0x2076,0x2077,0x2078,0x2079};
	if(c >= '0' && c <= '9') return sub ? 0x2080 + (c-'0') : sup[c-'0'];
	if(c == '+') return sub ? 0x208a : 0x207a;
	if(c == '-') return sub ? 0x208b : 0x207b;
	return c;
}

static uintattr_t setc(uintattr_t fg, uintattr_t c){ return (fg & 0xff000000u) | c; }

static int get_attr(const char *tag, int len, const char *name, char *out, int max){
	int nl = strlen(name);
	for(int i = 1; i + nl < len; ++i){
		if(strncasecmp(tag+i, name, nl) || !isspace((unsigned char)tag[i-1])) continue;
		int j = i + nl;
		while(j < len && isspace((unsigned char)tag[j])) ++j;
		if(j >= len || tag[j] != '=') continue;
		++j;
		while(j < len && isspace((unsigned char)tag[j])) ++j;
		char qc = (tag[j] == '"' || tag[j] == '\'') ? tag[j++] : 0;
		int o = 0;
		while(j < len && o < max-1 && (qc ? tag[j] != qc : (!isspace((unsigned char)tag[j]) && tag[j] != '>')))
			out[o++] = tag[j++];
		out[o] = 0;
		return 1;
	}
	return 0;
}

static void r_recalc(rctx *R){
	int ind = 0, q = 0;
	for(int i = 0; i < R->sp; ++i){ ind += R->st[i].indent; q += R->st[i].quote; }
	R->L->indent = ind;
	R->L->quote = q;
}

static void r_pop_to(rctx *R, const char *name){
	int k = R->sp - 1;
	while(k > 0 && strcmp(R->st[k].name, name)) --k;
	if(k <= 0) return;
	int block = 0;
	for(int m = R->sp - 1; m >= k; --m) block |= R->st[m].block;
	R->sp = k;
	if(block) lb_block(R->L);
	r_recalc(R);
}

static int in_set(const char *n, const char *const *set){
	for(; *set; ++set) if(!strcmp(n, *set)) return 1;
	return 0;
}

static const char *const blocktags[] = {"p","div","ul","ol","li","table","tr","dl","dt","dd","center",
	"section","article","pre","header","footer","nav","aside","figure","figcaption","address","details",
	"summary","h1","h2","h3","h4","h5","h6","blockquote","p-ipa","p-fn","p-q","p-q2", NULL};

static void r_tag(rctx *R, const char *tag, int len, int close){
	lb *L = R->L;
	char name[16];
	int i = 1 + close, o = 0;
	while(i < len && o < 15 && (isalnum((unsigned char)tag[i]) || tag[i] == '-')) name[o++] = tolower((unsigned char)tag[i++]);
	name[o] = 0;
	tst *top = &R->st[R->sp-1];
	if(close){ r_pop_to(R, name); return; }
	if(top->skip && strcmp(name, "script") && strcmp(name, "style")) return;
	int selfclose = len >= 2 && tag[len-2] == '/';

	if(!strcmp(name, "br")){ lb_br(L); return; }
	if(!strcmp(name, "wbr")){ if(!L->fresh) L->bend = L->bstart = L->cur.n; return; }
	if(!strcmp(name, "hr")){
		lb_block(L);
		lb_glyph(L, 0x2500, TB_DIM, 0, 0);
		while(!L->fresh && L->curw < lb_avail(L)) lb_glyph(L, 0x2500, TB_DIM, 0, 0);
		lb_block(L);
		return;
	}
	if(!strcmp(name, "img")){
		char alt[128];
		char t[140];
		if(!get_attr(tag, len, "alt", alt, sizeof alt) || !*alt) strcpy(alt, "image");
		snprintf(t, sizeof t, "[%s]", alt);
		lb_space(L);
		lb_text(L, t, TB_DIM, 0, 0);
		return;
	}
	if(in_set(name, (const char *const[]){"meta","input","link","col","source","area","base","param","track", NULL}))
		return;

	// tags that close an open one of their kind
	if(!strcmp(name, "li")){
		for(int k = R->sp-1; k > 0; --k){
			if(!strcmp(R->st[k].name, "ul") || !strcmp(R->st[k].name, "ol")) break;
			if(!strcmp(R->st[k].name, "li")){ r_pop_to(R, "li"); break; }
		}
	}else if(!strcmp(name, "p") || !strcmp(name, "dt") || !strcmp(name, "dd") || !strcmp(name, "tr")){
		if(!strcmp(R->st[R->sp-1].name, name)) r_pop_to(R, name);
	}
	top = &R->st[R->sp-1];

	tst t = *top;
	memcpy(t.name, name, sizeof name);
	t.block = in_set(name, blocktags);
	t.quote = t.indent = t.list = 0;
	t.lnum = 0;
	uintattr_t c;
	if(!strcmp(name, "b") || !strcmp(name, "strong") || !strcmp(name, "th") || !strcmp(name, "dt")) t.fg |= TB_BOLD;
	else if(!strcmp(name, "i") || !strcmp(name, "em") || !strcmp(name, "cite") || !strcmp(name, "var") || !strcmp(name, "dfn")) t.fg |= TB_ITALIC;
	else if(!strcmp(name, "u") || !strcmp(name, "ins")) t.fg |= TB_UNDERLINE;
	else if(!strcmp(name, "s") || !strcmp(name, "del") || !strcmp(name, "strike") || !strcmp(name, "p-n") || !strcmp(name, "p-fn")) t.fg |= TB_DIM;
	else if(!strcmp(name, "a") || !strcmp(name, "p-a") || !strcmp(name, "p-as")){
		t.fg = setc(t.fg, TB_CYAN) | TB_UNDERLINE;
		t.act = ACT(A_LINK, ++linkctr);
	}
	else if(name[0] == 'h' && name[1] >= '1' && name[1] <= '6' && !name[2]) t.fg = setc(t.fg, TB_GREEN) | TB_BOLD;
	else if(!strcmp(name, "p-l")) t.fg = setc(t.fg, TB_BLUE) | TB_BRIGHT;
	else if(!strcmp(name, "p-ipa")) t.fg = setc(t.fg, TB_MAGENTA);
	else if(!strcmp(name, "p-eg")) t.fg = setc(t.fg, TB_GREEN);
	else if(!strcmp(name, "p-tags")) t.fg |= TB_REVERSE;
	else if(!strcmp(name, "mark")){ t.fg = setc(t.fg, TB_BLACK); t.bg = TB_YELLOW; }
	else if(!strcmp(name, "sup")) t.sup = 1;
	else if(!strcmp(name, "sub")) t.sup = 2;
	else if(!strcmp(name, "script") || !strcmp(name, "style") || !strcmp(name, "head") || !strcmp(name, "title")) t.skip = 1;
	else if(!strcmp(name, "blockquote") || !strcmp(name, "p-q") || !strcmp(name, "p-q2")) t.quote = 1;
	else if(!strcmp(name, "dd")) t.indent = 2;
	else if(!strcmp(name, "ul")) t.list = 1;
	else if(!strcmp(name, "ol")) t.list = 2;
	else if(!strcmp(name, "font")){
		char col[32];
		if(get_attr(tag, len, "color", col, sizeof col)){
			for(char *x = col; *x; ++x) *x = tolower((unsigned char)*x);
			c = strstr(col, "green") ? TB_GREEN : strstr(col, "red") || strstr(col, "brown") || strstr(col, "maroon") ? TB_RED :
				strstr(col, "blue") || strstr(col, "navy") ? TB_BLUE : strstr(col, "purple") || strstr(col, "magenta") ? TB_MAGENTA : 0;
			if(c) t.fg = setc(t.fg, c);
			else if(strstr(col, "gr") || strstr(col, "silver")) t.fg |= TB_DIM;
		}
	}
	if(!strcmp(name, "td") || !strcmp(name, "th")){
		if(lb_has(L)){ lb_space(L); lb_glyph(L, 0x2502, TB_DIM, 0, 0); lb_space(L); }
	}

	if(t.block) lb_block(L);
	if(!strcmp(name, "li")){
		int pk = R->sp - 1;
		while(pk > 0 && !R->st[pk].list) --pk;
		char m[16];
		if(pk > 0 && R->st[pk].list == 2) snprintf(m, sizeof m, "%d.", ++R->st[pk].lnum);
		else strcpy(m, "\xe2\x80\xa2"); // bullet
		L->nmk = L->mkw = 0;
		size_t n = strlen(m);
		for(size_t k = 0; k < n && L->nmk < 15; ){
			uint32_t cp;
			k += u8dec((const unsigned char*)m+k, n-k, &cp);
			glyph g = {cp, TB_GREEN | TB_BOLD, 0, 0, 1};
			L->mk[L->nmk++] = g;
			L->mkw++;
		}
		glyph sp = {' ', 0, 0, 0, 1};
		L->mk[L->nmk++] = sp;
		L->mkw++;
		t.indent = L->mkw;
	}
	if(selfclose || R->sp >= 64){
		if(t.block) lb_block(L);
		return;
	}
	R->st[R->sp++] = t;
	r_recalc(R);
	if(!strcmp(name, "p-m") && opt_chords){
		char ch[32], s[40];
		if(get_attr(tag, len, "chord", ch, sizeof ch) && *ch){
			snprintf(s, sizeof s, "[%s]", ch);
			lb_text(L, s, TB_RED | TB_BOLD, 0, 0);
		}
	}
}

// Emits a run of text, highlighting the search terms like the website's <mark>.
static void r_flush(rctx *R, uint32_t *run, int n){
	if(!n) return;
	tst *t = &R->st[R->sp-1];
	if(t->skip) return;
	uint8_t mark[n];
	memset(mark, 0, n);
	if(opt_mark && R->rs){
		for(int h = 0; h < R->rs->nhl; ++h){
			term *tm = &R->rs->hl[h];
			for(int i = 0; i + tm->n <= n; ++i){
				int k = 0;
				while(k < tm->n && (run[i+k] < 128 ? (uint32_t)tolower(run[i+k]) : run[i+k]) == tm->v[k]) ++k;
				if(k == tm->n){ memset(mark+i, 1, k); i += k-1; }
			}
		}
	}
	lb *L = R->L;
	for(int i = 0; i < n; ++i){
		uint32_t cp = run[i];
		if(cp == ' ' || cp == '\n' || cp == '\r' || cp == '\f'){ lb_space(L); continue; }
		if(cp == '\t'){ // between columns
			if(lb_has(L)) L->pendsep = 1;
			continue;
		}
		if(t->sup) cp = supsub(cp, t->sup == 2);
		if(mark[i]) lb_glyph(L, cp, setc(t->fg, TB_BLACK), TB_YELLOW, t->act);
		else lb_glyph(L, cp, t->fg, t->bg, t->act);
	}
}

static void render_html(lb *L, const char *s, int n, uintattr_t fg, rset *rs){
	rctx R;
	memset(&R.st[0], 0, sizeof R.st[0]);
	R.L = L;
	R.st[0].fg = fg;
	R.sp = 1;
	R.rs = rs;
	r_recalc(&R);
	VEC(uint32_t) run = {0};
	for(int i = 0; i < n; ){
		char c = s[i];
		if(c == '<'){
			if(i + 3 < n && !strncmp(s+i, "<!--", 4)){
				const char *e = memmem(s+i+4, n-i-4, "-->", 3);
				i = e ? e - s + 3 : n;
				continue;
			}
			int j = i + 1, close = 0;
			if(j < n && s[j] == '/'){ close = 1; ++j; }
			if(j < n && isalpha((unsigned char)s[j])){
				const char *gt = memchr(s+j, '>', n-j);
				if(gt){
					r_flush(&R, run.v, run.n);
					run.n = 0;
					r_tag(&R, s+i, gt - (s+i) + 1, close);
					i = gt - s + 1;
					continue;
				}
			}
		}
		uint32_t cp;
		int k = 0;
		if(c == '&') k = entity(s+i, n-i, &cp);
		if(!k) k = u8dec((const unsigned char*)s+i, n-i, &cp);
		VPUSH(run, cp);
		i += k;
	}
	r_flush(&R, run.v, run.n);
	free(run.v);
	L->indent = L->quote = 0;
}

/* ---------- laying out a headword's group ---------- */

static void human_size(size_t n, char *o, int max){
	if(n < 1024) snprintf(o, max, "%zu B", n);
	else if(n < 1024*1024) snprintf(o, max, "%.1f KB", n/1024.0);
	else snprintf(o, max, "%.1f MB", n/1048576.0);
}

static void dict_label(int di, char *o, int max){
	snprintf(o, max, "%s%s", D[di].collapsed ? "+ " : "", D[di].name);
}

static void layout_group(rset *rs, int gi){
	group *g = &rs->g.v[gi];
	for(int l = 0; l < g->nl; ++l) free(g->lines[l].g);
	free(g->lines);
	lb L = {0};
	L.W = rs->width < 20 ? 20 : rs->width;
	L.fresh = 1;
	L.bend = -1;
	L.bar = TB_GREEN;
	char label[128];
	dict_label(g->e.v[0].d, label, sizeof label);
	lb_float(&L, label, TB_DIM, ACT(A_DICT, g->e.v[0].d));
	render_html(&L, g->hdr, strlen(g->hdr), TB_BOLD, rs);
	lb_finish(&L);
	for(int k = 0; k < g->e.n; ++k){
		entry *e = &g->e.v[k];
		dict *d = &D[e->d];
		if(k > 0 && e->d == g->e.v[k-1].d){ // another entry of the same dictionary
			lb_prefix(&L);
			while(L.curw < L.W) lb_push(&L, 0x254c, TB_DIM, 0, 0);
			L.cstart = 0;
			lb_emit(&L);
		}else if(k > 0){ // ─────── dictname ─
			dict_label(e->d, label, sizeof label);
			lb_prefix(&L);
			lb_float(&L, label, TB_DIM, ACT(A_DICT, e->d));
			while(L.curw < L.W - L.flw - 3) lb_push(&L, 0x2500, TB_DIM, 0, 0);
			lb_push(&L, ' ', 0, 0, 0);
			for(int i = 0; i < L.nfl; ++i) VPUSH(L.cur, L.fl[i]);
			L.curw += L.flw;
			L.nfl = 0;
			lb_push(&L, ' ', 0, 0, 0);
			lb_push(&L, 0x2500, TB_DIM, 0, 0);
			L.cstart = 0;
			lb_emit(&L);
		}
		if(d->collapsed){
			L.limit = L.out.n + 1;
			L.dim = 1;
		}
		if(e->slab){
			if(*e->subs){
				render_html(&L, e->subs, strlen(e->subs), TB_DIM, rs);
				lb_block(&L);
			}
			char sz[32], t[128];
			human_size(e->binlen, sz, sizeof sz);
			snprintf(t, sizeof t, "\xe2\x96\xb6 open %s (%s)", *e->ftype ? e->ftype : "file", sz);
			lb_text(&L, t, setc(0, TB_CYAN) | TB_UNDERLINE, 0, ACT(A_OPEN, (gi & 0xffff) << 12 | (k & 0xfff)));
		}else{
			render_html(&L, e->body, e->blen, 0, rs);
		}
		lb_finish(&L);
		L.limit = 0;
		L.dim = 0;
	}
	dline blank = {NULL, 0};
	VPUSH(L.out, blank);
	free(L.cur.v);
	g->lines = L.out.v;
	g->nl = L.out.n;
	g->dirty = 0;
}

static void relayout(rset *rs){
	if(!rs->dirty) return;
	rs->total = 0;
	for(int i = 0; i < rs->g.n; ++i){
		if(rs->g.v[i].dirty) layout_group(rs, i);
		rs->total += rs->g.v[i].nl;
	}
	rs->dirty = 0;
}

static void dirty_all(rset *rs){
	for(int i = 0; i < rs->g.n; ++i) rs->g.v[i].dirty = 1;
	rs->dirty = 1;
}

// Fetches results until there are `lines` lines laid out (or no more).
static void ensure(rset *rs, int lines){
	relayout(rs);
	while(!rs->done && rs->total < lines){
		if(fetch_one(rs) < 0) break;
		relayout(rs);
	}
	relayout(rs);
}

/* ---------- configuration (what's enabled / collapsed) ---------- */

typedef struct { char *page, *path; int v; } cfgent;
static VEC(cfgent) cfg_en;
static VEC(char*) cfg_col;
static char *cfg_page;
static char *cfg_image, *cfg_media, *cfg_open; // viewer commands for .slab images / audio and video / anything else
static char cfgpath[PATH_MAX];
static int persist = 1;

static void cfg_load(void){
	const char *x = getenv("XDG_CONFIG_HOME"), *h = getenv("HOME");
	if(x && *x) snprintf(cfgpath, sizeof cfgpath, "%s/peakslab/peakterm.conf", x);
	else if(h) snprintf(cfgpath, sizeof cfgpath, "%s/.config/peakslab/peakterm.conf", h);
	else return;
	FILE *f = fopen(cfgpath, "r");
	if(!f) return;
	char line[4096];
	while(fgets(line, sizeof line, f)){
		line[strcspn(line, "\n")] = 0;
		char *f1 = strtok(line, "\t");
		if(!f1) continue;
		char *f2 = strtok(NULL, "\t"), *f3 = strtok(NULL, "\t"), *f4 = strtok(NULL, "\t");
		if(!strcmp(f1, "page") && f2) cfg_page = xstrdup(strcmp(f2, "/") ? f2 : "");
		else if(!strcmp(f1, "mark") && f2) opt_mark = atoi(f2);
		else if(!strcmp(f1, "chords") && f2) opt_chords = atoi(f2);
		else if(!strcmp(f1, "collapse") && f2) VPUSH(cfg_col, xstrdup(f2));
		else if(!strcmp(f1, "image") && f2) cfg_image = xstrdup(f2);
		else if(!strcmp(f1, "media") && f2) cfg_media = xstrdup(f2);
		else if(!strcmp(f1, "open") && f2) cfg_open = xstrdup(f2);
		else if(!strcmp(f1, "enable") && f2 && f3 && f4){
			cfgent e = {xstrdup(strcmp(f2, "/") ? f2 : ""), xstrdup(f3), atoi(f4)};
			VPUSH(cfg_en, e);
		}
	}
	fclose(f);
}

static void cfg_save(void){
	if(!*cfgpath) return;
	char dir[PATH_MAX];
	snprintf(dir, sizeof dir, "%s", cfgpath);
	for(char *s = dir + 1; *s; ++s){
		if(*s == '/'){ *s = 0; mkdir(dir, 0755); *s = '/'; }
	}
	char tmp[PATH_MAX + 8];
	snprintf(tmp, sizeof tmp, "%s.tmp", cfgpath);
	FILE *f = fopen(tmp, "w");
	if(!f) return;
	fprintf(f, "# peakterm settings\n");
	if(cfg_page) fprintf(f, "page\t%s\n", *cfg_page ? cfg_page : "/");
	fprintf(f, "mark\t%d\nchords\t%d\n", opt_mark, opt_chords);
	if(cfg_image) fprintf(f, "image\t%s\n", cfg_image);
	if(cfg_media) fprintf(f, "media\t%s\n", cfg_media);
	if(cfg_open) fprintf(f, "open\t%s\n", cfg_open);
	for(int i = 0; i < cfg_col.n; ++i) fprintf(f, "collapse\t%s\n", cfg_col.v[i]);
	for(int i = 0; i < cfg_en.n; ++i)
		fprintf(f, "enable\t%s\t%s\t%d\n", *cfg_en.v[i].page ? cfg_en.v[i].page : "/", cfg_en.v[i].path, cfg_en.v[i].v);
	fclose(f);
	rename(tmp, cfgpath);
}

static int cfg_enabled(const char *page, const char *path, int def){
	for(int i = 0; i < cfg_en.n; ++i)
		if(!strcmp(cfg_en.v[i].page, page) && !strcmp(cfg_en.v[i].path, path)) return cfg_en.v[i].v;
	return def;
}

static void cfg_set_enabled(const char *page, const char *path, int v){
	for(int i = 0; i < cfg_en.n; ++i)
		if(!strcmp(cfg_en.v[i].page, page) && !strcmp(cfg_en.v[i].path, path)){ cfg_en.v[i].v = v; return; }
	cfgent e = {xstrdup(page), xstrdup(path), v};
	VPUSH(cfg_en, e);
}

static void cfg_set_collapsed(const char *path, int v){
	for(int i = 0; i < cfg_col.n; ++i){
		if(!strcmp(cfg_col.v[i], path)){
			if(!v){ free(cfg_col.v[i]); cfg_col.v[i] = cfg_col.v[--cfg_col.n]; }
			return;
		}
	}
	if(v) VPUSH(cfg_col, xstrdup(path));
}

/* ---------- loading the dictionary list ---------- */

static char root[PATH_MAX];
static jv *abbr;
static char *page = "";   // e.g. "khmer" or "khmer/bible"
static char appname[64];

static char *strip_tags(const char *s){
	sbuf b = {0};
	sb_add(&b, "", 0);
	int intag = 0;
	for(; *s; ++s){
		if(*s == '<') intag = 1;
		else if(*s == '>') intag = 0;
		else if(!intag) sb_add(&b, s, 1);
	}
	return b.v;
}

static char *basename_noext(const char *path){
	const char *b = strrchr(path, '/');
	b = b ? b+1 : path;
	char *r = xstrdup(b);
	char *e = strstr(r, ".peak");
	if(!e) e = strstr(r, ".slab");
	if(e) *e = 0;
	return r;
}

static void add_dict(const char *path, const char *full, const char *desc, int prio, int has_prio){
	D = xrealloc(D, (ND+1) * sizeof *D);
	dict *d = &D[ND++];
	memset(d, 0, sizeof *d);
	d->path = xstrdup(path);
	d->full = xstrdup(full);
	d->name = basename_noext(path);
	d->desc = strip_tags(desc);
	d->prio = prio;
	d->has_prio = has_prio;
	d->slab = strstr(path, ".slab") != NULL;
	d->zst = strlen(path) > 4 && !strcmp(path + strlen(path) - 4, ".zst");
	// path: lang/category.../file
	const char *s = strchr(path, '/');
	d->lang = s ? xstrndup(path, s - path) : xstrdup("");
	const char *e = strrchr(path, '/');
	d->cat = (s && e > s) ? xstrndup(s+1, e - s - 1) : xstrdup("");
	for(int i = 0; i < cfg_col.n; ++i)
		if(!strcmp(cfg_col.v[i], path)) d->collapsed = 1;
}

static int load_files_json(void){
	char fn[PATH_MAX + 16];
	snprintf(fn, sizeof fn, "%s/files.json", root);
	FILE *f = fopen(fn, "rb");
	if(!f) return 0;
	sbuf b = {0};
	char tmp[65536];
	size_t r;
	while((r = fread(tmp, 1, sizeof tmp, f)) > 0) sb_add(&b, tmp, r);
	fclose(f);
	if(!b.v) return 0;
	jv *top = xmalloc(sizeof *top);
	jp = b.v;
	if(jparse(top)) die("can't parse files.json");
	abbr = jget(top, "abbr");
	jv *dicts = jget(top, "dicts");
	if(!dicts || dicts->t != '[') die("files.json has no dicts");
	for(int i = 0; i < dicts->n; ++i){
		jv *a = &dicts->a[i];
		if(a->t != '[' || a->n < 1 || a->a[0].t != 's') continue;
		const char *path = a->a[0].s;
		const char *desc = a->n > 2 && a->a[2].t == 's' ? a->a[2].s : "";
		int has_prio = a->n > 4 && a->a[4].t == 'n';
		int prio = has_prio ? (int)a->a[4].num : 1;
		char full[PATH_MAX * 2];
		snprintf(full, sizeof full, "%s/%s", root, path);
		add_dict(path, full, desc, prio, has_prio);
	}
	return 1;
}

static int rank(dict *d){ return !d->has_prio ? 1 : d->prio == -1 ? 0 : d->prio > 0 ? d->prio : 100; }

static int page_cmp(const void *a, const void *b){
	dict *x = &D[*(const int*)a], *y = &D[*(const int*)b];
	int c;
	if((c = y->mc - x->mc)) return c;
	if((c = strcmp(x->cat, y->cat))) return c;
	if(x->primary != y->primary) return x->primary ? -1 : 1;
	if((c = x->rank - y->rank)) return c;
	if((c = strcmp(x->lang, y->lang))) return c;
	return strcmp(x->path, y->path);
}

static void set_appname(void){
	appname[0] = 0;
	char tmp[256];
	snprintf(tmp, sizeof tmp, "%s", page);
	for(char *seg = strtok(tmp, "/"); seg; seg = strtok(NULL, "/")){
		jv *e = jget(abbr, seg);
		const char *s = seg;
		if(e && e->t == '[' && e->n >= 2 && e->a[1].t == 's') s = e->a[1].s;
		else if(e && e->t == '[' && e->n >= 1 && e->a[0].t == 's') s = e->a[0].s;
		strncat(appname, s, sizeof appname - strlen(appname) - 1);
	}
	if(!appname[0]) snprintf(appname, sizeof appname, "peak");
	// drop emoji variation selectors (U+FE0F): terminals disagree on how wide they make a glyph
	for(char *v; (v = strstr(appname, "\xef\xb8\x8f")); ) memmove(v, v + 3, strlen(v + 3) + 1);
}

/* Picks the dictionaries for a page, the way the website does for its URL:
 * every file whose path contains each page segment, plus low priority
 * (<= 0) files of other languages in the same categories. */
static void build_page(const char *pg, int start){
	page = xstrdup(pg);
	set_appname();
	char tmp[256];
	char *segs[16];
	int nseg = 0;
	snprintf(tmp, sizeof tmp, "%s", pg);
	for(char *s = strtok(tmp, "/"); s && nseg < 16; s = strtok(NULL, "/")) segs[nseg++] = s;
	for(int i = 0; i < ND; ++i){
		dict *d = &D[i];
		d->primary = 1;
		for(int k = 0; k < nseg; ++k)
			if(!strstr(d->path, segs[k])) d->primary = 0;
		d->rank = rank(d);
	}
	for(int i = 0; i < ND; ++i){
		dict *d = &D[i];
		d->inpage = d->primary;
		if(!d->primary && d->has_prio && d->prio <= 0)
			for(int k = 0; k < ND && !d->inpage; ++k)
				if(D[k].primary && !strcmp(D[k].cat, d->cat)) d->inpage = 1;
		d->mc = 0;
	}
	for(int i = 0; i < ND; ++i){
		if(!D[i].inpage) continue;
		for(int k = 0; k < ND; ++k)
			if(D[k].inpage && D[k].primary && D[k].rank <= 1 && !strcmp(D[k].cat, D[i].cat)) D[i].mc++;
	}
	free(P);
	P = xmalloc((ND ? ND : 1) * sizeof *P);
	NP = 0;
	for(int i = 0; i < ND; ++i)
		if(D[i].inpage) P[NP++] = i;
	qsort(P, NP, sizeof *P, page_cmp);
	for(int i = 0; i < NP; ++i){
		dict *d = &D[P[i]];
		d->order = i;
		int def = !d->has_prio || d->prio == 1 || d->prio == -1;
		d->enabled = persist ? cfg_enabled(page, d->path, def) : 1;
	}
	if(!start) return;
	for(int i = 0; i < ND; ++i){
		if(D[i].inpage && D[i].enabled) dict_start(i);
		else dict_stop(i);
	}
}

/* ---------- printing (-q) ---------- */

static void print_line(FILE *o, dline *l, int color){
	uintattr_t pf = 0, pb = 0;
	for(int i = 0; i < l->n; ++i){
		glyph *g = &l->g[i];
		if(color && (g->fg != pf || g->bg != pb)){
			fputs("\x1b[0", o);
			if(g->fg & TB_BOLD) fputs(";1", o);
			if(g->fg & TB_DIM) fputs(";2", o);
			if(g->fg & TB_ITALIC) fputs(";3", o);
			if(g->fg & TB_UNDERLINE) fputs(";4", o);
			if(g->fg & TB_REVERSE) fputs(";7", o);
			int c = g->fg & 0xff;
			if(c >= 1 && c <= 8) fprintf(o, ";%d", (g->fg & TB_BRIGHT ? 90 : 30) + c - 1);
			c = g->bg & 0xff;
			if(c >= 1 && c <= 8) fprintf(o, ";%d", 40 + c - 1);
			fputc('m', o);
			pf = g->fg; pb = g->bg;
		}
		char u[4];
		fwrite(u, 1, u8enc(g->cp, u), o);
	}
	if(color && (pf || pb)) fputs("\x1b[0m", o);
	fputc('\n', o);
}

static void wait_loaded(void){
	for(;;){
		poll_loaded();
		int pending = 0;
		for(int i = 0; i < ND; ++i) pending |= is_loading(i);
		if(!pending) return;
		struct pollfd pf = {wakefd[0], POLLIN, 0};
		poll(&pf, 1, -1);
	}
}

/* ---------- opening .slab media ---------- */

static char status[256];
static long long status_until;

static void say(const char *fmt, ...){
	va_list ap;
	va_start(ap, fmt);
	vsnprintf(status, sizeof status, fmt, ap);
	va_end(ap);
	status_until = now_ms() + 4000;
}

static void open_entry(entry *e){
	const char *dir = getenv("XDG_RUNTIME_DIR");
	if(!dir || !*dir) dir = "/tmp";
	char ext[16] = "bin";
	int o = 0;
	for(const char *c = e->ftype; *c && o < 15; ++c)
		if(isalnum((unsigned char)*c)) ext[o++] = tolower((unsigned char)*c);
	if(o) ext[o] = 0;
	static int counter = 0;
	char fn[PATH_MAX];
	snprintf(fn, sizeof fn, "%s/peakterm-%d-%d.%s", dir, (int)getpid(), counter++, ext);
	int fd = open(fn, O_WRONLY | O_CREAT | O_TRUNC, 0600);
	if(fd < 0 || !wr_all(fd, e->bin, e->binlen)){
		if(fd >= 0) close(fd);
		say("can't write %s", fn);
		return;
	}
	close(fd);
	// image / audio and video / anything else: $PEAKTERM_IMAGE etc., then the
	// image / media / open lines of peakterm.conf, then xdg-open
	static const char *const images[] = {"jbig2","webp","png","jpg","jpeg","gif","bmp","svg","tif","tiff","avif","jxl", NULL};
	static const char *const media[] = {"webm","opus","ogg","oga","mp3","m4a","aac","wav","flac","mp4","mkv","mov","c2","codec2", NULL};
	const char *opener = NULL;
	if(in_set(ext, images)){ opener = getenv("PEAKTERM_IMAGE"); if(!opener || !*opener) opener = cfg_image; }
	else if(in_set(ext, media)){ opener = getenv("PEAKTERM_MEDIA"); if(!opener || !*opener) opener = cfg_media; }
	if(!opener || !*opener) opener = getenv("PEAKTERM_OPEN");
	if(!opener || !*opener) opener = cfg_open;
	if(!opener || !*opener) opener = "xdg-open";
	pid_t p = fork();
	if(p == 0){
		setsid();
		if(fork() == 0){
			int nul = open("/dev/null", O_RDWR);
			dup2(nul, 0); dup2(nul, 1); dup2(nul, 2);
			if(!strcmp(ext, "jbig2")) // image viewers don't read JBIG2: convert it (like the website's jbig2.wasm)
				execl("/bin/sh", "sh", "-c", "jbig2dec -t png -o \"$1.png\" \"$1\" && exec $2 \"$1.png\"", "sh", fn, opener, (char*)NULL);
			execlp("/bin/sh", "sh", "-c", "exec $2 \"$1\"", "sh", fn, opener, (char*)NULL);
		}
		_exit(0);
	}
	say("opening %s with %s", fn, opener);
}

/* ---------- the terminal interface ---------- */

enum { M_MAIN, M_DICTS, M_PAGES, M_HELP };
static int mode = M_MAIN;
static rset mainrs;
static rset *pops[MAXPOP];
static int npop;
static VEC(uint32_t) qcp;
static int qcur;
static char curq[QMAX];
static int dsel, dtop;               // dictionary list
static VEC(char*) pages; static int psel, ptop; // page list
static int explicit_files;

static const char *helptext[] = {
	"Type to search every enabled dictionary; results appear as you type.",
	"Globs:  a*b  lines with both a and b    !x  without x    ^a  starting with a",
	"",
	"  Up Down PgUp PgDn, wheel   scroll",
	"  Tab, Shift-Tab             select a link on screen; Enter looks it up",
	"  click a word or link       look it up in a popup (Esc / Backspace go back)",
	"  click a dictionary name    collapse / expand that dictionary",
	"  F2 or Ctrl-S               choose dictionaries",
	"  F3 or Ctrl-G               choose language / section",
	"  Ctrl-T                     highlighting on / off",
	"  Ctrl-O                     show / hide chords",
	"  Ctrl-U  Ctrl-K  Ctrl-W     delete to start / to end / a word",
	"  Esc                        clear the search (on an empty search: quit)",
	"  Ctrl-C or Ctrl-Q           quit",
	NULL
};

static void tprint(int x, int y, int maxx, uintattr_t fg, uintattr_t bg, const char *s){
	size_t n = strlen(s);
	int lastx = -1;
	for(size_t i = 0; i < n && x < maxx; ){
		uint32_t cp;
		i += u8dec((const unsigned char*)s+i, n-i, &cp);
		int w = tb_wcwidth(cp);
		if(w < 0) continue;
		if(w == 0){ if(lastx >= 0) tb_extend_cell(lastx, y, cp); continue; }
		if(x + w > maxx) break;
		tb_set_cell(x, y, cp, fg, bg);
		lastx = x;
		x += w;
	}
}

static int strwidth(const char *s){
	int w = 0;
	size_t n = strlen(s);
	for(size_t i = 0; i < n; ){
		uint32_t cp;
		i += u8dec((const unsigned char*)s+i, n-i, &cp);
		int c = tb_wcwidth(cp);
		if(c > 0) w += c;
	}
	return w;
}

static void fill_row(int y, int x0, int x1, uintattr_t fg, uintattr_t bg){
	for(int x = x0; x < x1; ++x) tb_set_cell(x, y, ' ', fg, bg);
}

static void draw_line(dline *l, int x0, int y, int maxx, uint32_t sel){
	int x = x0, lastx = -1;
	for(int i = 0; i < l->n; ++i){
		glyph *g = &l->g[i];
		if(g->w == 0){ if(lastx >= 0) tb_extend_cell(lastx, y, g->cp); continue; }
		if(x + g->w > maxx) break;
		uintattr_t fg = g->fg;
		if(sel && g->act == sel) fg |= TB_REVERSE;
		tb_set_cell(x, y, g->cp, fg, g->bg);
		lastx = x;
		x += g->w;
	}
}

static void draw_view(rset *rs, int x0, int y0, int w, int h){
	int line = rs->scroll, gi = 0;
	while(gi < rs->g.n && line >= rs->g.v[gi].nl){ line -= rs->g.v[gi].nl; ++gi; }
	rs->nrows = 0;
	for(int y = 0; y < h && y < 1024; ++y){
		rs->rows[y].g = -1;
		rs->nrows = y + 1;
		if(gi >= rs->g.n) continue;
		draw_line(&rs->g.v[gi].lines[line], x0, y0 + y, x0 + w, rs->sel);
		rs->rows[y].g = gi;
		rs->rows[y].l = line;
		if(++line >= rs->g.v[gi].nl){ ++gi; line = 0; }
	}
}

static int view_h(void){ return tb_height() - 2; }

static void popup_box(int *x0, int *y0, int *w, int *h){
	int W = tb_width(), H = tb_height();
	*x0 = W > 40 ? 3 : 0;
	*y0 = H > 12 ? 2 : 1;
	*w = W - 2 * *x0;
	*h = H - *y0 - (H > 12 ? 2 : 1);
}

static int counts(int *loading){
	int ready = 0;
	*loading = 0;
	for(int i = 0; i < NP; ++i){
		dict *d = &D[P[i]];
		if(!d->enabled) continue;
		if(d->state == D_READY) ++ready;
		else if(is_loading(P[i])) ++*loading;
	}
	return ready;
}

static void draw_status(const char *left){
	int W = tb_width(), y = tb_height() - 1;
	fill_row(y, 0, W, 0, 0);
	int loading, enabled = 0;
	for(int i = 0; i < NP; ++i) enabled += D[P[i]].enabled;
	int ready = counts(&loading);
	char right[128];
	if(loading) snprintf(right, sizeof right, " loading %d/%d ", ready, enabled);
	else snprintf(right, sizeof right, " %d/%d dictionaries ", ready, enabled);
	const char *l = (status[0] && now_ms() < status_until) ? status : left;
	tprint(0, y, W - strwidth(right), TB_DIM, 0, l);
	tprint(W - strwidth(right), y, W, TB_DIM, 0, right);
}

static void draw_input(void){
	int W = tb_width();
	fill_row(0, 0, W, 0, 0);
	char pr[96];
	snprintf(pr, sizeof pr, " %s \xe2\x9d\xaf ", appname);
	tprint(0, 0, W, TB_GREEN | TB_BOLD, 0, pr);
	int x = strwidth(pr), cx = x, lastx = -1;
	// keep the cursor on screen for long queries
	int startc = 0, wsum = 0;
	for(int i = qcur - 1; i >= 0; --i){
		int cw = tb_wcwidth(qcp.v[i]);
		wsum += cw > 0 ? cw : 0;
		if(x + wsum >= W - 2){ startc = i + 1; break; }
	}
	for(int i = startc; i < qcp.n; ++i){
		int cw = tb_wcwidth(qcp.v[i]);
		if(i == qcur) cx = x;
		if(cw < 0) continue;
		if(cw == 0){ if(lastx >= 0) tb_extend_cell(lastx, 0, qcp.v[i]); continue; }
		if(x + cw > W) break;
		tb_set_cell(x, 0, qcp.v[i], TB_BOLD, 0);
		lastx = x;
		x += cw;
	}
	if(qcur >= qcp.n) cx = x;
	if(mainrs.q[0] && !npop){
		char info[64];
		if(mainrs.nent) snprintf(info, sizeof info, "%d%s ", mainrs.nent, mainrs.done ? "" : "+");
		else snprintf(info, sizeof info, "%s ", mainrs.done ? "no matches" : "");
		int iw = strwidth(info);
		if(x + iw + 2 < W) tprint(W - iw, 0, W, mainrs.nent ? TB_DIM : TB_RED, 0, info);
	}
	tb_set_cursor(cx < W ? cx : W-1, 0);
}

static void draw_help(int y0, int h){
	int W = tb_width(), y = y0;
	char t[512];
	snprintf(t, sizeof t, " PeakSlab %s%s%s", appname, *page ? "  \xc2\xb7  " : "", page);
	if(y < y0 + h) tprint(1, y++, W, TB_GREEN | TB_BOLD, 0, t);
	++y;
	for(int i = 0; helptext[i] && y < y0 + h; ++i) tprint(1, y++, W, 0, 0, helptext[i]);
	++y;
	int loading;
	int ready = counts(&loading);
	int failed = 0;
	for(int i = 0; i < NP; ++i) failed += D[P[i]].enabled && D[P[i]].state == D_FAILED;
	snprintf(t, sizeof t, " %d dictionaries ready%s%s, %d more available with F2.", ready,
		loading ? ", still loading " : "", loading ? (snprintf(t+400, 100, "%d", loading), t+400) : "", NP - ready - loading - failed);
	if(y < y0 + h) tprint(1, y++, W, TB_DIM, 0, t);
	if(failed && y < y0 + h){
		snprintf(t, sizeof t, " %d failed to load (see F2).", failed);
		tprint(1, y++, W, TB_RED, 0, t);
	}
}

static const char *state_str(dict *d, char *buf, int max){
	if(d->state == D_READY) snprintf(buf, max, "%dms", d->ms);
	else if(dstate(d) == D_LOADING || dstate(d) == D_DECODED) snprintf(buf, max, "loading");
	else if(d->state == D_FAILED) snprintf(buf, max, "%s", d->err);
	else buf[0] = 0;
	return buf;
}

static void draw_dicts(void){
	int W = tb_width(), H = tb_height();
	int y0 = 1, h = H - 2 - 4;
	if(h < 1) h = H - 2;
	char t[256], s[96];
	fill_row(y0 - 1, 0, W, 0, 0);
	snprintf(t, sizeof t, " Dictionaries for %s%s", appname, explicit_files ? "" : (*page ? "" : " (all)"));
	tprint(0, 0, W, TB_GREEN | TB_BOLD, 0, t);
	if(dsel < dtop) dtop = dsel;
	if(dsel >= dtop + h) dtop = dsel - h + 1;
	int namew = 8;
	for(int i = 0; i < NP; ++i){ int w = strwidth(D[P[i]].name); if(w > namew) namew = w; }
	if(namew > 24) namew = 24;
	for(int r = 0; r < h && dtop + r < NP; ++r){
		int i = dtop + r;
		dict *d = &D[P[i]];
		uintattr_t bg = i == dsel ? TB_REVERSE : 0;
		int y = y0 + r;
		fill_row(y, 0, W, bg, 0);
		snprintf(t, sizeof t, " [%s] ", d->enabled ? "x" : " ");
		tprint(0, y, W, (d->enabled ? TB_GREEN | TB_BOLD : 0) | bg, 0, t);
		int x = strwidth(t);
		tprint(x, y, x + namew, (d->primary ? TB_BOLD : 0) | bg, 0, d->name);
		x += namew + 1;
		snprintf(t, sizeof t, "%s%-9s", d->collapsed ? "\xe2\x8a\x9f " : "  ", state_str(d, s, sizeof s));
		tprint(x, y, W, (d->state == D_FAILED ? TB_RED : TB_DIM) | bg, 0, t);
		x += strwidth(t) + 1;
		tprint(x, y, W, TB_DIM | bg, 0, d->desc);
	}
	if(NP && h < H - 2){
		dict *d = &D[P[dsel]];
		lb L = {0};
		L.W = W - 2; L.fresh = 1; L.bend = -1;
		snprintf(t, sizeof t, "%s  (%s, priority %d) ", d->path, d->lang, d->has_prio ? d->prio : 1);
		lb_text(&L, t, TB_DIM, 0, 0);
		lb_text(&L, d->desc, 0, 0, 0);
		lb_finish(&L);
		for(int l = 0; l < L.out.n && l < 3; ++l) draw_line(&L.out.v[l], 1, H - 5 + l, W, 0);
		for(int l = 0; l < L.out.n; ++l) free(L.out.v[l].g);
		free(L.out.v); free(L.cur.v);
	}
	tb_hide_cursor();
	draw_status(" Space toggle  c collapse  a all  n none  d defaults  Esc back");
}

static int page_count(const char *p){
	int n = 0, l = strlen(p);
	for(int i = 0; i < ND; ++i)
		if(!l || (!strncmp(D[i].path, p, l) && D[i].path[l] == '/')) ++n;
	return n;
}

static void draw_pages(void){
	int W = tb_width(), H = tb_height(), h = H - 2;
	fill_row(0, 0, W, 0, 0);
	tprint(0, 0, W, TB_GREEN | TB_BOLD, 0, " Choose a language or section");
	if(psel < ptop) ptop = psel;
	if(psel >= ptop + h) ptop = psel - h + 1;
	for(int r = 0; r < h && ptop + r < pages.n; ++r){
		int i = ptop + r, y = 1 + r;
		const char *p = pages.v[i];
		uintattr_t a = i == psel ? TB_REVERSE : 0;
		fill_row(y, 0, W, a, 0);
		int depth = 0;
		for(const char *c = p; *c; ++c) depth += *c == '/';
		char t[300];
		const char *leaf = strrchr(p, '/');
		leaf = leaf ? leaf + 1 : p;
		jv *e = jget(abbr, leaf);
		const char *sym = e && e->t == '[' && e->n >= 2 && e->a[1].t == 's' ? e->a[1].s : "";
		snprintf(t, sizeof t, " %*s%s %s", depth * 2, "", *p ? leaf : "everything", sym);
		tprint(0, y, W, (depth ? 0 : TB_BOLD) | (!strcmp(p, page) ? TB_GREEN : 0) | a, 0, t);
		snprintf(t, sizeof t, "%d ", page_count(p));
		tprint(W - strwidth(t), y, W, TB_DIM | a, 0, t);
	}
	tb_hide_cursor();
	draw_status(" Enter choose  Esc back");
}

static void draw(void){
	tb_clear();
	int W = tb_width(), H = tb_height();
	if(mode == M_DICTS){ draw_dicts(); tb_present(); return; }
	if(mode == M_PAGES){ draw_pages(); tb_present(); return; }
	draw_input();
	if(mode == M_HELP || !mainrs.q[0]) draw_help(2, H - 3);
	else{
		mainrs.width = W - 1;
		draw_view(&mainrs, 0, 1, W, view_h());
	}
	if(npop && mode == M_MAIN){
		rset *p = pops[npop-1];
		int x0, y0, w, h;
		popup_box(&x0, &y0, &w, &h);
		for(int y = y0; y < y0 + h; ++y) fill_row(y, x0, x0 + w, 0, 0);
		for(int x = x0; x < x0 + w; ++x){ tb_set_cell(x, y0, 0x2500, TB_GREEN, 0); tb_set_cell(x, y0 + h - 1, 0x2500, TB_GREEN, 0); }
		for(int y = y0; y < y0 + h; ++y){ tb_set_cell(x0, y, 0x2502, TB_GREEN, 0); tb_set_cell(x0 + w - 1, y, 0x2502, TB_GREEN, 0); }
		tb_set_cell(x0, y0, 0x256d, TB_GREEN, 0); tb_set_cell(x0 + w - 1, y0, 0x256e, TB_GREEN, 0);
		tb_set_cell(x0, y0 + h - 1, 0x2570, TB_GREEN, 0); tb_set_cell(x0 + w - 1, y0 + h - 1, 0x256f, TB_GREEN, 0);
		char t[QMAX + 64];
		snprintf(t, sizeof t, " %s%s \xc2\xb7 %d ", npop > 1 ? "\xe2\x80\xa6 " : "", p->q, p->nent);
		tprint(x0 + 2, y0, x0 + w - 2, TB_BOLD, 0, t);
		draw_view(p, x0 + 1, y0 + 1, w - 2, h - 2);
		draw_status(" Esc close  Backspace back  Tab links  click a word to look it up");
	}else if(mode == M_HELP){
		draw_status(" any key to go back");
	}else{
		draw_status(mainrs.q[0] ? " F1 help  F2 dictionaries  F3 language  Tab links  Ctrl-C quit" : " F2 dictionaries  F3 language  Ctrl-C quit");
	}
	tb_present();
}

static rset *active(void){ return npop ? pops[npop-1] : &mainrs; }

static int active_h(void){
	if(npop){ int x0, y0, w, h; popup_box(&x0, &y0, &w, &h); return h - 2; }
	return view_h();
}

static void clamp_scroll(rset *rs, int h){
	ensure(rs, rs->scroll + 2*h);
	int max = rs->total - h;
	if(rs->done && rs->scroll > max) rs->scroll = max;
	if(rs->scroll < 0) rs->scroll = 0;
}

static void scroll_by(int n){
	rset *rs = active();
	rs->scroll += n;
	clamp_scroll(rs, active_h());
}

static void qstr(char *out, int max){
	int o = 0;
	for(int i = 0; i < qcp.n && o + 4 < max; ++i) o += u8enc(qcp.v[i], out + o);
	out[o] = 0;
}

static void query_changed(int keep_scroll){
	char raw[QMAX], q[QMAX];
	qstr(raw, sizeof raw);
	normq(raw, q, sizeof q);
	if(!keep_scroll && !strcmp(q, curq)) return;
	snprintf(curq, sizeof curq, "%s", q);
	int scroll = keep_scroll ? mainrs.scroll : 0;
	if(!q[0]){ rs_free(&mainrs); return; }
	mainrs.width = tb_width() - 1;
	search_start(&mainrs, q);
	mainrs.scroll = scroll;
	clamp_scroll(&mainrs, view_h());
}

static void close_popups(void){
	while(npop){ rs_free(pops[--npop]); free(pops[npop]); }
}

static void lookup(const char *word){
	char q[QMAX];
	normq(word, q, sizeof q);
	if(!q[0]) return;
	rset *p = calloc(1, sizeof *p);
	if(!p) die("out of memory");
	int x0, y0, w, h;
	popup_box(&x0, &y0, &w, &h);
	p->width = w - 3;
	popup_search(p, q);
	if(!p->nent){
		say("nothing found for \"%s\"", word);
		rs_free(p);
		free(p);
		return;
	}
	if(npop == MAXPOP){ rs_free(pops[0]); free(pops[0]); memmove(pops, pops + 1, sizeof(*pops) * (MAXPOP - 1)); --npop; }
	pops[npop++] = p;
	relayout(p);
}

static void dirty_everything(void){
	dirty_all(&mainrs);
	for(int i = 0; i < npop; ++i) dirty_all(pops[i]);
}

// The text of a link: every glyph carrying its action (a link can wrap over lines).
static void act_text(rset *rs, uint32_t act, char *out, int max){
	int o = 0;
	for(int gi = 0; gi < rs->g.n; ++gi){
		group *g = &rs->g.v[gi];
		for(int l = 0; l < g->nl; ++l){
			int prev = 0;
			for(int i = 0; i < g->lines[l].n; ++i){
				glyph *c = &g->lines[l].g[i];
				if(c->act != act){ prev = 0; continue; }
				if(!prev && o && o + 1 < max) out[o++] = ' ';
				if(o + 5 < max) o += u8enc(c->cp, out + o);
				prev = 1;
			}
		}
	}
	out[o] = 0;
}

static int wordch(uint32_t c){
	if(c <= ' ' || c == 0xa0) return 0;
	if(c < 128) return !strchr(".,;:!?()[]{}\"'<>/\\|=*+#~`", c);
	static const uint32_t no[] = {0x17d4,0x17d5,0x17d6,0xab,0xbb,0x201c,0x201d,0x2018,0x2019,0x2026,0x2014,
		0x2013,0xb7,0x2502,0x2500,0x258e,0x3001,0x3002,0xff0c,0x060c,0x061b,0x061f,0x2022,0x25b6};
	for(size_t i = 0; i < sizeof no / sizeof *no; ++i) if(c == no[i]) return 0;
	return 1;
}

static void activate(rset *rs, uint32_t act){
	char t[QMAX];
	switch(AKIND(act)){
		case A_LINK:
			act_text(rs, act, t, sizeof t);
			lookup(t);
			break;
		case A_DICT: {
			dict *d = &D[AVAL(act)];
			d->collapsed = !d->collapsed;
			cfg_set_collapsed(d->path, d->collapsed);
			cfg_save();
			dirty_everything();
			break;
		}
		case A_OPEN: {
			int gi = AVAL(act) >> 12, k = AVAL(act) & 0xfff;
			if(gi < rs->g.n && k < rs->g.v[gi].e.n) open_entry(&rs->g.v[gi].e.v[k]);
			break;
		}
	}
}

// Click at (x, y) inside a view drawn at (x0, y0).
static void click_view(rset *rs, int x0, int y0, int x, int y){
	int r = y - y0;
	if(r < 0 || r >= rs->nrows || rs->rows[r].g < 0) return;
	dline *l = &rs->g.v[rs->rows[r].g].lines[rs->rows[r].l];
	int cx = x0, hit = -1;
	for(int i = 0; i < l->n; ++i){
		if(!l->g[i].w) continue;
		if(x >= cx && x < cx + l->g[i].w){ hit = i; break; }
		cx += l->g[i].w;
	}
	if(hit < 0) return;
	if(l->g[hit].act){ activate(rs, l->g[hit].act); return; }
	if(!wordch(l->g[hit].cp)) return;
	int a = hit, b = hit;
	while(a > 0 && (wordch(l->g[a-1].cp) || !l->g[a].w)) --a;
	while(b + 1 < l->n && (wordch(l->g[b+1].cp) || !l->g[b+1].w)) ++b;
	char t[QMAX];
	int o = 0;
	for(int i = a; i <= b && o + 5 < (int)sizeof t; ++i) o += u8enc(l->g[i].cp, t + o);
	t[o] = 0;
	lookup(t);
}

// Tab / Shift-Tab: select the next / previous link or media on screen.
static void cycle_links(int dir){
	rset *rs = active();
	uint32_t acts[512];
	int n = 0;
	for(int r = 0; r < rs->nrows; ++r){
		if(rs->rows[r].g < 0) continue;
		dline *l = &rs->g.v[rs->rows[r].g].lines[rs->rows[r].l];
		for(int i = 0; i < l->n && n < 512; ++i){
			uint32_t a = l->g[i].act;
			if((AKIND(a) == A_LINK || AKIND(a) == A_OPEN) && (!n || acts[n-1] != a)){
				int dup = 0;
				for(int k = 0; k < n; ++k) if(acts[k] == a) dup = 1;
				if(!dup) acts[n++] = a;
			}
		}
	}
	if(!n){ rs->sel = 0; say("no links on screen"); return; }
	int cur = -1;
	for(int k = 0; k < n; ++k) if(acts[k] == rs->sel) cur = k;
	if(cur < 0) cur = dir > 0 ? 0 : n - 1;
	else cur = (cur + dir + n) % n;
	rs->sel = acts[cur];
}

static void build_pages(void){
	pages.n = 0;
	VPUSH(pages, xstrdup(""));
	for(int i = 0; i < ND; ++i){
		const char *p = D[i].path;
		for(const char *s = strchr(p, '/'); s; s = strchr(s + 1, '/')){
			char *pre = xstrndup(p, s - p);
			int have = 0;
			for(int k = 0; k < pages.n; ++k) if(!strcmp(pages.v[k], pre)) have = 1;
			if(have) free(pre);
			else VPUSH(pages, pre);
		}
	}
	for(int i = 1; i < pages.n; ++i)
		for(int k = i; k > 0 && strcmp(pages.v[k-1], pages.v[k]) > 0; --k){
			char *t = pages.v[k]; pages.v[k] = pages.v[k-1]; pages.v[k-1] = t;
		}
}

static void set_enabled(int di, int v){
	dict *d = &D[di];
	if(d->enabled == v) return;
	d->enabled = v;
	if(persist){ cfg_set_enabled(page, d->path, v); }
	if(v){ if(d->state == D_FAILED) d->state = D_OFF; dict_start(di); }
	else dict_stop(di);
}

static int need_research;

static void key_dicts(struct tb_event *ev){
	int h = tb_height() - 6;
	if(h < 1) h = 1;
	switch(ev->key){
		case TB_KEY_ARROW_UP: if(dsel > 0) --dsel; return;
		case TB_KEY_ARROW_DOWN: if(dsel + 1 < NP) ++dsel; return;
		case TB_KEY_PGUP: dsel -= h; if(dsel < 0) dsel = 0; return;
		case TB_KEY_PGDN: dsel += h; if(dsel >= NP) dsel = NP - 1; if(dsel < 0) dsel = 0; return;
		case TB_KEY_HOME: dsel = 0; return;
		case TB_KEY_END: dsel = NP ? NP - 1 : 0; return;
		case TB_KEY_ESC: case TB_KEY_F2: case TB_KEY_CTRL_S: case TB_KEY_TAB:
			mode = M_MAIN;
			cfg_save();
			need_research = 1;
			return;
		case TB_KEY_ENTER: case TB_KEY_SPACE:
			if(NP){ set_enabled(P[dsel], !D[P[dsel]].enabled); need_research = 1; }
			return;
	}
	if(!NP) return;
	dict *d = &D[P[dsel]];
	switch(ev->ch){
		case ' ': set_enabled(P[dsel], !d->enabled); need_research = 1; break;
		case 'k': if(dsel > 0) --dsel; break;
		case 'j': if(dsel + 1 < NP) ++dsel; break;
		case 'c':
			d->collapsed = !d->collapsed;
			cfg_set_collapsed(d->path, d->collapsed);
			dirty_everything();
			break;
		case 'a': for(int i = 0; i < NP; ++i) set_enabled(P[i], 1); need_research = 1; break;
		case 'n': for(int i = 0; i < NP; ++i) set_enabled(P[i], 0); need_research = 1; break;
		case 'd':
			for(int i = 0; i < NP; ++i){
				dict *x = &D[P[i]];
				set_enabled(P[i], !x->has_prio || x->prio == 1 || x->prio == -1);
			}
			need_research = 1;
			break;
		case 'q': mode = M_MAIN; cfg_save(); need_research = 1; break;
	}
}

static void choose_page(const char *p){
	close_popups();
	rs_free(&mainrs);
	curq[0] = 0;
	build_page(p, 1);
	free(cfg_page);
	cfg_page = xstrdup(p);
	cfg_save();
	dsel = dtop = 0;
	need_research = 1;
}

static void key_pages(struct tb_event *ev){
	int h = tb_height() - 2;
	switch(ev->key){
		case TB_KEY_ARROW_UP: if(psel > 0) --psel; return;
		case TB_KEY_ARROW_DOWN: if(psel + 1 < pages.n) ++psel; return;
		case TB_KEY_PGUP: psel -= h; if(psel < 0) psel = 0; return;
		case TB_KEY_PGDN: psel += h; if(psel >= pages.n) psel = pages.n - 1; return;
		case TB_KEY_HOME: psel = 0; return;
		case TB_KEY_END: psel = pages.n - 1; return;
		case TB_KEY_ESC: case TB_KEY_F3: case TB_KEY_CTRL_G: mode = M_MAIN; return;
		case TB_KEY_ENTER: choose_page(pages.v[psel]); mode = M_MAIN; return;
	}
	if(ev->ch == 'k' && psel > 0) --psel;
	if(ev->ch == 'j' && psel + 1 < pages.n) ++psel;
	if(ev->ch == 'q') mode = M_MAIN;
}

static void open_pages(void){
	if(explicit_files){ say("no files.json: the dictionaries were given on the command line"); return; }
	build_pages();
	psel = 0;
	for(int i = 0; i < pages.n; ++i) if(!strcmp(pages.v[i], page)) psel = i;
	mode = M_PAGES;
}

static void q_insert(uint32_t c){
	if(qcp.n >= QMAX/4) return;
	VPUSH(qcp, 0);
	memmove(qcp.v + qcur + 1, qcp.v + qcur, (qcp.n - qcur - 1) * sizeof *qcp.v);
	qcp.v[qcur++] = c;
}

static void q_delete(int from, int to){
	if(from < 0) from = 0;
	if(to > qcp.n) to = qcp.n;
	if(from >= to) return;
	memmove(qcp.v + from, qcp.v + to, (qcp.n - to) * sizeof *qcp.v);
	qcp.n -= to - from;
	if(qcur > to) qcur -= to - from;
	else if(qcur > from) qcur = from;
}

static int quit;

static void key_main(struct tb_event *ev){
	rset *rs = active();
	int h = active_h();
	switch(ev->key){
		case TB_KEY_CTRL_C: case TB_KEY_CTRL_Q: quit = 1; return;
		case TB_KEY_ARROW_UP: case TB_KEY_CTRL_P: scroll_by(-1); return;
		case TB_KEY_ARROW_DOWN: case TB_KEY_CTRL_N: scroll_by(1); return;
		case TB_KEY_PGUP: scroll_by(-(h - 1)); return;
		case TB_KEY_PGDN: scroll_by(h - 1); return;
		case TB_KEY_TAB: cycle_links(1); return;
		case TB_KEY_BACK_TAB: cycle_links(-1); return;
		case TB_KEY_ENTER:
			if(rs->sel) activate(rs, rs->sel);
			return;
		case TB_KEY_F1: mode = M_HELP; return;
		case TB_KEY_F2: case TB_KEY_CTRL_S: close_popups(); mode = M_DICTS; return;
		case TB_KEY_F3: case TB_KEY_CTRL_G: close_popups(); open_pages(); return;
		case TB_KEY_CTRL_T:
			opt_mark = !opt_mark;
			say("highlighting %s", opt_mark ? "on" : "off");
			cfg_save();
			dirty_everything();
			return;
		case TB_KEY_CTRL_O:
			opt_chords = !opt_chords;
			say("chords %s", opt_chords ? "shown" : "hidden");
			cfg_save();
			dirty_everything();
			return;
		case TB_KEY_CTRL_L: tb_invalidate(); return;
		case TB_KEY_ESC:
			if(npop){ rs_free(pops[--npop]); free(pops[npop]); return; }
			if(rs->sel){ rs->sel = 0; return; }
			if(qcp.n){ qcp.n = qcur = 0; return; }
			quit = 1;
			return;
		case TB_KEY_BACKSPACE: case TB_KEY_BACKSPACE2:
			if(npop){ rs_free(pops[--npop]); free(pops[npop]); return; }
			q_delete(qcur - 1, qcur);
			return;
	}
	if(npop && (ev->ch || ev->key == TB_KEY_SPACE)) close_popups(); // typing goes back to the search
	switch(ev->key){
		case TB_KEY_DELETE: case TB_KEY_CTRL_D: q_delete(qcur, qcur + 1); return;
		case TB_KEY_ARROW_LEFT: case TB_KEY_CTRL_B: if(qcur > 0) --qcur; return;
		case TB_KEY_ARROW_RIGHT: case TB_KEY_CTRL_F: if(qcur < qcp.n) ++qcur; return;
		case TB_KEY_HOME: case TB_KEY_CTRL_A: qcur = 0; return;
		case TB_KEY_END: case TB_KEY_CTRL_E: qcur = qcp.n; return;
		case TB_KEY_CTRL_U: q_delete(0, qcur); return;
		case TB_KEY_CTRL_K: q_delete(qcur, qcp.n); return;
		case TB_KEY_CTRL_W: {
			int a = qcur;
			while(a > 0 && qcp.v[a-1] == ' ') --a;
			while(a > 0 && qcp.v[a-1] != ' ') --a;
			q_delete(a, qcur);
			return;
		}
		case TB_KEY_SPACE: q_insert(' '); return;
	}
	if(ev->ch && !(ev->mod & TB_MOD_ALT)) q_insert(ev->ch);
}

static void mouse(struct tb_event *ev){
	if(mode == M_DICTS){
		int r = ev->y - 1 + dtop;
		if(ev->key == TB_KEY_MOUSE_WHEEL_UP){ if(dsel > 0) --dsel; }
		else if(ev->key == TB_KEY_MOUSE_WHEEL_DOWN){ if(dsel + 1 < NP) ++dsel; }
		else if(ev->key == TB_KEY_MOUSE_LEFT && ev->y >= 1 && r < NP && ev->y < tb_height() - 5){
			dsel = r;
			if(ev->x < 5){ set_enabled(P[dsel], !D[P[dsel]].enabled); need_research = 1; }
		}
		return;
	}
	if(mode == M_PAGES){
		int r = ev->y - 1 + ptop;
		if(ev->key == TB_KEY_MOUSE_WHEEL_UP){ if(psel > 0) --psel; }
		else if(ev->key == TB_KEY_MOUSE_WHEEL_DOWN){ if(psel + 1 < pages.n) ++psel; }
		else if(ev->key == TB_KEY_MOUSE_LEFT && ev->y >= 1 && r < pages.n){
			if(psel == r){ choose_page(pages.v[r]); mode = M_MAIN; }
			else psel = r;
		}
		return;
	}
	if(mode == M_HELP){ mode = M_MAIN; return; }
	if(ev->key == TB_KEY_MOUSE_WHEEL_UP){ scroll_by(-3); return; }
	if(ev->key == TB_KEY_MOUSE_WHEEL_DOWN){ scroll_by(3); return; }
	if(ev->key != TB_KEY_MOUSE_LEFT || (ev->mod & TB_MOD_MOTION)) return;
	if(npop){
		int x0, y0, w, h;
		popup_box(&x0, &y0, &w, &h);
		if(ev->x < x0 || ev->x >= x0 + w || ev->y < y0 || ev->y >= y0 + h){ close_popups(); return; }
		click_view(pops[npop-1], x0 + 1, y0 + 1, ev->x, ev->y);
		return;
	}
	if(ev->y >= 1 && ev->y < 1 + view_h() && mainrs.q[0]) click_view(&mainrs, 0, 1, ev->x, ev->y);
}

static void handle(struct tb_event *ev){
	if(ev->type == TB_EVENT_RESIZE){
		mainrs.width = tb_width() - 1;
		dirty_all(&mainrs);
		int x0, y0, w, h;
		popup_box(&x0, &y0, &w, &h);
		for(int i = 0; i < npop; ++i){ pops[i]->width = w - 3; dirty_all(pops[i]); }
		return;
	}
	if(ev->type == TB_EVENT_MOUSE){ mouse(ev); return; }
	if(ev->type != TB_EVENT_KEY) return;
	if(ev->key == TB_KEY_CTRL_C || ev->key == TB_KEY_CTRL_Q){ quit = 1; return; }
	if(mode == M_DICTS) key_dicts(ev);
	else if(mode == M_PAGES) key_pages(ev);
	else if(mode == M_HELP) mode = M_MAIN;
	else key_main(ev);
}

static int tui(void){
	if(tb_init()){ fprintf(stderr, "peakterm: can't open the terminal\n"); return 1; }
	tb_set_input_mode(TB_INPUT_ESC | TB_INPUT_MOUSE);
	int ttyfd = -1, rszfd = -1;
	tb_get_fds(&ttyfd, &rszfd);
	mainrs.width = tb_width() - 1;
	while(!quit){
		if(need_research){
			need_research = 0;
			query_changed(1);
		}else{
			query_changed(0);
		}
		if(mainrs.q[0]) clamp_scroll(&mainrs, view_h());
		for(int i = 0; i < npop; ++i) relayout(pops[i]);
		draw();
		struct pollfd pf[3];
		int n = 0;
		pf[n].fd = ttyfd; pf[n++].events = POLLIN;
		if(rszfd >= 0){ pf[n].fd = rszfd; pf[n++].events = POLLIN; }
		if(wakefd[0] >= 0){ pf[n].fd = wakefd[0]; pf[n++].events = POLLIN; }
		int timeout = status[0] && now_ms() < status_until ? (int)(status_until - now_ms()) + 10 : -1;
		if(poll(pf, n, timeout) < 0 && errno != EINTR) break;
		if(poll_loaded()) need_research = 1; // like the website: search again when a dictionary arrives
		struct tb_event ev;
		while(!quit && tb_peek_event(&ev, 0) == TB_OK) handle(&ev);
		if(status[0] && now_ms() >= status_until) status[0] = 0;
	}
	tb_shutdown();
	return 0;
}

static void usage(void){
	fputs("usage: peakterm [-r root] [-a] [page | dictionary files...]\n"
		"       peakterm -q query [-n groups] [-w width] [page | files...]\n"
		"       peakterm -l [page]\n\n"
		"  page        a language or section like on peakslab.org: khmer, khmer/bible, ...\n"
		"  -r root     the PeakSlab folder with files.json (default: $PEAKSLAB_ROOT,\n"
		"              the folder peakterm is in, or the current folder)\n"
		"  -a          enable every dictionary of the page (this run only)\n"
		"  -q query    print the results and exit; -n how many headwords (default 10)\n"
		"  -w width    width for -q (default: the terminal's, or 80)\n"
		"  -l          list the page's dictionaries and exit\n\n"
		"Media in .slab dictionaries opens with $PEAKTERM_IMAGE (images), $PEAKTERM_MEDIA\n"
		"(audio, video) or $PEAKTERM_OPEN (anything), else the \"image\", \"media\" or \"open\"\n"
		"line of ~/.config/peakslab/peakterm.conf (e.g. \"image<TAB>sxiv\"), else xdg-open.\n", stderr);
}

static int find_root(const char *opt){
	const char *cands[3] = {opt, getenv("PEAKSLAB_ROOT"), NULL};
	char exe[PATH_MAX];
	ssize_t n = readlink("/proc/self/exe", exe, sizeof exe - 1);
	if(n > 0){
		exe[n] = 0;
		char *s = strrchr(exe, '/');
		if(s) *s = 0;
		cands[2] = exe;
	}
	for(int i = 0; i < 3; ++i){
		if(!cands[i] || !*cands[i]) continue;
		char fn[PATH_MAX + 16];
		snprintf(fn, sizeof fn, "%s/files.json", cands[i]);
		if(!access(fn, R_OK)){ snprintf(root, sizeof root, "%s", cands[i]); return 1; }
		if(i == 0) return 0;
	}
	if(!access("files.json", R_OK)){ snprintf(root, sizeof root, "."); return 1; }
	return 0;
}

int main(int argc, char **argv){
	const char *ropt = NULL, *query = NULL;
	int maxg = 10, width = 0, list = 0, all = 0;
	VEC(char*) args = {0};
	for(int i = 1; i < argc; ++i){
		char *a = argv[i];
		if(!strcmp(a, "-h") || !strcmp(a, "--help")){ usage(); return 0; }
		else if(!strcmp(a, "-r") && i + 1 < argc) ropt = argv[++i];
		else if(!strcmp(a, "-q") && i + 1 < argc) query = argv[++i];
		else if(!strcmp(a, "-n") && i + 1 < argc) maxg = atoi(argv[++i]);
		else if(!strcmp(a, "-w") && i + 1 < argc) width = atoi(argv[++i]);
		else if(!strcmp(a, "-l")) list = 1;
		else if(!strcmp(a, "-a")) all = 1;
		else if(a[0] == '-' && a[1]){ usage(); return 2; }
		else VPUSH(args, a);
	}
	signal(SIGCHLD, SIG_IGN); // media viewers we start are reaped automatically
	cfg_load();

	// dictionary files given directly?
	struct stat st;
	for(int i = 0; i < args.n; ++i){
		if(!stat(args.v[i], &st) && S_ISREG(st.st_mode)){
			add_dict(args.v[i], args.v[i], "", 1, 0);
			explicit_files = 1;
		}
	}
	const char *pg = "";
	if(explicit_files){
		persist = 0;
	}else{
		if(!find_root(ropt)){
			fprintf(stderr, "peakterm: can't find files.json (use -r or set PEAKSLAB_ROOT)\n");
			return 1;
		}
		if(!load_files_json()) die("can't read files.json");
		if(args.n){
			char *p = args.v[0];
			while(*p == '/') ++p;
			size_t l = strlen(p);
			while(l && p[l-1] == '/') p[--l] = 0;
			pg = p;
		}else if(cfg_page) pg = cfg_page;
	}
	if(all) persist = 0;
	build_page(pg, 0);
	if(!NP){ fprintf(stderr, "peakterm: no dictionaries for \"%s\"\n", pg); return 1; }
	if(all) for(int i = 0; i < NP; ++i) D[P[i]].enabled = 1;
	if(!explicit_files && args.n && !query && !list && !all){
		free(cfg_page);
		cfg_page = xstrdup(pg);
		cfg_save();
	}

	if(list){
		for(int i = 0; i < NP; ++i){
			dict *d = &D[P[i]];
			printf("[%s] %-24s %3d  %s\n", d->enabled ? "x" : " ", d->name, d->has_prio ? d->prio : 1, d->path);
		}
		return 0;
	}

	for(int i = 0; i < NP; ++i) if(D[P[i]].enabled) dict_start(P[i]);

	if(query){
		wait_loaded();
		for(int i = 0; i < NP; ++i){
			dict *d = &D[P[i]];
			if(d->enabled && d->state == D_FAILED) fprintf(stderr, "peakterm: %s: %s\n", d->path, d->err);
		}
		if(!width){
			struct winsize ws;
			width = (!ioctl(1, TIOCGWINSZ, &ws) && ws.ws_col) ? ws.ws_col : 80;
		}
		rset rs = {0};
		rs.width = width;
		char q[QMAX];
		normq(query, q, sizeof q);
		search_start(&rs, q);
		while(rs.g.n <= maxg && fetch_one(&rs) >= 0);
		int ng = rs.g.n < maxg ? rs.g.n : maxg;
		int color = isatty(1);
		for(int gi = 0; gi < ng; ++gi){
			layout_group(&rs, gi);
			group *g = &rs.g.v[gi];
			for(int l = 0; l < g->nl; ++l) print_line(stdout, &g->lines[l], color);
		}
		return rs.g.n ? 0 : 1;
	}
	int r = tui();
	cfg_save();
	return r;
}
