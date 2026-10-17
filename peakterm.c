/* peakterm: peakslab.org's multi-dictionary search in a terminal (termbox2).
 *
 * peak.c is #included unchanged. It keeps its search state in globals (the
 * website gives each dictionary its own wasm instance), so each dictionary
 * keeps a copy of them that's switched in before it's used. Dictionaries load
 * one at a time between keystrokes.
 *
 *   peakterm [-r root] [-a] [page | files...]        page: khmer, khmer/bible, ...
 *   peakterm -q query [-n groups] [-w width] [page]   print the results
 */
#define TB_IMPL
#define TB_OPT_ATTR_W 32
#define TB_OPT_EGC
#include "utils/termbox2/termbox2.h"
#include "peak.c"
#undef printf
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>

#define QMAX 512        // query buffer per search state (as on the website)
#define FILLMAX 64      // results per dictionary when gathering a headword's entries
#define POPMAX 100      // results per dictionary in the lookup popup
#define PAD (QMAX + 64) // zeroed tail after the data (see load)
#define BAR_COLOR TB_YELLOW // the ─── dictionary ─ bars between entries

#define VEC(T) struct { T *v; int n, cap; }
#define VPUSH(a, x) do{ \
	if((a).n >= (a).cap){ \
		(a).cap = (a).cap * 2 + 8; \
		(a).v = xrealloc((a).v, (a).cap * sizeof(*(a).v)); \
	} \
	(a).v[(a).n++] = (x); \
}while(0)

static void die(const char *m){
	fprintf(stderr, "peakterm: %s\n", m);
	exit(1);
}

static void *xrealloc(void *p, size_t n){
	void *r = realloc(p, n ? n : 1);
	if(!r)
		die("out of memory");
	return r;
}

static char *xstrndup(const char *s, size_t n){
	char *r = xrealloc(NULL, n + 1);
	memcpy(r, s, n);
	r[n] = 0;
	return r;
}

static char *xstrdup(const char *s){
	return xstrndup(s, strlen(s));
}

static long long now_ms(void){
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return t.tv_sec * 1000LL + t.tv_nsec / 1000000;
}

// One UTF-8 character of s into *cp; returns its length (invalid bytes become U+FFFD).
static int u8(const char *s, uint32_t *cp){
	int n = tb_utf8_char_to_unicode(cp, s);
	if(n <= 0){
		*cp = 0xfffd;
		n = 1;
	}
	return n;
}

static int strw(const char *s){
	int w = 0;
	uint32_t cp;
	while(*s){
		s += u8(s, &cp);
		if(tb_wcwidth(cp) > 0)
			w += tb_wcwidth(cp);
	}
	return w;
}

/* The website's updateQuery(), also used for grouping headwords: as stored in
 * peak (lowercase ASCII, no tags, no zero width spaces), trimmed. */
static char *norm(const char *s, int n){
	char *k = xrealloc(NULL, n + 1);
	int o = 0, intag = 0;
	for(int i = 0; i < n; ++i){
		unsigned char c = s[i];
		if(c == '<' || intag){
			intag = c != '>';
			continue;
		}
		if(c == 0xe2 && i + 2 < n && (uint8_t)s[i+1] == 0x80 && (uint8_t)s[i+2] == 0x8b){
			i += 2;
			continue;
		}
		if(o || !isspace(c))
			k[o++] = tolower(c);
	}
	while(o && isspace((unsigned char)k[o-1]))
		--o;
	k[o] = 0;
	return k;
}

static char *trimdup(const char *s, int n){
	while(n && isspace((unsigned char)*s)){
		++s;
		--n;
	}
	while(n && isspace((unsigned char)s[n-1]))
		--n;
	return xstrndup(s, n);
}

/* ---------- dictionaries ---------- */

// A dictionary's copy of peak.c's globals.
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
	int prio, has_prio, buflen, slab, zst;
	int inpage, primary, enabled, collapsed, order, rank, mc; // on the current page
	int ready, failed, want, insearch;
	uint8_t *qbuf;
	struct pctx ctx;
} dict;

static dict *D;         // every dictionary
static int ND;
static int *P, NP;      // the page's dictionaries, in display order
static dict *cur;       // whose state is in peak.c's globals
static uint8_t *resbuf; // one result buffer for all of them
static size_t resmax;

static void save_cur(void){
	if(cur)
		cur->ctx = (struct pctx){g_d, g_d_size, ps_h, tracker, iowa, wis, psa == &wis};
}

static void use(dict *d){
	if(cur == d)
		return;
	save_cur();
	struct pctx *c = &d->ctx;
	g_d = c->g_d;
	g_d_size = c->g_d_size;
	ps_h = c->ps_h;
	tracker = c->tracker;
	iowa = c->iowa;
	wis = c->wis;
	psa = c->alt ? &wis : &iowa;
	cur = d;
}

/* Reads, decompresses and hands a dictionary to peak.c. peak.c's binary and
 * glob searches can compare a little past the end of the data (harmless in
 * wasm memory), so the data gets a zeroed tail longer than any query. */
static void load(dict *d){
	uint8_t *src = NULL, *buf = NULL;
	size_t n = 0, size = 0;
	struct stat st;
	int ok = 0;

	FILE *f = fopen(d->full, "rb");
	if(f && !fstat(fileno(f), &st) && st.st_size > 0){
		n = st.st_size;
		src = malloc(n + PAD);
		ok = src && fread(src, 1, n, f) == n;
	}
	if(f)
		fclose(f);

	if(ok && d->zst){
		unsigned long long fs = ZSTD_getFrameContentSize(src, n);
		ok = fs < ZSTD_CONTENTSIZE_ERROR && fs < 512ULL << 20 && (buf = malloc(fs + PAD));
		if(ok){
			size = ZSTD_decompress(buf, fs, src, n);
			ok = !ZSTD_isError(size);
		}
		free(src);
	}else if(ok){
		buf = src;
		size = n;
	}else{
		free(src);
	}
	if(!ok || size < sizeof(struct peakslab) || memcmp(((struct peakslab *)buf)->magicstr, "Peak", 4)){
		free(buf);
		d->failed = 1;
		return;
	}
	memset(buf + size, 0, PAD);

	use(d); // saves whoever was current; then fresh globals for load_peak()
	g_d = NULL;
	ps_h = NULL;
	tracker = (struct ptracker){0};
	memset(&iowa, 0, sizeof iowa);
	memset(&wis, 0, sizeof wis);
	psa = &iowa;
	if(d->buflen + 4096u > resmax){
		resmax = d->buflen + 4096;
		resbuf = xrealloc(resbuf, resmax);
	}
	load_peak(buf, size, 0); // already decompressed: peak.c keeps the buffer
	d->qbuf = xrealloc(NULL, QMAX * 2);
	peak_init(d->qbuf, QMAX, d->qbuf + QMAX, QMAX, resbuf, resmax);
	g_result_loc = resbuf;
	g_result_max = resmax;
	d->ready = 1;
}

// Loads one dictionary that's wanted. Returns 1 if it did.
static int load_one(void){
	for(dict *d = D; d < D + ND; ++d){
		if(d->want && !d->ready && !d->failed){
			load(d);
			return 1;
		}
	}
	return 0;
}

static void unload(dict *d){
	if(cur == d){
		save_cur();
		cur = NULL;
	}
	if(d->ready){
		free(d->ctx.g_d);
		free(d->ctx.tracker.data);
		free(d->qbuf);
	}
	d->ctx = (struct pctx){0};
	d->ready = d->insearch = d->failed = 0;
}

static int usable(int di){
	return D[di].ready && D[di].enabled && D[di].inpage;
}

/* ---------- search results, grouped by headword like the website ---------- */

typedef struct {
	uint32_t cp;
	uintattr_t fg, bg;
	uint32_t act; // what clicking it does: ACT(kind, value)
	int8_t w;
} glyph;

typedef struct {
	glyph *g;
	int n;
} dline;

enum { A_LINK = 1, A_DICT, A_OPEN };
#define ACT(k, v) ((uint32_t)(k) << 28 | ((v) & 0xfffffffu))
#define AKIND(a) ((a) >> 28)
#define AVAL(a) ((a) & 0xfffffffu)

typedef struct {
	int d, blen;
	char *body;  // the HTML after the headword, or a .slab entry's file
	char *ftype; // a .slab entry's file type
	size_t binlen;
} entry;

typedef struct {
	char *key, *hdr;
	VEC(entry) e;
	VEC(dline) l; // laid out
	int dirty;
} group;

typedef struct {
	VEC(group) g;
	char q[QMAX];
	uint32_t hl[QMAX]; // the query, highlighted like the website's <mark>
	int nhl;
	int st, cdic, done, popup, nent, scroll, width, total, dirty;
} rset;

