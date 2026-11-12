"""Contrat de licence en RTF pour la page « Contrat de licence » des installateurs Windows (NSIS et MSI).

  python scripts/licence-rtf.py           écrit src-tauri/licence.rtf
  python scripts/licence-rtf.py --check   vérifie qu'il est à jour (contrôle des traductions de la CI)

À relancer quand docs/conditions/fr/2-licence.md change.

Pourquoi un RTF sur une seule ligne, en ASCII :
- NSIS (-setup.exe) lit le fichier comme RTF dès qu'il commence par « {\\rtf » (Tauri y ajoute seulement un BOM) ;
- pour le MSI, Tauri insère le contenu tel quel dans son propre RTF (page de code 1252) en remplaçant chaque
  fin de ligne par « \\par » : une seule ligne évite des lignes vides en trop, et les lettres accentuées
  écrites « \\uN? » s'affichent juste, là où de l'UTF-8 brut donnerait « Ã© ».
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "conditions", "fr", "2-licence.md")
OUT = os.path.join(ROOT, "src-tauri", "licence.rtf")
ENGLISH = "The English version of this agreement is in GestiMarket (Settings → Help, terms and licence). The French version prevails."


def esc(text: str) -> str:
    """Texte → RTF : caractères spéciaux échappés, tout ce qui n'est pas ASCII en « \\uN? »."""
    out = []
    for ch in text:
        code = ord(ch)
        if ch in "\\{}":
            out.append("\\" + ch)
        elif 32 <= code < 127:
            out.append(ch)
        elif code > 0xFFFF:
            code -= 0x10000
            for unit in (0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)):
                out.append(f"\\u{unit - 0x10000}?")
        else:
            out.append(f"\\u{code if code < 0x8000 else code - 0x10000}?")
    return "".join(out)


def inline(text: str) -> str:
    """**gras** du Markdown → \\b … \\b0."""
    parts = re.split(r"\*\*(.+?)\*\*", text)
    return "".join(esc(p) if i % 2 == 0 else "{\\b " + esc(p) + "}" for i, p in enumerate(parts))


def paragraphs(md: str) -> list[str]:
    out = []
    header = None
    for line in md.splitlines():
        line = line.rstrip()
        if not line:
            header = None
            continue
        if line.startswith("# "):
            out.append("{\\b\\fs24 " + esc(line[2:]) + "}")
            continue
        if line.startswith("## "):
            out.append("{\\b " + esc(line[3:]) + "}")
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-+:?", c) for c in cells):
                continue
            if header is None:
                header = cells
                continue
            out.append(esc("• ") + "{\\b " + esc(cells[0]) + "}" + esc(f" ({header[1].lower()} : {cells[1]}) : {cells[2]}"))
            continue
        header = None
        if line.startswith("- "):
            out.append(esc("• ") + inline(line[2:]))
        else:
            out.append(inline(line))
    out.append("{\\i " + esc(ENGLISH) + "}")
    return out


def rtf(md: str) -> str:
    body = "\\par\\par ".join(paragraphs(md))
    return "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1 " + body + "\\par}"


def main():
    data = rtf(open(SRC, encoding="utf-8").read())
    assert "\n" not in data and data.isascii()
    if "--check" in sys.argv:
        current = open(OUT, encoding="ascii", newline="").read() if os.path.exists(OUT) else ""
        if current != data:
            print("src-tauri/licence.rtf n'est pas à jour : python scripts/licence-rtf.py")
            sys.exit(1)
        print("licence.rtf à jour")
        return
    open(OUT, "w", encoding="ascii", newline="").write(data)
    print(f"{OUT} : {len(data)} caractères")


if __name__ == "__main__":
    main()
