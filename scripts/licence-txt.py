"""Contrat de licence en texte simple pour la page « Contrat de licence » de l'installateur Windows.

  python scripts/licence-txt.py   écrit src-tauri/licence.txt (UTF-8 avec BOM, fins de ligne Windows)

À relancer quand docs/conditions/fr/2-licence.md change (le contrôle des traductions de la CI le vérifie).
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "conditions", "fr", "2-licence.md")
OUT = os.path.join(ROOT, "src-tauri", "licence.txt")


def plain(md: str) -> str:
    out = []
    header = None
    for line in md.splitlines():
        line = line.rstrip()
        if line.startswith("# "):
            out.append(line[2:].upper())
            continue
        if line.startswith("## "):
            out += ["", line[3:]]
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(re.fullmatch(r"-+", c) for c in cells):
                continue
            if header is None:
                header = cells
                continue
            out.append(f"- {cells[0]} ({header[1].lower()} : {cells[1]}) : {cells[2]}")
            continue
        header = None
        out.append(line.replace("**", ""))
    text = "\n".join(out).strip() + "\n"
    text += "\nThe English version of this agreement is in GestiMarket (Settings → Help, terms and licence). The French version prevails.\n"
    return re.sub(r"\n{3,}", "\n\n", text)


def main():
    text = plain(open(SRC, encoding="utf-8").read()).replace("\n", "\r\n")
    data = "﻿" + text
    if "--check" in sys.argv:
        current = open(OUT, encoding="utf-8", newline="").read() if os.path.exists(OUT) else ""
        if current != data:
            print("src-tauri/licence.txt n'est pas à jour : python scripts/licence-txt.py")
            sys.exit(1)
        print("licence.txt à jour")
        return
    open(OUT, "w", encoding="utf-8", newline="").write(data)
    print(f"{OUT} : {len(text)} caractères")


if __name__ == "__main__":
    main()