static int opt_mark = 1, opt_chords = 0;
static int rows_ok; // whether rows[] (below) matches what's on screen
static uint32_t linkctr;

static void rs_free(rset *rs){
	for(group *g = rs->g.v; g < rs->g.v + rs->g.n; ++g){
		for(entry *e = g->e.v; e < g->e.v + g->e.n; ++e){
			free(e->body);
			free(e->ftype);
		}
		for(int l = 0; l < g->l.n; ++l)
			free(g->l.v[l].g);
		free(g->e.v);
		free(g->l.v);
		free(g->key);
		free(g->hdr);
	}
	free(rs->g.v);
	*rs = (rset){.width = rs->width};
	rows_ok = 0;
}

// Adds a get_result() buffer to its headword's group. Returns the group, or -1 for a repeat.
static int add_result(rset *rs, int di, const char *buf, uint32_t len, int *isnew){
	entry e = {.d = di};
	const char *z = D[di].slab ? memchr(buf, 0, len) : NULL; // .slab: header \t ... \t filetype \n \0 bytes
	if(!D[di].slab)
		while(len && buf[len-1] == '\n')
			--len;
	const char *tab = memchr(buf, '\t', z ? (size_t)(z - buf) : len);
	char *hdr = trimdup(buf, tab ? tab - buf : z ? z - buf : (int)len);
	char *key = norm(hdr, strlen(hdr));
	if(z){
		char *t = trimdup(buf, z - buf), *ft = strrchr(t, '\t');
		e.ftype = xstrdup(ft ? ft + 1 : "");
		e.binlen = len - (z - buf) - 1;
		e.body = xstrndup(z + 1, e.binlen);
		free(t);
	}else{
		e.blen = tab ? (int)(buf + len - tab - 1) : 0;
		e.body = xstrndup(tab ? tab + 1 : "", e.blen);
	}

	int gi = rs->g.n - 1; // most results belong to the newest group
	while(gi >= 0 && strcmp(rs->g.v[gi].key, key))
		--gi;
	*isnew = gi < 0;
	if(*isnew){
		VPUSH(rs->g, ((group){.key = key, .hdr = hdr}));
		gi = rs->g.n - 1;
	}else{
		free(key);
		free(hdr);
	}
	group *g = &rs->g.v[gi];
	for(entry *x = g->e.v; x < g->e.v + g->e.n; ++x){
		if(x->d == di && x->blen == e.blen && x->binlen == e.binlen && !memcmp(x->body, e.body, e.blen + e.binlen)){
			free(e.body);
			free(e.ftype);
			return -1;
		}
	}
	VPUSH(g->e, e);
	for(int k = g->e.n - 1; k > 0 && D[g->e.v[k-1].d].order > D[di].order; --k){ // in dictionary order
		entry t = g->e.v[k];
		g->e.v[k] = g->e.v[k-1];
		g->e.v[k-1] = t;
	}
	g->dirty = rs->dirty = 1;
	rs->nent++;
	return gi;
}

/* get_result(), except on an index with exactly one entry: p_binarysearch()
 * then compares through a NULL `guess` (readable in wasm, a crash here). */
static int peak_get(int skip){
	if(psa->st != FULL && psa->idxlen == 1 && psa->line == 0)
		return -1;
	return get_result(skip);
}

static void setq(const char *q){
	snprintf((char *)psa->qloc, QMAX, "%s", q);
}

/* Searches the usable dictionaries but `except` for `q` with peak.c's second
 * search state, leaving the main search where it was (the website's "tempsearch"). */
static void side_search(rset *rs, int st, const char *q, int except, int max){
	for(int i = 0; i < NP; ++i){
		if(P[i] == except || !usable(P[i]))
			continue;
		use(&D[P[i]]);
		switchstate();
		setq(q);
		init_search(st, 0);
		for(int k = 0; k < max; ++k){
			int r = peak_get(rs->popup), isnew;
			if(r <= 0)
				break;
			add_result(rs, P[i], (char *)g_result_loc, r, &isnew);
		}
		switchstate();
	}
}

static void search_start(rset *rs, const char *q, int popup){
	rs_free(rs);
	snprintf(rs->q, sizeof rs->q, "%s", q);
	for(const char *s = q; *s && rs->nhl < QMAX; ++rs->nhl)
		s += u8(s, &rs->hl[rs->nhl]);
	rs->popup = rs->done = popup;
	if(popup){ // exact headwords, then the second index (the website's tempsearch 1 and 2)
		side_search(rs, EXACT1, q, -1, POPMAX);
		side_search(rs, EXACT2, q, -1, POPMAX);
		return;
	}
	rs->st = strpbrk(q, "!+*^") ? FULL : INDEX1;
	for(int i = 0; i < ND; ++i)
		D[i].insearch = 0;
	for(int i = 0; i < NP; ++i){
		if(!usable(P[i]))
			continue;
		use(&D[P[i]]);
		setq(q);
		init_search(rs->st, 1);
		D[P[i]].insearch = 1;
	}
}

/* The next main search result, dictionary by dictionary, in the website's
 * order: index 1, 2, 3, then the full text (globs: full text only). A new
 * headword gathers its entries from the other dictionaries. Returns its group,
 * or -1 when there are no more. */
static int fetch_one(rset *rs){
	while(!rs->done){
		if(rs->cdic >= NP){
			if(rs->st == FULL){
				rs->done = 1;
				break;
			}
			rs->st = rs->st == INDEX3 ? FULL : rs->st + 1;
			for(int i = 0; i < NP; ++i){
				if(D[P[i]].insearch && D[P[i]].ready){
					use(&D[P[i]]);
					continue_search(rs->st);
				}
			}
			rs->cdic = 0;
			continue;
		}
		int di = P[rs->cdic];
		if(!D[di].insearch || !D[di].ready){
			rs->cdic++;
			continue;
		}
		use(&D[di]);
		int r = peak_get(0), isnew;
		if(r <= 0){
			rs->cdic++;
			continue;
		}
		int gi = add_result(rs, di, (char *)g_result_loc, r, &isnew);
		if(isnew){
			char *key = xstrdup(rs->g.v[gi].key);
			side_search(rs, EXACT1, key, di, FILLMAX);
			free(key);
		}
		if(gi >= 0)
			return gi;
	}
	return -1;
}

/* ---------- laying out text into lines of glyphs ---------- */

typedef struct {
	VEC(dline) out;
	VEC(glyph) cur;
	int W, curw;
	int fresh;        // the line's prefix (the group's bar, quote bars) isn't out yet
	int cstart;       // where the line's text starts, after the prefix
	int quote;        // how many quotes the text is in
	int bend, bstart; // where to wrap: the line ends at bend, the next starts at bstart
	int pend;         // a collapsed space waiting for the next glyph
	int pendsep;      // a column separator (a tab) waiting for the next glyph
	int limit, dim;   // keep only `limit` lines, dimmed (a collapsed dictionary)
	int blank;        // blank lines in a row
} lb;

static void lb_push(lb *L, uint32_t cp, uintattr_t fg, uint32_t act){
	int w = tb_wcwidth(cp) < 0 ? 1 : tb_wcwidth(cp);
	VPUSH(L->cur, ((glyph){cp, fg, 0, act, w}));
	L->curw += w;
}

static void lb_prefix(lb *L){
	L->cur.n = L->curw = L->fresh = 0;
	L->bend = -1;
	lb_push(L, 0x258e, TB_GREEN, 0);
	lb_push(L, ' ', 0, 0);
	for(int q = 0; q < L->quote; ++q){ // a bar for each quote
		lb_push(L, 0x2502, TB_DIM, 0);
		lb_push(L, ' ', 0, 0);
	}
	L->cstart = L->cur.n;
}

static int lb_has(lb *L){
	return !L->fresh && L->cur.n > L->cstart;
}

static void lb_emit(lb *L){
	if(L->fresh)
		lb_prefix(L);
	while(L->cur.n > L->cstart && L->cur.v[L->cur.n-1].cp == ' ' && !L->cur.v[L->cur.n-1].act){
		L->cur.n--;
		L->curw--;
	}
	if(!L->limit || L->out.n < L->limit){
		dline d = {xrealloc(NULL, L->cur.n * sizeof(glyph)), L->cur.n};
		for(int i = 0; i < d.n; ++i){
			d.g[i] = L->cur.v[i];
			if(L->dim)
				d.g[i].fg |= TB_DIM;
		}
		VPUSH(L->out, d);
	}
	L->blank = L->cur.n > L->cstart ? 0 : L->blank + 1;
	L->fresh = 1;
	L->cur.n = L->curw = L->pend = L->pendsep = 0;
}

