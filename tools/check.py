#!/usr/bin/env python3
"""Controles avant mise en ligne. Usage : python3 tools/check.py"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
front = [p for p in root.rglob("*") if p.suffix in {".js", ".html", ".css"} and ".git" not in p.parts and "_deploy" not in p.parts]
code = [p for p in root.rglob("*") if p.suffix in {".js", ".ts"} and ".git" not in p.parts and "_deploy" not in p.parts]
problems = []

# 1. une seule version d'assets partout (deux ?v= differents = deux
#    instances du meme module = deux clients Supabase, deux lecteurs...)
versions = {}
for p in front:
    for v in re.findall(r"\?v=(\d+)", p.read_text(encoding="utf-8")):
        versions.setdefault(v, set()).add(str(p.relative_to(root)))
if len(versions) > 1:
    problems.append("versions ?v= melangees : " + ", ".join(f"v{k} ({len(f)} fichiers)" for k, f in versions.items()))

# 2. tout import relatif porte le suffixe de version
for p in root.joinpath("js").rglob("*.js"):
    for m in re.finditer(r"""(?:from|import)\s*\(?\s*["'](\.{1,2}/[^"']+)["']""", p.read_text(encoding="utf-8")):
        if "?v=" not in m.group(1):
            problems.append(f"{p.relative_to(root)} : import sans ?v= -> {m.group(1)}")

# 3. aucune cle secrete dans ce qui est servi aux visiteurs
for p in front:
    t = p.read_text(encoding="utf-8")
    if re.search(r"sb_secret_[A-Za-z0-9_-]{8,}", t) or "service_role" in t and p.suffix == ".js" and "config" in p.name:
        problems.append(f"{p.relative_to(root)} : cle secrete dans le front !")

# 4. aucun guillemet typographique dans le code (casse les chaines JS)
curly = "‘’“”«»"
for p in code:
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if any(c in line for c in curly):
            problems.append(f"{p.relative_to(root)}:{i} : guillemet typographique")

for msg in problems:
    print("ECHEC  " + msg)
print(f"{len(front)} fichiers front, {len(code)} fichiers de code, version assets : v{','.join(versions) or '?'}")
print("OK" if not problems else f"{len(problems)} probleme(s)")
sys.exit(1 if problems else 0)
