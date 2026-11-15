"""Classement Sugu Eden (src-tauri/data/sugu_classement.txt) → SQL pour Eden Dev (supabase/sugu_classement.sql).

  python scripts/sugu-classement.py           écrit supabase/sugu_classement.sql
  python scripts/sugu-classement.py --check   vérifie le fichier (codes uniques, 3 niveaux) et que le SQL est à jour

Les codes (« femmes/vetements/robes ») sont fabriqués comme dans src-tauri/src/sugu_tax.rs : mêmes règles.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src-tauri", "data", "sugu_classement.txt")
OUT = os.path.join(ROOT, "supabase", "sugu_classement.sql")

ACCENTS = {
    "à": "a", "â": "a", "ä": "a", "á": "a", "é": "e", "è": "e", "ê": "e", "ë": "e", "î": "i", "ï": "i", "í": "i",
    "ô": "o", "ö": "o", "ó": "o", "ù": "u", "û": "u", "ü": "u", "ú": "u", "ç": "c", "œ": "oe", "æ": "ae", "ñ": "n",
}


def slug(name: str) -> str:
    out, dash = [], False
    for ch in name.lower():
        ch = ACCENTS.get(ch, ch)
        for c in ch:
            if c.isascii() and c.isalnum():
                out.append(c)
                dash = False
            elif not dash and out:
                out.append("-")
                dash = True
    return "".join(out).strip("-")


def parse():
    version, nodes, stack = 0, [], []
    for raw in open(SRC, encoding="utf-8").read().splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw.startswith("@version"):
            version = int(raw.split()[1])
            continue
        depth = (len(raw) - len(raw.lstrip(" "))) // 2
        text = raw.strip()
        synonyms = ""
        if ";" in text:
            text, synonyms = (t.strip() for t in text.split(";", 1))
        code_part = None
        if " = " in text:
            text, code_part = (t.strip() for t in text.split(" = ", 1))
        if depth > 2 or depth > len(stack):
            sys.exit(f"Niveau invalide : {raw!r}")
        stack = stack[:depth]
        parent = stack[-1]["code"] if stack else None
        code = (parent + "/" if parent else "") + (code_part or slug(text))
        node = {"code": code, "parent": parent, "level": depth + 1, "name": text, "synonyms": synonyms, "sort": len(nodes)}
        nodes.append(node)
        stack.append(node)
    return version, nodes


def check(nodes):
    codes = [n["code"] for n in nodes]
    dup = {c for c in codes if codes.count(c) > 1}
    if dup:
        sys.exit(f"Codes en double : {sorted(dup)}")
    for n in nodes:
        if n["level"] < 3 and not any(m["parent"] == n["code"] for m in nodes):
            sys.exit(f"Branche vide (il faut des sous-catégories) : {n['code']}")


def sql(version, nodes):
    q = lambda s: "null" if s is None else "'" + s.replace("'", "''") + "'"
    rows = ",\n".join(f"  ({q(n['code'])}, {q(n['parent'])}, {n['level']}, {q(n['name'])}, {n['sort']}, {q(n['synonyms'])})" for n in nodes)
    return (
        "-- Fabriqué par scripts/sugu-classement.py à partir de src-tauri/data/sugu_classement.txt : ne pas modifier à la main.\n"
        f"-- Classement Sugu Eden, version {version} ({len(nodes)} lignes).\n"
        "begin;\n"
        "delete from public.sugu_taxonomy;\n"
        "insert into public.sugu_taxonomy (code, parent, level, name, sort, synonyms) values\n"
        f"{rows};\n"
        f"insert into public.gm_config (key, value) values ('sugu_taxonomy_version', '{version}')\n"
        "on conflict (key) do update set value = excluded.value;\n"
        "commit;\n"
    )


def main():
    version, nodes = parse()
    check(nodes)
    text = sql(version, nodes)
    levels = [sum(1 for n in nodes if n["level"] == lv) for lv in (1, 2, 3)]
    if "--check" in sys.argv:
        current = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if current != text:
            sys.exit("supabase/sugu_classement.sql n'est pas à jour : python scripts/sugu-classement.py")
        print(f"Classement Sugu Eden à jour : {levels[0]} catégories, {levels[1]} sections, {levels[2]} sous-catégories.")
        return
    open(OUT, "w", encoding="utf-8", newline="\n").write(text)
    print(f"{OUT} : version {version}, {levels[0]} catégories, {levels[1]} sections, {levels[2]} sous-catégories.")


if __name__ == "__main__":
    main()