static void lb_glyph(lb *L, uint32_t cp, uintattr_t fg, uintattr_t bg, uint32_t act){
	if(cp == 0x200b){ // zero width space: may wrap here
		if(!L->fresh)
			L->bend = L->bstart = L->cur.n;
		return;
	}
	if(cp == 0xa0)
		cp = ' ';
	int w = cp == 0xad ? -1 : tb_wcwidth(cp); // (soft hyphens are dropped)
	if(w < 0)
		return;
	if(L->fresh)
		lb_prefix(L);
	if(w == 0){ // combining: joins the glyph before it
		if(L->cur.n > L->cstart)
			VPUSH(L->cur, ((glyph){cp, fg, bg, act, 0}));
		return;
	}
	if(L->pendsep && L->cur.n > L->cstart){ // between columns: " · "
		L->pendsep = 0;
		L->pend = 1;
		lb_glyph(L, 0xb7, TB_DIM, 0, 0);
		L->pend = 1;
	}
	if(L->pend && L->cur.n > L->cstart){
		L->bend = L->cur.n;
		L->bstart = L->cur.n + 1;
		lb_push(L, ' ', 0, 0);
	}
	L->pend = 0;
	if(w == 2)
		L->bend = L->bstart = L->cur.n;
	while(L->curw + w > L->W && L->cur.n > L->cstart){ // wrap at the last break, carrying the rest over
		int soft = L->bend > L->cstart, tn = soft ? L->cur.n - L->bstart : 0;
		glyph t[tn ? tn : 1];
		memcpy(t, L->cur.v + L->cur.n - tn, tn * sizeof *t);
		if(soft)
			L->cur.n = L->bend;
		lb_emit(L);
		lb_prefix(L);
		for(int i = 0; i < tn; ++i){
			VPUSH(L->cur, t[i]);
			L->curw += t[i].w;
		}
	}
	VPUSH(L->cur, ((glyph){cp, fg, bg, act, w}));
	L->curw += w;
	if(cp == '-' || cp == '/' || cp == 0x17d4 || cp == 0x2013 || cp == 0x2014 || w == 2)
		L->bend = L->bstart = L->cur.n;
}

static void lb_text(lb *L, const char *s, uintattr_t fg, uint32_t act){
	uint32_t cp;
	while(*s){
		s += u8(s, &cp);
		if(cp == ' ')
			L->pend = lb_has(L);
		else
			lb_glyph(L, cp, fg, 0, act);
	}
}

static void lb_block(lb *L){
	if(lb_has(L))
		lb_emit(L);
	else
		L->fresh = 1;
	L->pendsep = 0;
}

// Fills the line with `fill` up to a right-aligned, clickable label.
static void lb_label(lb *L, uint32_t fill, const char *lab, uint32_t act){
	uint32_t cp;
	while(L->curw < L->W - strw(lab))
		lb_push(L, fill, BAR_COLOR, 0);
	while(*lab){
		lab += u8(lab, &cp);
		lb_push(L, cp, BAR_COLOR | TB_BOLD, act);
	}
	lb_emit(L);
}

/* ---------- dictionary HTML to styled text ---------- */

enum { BL = 1, LI = 2, LINK = 4, SKIP = 8, MARK = 16, UL = 32, OL = 64, QUOTE = 128 };

static const struct {
	const char *n;
	uintattr_t a, c; // attributes added, color
	int f;
} tags[] = {
	{"b", TB_BOLD, 0, 0}, {"strong", TB_BOLD, 0, 0}, {"th", TB_BOLD, 0, 0}, {"dt", TB_BOLD, 0, BL},
	{"i", TB_ITALIC, 0, 0}, {"em", TB_ITALIC, 0, 0}, {"cite", TB_ITALIC, 0, 0}, {"u", TB_UNDERLINE, 0, 0},
	{"s", TB_DIM, 0, 0}, {"del", TB_DIM, 0, 0}, {"p-n", TB_DIM, 0, 0}, {"p-fn", TB_DIM, 0, BL},
	{"a", TB_UNDERLINE, TB_CYAN, LINK}, {"p-a", TB_UNDERLINE, TB_CYAN, LINK}, {"p-as", TB_UNDERLINE, TB_CYAN, LINK},
	{"h1", TB_BOLD, TB_GREEN, BL}, {"h2", TB_BOLD, TB_GREEN, BL}, {"h3", TB_BOLD, TB_GREEN, BL}, {"h4", TB_BOLD, TB_GREEN, BL},
	{"p-l", TB_BRIGHT, TB_BLUE, 0}, {"p-ipa", 0, TB_MAGENTA, BL}, {"p-eg", 0, TB_GREEN, 0}, {"p-tags", TB_REVERSE, 0, 0},
	{"mark", 0, TB_BLACK, MARK}, {"script", 0, 0, SKIP}, {"style", 0, 0, SKIP}, {"head", 0, 0, SKIP},
	{"blockquote", 0, 0, BL | QUOTE}, {"p-q", 0, 0, BL | QUOTE}, {"p-q2", 0, 0, BL | QUOTE},
	{"li", 0, 0, BL | LI}, {"dd", 0, 0, BL}, {"ul", 0, 0, BL | UL}, {"ol", 0, 0, BL | OL}, {"p", 0, 0, BL}, {"div", 0, 0, BL},
	{"table", 0, 0, BL}, {"tr", 0, 0, BL}, {"dl", 0, 0, BL}, {"center", 0, 0, BL}, {"pre", 0, 0, BL}, {"section", 0, 0, BL},
	{"p-m", 0, 0, 0},
};
#define NTAGS (int)(sizeof tags / sizeof *tags)

static const struct {
	const char *n;
	uint32_t c;
} ents[] = {
	{"amp;", '&'}, {"lt;", '<'}, {"gt;", '>'}, {"quot;", '"'}, {"apos;", '\''}, {"nbsp;", 0xa0},
	{"ndash;", 0x2013}, {"mdash;", 0x2014}, {"hellip;", 0x2026}, {"lsquo;", 0x2018}, {"rsquo;", 0x2019},
	{"ldquo;", 0x201c}, {"rdquo;", 0x201d},
};
#define NENTS (int)(sizeof ents / sizeof *ents)

typedef struct {
	char name[12];
	uintattr_t fg, bg;
	uint32_t act;
	int f;
	int lnum; // an <ol>'s last item number
} tst;

typedef struct {
	lb *L;
	tst st[64]; // open tags
	int sp;
	rset *rs;
	int qend; // the output line count when the last quote ended
} rctx;

static void r_quotes(rctx *R){ // the quote bars for the next line
	R->L->quote = 0;
	for(int i = 0; i < R->sp; ++i)
		R->L->quote += !!(R->st[i].f & QUOTE);
}

// Closes the innermost open `name` (and what's inside it).
static void r_pop(rctx *R, const char *name){
	int k = R->sp - 1, block = 0;
	while(k > 0 && strcmp(R->st[k].name, name))
		--k;
	if(k <= 0)
		return;
	for(int m = k; m < R->sp; ++m)
		block |= R->st[m].f;
	R->sp = k;
	if(block & BL)
		lb_block(R->L);
	if(block & QUOTE)
		R->qend = R->L->out.n;
	r_quotes(R);
}

