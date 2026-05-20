#!/usr/bin/env python3
"""
quantize_cb.py - Convert newamp1vq_cb float arrays to int16_t for smaller wasm.

Uses per-array scaling:
  codes0 (absolute log spectral, -35..+56 dB): scale = 512
  codes1 (residual, -15.5..+13.9 dB):          scale = 2048

The scale constants are emitted as #defines so newamp1.c can dequantize:
  NEWAMP1_VQ_SCALE_0  512.0f
  NEWAMP1_VQ_SCALE_1  2048.0f

Usage:
    python3 quantize_cb.py codebooknewamp1.c
"""

import re
import sys

print("Hello\n")

# Per-array scales. Keys match the array names in the generated file.
# Chosen as powers of 2 just below 32767 / max_abs_value.
SCALES = {
    'codes0': 512.0,   # max_abs=55.73, 32767/512=64.0  > 55.73 ok
    'codes1': 2048.0,  # max_abs=15.49, 32767/2048=16.0 > 15.49 ok
}
DEFAULT_SCALE = 512.0  # fallback if a new array name appears

def find_arrays(src):
    results = []
    pattern = re.compile(
        r'(?:static\s+)?(?:const\s+)?float\s+(\w+)\[\]\s*=\s*\{([^}]+)\}',
        re.DOTALL
    )
    for m in pattern.finditer(src):
        name = m.group(1)
        body = m.group(2)
        # Only grab values with a decimal point to avoid stray ints from struct lines
        vals = [float(x) for x in re.findall(r'-?\d+\.\d+(?:e[+-]?\d+)?', body)]
        results.append((name, m.start(), m.end(), vals))
    return results

def check_scale(name, vals, scale):
    max_abs = max(abs(v) for v in vals)
    max_rep = 32767.0 / scale
    print(f"  [{name}] count={len(vals)}, range=[{min(vals):.4f}, {max(vals):.4f}]")
    print(f"           scale={scale:.0f}, max_representable=+-{max_rep:.4f}", end="")
    if max_abs > max_rep:
        print(f"  *** OVERFLOW: max_abs={max_abs:.4f} ***")
        return False
    else:
        print(f"  headroom={max_rep - max_abs:.4f} ok")
        return True

def quantize_file(path):
    with open(path) as f:
        src = f.read()

    if 'newamp1vq_cb' not in src:
        print(f"ERROR: {path} doesn't look like a newamp1vq codebook.")
        sys.exit(1)

    arrays = find_arrays(src)
    if not arrays:
        print("ERROR: no float arrays found.")
        sys.exit(1)

    print(f"Found {len(arrays)} float array(s) in {path}:")
    all_ok = True
    for name, _, _, vals in arrays:
        scale = SCALES.get(name, DEFAULT_SCALE)
        ok = check_scale(name, vals, scale)
        all_ok = all_ok and ok

    if not all_ok:
        print("\nAborting due to overflow. Adjust SCALES in this script.")
        sys.exit(1)

    # Replace arrays back-to-front to preserve string offsets
    out = src
    for name, start, end, vals in reversed(arrays):
        scale = SCALES.get(name, DEFAULT_SCALE)
        int16s = [max(-32768, min(32767, int(round(v * scale)))) for v in vals]
        rows = []
        for i in range(0, len(int16s), 10):
            rows.append('    ' + ', '.join(str(v) for v in int16s[i:i+10]))
        body = ',\n'.join(rows)
        replacement = f'static const int16_t {name}[] = {{\n{body}\n}}'
        out = out[:start] + replacement + out[end:]

    if '#include <stdint.h>' not in out:
        out = '#include <stdint.h>\n' + out

    scale_defines = '\n'
    for name, scale in SCALES.items():
        suffix = name[-1].upper()
        scale_defines += f'#define NEWAMP1_VQ_SCALE_{suffix} {scale:.1f}f\n'
    scale_defines += '\n'
    last_inc = max(m.end() for m in re.finditer(r'#include[^\n]*\n', out))
    out = out[:last_inc] + scale_defines + out[last_inc:]

    with open(path, 'w') as f:
        f.write(out)

    total_vals = sum(len(v) for _, _, _, v in arrays)
    print(f"\nWrote {path}")
    print(f"  float size was : {total_vals * 4} bytes")
    print(f"  int16 size now : {total_vals * 2} bytes")
    print()
    print("Manual changes still required:")
    print()
    print("1. quantise.h -- change cb field in struct codebook:")
    print("     const float   *cb;   // remove this")
    print("     const int16_t *cb;   // add this (also add #include <stdint.h>)")
    print()
    print("2. newamp1.c -- dequantize every access to newamp1vq_cb[stage].cb[...]")
    print("   Add this scale table near the top of the file:")
    print()
    print("     static const float newamp1_vq_scales[] = {")
    print("         NEWAMP1_VQ_SCALE_0,  // codes0: 512.0")
    print("         NEWAMP1_VQ_SCALE_1   // codes1: 2048.0")
    print("     };")
    print()
    print("   Then change each lookup from:")
    print("     float v = newamp1vq_cb[stage].cb[i];")
    print("   to:")
    print("     float v = newamp1vq_cb[stage].cb[i] / newamp1_vq_scales[stage];")
