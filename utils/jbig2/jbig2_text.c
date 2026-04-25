/* Copyright (C) 2001-2023 Artifex Software, Inc.
   All Rights Reserved.

   This software is provided AS-IS with no warranty, either express or
   implied.

   This software is distributed under license and may not be copied,
   modified or distributed except as expressly authorized under the terms
   of the license contained in the file LICENSE in this distribution.

   Refer to licensing information at http://www.artifex.com or contact
   Artifex Software, Inc.,  39 Mesa Street, Suite 108A, San Francisco,
   CA 94129, USA, for further information.
*/

/*
    jbig2dec
*/

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif
#include "os_types.h"

#include <stddef.h>
#include <string.h>             /* memset() */

#include "jbig2.h"
#include "jbig2_priv.h"
#include "jbig2_arith.h"
#include "jbig2_arith_int.h"
#include "jbig2_arith_iaid.h"
#include "jbig2_generic.h"
#include "jbig2_huffman.h"
#include "jbig2_image.h"
#include "jbig2_page.h"
//#include "jbig2_refinement.h"
#include "jbig2_segment.h"
#include "jbig2_symbol_dict.h"
#include "jbig2_text.h"

/**
 * jbig2_decode_text_region: decode a text region segment
 *
 * @ctx: jbig2 decoder context
 * @segment: jbig2 segment (header) structure
 * @params: parameters from the text region header
 * @dicts: an array of referenced symbol dictionaries
 * @n_dicts: the number of referenced symbol dictionaries
 * @image: image structure in which to store the decoded region bitmap
 * @data: pointer to text region data to be decoded
 * @size: length of text region data
 *
 * Implements the text region decoding procedure
 * described in section 6.4 of the JBIG2 spec.
 *
 * returns: 0 on success
 **/
int
jbig2_decode_text_region(Jbig2Ctx *ctx, Jbig2Segment *segment,
                         const Jbig2TextRegionParams *params,
                         const Jbig2SymbolDict *const *dicts, const uint32_t n_dicts,
                         Jbig2Image *image, const byte *data, const size_t size, Jbig2ArithCx *GR_stats, Jbig2ArithState *as, Jbig2WordStream *ws)
{
	return 0;
}

/**
 * jbig2_text_region: read a text region segment header
 **/
int
jbig2_text_region(Jbig2Ctx *ctx, Jbig2Segment *segment, const byte *segment_data)
{
		return 0;
}
