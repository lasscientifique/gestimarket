"""Messages français du moteur (Rust) et de Supabase (SQL, fonctions) à traduire dans src/i18n/en-messages.ts.

Les parties variables (« {} », « {code} », « {:.2} », « % » des exceptions SQL) deviennent « {} ».
  python scripts/i18n_messages.py          écrit scripts/i18n-messages.json
  python scripts/i18n_messages.py --check  échoue si un message n'a pas de traduction anglaise (CI)
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH|PRAGMA|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|ORDER BY)\b|\bFROM\b|\bWHERE\b|\bJOIN\b|\bIS (NOT )?NULL\b|\bCOLLATE\b|\bLIMIT \?")
RUST_STR = re.compile(r'(?<![A-Za-z0-9_#])"((?:[^"\\]|\\.)*)"', re.S)


def is_message(s):
    v = s.strip()
    if not re.search(r"[A-Za-zÀ-ÿ]", re.sub(r"\{\}", "", v)):
        return False
    if SQL.search(v) or v.startswith(("http", "/", "#", "%", "application/", "text/")):
        return False
    if " " not in v and not re.search(r"[À-ÿ]", v):
        return False
    if re.fullmatch(r"[a-z0-9_.:/ -]+", v):  # identifiants, chemins
        return False
    if re.search(r"LIKE \?|[<>=]=? \?|\?, '|=>|fn |</|<!|^[a-z_.]+ [<>=]", v):  # SQL, code, HTML
        return False
    if re.fullmatch(r"[+]?[A-Za-z]+", re.sub(r"\{\}|\s", "", v)):  # « Bearer {} », « +{} days »
        return False
    return True


def rust_messages(path):
    text = open(path, encoding="utf-8").read()
    # Commentaires de ligne retirés (hors chaînes : approximation suffisante pour ce code).
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    text = re.sub(r"'(\\.|[^'\\])'", "' '", text)  # caractères isolés : '"', '\''
    if "#[cfg(test)]" in text:
        text = text[: text.index("#[cfg(test)]")]
    out = []
    for m in RUST_STR.finditer(text):
        s = m.group(1)
        s = re.sub(r"\\\r?\n\s*", "", s)  # continuation de ligne Rust
        s = s.replace('\\"', '"').replace("\\n", "\n").replace("\\'", "'").replace("\\\\", "\\")
        s = re.sub(r"\{\{", "\x00", s)
        s = re.sub(r"\}\}", "\x01", s)
        s = re.sub(r"\{[^{}]*\}", "{}", s).replace("\x00", "{").replace("\x01", "}")
        if is_message(s):
            out.append(s)
    return out


def sql_messages(path):
    text = open(path, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"raise exception '((?:[^']|'')*)'", text):
        out.append(m.group(1).replace("''", "'").replace("%", "{}"))
    for m in re.finditer(r"'(?:error|message)',\s*'((?:[^']|'')*)'", text):
        out.append(m.group(1).replace("''", "'"))
    for m in re.finditer(r"(?:then|else) '((?:[^']|'')*)'", text):
        s = m.group(1).replace("''", "'")
        if is_message(s):
            out.append(s)
    return [s for s in out if is_message(s)]


def ts_messages(path):
    text = open(path, encoding="utf-8").read()
    return [m.group(1) for m in re.finditer(r'message: "((?:[^"\\]|\\.)*)"', text) if is_message(m.group(1))]


def collect():
    found = []
    for base, _dirs, files in os.walk(os.path.join(ROOT, "src-tauri", "src")):
        for f in files:
            if f.endswith(".rs") and f != "tests.rs":
                found += rust_messages(os.path.join(base, f))
    for f in os.listdir(os.path.join(ROOT, "src-tauri", "migrations")):
        text = open(os.path.join(ROOT, "src-tauri", "migrations", f), encoding="utf-8").read()
        # Noms des meubles de la palette (types prédéfinis).
        for m in re.finditer(r"\('[a-z_]+',\s*'((?:[^']|'')*)',\s*'(?:rayon|froid|presentation|rangement|zone|batiment)'", text):
            found.append(m.group(1).replace("''", "'"))
        found += [m.group(1) for m in re.finditer(r"'(Rez-de-chaussée)'", text)]
    sup = os.path.join(ROOT, "supabase")
    for f in os.listdir(sup):
        if f.endswith(".sql"):
            found += sql_messages(os.path.join(sup, f))
    for base, _dirs, files in os.walk(os.path.join(sup, "functions")):
        for f in files:
            if f.endswith(".ts"):
                found += ts_messages(os.path.join(base, f))
    seen, unique = set(), []
    for s in found:
        if s not in seen:
            seen.add(s)
            unique.append(s)
    return sorted(unique, key=str.lower)


def dictionary_keys():
    text = open(os.path.join(ROOT, "src", "i18n", "en-messages.ts"), encoding="utf-8").read()
    return set(json.loads("[" + m.group(1) + "]")[0] for m in re.finditer(r'^\s*("(?:[^"\\]|\\.)*"):', text, re.M))


messages = collect()
if "--check" in sys.argv:
    have = dictionary_keys()
    missing = [m for m in messages if m not in have]
    for m in missing[:40]:
        print("message sans traduction anglaise :", m)
    print(f"{len(messages)} message(s) ; {len(missing)} sans traduction")
    sys.exit(1 if missing else 0)
json.dump(messages, open(os.path.join(ROOT, "scripts", "i18n-messages.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(messages)} message(s) → scripts/i18n-messages.json ({sum(len(m) for m in messages)} caractères)")