static void r_tag(rctx *R, const char *tag, int len, int close){
	lb *L = R->L;
	char name[12], s[40];
	int i = 1 + close, o = 0, k = 0;
	while(i < len && o < 11 && (isalnum((unsigned char)tag[i]) || tag[i] == '-'))
		name[o++] = tolower((unsigned char)tag[i++]);
	name[o] = 0;
	if(close){
		r_pop(R, name);
		return;
	}
	if(R->st[R->sp-1].f & SKIP)
		return;
	if(!strcmp(name, "br")){
		if(lb_has(L) || L->blank < 1)
			lb_emit(L);
		return;
	}
	if(!strcmp(name, "img")){
		L->pend = lb_has(L);
		lb_text(L, "[image]", TB_DIM, 0);
		return;
	}
	if(!strcmp(name, "hr")){
		lb_block(L);
		do
			lb_glyph(L, 0x2500, TB_DIM, 0, 0);
		while(L->curw < L->W);
		lb_block(L);
		return;
	}
	while(k < NTAGS && strcmp(tags[k].n, name))
		++k;
	if(k == NTAGS) // other tags (span, font, ...) change nothing
		return;
	if(((tags[k].f & LI) || !strcmp(name, "p")) && !strcmp(R->st[R->sp-1].name, name))
		r_pop(R, name); // an open <li> or <p> closes before the next one

	tst t = R->st[R->sp-1];
	snprintf(t.name, sizeof t.name, "%s", name);
	t.f = tags[k].f;
	t.lnum = 0;
	const char *start = memmem(tag, len, "start=", 6); // <ol start="5">
	if((t.f & OL) && start)
		t.lnum = atoi(start + 6 + (start[6] == '"' || start[6] == '\'')) - 1;
	if(tags[k].c)
		t.fg = (t.fg & 0xff000000u) | tags[k].c;
	t.fg |= tags[k].a;
	if(t.f & MARK)
		t.bg = TB_YELLOW;
	if(t.f & LINK)
		t.act = ACT(A_LINK, ++linkctr);
	if(t.f & BL)
		lb_block(L);
	if((t.f & QUOTE) && R->qend == L->out.n && !L->blank)
		lb_emit(L); // a blank line between two quotes, so they don't look like one
	if(t.f & LI){ // a bullet, or the item's number in an <ol>
		int j = R->sp - 1;
		while(j > 0 && !(R->st[j].f & (UL | OL)))
			--j;
		if(j > 0 && (R->st[j].f & OL)){
			snprintf(s, sizeof s, "%d.", ++R->st[j].lnum);
			lb_text(L, s, TB_GREEN | TB_BOLD, 0);
		}else{
			lb_glyph(L, 0x2022, TB_GREEN | TB_BOLD, 0, 0);
		}
		L->pend = 1;
	}
	if(tag[len-2] == '/' || R->sp >= 64)
		return;
	R->st[R->sp++] = t;
	r_quotes(R);

	const char *c = memmem(tag, len, "chord=\"", 7); // <p-m chord="G">: shown as [G] with Ctrl-O
	char chord[32];
	if(!strcmp(name, "p-m") && opt_chords && c && sscanf(c + 7, "%31[^\"]", chord) == 1){
		snprintf(s, sizeof s, "[%s]", chord);
		lb_text(L, s, TB_RED | TB_BOLD, 0);
	}
}

// A run of text between tags. The search query is highlighted (case-insensitively for ASCII).
static void r_flush(rctx *R, uint32_t *run, int n){
	tst *t = &R->st[R->sp-1];
	if(!n || (t->f & SKIP))
		return;
	uint8_t mark[n];
	int hn = opt_mark && R->rs ? R->rs->nhl : 0;
	memset(mark, 0, n);
	for(int i = 0; hn && i + hn <= n; ++i){
		int k = 0;
		while(k < hn && (run[i+k] < 128 ? (uint32_t)tolower(run[i+k]) : run[i+k]) == R->rs->hl[k])
			++k;
		if(k == hn){
			memset(mark + i, 1, k);
			i += k - 1;
		}
	}
	for(int i = 0; i < n; ++i){
		if(run[i] == '\t')
			R->L->pendsep = lb_has(R->L); // between columns
		else if(run[i] == ' ' || run[i] == '\n' || run[i] == '\r')
			R->L->pend |= lb_has(R->L);
		else if(mark[i])
			lb_glyph(R->L, run[i], (t->fg & 0xff000000u) | TB_BLACK, TB_YELLOW, t->act);
		else
			lb_glyph(R->L, run[i], t->fg, t->bg, t->act);
	}
}

static void render_html(lb *L, const char *s, int n, uintattr_t fg, rset *rs){
	rctx R = {.L = L, .sp = 1, .rs = rs, .qend = -1};
	R.st[0].fg = fg;
	VEC(uint32_t) run = {0};
	for(int i = 0, k; i < n; i += k){
		const char *gt;
		int close = s[i+1] == '/';
		if(s[i] == '<' && !strncmp(s + i, "<!--", 4)){
			gt = memmem(s + i, n - i, "-->", 3);
			k = gt ? gt - (s + i) + 3 : n - i;
			continue;
		}
		if(s[i] == '<' && isalpha((unsigned char)s[i+1+close]) && (gt = memchr(s + i, '>', n - i))){
			r_flush(&R, run.v, run.n);
			run.n = 0;
			k = gt - (s + i) + 1;
			r_tag(&R, s + i, k, close);
			continue;
		}
		uint32_t cp = 0; // an entity, or a UTF-8 character
		const char *semi = s[i] == '&' ? memchr(s + i, ';', n - i < 10 ? n - i : 10) : NULL;
		if(semi && s[i+1] == '#')
			cp = s[i+2] == 'x' ? strtoul(s + i + 3, NULL, 16) : strtoul(s + i + 2, NULL, 10);
		for(int e = 0; semi && !cp && e < NENTS; ++e)
			if(!strncmp(s + i + 1, ents[e].n, strlen(ents[e].n)))
				cp = ents[e].c;
		if(cp)
			k = semi - (s + i) + 1;
		else
			k = u8(s + i, &cp);
		VPUSH(run, cp > 0x10ffff ? 0xfffd : cp);
	}
	r_flush(&R, run.v, run.n);
	free(run.v);
	L->quote = 0;
}

/* A headword's group: the headword with its first dictionary on the right,
 * then each entry under ─── dictname ─ (╌╌╌ between entries of one dictionary). */
static void layout_group(rset *rs, int gi){
	group *g = &rs->g.v[gi];
	char lab[160];
	for(int l = 0; l < g->l.n; ++l)
		free(g->l.v[l].g);
	free(g->l.v);
	lb L = {.W = rs->width < 20 ? 20 : rs->width, .fresh = 1};
	for(int k = 0; k < g->e.n; ++k){
		entry *e = &g->e.v[k];
		dict *d = &D[e->d];
		int same = k && e->d == g->e.v[k-1].d;
		if(same)
			lab[0] = 0;
		else
			snprintf(lab, sizeof lab, k ? " %s%s \xe2\x94\x80" : " %s%s", d->collapsed ? "+ " : "", d->name);
		if(k == 0){
			render_html(&L, g->hdr, strlen(g->hdr), TB_BOLD, rs);
			if(lb_has(&L) && L.curw + strw(lab) > L.W)
				lb_emit(&L);
		}
		if(k || !lb_has(&L))
			lb_prefix(&L);
		lb_label(&L, k == 0 ? ' ' : same ? 0x254c : 0x2500, lab, ACT(A_DICT, e->d));
		if(d->collapsed){ // collapsed: its first line, dimmed
			L.limit = L.out.n + 1;
			L.dim = 1;
		}
		if(e->ftype){
			snprintf(lab, sizeof lab, "\xe2\x96\xb6 open %s (%zu KB)", e->ftype, (e->binlen + 1023) / 1024);
			lb_text(&L, lab, TB_CYAN | TB_UNDERLINE, ACT(A_OPEN, (gi & 0xffff) << 12 | (k & 0xfff)));
		}else{
			render_html(&L, e->body, e->blen, 0, rs);
		}
		lb_block(&L);
		L.limit = L.dim = 0;
	}
	VPUSH(L.out, ((dline){NULL, 0}));
	free(L.cur.v);
	g->l.v = L.out.v;
	g->l.n = L.out.n;
	g->l.cap = L.out.cap;
	g->dirty = 0;
}

// Lays out what changed, fetching results until there are `lines` lines (or no more).
static void ensure(rset *rs, int lines){
	do{
		if(!rs->dirty)
			continue;
		rs->total = rs->dirty = rows_ok = 0;
		for(int i = 0; i < rs->g.n; ++i){
			if(rs->g.v[i].dirty)
				layout_group(rs, i);
			rs->total += rs->g.v[i].l.n;
		}
	}while(!rs->done && rs->total < lines && fetch_one(rs) >= 0);
}

static void dirty_all(rset *rs){
	for(int i = 0; i < rs->g.n; ++i)
		rs->g.v[i].dirty = rs->dirty = 1;
}

/* ---------- settings and the dictionary list ---------- */

/* ~/.config/peakslab/peakterm.conf, tab separated lines: page, mark, chords,
 * image and media (viewer commands), "collapse <path>", and
 * "enable <page> <path> <0|1>" for the choices made in the dictionary list. */
typedef struct {
	char *page, *path;
	int on;
} cfgent;

static VEC(cfgent) cfg;
static VEC(char *) cols;
static char *cfg_page, *cfg_image, *cfg_media;
static char cfgpath[PATH_MAX], root[PATH_MAX], *page = "";
static int persist = 1; // save choices (not with -a or dictionary files)

static char *cfg_str(const char *s){ // "/" stands for "" (everything)
	return xstrdup(strcmp(s, "/") ? s : "");
}

