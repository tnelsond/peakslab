#!/usr/bin/env python3
"""Links against the hand-checked senses: their precision and recall.

Usage: check.py <links.pkl> <gold.json>
gold.json: {wk index: [the synset ids that fit, and/or "N" if none fitting is right too]}
"""
import sys, json, pickle

LINKS, GOLD = sys.argv[1:3]
links = pickle.load(open(LINKS, 'rb'))
gold = json.load(open(GOLD))
made = good = linkable = right = 0
for k, ok in gold.items():
	got = links[int(k)][0]
	linkable += any(x != 'N' for x in ok)
	made += bool(got)
	good += got in ok
	right += (got or 'N') in ok
print(f'{len(gold)} checked: {right / len(gold):.0%} right; links {made}, precision {good / max(made, 1):.2f}, '
	f'recall {good / linkable:.2f}')
