/*---------------------------------------------------------------------------*\

  FILE........: generate_codebook.c
  AUTHOR......: Bruce Perens
  DATE CREATED: 29 Sep 2010

  Generate header files containing quantisers, runs at compile time.

\*---------------------------------------------------------------------------*/

/*
  All rights reserved.

  This program is free software; you can redistribute it and/or modify
  it under the terms of the GNU Lesser General Public License version 2.1, as
  published by the Free Software Foundation.  This program is
  distributed in the hope that it will be useful, but WITHOUT ANY
  WARRANTY; without even the implied warranty of MERCHANTABILITY or
  FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public
  License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with this program; if not, see <http://www.gnu.org/licenses/>.
*/

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static const char usage[] =
    "Usage: %s filename array_name [filename ...]\n"
    "\tCreate C code for codebook tables.\n";

static const char format[] =
    "The table format must be:\n"
    "\tTwo integers describing the dimensions of the codebook.\n"
    "\tThen, enough numbers to fill the specified dimensions.\n";

static const char header[] =
    "/* THIS IS A GENERATED FILE. Edit generate_codebook.c and its input */\n\n"
    "/*\n"
    " * This intermediary file and the files that used to create it are under "
    "\n"
    " * The LGPL. See the file COPYING.\n"
    " */\n\n"
    "#include <stdint.h>\n"
    "#include \"defines.h\"\n\n";

struct codebook {
  unsigned int k;
  unsigned int log2m;
  unsigned int m;
  float *cb;
  float scale;  /* 32767 / max_abs, rounded down to power of 2 */
};

/* Compute scale: largest power of 2 such that scale * max_abs <= 32767 */
static float compute_scale(const struct codebook *b) {
  int limit = b->k * b->m;
  int i;
  float max_abs = 0.0f;
  float scale;

  for (i = 0; i < limit; i++) {
    float a = fabsf(b->cb[i]);
    if (a > max_abs) max_abs = a;
  }

  /* start at 2^14 and halve until it fits */
  scale = 16384.0f;
  while (scale > 1.0f && scale * max_abs > 32767.0f)
    scale *= 0.5f;

  return scale;
}

static void dump_array(const struct codebook *b, int index) {
  int limit = b->k * b->m;
  int i;

  printf("static const int16_t codes%d[] = {\n", index);
  for (i = 0; i < limit; i++) {
    int v = (int)roundf(b->cb[i] * b->scale);
    /* clamp — should never trigger if compute_scale is correct */
    if (v >  32767) v =  32767;
    if (v < -32768) v = -32768;
    printf("  %d", v);
    if (i < limit - 1) printf(",");

    /* organise VQs by rows, looks prettier */
    if (((i + 1) % b->k) == 0) printf("\n");
  }
  printf("};\n");
}

static void dump_structure(const struct codebook *b, int index) {
  printf("  {\n");
  printf("    %d,\n", b->k);
  printf("    %d,\n", (int)roundf(log(b->m) / log(2)));
  printf("    %d,\n", b->m);
  printf("    %.1ff,\n", b->scale);
  printf("    codes%d\n", index);
  printf("  }");
}

float get_float(FILE *in, const char *name, char **cursor, char *buffer,
                int size) {
  for (;;) {
    char *s = *cursor;
    char c;

    while ((c = *s) != '\0' && !isdigit(c) && c != '-' && c != '.') s++;

    /* Comments start with "#" and continue to the end of the line. */
    if (c != '\0' && c != '#') {
      char *end = 0;
      float f = 0;

      f = strtod(s, &end);

      if (end != s) *cursor = end;
      return f;
    }

    if (fgets(buffer, size, in) == NULL) {
      fprintf(stderr, "%s: Format error. %s\n", name, format);
      exit(1);
    }
    *cursor = buffer;
  }
}

static struct codebook *load(FILE *file, const char *name) {
  char line[1024];
  char *cursor = line;
  struct codebook *b = malloc(sizeof(struct codebook));
  int i;
  int size;

  *cursor = '\0';

  b->k = (int)get_float(file, name, &cursor, line, sizeof(line));
  b->m = (int)get_float(file, name, &cursor, line, sizeof(line));
  size = b->k * b->m;

  b->cb = (float *)malloc(size * sizeof(float));

  for (i = 0; i < size; i++)
    b->cb[i] = get_float(file, name, &cursor, line, sizeof(line));

  return b;
}

int main(int argc, char **argv) {
  struct codebook **cb = malloc(argc * sizeof(struct codebook *));
  int i;

  if (argc < 2) {
    fprintf(stderr, usage, argv[0]);
    fprintf(stderr, format);
    exit(1);
  }

  for (i = 0; i < argc - 2; i++) {
    FILE *in = fopen(argv[i + 2], "r");

    if (in == NULL) {
      perror(argv[i + 2]);
      exit(1);
    }

    cb[i] = load(in, argv[i + 2]);
    cb[i]->scale = compute_scale(cb[i]);

    fclose(in);
  }

  printf(header);
  for (i = 0; i < argc - 2; i++) {
    printf("  /* %s */\n", argv[i + 2]);
    dump_array(cb[i], i);
  }
  printf("\nconst struct lsp_codebook %s[] = {\n", argv[1]);
  for (i = 0; i < argc - 2; i++) {
    printf("  /* %s */\n", argv[i + 2]);
    dump_structure(cb[i], i);
    printf(",\n");
  }
  printf("  { 0, 0, 0, 0.0f, 0 }\n");
  printf("};\n");
  for (i = 0; i < argc - 2; i++) {
    free(cb[i]->cb);
    free(cb[i]);
  }
  free(cb);
  return 0;
}