static void cfg_load(void){
	const char *x = getenv("XDG_CONFIG_HOME");
	if(x && *x)
		snprintf(cfgpath, sizeof cfgpath, "%s/peakslab/peakterm.conf", x);
	else
		snprintf(cfgpath, sizeof cfgpath, "%s/.config/peakslab/peakterm.conf", getenv("HOME"));
	FILE *f = fopen(cfgpath, "r");
	if(!f)
		return;
	char line[4096];
	while(fgets(line, sizeof line, f)){
		line[strcspn(line, "\n")] = 0;
		char *k = strtok(line, "\t"), *a = strtok(NULL, "\t"), *b, *c;
		if(!k || !a)
			continue;
		if(!strcmp(k, "page"))
			cfg_page = cfg_str(a);
		else if(!strcmp(k, "image"))
			cfg_image = xstrdup(a);
		else if(!strcmp(k, "media"))
			cfg_media = xstrdup(a);
		else if(!strcmp(k, "mark"))
			opt_mark = atoi(a);
		else if(!strcmp(k, "chords"))
			opt_chords = atoi(a);
		else if(!strcmp(k, "collapse"))
			VPUSH(cols, xstrdup(a));
		else if(!strcmp(k, "enable") && (b = strtok(NULL, "\t")) && (c = strtok(NULL, "\t")))
			VPUSH(cfg, ((cfgent){cfg_str(a), xstrdup(b), atoi(c)}));
	}
	fclose(f);
}

static void cfg_save(void){
	for(char *s = strchr(cfgpath + 1, '/'); s; s = strchr(s + 1, '/')){ // mkdir -p
		*s = 0;
		mkdir(cfgpath, 0755);
		*s = '/';
	}
	FILE *f = fopen(cfgpath, "w");
	if(!f)
		return;
	fprintf(f, "# peakterm settings\npage\t%s\nmark\t%d\nchords\t%d\n", cfg_page && *cfg_page ? cfg_page : "/", opt_mark, opt_chords);
	if(cfg_image)
		fprintf(f, "image\t%s\n", cfg_image);
	if(cfg_media)
		fprintf(f, "media\t%s\n", cfg_media);
	for(int i = 0; i < cols.n; ++i)
		fprintf(f, "collapse\t%s\n", cols.v[i]);
	for(cfgent *e = cfg.v; e < cfg.v + cfg.n; ++e)
		fprintf(f, "enable\t%s\t%s\t%d\n", *e->page ? e->page : "/", e->path, e->on);
	fclose(f);
}

// The saved choice for d on this page, or NULL.
static cfgent *cfg_find(dict *d){
	for(cfgent *e = cfg.v; e < cfg.v + cfg.n; ++e)
		if(!strcmp(e->page, page) && !strcmp(e->path, d->path))
			return e;
	return NULL;
}

// After d was enabled, disabled, collapsed or expanded.
static void cfg_set(dict *d){
	int i = 0;
	while(i < cols.n && strcmp(cols.v[i], d->path))
		++i;
	if(d->collapsed && i == cols.n)
		VPUSH(cols, xstrdup(d->path));
	if(!d->collapsed && i < cols.n)
		cols.v[i] = cols.v[--cols.n];
	if(persist){
		cfgent *e = cfg_find(d);
		if(e)
			e->on = d->enabled;
		else
			VPUSH(cfg, ((cfgent){xstrdup(page), xstrdup(d->path), d->enabled}));
	}
	cfg_save();
}

static void add_dict(const char *path, const char *full, const char *desc, int prio, int has_prio, int buflen){
	const char *b = strrchr(path, '/'), *s = strchr(path, '/'), *base = b ? b + 1 : path;
	D = xrealloc(D, (ND + 1) * sizeof *D);
	dict *d = &D[ND++];
	*d = (dict){0};
	d->path = xstrdup(path);
	d->full = xstrdup(full);
	d->name = xstrndup(base, strcspn(base, "."));
	d->desc = norm(desc, strlen(desc)); // (without its links)
	d->lang = s ? xstrndup(path, s - path) : xstrdup("");
	d->cat = s && b > s ? xstrndup(s + 1, b - s - 1) : xstrdup("");
	d->prio = prio;
	d->has_prio = has_prio;
	d->buflen = buflen;
	d->slab = strstr(path, ".slab") != NULL;
	d->zst = strlen(path) > 4 && !strcmp(path + strlen(path) - 4, ".zst");
}

// files.json's "dicts": [[path, timestamp, description, buflen, priority], ...]
static int load_files_json(void){
	char fn[PATH_MAX + 16], str[3][PATH_MAX];
	snprintf(fn, sizeof fn, "%s/files.json", root);
	FILE *f = fopen(fn, "rb");
	if(!f)
		return 0;
	fseek(f, 0, SEEK_END);
	long n = ftell(f);
	fseek(f, 0, SEEK_SET);
	char *b = xrealloc(NULL, n > 0 ? n + 1 : 1);
	int ok = n > 0 && fread(b, 1, n, f) == (size_t)n;
	fclose(f);
	const char *p = NULL;
	if(ok){
		b[n] = 0;
		p = strstr(b, "\"dicts\"");
	}
	if(p)
		p = strchr(p, '[');
	if(!p){
		free(b);
		return 0;
	}
	for(++p; (p += strspn(p, " \t\r\n,")), *p == '['; ++p){ // each [ ... ]
		int nf = 0, num[5] = {0, 0, 0, 0, 1}, hp = 0;
		for(++p; (p += strspn(p, " \t\r\n,")), *p && *p != ']'; ++nf){
			if(*p == '"'){ // fields 0 and 2 are kept
				char *dst = str[nf == 0 ? 0 : nf == 2 ? 1 : 2];
				int o = 0;
				for(++p; *p && *p != '"'; ++p){
					if(*p == '\\' && p[1])
						++p;
					if(o < PATH_MAX - 1)
						dst[o++] = *p;
				}
				dst[o] = 0;
				if(*p)
					++p;
				continue;
			}
			char *e;
			double v = strtod(p, &e);
			if(e == p){
				++p;
				continue;
			}
			if(nf < 5)
				num[nf] = v;
			hp |= nf == 4;
			p = e;
		}
		if(nf > 2){
			snprintf(fn, sizeof fn, "%s/%s", root, str[0]);
			add_dict(str[0], fn, str[1], num[4], hp, num[3]);
		}
	}
	free(b);
	return 1;
}

// The website's order (see build_page).
static int page_cmp(const void *a, const void *b){
	dict *x = &D[*(const int *)a], *y = &D[*(const int *)b];
	int c = y->mc - x->mc;
	if(!c)
		c = strcmp(x->cat, y->cat);
	if(!c)
		c = y->primary - x->primary;
	if(!c)
		c = x->rank - y->rank;
	if(!c)
		c = strcmp(x->lang, y->lang);
	if(!c)
		c = strcmp(x->path, y->path);
	return c;
}

/* The website's choice for a page's URL: files whose path contains every page
 * segment, plus low priority (<= 0) files of other languages in their
 * categories; categories with the most main dictionaries first. The page's
 * enabled dictionaries get loaded, the others unloaded. */
static void build_page(const char *pg){
	char tmp[256], *segs[16];
	int nseg = 0;
	page = xstrdup(pg);
	snprintf(tmp, sizeof tmp, "%s", pg);
	for(char *s = strtok(tmp, "/"); s && nseg < 16; s = strtok(NULL, "/"))
		segs[nseg++] = s;
	for(dict *d = D; d < D + ND; ++d){
		d->primary = 1;
		for(int k = 0; k < nseg; ++k)
			d->primary &= strstr(d->path, segs[k]) != NULL;
		d->rank = !d->has_prio ? 1 : d->prio == -1 ? 0 : d->prio > 0 ? d->prio : 100;
	}
	P = xrealloc(P, (ND + 1) * sizeof *P);
	NP = 0;
	for(dict *d = D; d < D + ND; ++d){
		d->inpage = d->primary;
		for(dict *x = D; !d->inpage && d->has_prio && d->prio <= 0 && x < D + ND; ++x)
			d->inpage = x->primary && !strcmp(x->cat, d->cat);
		d->mc = 0;
		for(dict *x = D; d->inpage && x < D + ND; ++x)
			d->mc += x->primary && x->rank <= 1 && !strcmp(x->cat, d->cat);
		d->want = 0;
		if(d->inpage)
			P[NP++] = d - D;
	}
	qsort(P, NP, sizeof *P, page_cmp);
	for(int i = 0; i < NP; ++i){
		dict *d = &D[P[i]];
		cfgent *e = persist ? cfg_find(d) : NULL;
		d->order = i;
		d->enabled = d->want = e ? e->on : !persist || !d->has_prio || d->prio == 1 || d->prio == -1;
		d->collapsed = 0;
		for(int k = 0; k < cols.n; ++k)
			d->collapsed |= !strcmp(cols.v[k], d->path);
	}
	for(dict *d = D; d < D + ND; ++d)
		if(!d->want)
			unload(d);
}

/* ---------- the terminal interface ---------- */

