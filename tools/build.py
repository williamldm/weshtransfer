#!/usr/bin/env python3
"""Prépare le dossier _deploy : uniquement ce qui doit être public (pas dev/,
tools/, supabase/). Son contenu va à la racine du site chez o2switch, ou tel
quel sur Netlify. Usage : python3 tools/build.py"""
import pathlib, shutil, subprocess, sys

root = pathlib.Path(__file__).resolve().parent.parent
out = root / "_deploy"
if subprocess.run([sys.executable, str(root / "tools/check.py")]).returncode:
    sys.exit("Contrôles en échec : rien n'est préparé.")
shutil.rmtree(out, ignore_errors=True)
out.mkdir()
for name in ["index.html", "app.html", "t.html", "robots.txt", ".htaccess"]:
    shutil.copy2(root / name, out / name)
for d in ["css", "js", "fonts", "img"]:
    shutil.copytree(root / d, out / d)
n = sum(1 for p in out.rglob("*") if p.is_file())
print(f"_deploy prêt : {n} fichiers (dont .htaccess, caché). Son contenu va à la racine du site.")
