#!/usr/bin/env python3
"""
Print the first few values and stats for each float array separately,
so we can see which array has the wild range.
"""
import re, sys

path = sys.argv[1]
with open(path) as f:
    src = f.read()

# Find each named array
arrays = re.findall(
    r'(?:static\s+)?(?:const\s+)?float\s+(\w+)\[\]\s*=\s*\{([^}]+)\}',
    src, re.DOTALL
)

for name, body in arrays:
    vals = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:e[+-]?\d+)?', body)]
    if not vals:
        continue
    print(f"\nArray: {name}")
    print(f"  Count : {len(vals)}")
    print(f"  Min   : {min(vals):.4f}")
    print(f"  Max   : {max(vals):.4f}")
    print(f"  First5: {vals[:5]}")
    print(f"  Last5 : {vals[-5:]}")