enum { MAIN, DICTS, PAGES };
static int mode, quit, research, sel, top, popup;
static rset mainrs, pop;
static VEC(uint32_t) qcp; // the search box
static VEC(char *) pages; // the language / section list (F3)
static char curq[QMAX], status[256];
static long long status_until;
static dline *rows[512];  // what's on each screen row of the active view (for clicks)

#define say(...) do{ \
	snprintf(status, sizeof status, __VA_ARGS__); \
	status_until = now_ms() + 4000; \
}while(0)

// The viewer for a .slab file type: images, then audio and video; NULL for xdg-open.
static const char *find_viewer(const char *ext){
	char w[24];
	const char *env;
	snprintf(w, sizeof w, " %s ", ext);
	if(strstr(" jbig2 webp png jpg jpeg gif bmp svg tif tiff avif jxl ", w)){
		env = getenv("PEAKTERM_IMAGE");
		return env && *env ? env : cfg_image;
	}
	if(strstr(" webm opus ogg oga mp3 m4a wav flac mp4 mkv mov c2 codec2 ", w)){
		env = getenv("PEAKTERM_MEDIA");
		return env && *env ? env : cfg_media;
	}
	return NULL;
}

// Opens a .slab entry's file in its viewer (JBIG2 is converted to PNG first).
static void open_entry(entry *e){
	const char *dir = getenv("XDG_RUNTIME_DIR"), *op;
	char ext[16] = "bin", fn[PATH_MAX];
	for(int o = 0; e->ftype[o] && o < 15; ++o){
		ext[o] = tolower((unsigned char)e->ftype[o]);
		ext[o+1] = 0;
	}
	snprintf(fn, sizeof fn, "%s/peakterm-%d-%lld.%s", dir && *dir ? dir : "/tmp", (int)getpid(), now_ms(), ext);
	FILE *f = fopen(fn, "wb");
	if(!f || fwrite(e->body, 1, e->binlen, f) != e->binlen){
		if(f)
			fclose(f);
		say("can't write %s", fn);
		return;
	}
	fclose(f);
	op = find_viewer(ext);
	if(!op || !*op)
		op = "xdg-open";
	if(!fork()){
		int nul = open("/dev/null", O_RDWR);
		setsid();
		if(nul >= 0){
			dup2(nul, 0);
			dup2(nul, 1);
			dup2(nul, 2);
		}
		if(!strcmp(ext, "jbig2"))
			execl("/bin/sh", "sh", "-c", "jbig2dec -t png -o \"$1.png\" \"$1\" && exec $2 \"$1.png\"", "sh", fn, op, (char *)NULL);
		else
			execl("/bin/sh", "sh", "-c", "exec $2 \"$1\"", "sh", fn, op, (char *)NULL);
		_exit(1);
	}
	say("opening %s with %s", fn, op);
}

static int tprint(int x, int y, int maxx, uintattr_t fg, const char *s){
	uint32_t cp;
	while(*s && x < maxx){
		s += u8(s, &cp);
		int w = tb_wcwidth(cp);
		if(w == 0 && x > 0){
			tb_extend_cell(x - 1, y, cp);
		}else if(w > 0 && x + w <= maxx){
			tb_set_cell(x, y, cp, fg, 0);
			x += w;
		}
	}
	return x;
}

static void draw_view(rset *rs, int x0, int y0, int w, int h){
	int line = rs->scroll, gi = 0;
	while(gi < rs->g.n && line >= rs->g.v[gi].l.n)
		line -= rs->g.v[gi++].l.n;
	for(int y = 0; y < h && y < 512; ++y){
		dline *l = gi < rs->g.n ? &rs->g.v[gi].l.v[line] : NULL;
		rows[y] = l;
		if(!l)
			continue;
		for(int i = 0, x = x0; i < l->n && x + l->g[i].w <= x0 + w; x += l->g[i++].w){
			if(l->g[i].w)
				tb_set_cell(x, y0 + y, l->g[i].cp, l->g[i].fg, l->g[i].bg);
			else if(x > x0)
				tb_extend_cell(x - 1, y0 + y, l->g[i].cp);
		}
		if(++line >= rs->g.v[gi].l.n){
			++gi;
			line = 0;
		}
	}
	rows_ok = 1;
}

// Where the popup box goes.
static int pop_x(void){
	return tb_width() > 40 ? 3 : 0;
}

static int pop_y(void){
	return tb_height() > 12 ? 2 : 1;
}

static int page_count(const char *p){
	int n = 0, l = strlen(p);
	for(dict *d = D; d < D + ND; ++d)
		n += !l || (!strncmp(d->path, p, l) && d->path[l] == '/');
	return n;
}

// The dictionary list (F2) or the language / section list (F3).
static void draw_list(int W, int H, char *t, size_t tn){
	int n = mode == DICTS ? NP : pages.n;
	tprint(0, 0, W, TB_GREEN | TB_BOLD, mode == DICTS ? " Dictionaries" : " Languages and sections");
	if(sel < top)
		top = sel;
	if(sel >= top + H - 2)
		top = sel - H + 3;
	for(int r = 0; r < H - 2 && top + r < n; ++r){
		uintattr_t a = top + r == sel ? TB_REVERSE : 0;
		for(int x = 0; x < W; ++x)
			tb_set_cell(x, r + 1, ' ', a, 0);
		if(mode == DICTS){
			dict *d = &D[P[top + r]];
			const char *state = d->failed ? "failed" : d->want && !d->ready ? "loading" : "";
			snprintf(t, tn, " [%c] %-20.20s %s %-8s ", d->enabled ? 'x' : ' ', d->name, d->collapsed ? "\xe2\x8a\x9f" : " ", state);
			int x = tprint(0, r + 1, W, (d->enabled ? TB_BOLD : 0) | (d->failed ? TB_RED : 0) | a, t);
			tprint(x, r + 1, W, TB_DIM | a, d->desc);
		}else{
			const char *p = pages.v[top + r], *leaf = strrchr(p, '/');
			int depth = 0;
			for(const char *c = p; *c; ++c)
				depth += *c == '/';
			snprintf(t, tn, " %*s%s", depth * 2, "", *p ? (leaf ? leaf + 1 : p) : "everything");
			tprint(0, r + 1, W, (strcmp(p, page) ? 0 : TB_GREEN) | (depth ? 0 : TB_BOLD) | a, t);
			snprintf(t, tn, "%d ", page_count(p));
			tprint(W - strlen(t), r + 1, W, TB_DIM | a, t);
		}
	}
	tb_hide_cursor();
	if(mode == DICTS)
		snprintf(t, tn, " Space toggle  c collapse  a all  n none  Esc back");
	else
		snprintf(t, tn, " Enter choose  Esc back");
}

static void draw_popup(int W, int H, char *t, size_t tn){
	int x0 = pop_x(), y0 = pop_y(), w = W - 2 * x0, h = H - 2 * y0;
	for(int y = y0; y < y0 + h; ++y){
		for(int x = x0; x < x0 + w; ++x){
			uint32_t c = ' ';
			if(y == y0 || y == y0 + h - 1)
				c = 0x2500;
			else if(x == x0 || x == x0 + w - 1)
				c = 0x2502;
			tb_set_cell(x, y, c, TB_GREEN, 0);
		}
	}
	snprintf(t, tn, " %s \xc2\xb7 %d ", pop.q, pop.nent);
	tprint(x0 + 2, y0, x0 + w - 2, TB_BOLD, t);
	draw_view(&pop, x0 + 1, y0 + 1, w - 2, h - 2);
}

static const char *help[] = {
	"Type to search the enabled dictionaries.   Globs: a*b  both   !x  without   ^a  starting with",
	"",
	"  click a word or link      look it up              click a dictionary name   collapse / expand it",
	"  Up Down PgUp PgDn, wheel  scroll                  Ctrl-T  Ctrl-O            highlighting, chords",
	"  F2 or Ctrl-S              choose dictionaries     F3 or Ctrl-G              choose language / section",
	"  Ctrl-U  Ctrl-W            clear, delete a word    Esc                       clear the search, or quit",
	NULL,
};

