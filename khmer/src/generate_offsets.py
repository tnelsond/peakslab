#!/usr/bin/python
import struct
import sys
import os

def generate_offsets(input_tsv: str, output_base: str):
    """
    Generate a binary .offsets file (little-endian Uint32Array) for fast line access.
    
    Usage:
        python generate_offsets.py input.tsv path/to/dict_name
    
    This will create:
        path/to/dict_name.offsets
        path/to/dict_name.zst  (if zstd is installed and file doesn't exist)
    """
    offsets_path = f"{output_base}.offsets"
    zst_path = f"{output_base}.tsv.zst"

    print(f"Generating offsets for {input_tsv} → {offsets_path}")

    offsets = [0]  # Start with offset 0
    pos = 0

    with open(input_tsv, 'r', encoding='utf-8', newline='') as f:
        for line in f:
            # Encode the exact line as stored (including the line ending)
            line_bytes = line.encode('utf-8')
            pos += len(line_bytes)
            offsets.append(pos)

    # The last offset is the total file length (sentinel value)
    line_count = len(offsets) - 1
    print(f"Processed {line_count:,} lines")

    # Write as little-endian uint32
    with open(offsets_path, 'wb') as out:
        for offset in offsets:
            out.write(struct.pack('<I', offset))

    file_size = os.path.getsize(offsets_path)
    print(f"Offsets written to {offsets_path} ({file_size // 1024} KB, {file_size} bytes)")

    if file_size % 4 != 0:
        raise ValueError("Generated offsets file size is not a multiple of 4! Something went wrong.")

    # Optional: compress with zstd if available
    if not os.path.exists(zst_path):
        try:
            import subprocess
            print(f"Compressing {input_tsv} → {zst_path}")
            subprocess.run(['zstd', '-19', '-f', input_tsv, '-o', zst_path], check=True)
            print(f"Compressed: {zst_path}")
        except FileNotFoundError:
            print("zstd not found in PATH — skipping compression (install zstd to auto-compress)")
        except subprocess.CalledProcessError as e:
            print(f"zstd compression failed: {e}")
    else:
        print(f"Compressed file already exists: {zst_path}")

    print("Done! Files are ready for pslab.js")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python generate_offsets.py <input.tsv> <output_base>")
        print("Example: python generate_offsets.py sonv3.tsv ../db/sonv3")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_base = sys.argv[2]
    
    if not os.path.isfile(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)
    
    generate_offsets(input_file, output_base)
