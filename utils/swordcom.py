"""Read a SWORD zCom / zCom4 commentary (CrossWire's compressed modules) in KJV
versification: entries() yields (book code, chapter, verse, raw text, where
the text is: verses linked to one entry share it); chapter 0 is the book's
introduction, verse 0 a chapter's.

The verse counts come from a peakslab KJV (.tsv): "gen 1.1<TAB>..." keys.
"""
import os, re, struct, zlib

def kjv(path):
	"""[(book code, [verses in chapter 1, 2, ...])] in Bible order"""
	books = {}
	for line in open(path, encoding='utf-8'):
		m = re.match(r'(\S+) (\d+)\.(\d+)\t', line)
		if m:
			ch = books.setdefault(m[1], {})
			ch[int(m[2])] = max(ch.get(int(m[2]), 0), int(m[3]))
	return [(b, [c[i] for i in sorted(c)]) for b, c in books.items()]

def entries(moddir, kjvtsv):
	books = kjv(kjvtsv)
	for testament, bks in (('ot', books[:39]), ('nt', books[39:])):
		bzs = open(os.path.join(moddir, testament + '.bzs'), 'rb').read()
		bzv = open(os.path.join(moddir, testament + '.bzv'), 'rb').read()
		bzz = open(os.path.join(moddir, testament + '.bzz'), 'rb').read()
		blocks = [struct.unpack_from('<III', bzs, i) for i in range(0, len(bzs), 12)]
		# zCom: block, offset, u16 size (10 bytes); zCom4: u32 size (12)
		n = 2 + sum(1 + len(ch) + sum(ch) for _, ch in bks)
		size = len(bzv) // n
		fmt = '<IIH' if size == 10 else '<III'
		cache = {}
		def text(i):
			b, off, ln = struct.unpack_from(fmt, bzv, i * size)
			if ln == 0 or b >= len(blocks):
				return ''
			if b not in cache:
				o, cs, _ = blocks[b]
				cache.clear()
				cache[b] = zlib.decompress(bzz[o:o + cs])
			return cache[b][off:off + ln].decode('utf-8', 'replace')
		def loc(i):
			"""Where its text is: verses linked to one entry share it"""
			return struct.unpack_from(fmt, bzv, i * size)[:2]
		i = 2
		for code, chs in bks:
			yield code, 0, 0, text(i), loc(i); i += 1
			for c, nv in enumerate(chs, 1):
				yield code, c, 0, text(i), loc(i); i += 1
				for v in range(1, nv + 1):
					yield code, c, v, text(i), loc(i); i += 1
