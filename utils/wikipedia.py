#!/usr/bin/env python3
import json
import re
from pathlib import Path

EXTRACTED_DIR = "lowiki_extracted"
OUTPUT_TSV    = "lowiki.tsv"
MAX_CHARS     = 800

def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r'<templatestyles[^>]*>.*?</templatestyles>', '', text, flags=re.I | re.S)
    text = re.sub(r'&lt;templatestyles[^&]*&gt;.*?&lt;/templatestyles&gt;', '', text, flags=re.I | re.S)
    text = re.sub(r'</?(?:div|span|table|tr|td|th|ref|references|gallery)[^>]*>', '', text, flags=re.I)
    text = re.sub(r'&lt;/?[^&]+&gt;', '', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def text_to_html(text: str) -> str:
    text = clean_text(text)
    if not text:
        return ""

    lines = [l.rstrip() for l in text.splitlines()]
    html = []
    paragraph = []
    list_items = []
    list_type = None

    heading_re = re.compile(r'^(={2,6})\s*(.+?)\s*\1\s*$')
    bullet_re  = re.compile(r'^[\*\-•]\s+(.+)$')
    number_re  = re.compile(r'^#\s+(.+)$')

    def flush_paragraph():
        if paragraph:
            p = " ".join(paragraph).strip()
            if p:
                html.append(f"<p>{p}</p>")
            paragraph.clear()

    def flush_list():
        nonlocal list_type
        if list_items and list_type:
            html.append(f"<{list_type}>")
            for item in list_items:
                html.append(f"<li>{item}</li>")
            html.append(f"</{list_type}>")
            list_items.clear()
            list_type = None

    for line in lines:
        line = line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            continue

        m = heading_re.match(line)
        if m:
            flush_paragraph()
            flush_list()
            level = min(len(m.group(1)), 4)
            html.append(f"<h{level}>{m.group(2).strip()}</h{level}>")
            continue

        m = bullet_re.match(line)
        if m:
            flush_paragraph()
            if list_type and list_type != "ul":
                flush_list()
            list_type = "ul"
            list_items.append(m.group(1).strip())
            continue

        m = number_re.match(line)
        if m:
            flush_paragraph()
            if list_type and list_type != "ol":
                flush_list()
            list_type = "ol"
            list_items.append(m.group(1).strip())
            continue

        flush_list()
        paragraph.append(line)

    flush_paragraph()
    flush_list()
    return "".join(html)

def sanitize(s: str) -> str:
    return s.replace("\t", " ").replace("\r", " ").replace("\n", " ").strip()

def main():
    files = [f for f in Path(EXTRACTED_DIR).rglob("*") if f.is_file()]
    if not files:
        print(f"No files found in {EXTRACTED_DIR}")
        return

    print(f"Found {len(files)} files. Writing title + text only (max {MAX_CHARS} chars)...")

    with open(OUTPUT_TSV, "w", encoding="utf-8", newline="\n") as out:
        out.write("title\ttext\n")

        count = 0
        for filepath in files:
            with open(filepath, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        art = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    raw = art.get("text", "").strip()
                    if not raw:
                        continue

                    html_text = text_to_html(raw)

                    if len(html_text) > MAX_CHARS:
                        html_text = html_text[:MAX_CHARS].rstrip()

                    title = sanitize(art.get("title", ""))
                    text  = sanitize(html_text)

                    out.write(f"{title}\t{text}\n")
                    count += 1

    print(f"Done → {OUTPUT_TSV}  ({count} articles)")

if __name__ == "__main__":
    main()
