#!/usr/bin/env python3
"""Incremente ?v=N dans tous les .html/.js/.css (cache navigateur).
A lancer a chaque mise en ligne : python3 tools/bump.py"""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
files = [p for p in root.rglob("*") if p.suffix in {".js", ".html", ".css"} and ".git" not in p.parts]
current = max(int(v) for p in files for v in re.findall(r"\?v=(\d+)", p.read_text(encoding="utf-8")))
for p in files:
    t = p.read_text(encoding="utf-8")
    n = re.sub(r"\?v=\d+", f"?v={current + 1}", t)
    if n != t:
        p.write_text(n, encoding="utf-8")
print(f"v{current} -> v{current + 1}")