static void draw(void){
	int W = tb_width(), H = tb_height(), ready = 0, loading = 0, enabled = 0;
	char t[QMAX + 64];
	tb_clear();
	for(int i = 0; i < NP; ++i){
		dict *d = &D[P[i]];
		enabled += d->enabled;
		ready += d->enabled && d->ready;
		loading += d->enabled && !d->ready && !d->failed;
	}
	if(mode != MAIN){
		draw_list(W, H, t, sizeof t);
	}else{
		snprintf(t, sizeof t, " %s \xe2\x9d\xaf ", *page ? page : "peak");
		int x = tprint(0, 0, W, TB_GREEN | TB_BOLD, t);
		for(int i = 0; i < qcp.n; ++i){
			char u[8] = {0};
			tb_utf8_unicode_to_char(u, qcp.v[i]);
			x = tprint(x, 0, W, TB_BOLD, u);
		}
		tb_set_cursor(x < W ? x : W - 1, 0);
		if(mainrs.q[0]){
			if(mainrs.nent || !mainrs.done)
				snprintf(t, sizeof t, "%d%s ", mainrs.nent, mainrs.done ? "" : "+");
			else
				snprintf(t, sizeof t, "no matches ");
			tprint(W - strlen(t), 0, W, mainrs.nent ? TB_DIM : TB_RED, t);
			draw_view(&mainrs, 0, 1, W, H - 2);
		}else{
			for(int i = 0; help[i] && i + 2 < H - 1; ++i)
				tprint(1, i + 2, W, i ? 0 : TB_BOLD, help[i]);
		}
		if(popup){
			draw_popup(W, H, t, sizeof t);
			snprintf(t, sizeof t, " Esc close  click a word to look it up");
		}else{
			snprintf(t, sizeof t, " F2 dictionaries  F3 language  Ctrl-C quit");
		}
	}
	if(status[0] && now_ms() < status_until)
		snprintf(t, sizeof t, " %s", status);
	tprint(0, H - 1, W, TB_DIM, t);
	snprintf(t, sizeof t, loading ? " loading %d/%d " : " %d/%d dictionaries ", ready, enabled);
	tprint(W - strlen(t), H - 1, W, TB_DIM, t);
	tb_present();
}

static void clamp(rset *rs, int h){
	ensure(rs, rs->scroll + 2 * h);
	if(rs->done && rs->scroll > rs->total - h)
		rs->scroll = rs->total - h;
	if(rs->scroll < 0)
		rs->scroll = 0;
}

static void lookup(const char *word){
	char *q = norm(word, strlen(word));
	if(*q){
		pop.width = tb_width() - 2 * pop_x() - 3;
		search_start(&pop, q, 1);
		if(!pop.nent)
			say("nothing found for \"%s\"", word);
		popup = pop.nent > 0;
	}
	rows_ok = 0;
	free(q);
}

static int wordch(uint32_t c){
	if(c <= ' ' || c == 0xa0 || c == 0xab || c == 0xbb || c == 0xb7 || c == 0x17d4 || c == 0x17d5)
		return 0;
	if(c < 128 && strchr(".,;:!?()[]{}\"'<>/\\|=*+#~`", c))
		return 0;
	return !(c >= 0x2010 && c <= 0x2027) && !(c >= 0x2500 && c <= 0x259f); // punctuation, box drawing
}

static void toggle_collapsed(dict *d){
	d->collapsed = !d->collapsed;
	cfg_set(d);
	dirty_all(&mainrs);
	dirty_all(&pop);
}

// A click on a link, a dictionary name, media, or a word to look up.
static void click(rset *rs, int x0, int r, int x){
	dline *l = rows_ok && r >= 0 && r < 512 ? rows[r] : NULL;
	int hit = -1, o = 0;
	char t[QMAX];
	for(int i = 0, cx = x0; l && i < l->n && hit < 0; cx += l->g[i++].w)
		if(l->g[i].w && x >= cx && x < cx + l->g[i].w)
			hit = i;
	if(hit < 0)
		return;
	uint32_t act = l->g[hit].act, k = AVAL(act), gi = k >> 12, ei = k & 0xfff;
	if(AKIND(act) == A_DICT){
		toggle_collapsed(&D[k]);
		return;
	}
	if(AKIND(act) == A_OPEN){
		if(gi < (uint32_t)rs->g.n && ei < (uint32_t)rs->g.v[gi].e.n)
			open_entry(&rs->g.v[gi].e.v[ei]);
		return;
	}
	if(act){ // a link: every glyph with its action (it may wrap over lines)
		for(group *g = rs->g.v; g < rs->g.v + rs->g.n; ++g)
			for(int ln = 0; ln < g->l.n; ++ln)
				for(int i = 0; i < g->l.v[ln].n; ++i)
					if(g->l.v[ln].g[i].act == act && o + 5 < QMAX)
						o += tb_utf8_unicode_to_char(t + o, g->l.v[ln].g[i].cp);
	}else if(wordch(l->g[hit].cp)){ // the word around it
		int a = hit, b = hit;
		while(a > 0 && (wordch(l->g[a-1].cp) || !l->g[a].w))
			--a;
		while(b + 1 < l->n && (wordch(l->g[b+1].cp) || !l->g[b+1].w))
			++b;
		for(int i = a; i <= b && o + 5 < QMAX; ++i)
			o += tb_utf8_unicode_to_char(t + o, l->g[i].cp);
	}
	t[o] = 0;
	lookup(t);
}

static void set_enabled(dict *d, int on){
	d->enabled = d->want = on;
	d->failed = 0;
	if(!on)
		unload(d);
	cfg_set(d);
	research = 1;
}

// F3: every folder that holds dictionaries ("" is everything).
static void open_pages(void){
	pages.n = 0;
	VPUSH(pages, "");
	for(dict *d = D; d < D + ND; ++d){
		for(const char *s = strchr(d->path, '/'); s; s = strchr(s + 1, '/')){
			int k = 0, l = s - d->path;
			while(k < pages.n && (strncmp(pages.v[k], d->path, l) || pages.v[k][l]))
				++k;
			if(k == pages.n)
				VPUSH(pages, xstrndup(d->path, l));
		}
	}
	for(int i = 2; i < pages.n; ++i){ // sort, after "everything"
		for(int k = i; k > 1 && strcmp(pages.v[k-1], pages.v[k]) > 0; --k){
			char *t = pages.v[k];
			pages.v[k] = pages.v[k-1];
			pages.v[k-1] = t;
		}
	}
	sel = top = 0;
	for(int i = 0; i < pages.n; ++i)
		if(!strcmp(pages.v[i], page))
			sel = i;
	mode = PAGES;
}

static void choose_page(const char *p){
	popup = 0;
	rs_free(&mainrs);
	rs_free(&pop);
	build_page(p);
	free(cfg_page);
	cfg_page = xstrdup(page);
	cfg_save();
	mode = MAIN;
	research = 1;
}

// Keys in the dictionary list and the language / section list.
static void key_list(int k, uint32_t ch, int h){
	int n = mode == DICTS ? NP : pages.n;
	if(k == TB_KEY_ARROW_UP || ch == 'k')
		sel -= sel > 0;
	else if(k == TB_KEY_ARROW_DOWN || ch == 'j')
		sel += sel + 1 < n;
	else if(k == TB_KEY_PGUP)
		sel = sel > h ? sel - h : 0;
	else if(k == TB_KEY_PGDN)
		sel = sel + h < n ? sel + h : n - 1;
	else if(k == TB_KEY_ESC || k == TB_KEY_F2 || k == TB_KEY_F3 || k == TB_KEY_CTRL_S || k == TB_KEY_CTRL_G || ch == 'q')
		mode = MAIN;
	else if(mode == PAGES && k == TB_KEY_ENTER && sel < pages.n)
		choose_page(pages.v[sel]);
	else if(mode == DICTS && NP && (ch == ' ' || k == TB_KEY_ENTER))
		set_enabled(&D[P[sel]], !D[P[sel]].enabled);
	else if(mode == DICTS && NP && ch == 'c')
		toggle_collapsed(&D[P[sel]]);
	else if(mode == DICTS && (ch == 'a' || ch == 'n'))
		for(int i = 0; i < NP; ++i)
			set_enabled(&D[P[i]], ch == 'a');
}

