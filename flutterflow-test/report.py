"""Lit la sortie JSON de « flutter test » et écrit chaque échec en annotation GitHub (lisible sans connexion)."""
import json
import sys

names, failures, ok, prints = {}, [], None, {}
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try:
        event = json.loads(line)
    except ValueError:
        continue
    kind = event.get("type")
    if kind == "testStart":
        names[event["test"]["id"]] = event["test"]["name"]
    elif kind == "print":
        prints.setdefault(event.get("testID"), []).append(event.get("message", ""))
    elif kind == "error":
        logs = "
".join(prints.get(event.get("testID"), []))
        failures.append((names.get(event.get("testID"), "?"), logs + "
" + event.get("error", ""), event.get("stackTrace", "")))
    elif kind == "testDone" and not event.get("hidden"):
        print(("OK    " if event.get("result") == "success" else "ÉCHEC ") + names.get(event["testID"], "?"))
    elif kind == "done":
        ok = event.get("success")

for name, error, stack in failures:
    text = (error + "\n" + "\n".join(stack.splitlines()[:25]))[:4000]
    print(f"::error title={name.replace(':', ' ')}::" + text.replace("%", "%25").replace("\r", "").replace("\n", "%0A"))
print(f"{len(failures)} erreur(s)")
sys.exit(0 if ok and not failures else 1)
