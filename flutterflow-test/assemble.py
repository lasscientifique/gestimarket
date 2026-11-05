"""Assemble le code FlutterFlow à tester, tel qu'il est collé dans l'éditeur.

- lib/menu_flottant.dart : en-tête d'imports (celui que FlutterFlow ajoute au-dessus de « DO NOT REMOVE »)
  + supabase/flutterflow/menu_flottant.dart, sans aucune modification.
- lib/is_server_active.dart : corps de la fonction personnalisée « isServerActive » pris dans
  supabase/flutterflow/flutterflow_fonction_serveur.dart, avec la signature que FlutterFlow génère.
SupaFlow et FFAppState sont remplacés par des doublures (lib/ff_stubs.dart).
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT.parent / "supabase" / "flutterflow"
LIB = ROOT / "lib"
NOTE = "// Fichier assemblé par assemble.py à partir de supabase/flutterflow : ne pas modifier.\n"

menu = (SRC / "menu_flottant.dart").read_text(encoding="utf-8")
(LIB / "menu_flottant.dart").write_text(
    NOTE
    + "import 'package:flutter/material.dart';\n"
    + "import 'package:go_router/go_router.dart';\n\n"
    + "import 'ff_stubs.dart';\n\n"
    + menu,
    encoding="utf-8",
)

server = (SRC / "flutterflow_fonction_serveur.dart").read_text(encoding="utf-8")
found = re.search(r"'isServerActive',.*?code: r'''(.*?)'''", server, re.S)
if not found:
    raise SystemExit("isServerActive introuvable dans flutterflow_fonction_serveur.dart")
(LIB / "is_server_active.dart").write_text(
    NOTE + "bool? isServerActive(String? shopCode, bool? active, DateTime? lastSeen) {\n" + found.group(1) + "}\n",
    encoding="utf-8",
)
print("assemblé : lib/menu_flottant.dart, lib/is_server_active.dart")