static void key(struct tb_event *ev){
	rset *rs = popup ? &pop : &mainrs;
	int k = ev->key, h = popup ? tb_height() - 2 * pop_y() - 2 : tb_height() - 2;
	int backspace = k == TB_KEY_BACKSPACE || k == TB_KEY_BACKSPACE2;
	uint32_t ch = ev->ch ? ev->ch : k == TB_KEY_SPACE ? ' ' : 0;
	if(k == TB_KEY_CTRL_C || k == TB_KEY_CTRL_Q){
		quit = 1;
	}else if(mode != MAIN){
		key_list(k, ch, h);
	}else if(k == TB_KEY_ARROW_UP){
		rs->scroll--;
	}else if(k == TB_KEY_ARROW_DOWN){
		rs->scroll++;
	}else if(k == TB_KEY_PGUP){
		rs->scroll -= h - 1;
	}else if(k == TB_KEY_PGDN){
		rs->scroll += h - 1;
	}else if(k == TB_KEY_F2 || k == TB_KEY_CTRL_S){
		popup = 0;
		mode = DICTS;
		sel = top = 0;
	}else if(k == TB_KEY_F3 || k == TB_KEY_CTRL_G){
		popup = 0;
		if(root[0])
			open_pages();
		else
			say("no files.json: the dictionaries came from the command line");
	}else if(k == TB_KEY_CTRL_T || k == TB_KEY_CTRL_O){
		if(k == TB_KEY_CTRL_T)
			opt_mark = !opt_mark;
		else
			opt_chords = !opt_chords;
		cfg_save();
		dirty_all(&mainrs);
		dirty_all(&pop);
	}else if(popup && (k == TB_KEY_ESC || backspace)){
		popup = 0;
	}else if(k == TB_KEY_ESC){
		if(qcp.n)
			qcp.n = 0;
		else
			quit = 1;
	}else if(backspace){
		if(qcp.n)
			qcp.n--;
	}else if(k == TB_KEY_CTRL_U){
		qcp.n = 0;
	}else if(k == TB_KEY_CTRL_W){
		while(qcp.n && qcp.v[qcp.n-1] == ' ')
			--qcp.n;
		while(qcp.n && qcp.v[qcp.n-1] != ' ')
			--qcp.n;
	}else if(ch && !(ev->mod & TB_MOD_ALT) && qcp.n < QMAX / 4){
		popup = 0; // typing goes back to the search
		VPUSH(qcp, ch);
	}
	if(mode != MAIN || popup != (rs == &pop))
		rows_ok = 0;
}

static void mouse(struct tb_event *ev){
	int x0 = pop_x(), y0 = pop_y(), wheel = 0;
	if(mode != MAIN)
		return;
	if(ev->key == TB_KEY_MOUSE_WHEEL_UP)
		wheel = -3;
	else if(ev->key == TB_KEY_MOUSE_WHEEL_DOWN)
		wheel = 3;
	if(wheel){
		(popup ? &pop : &mainrs)->scroll += wheel;
		return;
	}
	if(ev->key != TB_KEY_MOUSE_LEFT || (ev->mod & TB_MOD_MOTION))
		return;
	if(!popup)
		click(&mainrs, 0, ev->y - 1, ev->x);
	else if(ev->x < x0 || ev->x >= tb_width() - x0 || ev->y < y0 || ev->y >= tb_height() - y0)
		popup = rows_ok = 0; // a click outside the popup closes it
	else
		click(&pop, x0 + 1, ev->y - y0 - 1, ev->x);
}

static void tui(void){
	int ttyfd = -1, rszfd = -1;
	if(tb_init())
		die("can't open the terminal");
	tb_set_input_mode(TB_INPUT_ESC | TB_INPUT_MOUSE);
	tb_get_fds(&ttyfd, &rszfd);
	while(!quit){
		char raw[QMAX];
		int o = 0, loading = 0, W = tb_width();
		for(int i = 0; i < qcp.n && o + 5 < QMAX; ++i)
			o += tb_utf8_unicode_to_char(raw + o, qcp.v[i]);
		char *q = norm(raw, o);
		if(research || strcmp(q, curq)){ // a new search (or the same again when the dictionaries changed)
			int scroll = strcmp(q, curq) ? 0 : mainrs.scroll;
			snprintf(curq, sizeof curq, "%s", q);
			if(*q)
				search_start(&mainrs, q, 0);
			else
				rs_free(&mainrs);
			mainrs.scroll = scroll;
			research = 0;
		}
		free(q);

		if(mainrs.width != W - 1){ // the layout follows the terminal's size
			mainrs.width = W - 1;
			dirty_all(&mainrs);
		}
		if(pop.width != W - 2 * pop_x() - 3){
			pop.width = W - 2 * pop_x() - 3;
			dirty_all(&pop);
		}
		if(mainrs.q[0])
			clamp(&mainrs, tb_height() - 2);
		if(popup)
			clamp(&pop, tb_height() - 2 * pop_y() - 2);
		draw();

		for(dict *d = D; d < D + ND; ++d)
			loading |= d->want && !d->ready && !d->failed;
		int timeout = -1;
		if(loading)
			timeout = 0;
		else if(status[0] && now_ms() < status_until)
			timeout = status_until - now_ms() + 10;
		struct pollfd pf[2] = {{ttyfd, POLLIN, 0}, {rszfd, POLLIN, 0}};
		poll(pf, 2, timeout);
		struct tb_event ev;
		while(!quit && tb_peek_event(&ev, 0) == TB_OK){
			if(ev.type == TB_EVENT_KEY)
				key(&ev);
			else if(ev.type == TB_EVENT_MOUSE)
				mouse(&ev);
		}
		if(load_one())
			research = 1; // between keystrokes; then search again, like the website
		if(status[0] && now_ms() >= status_until)
			status[0] = 0;
	}
	tb_shutdown();
}

static void usage(void){
	die("usage: peakterm [-r root] [-a] [-q query [-n groups] [-w width]] [page | files...]");
}

// files.json is in -r, $PEAKSLAB_ROOT, peakterm's folder, or here.
static int find_root(const char *ropt){
	char exe[PATH_MAX] = "", fn[PATH_MAX + 16];
	ssize_t n = readlink("/proc/self/exe", exe, sizeof exe - 1);
	if(n > 0){
		exe[n] = 0;
		*strrchr(exe, '/') = 0;
	}
	const char *cands[] = {ropt, getenv("PEAKSLAB_ROOT"), exe, "."};
	for(int i = 0; i < 4; ++i){
		if(!cands[i] || !*cands[i])
			continue;
		snprintf(fn, sizeof fn, "%s/files.json", cands[i]);
		if(!access(fn, R_OK)){
			snprintf(root, sizeof root, "%s", cands[i]);
			return 1;
		}
		if(ropt)
			return 0;
	}
	return 0;
}

// -q: loads the page, prints the first headwords as plain text.
static int print_results(const char *query, int maxg, int width){
	struct winsize ws;
	while(load_one())
		;
	for(int i = 0; i < NP; ++i)
		if(D[P[i]].failed)
			fprintf(stderr, "peakterm: can't load %s\n", D[P[i]].path);
	rset rs = {.width = width};
	if(!width)
		rs.width = !ioctl(1, TIOCGWINSZ, &ws) && ws.ws_col ? ws.ws_col : 80;
	char *q = norm(query, strlen(query));
	search_start(&rs, q, 0);
	free(q);
	while(rs.g.n <= maxg && fetch_one(&rs) >= 0)
		;
	for(int gi = 0; gi < rs.g.n && gi < maxg; ++gi){
		layout_group(&rs, gi);
		group *g = &rs.g.v[gi];
		for(dline *l = g->l.v; l < g->l.v + g->l.n; ++l){
			for(int i = 0; i < l->n; ++i){
				char u[8];
				fwrite(u, 1, tb_utf8_unicode_to_char(u, l->g[i].cp), stdout);
			}
			putchar('\n');
		}
	}
	return rs.g.n ? 0 : 1;
}

int main(int argc, char **argv){
	const char *ropt = NULL, *query = NULL, *pg = NULL;
	int maxg = 10, width = 0, files = 0;
	struct stat st;

	signal(SIGCHLD, SIG_IGN); // media viewers are reaped automatically
	cfg_load();
	for(int i = 1; i < argc; ++i){
		const char *a = argv[i];
		if(a[0] == '-' && a[1] && strchr("rqnw", a[1]) && !a[2]){
			if(i + 1 >= argc)
				usage();
			const char *v = argv[++i];
			if(a[1] == 'r')
				ropt = v;
			else if(a[1] == 'q')
				query = v;
			else if(a[1] == 'n')
				maxg = atoi(v);
			else
				width = atoi(v);
		}else if(!strcmp(a, "-a")){
			persist = 0; // every dictionary, without saving choices
		}else if(a[0] == '-'){
			usage();
		}else if(!stat(a, &st) && S_ISREG(st.st_mode)){
			add_dict(a, a, "", 1, 0, 1 << 22);
			files = 1;
			persist = 0;
		}else{
			pg = a;
		}
	}
	if(!files && (!find_root(ropt) || !load_files_json()))
		die("can't read files.json (use -r or set PEAKSLAB_ROOT)");

	char *p = xstrdup(pg ? pg + strspn(pg, "/") : cfg_page && !files ? cfg_page : "");
	for(size_t l = strlen(p); l && p[l-1] == '/'; )
		p[--l] = 0;
	build_page(p);
	free(p);
	if(!NP)
		die("no dictionaries for that page");
	if(pg && !files && !query){
		free(cfg_page);
		cfg_page = xstrdup(page);
		cfg_save();
	}
	if(query)
		return print_results(query, maxg, width);
	tui();
	return 0;
}
