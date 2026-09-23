#!/usr/bin/env python3
"""Prépare le dossier _deploy à glisser sur Netlify : uniquement ce qui doit
être public (pas dev/, tools/, supabase/). Usage : python3 tools/build.py"""
import pathlib, shutil, subprocess, sys

root = pathlib.Path(__file__).resolve().parent.parent
out = root / "_deploy"
if subprocess.run([sys.executable, str(root / "tools/check.py")]).returncode:
    sys.exit("Contrôles en échec : rien n'est préparé.")
shutil.rmtree(out, ignore_errors=True)
out.mkdir()
for name in ["index.html", "app.html", "t.html"]:
    shutil.copy2(root / name, out / name)
for d in ["css", "js", "fonts", "img"]:
    shutil.copytree(root / d, out / d)
n = sum(1 for p in out.rglob("*") if p.is_file())
print(f"_deploy prêt : {n} fichiers. Glisse le dossier sur Netlify (onglet Deploys).")
