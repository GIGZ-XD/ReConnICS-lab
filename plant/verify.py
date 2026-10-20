#!/usr/bin/env python3
"""Score ReConnICS-ng output against plant.truth.json.
usage: verify.py plant.truth.json cell1.json [cell2.json ..] [inv/inventory.json ..]
  *.json from `reconnics-ng analyze <seg>.pcap -o <seg>.json`: every truth field is printed ok/MISSING/WRONG.
  inventory.json from `reconnics-ng inventory --in <seg>.json --out inv --index ...`: prints the advisory match level.
A device whose firmware changed mid-run (firmware_history in the truth) is ok with the final or the initial value
(ng keeps the latest and lists the earlier one under attributes.identityConflicts); the row says which one it saw."""
import json, sys

norm = lambda s: "".join(str(s).lower().lstrip("v").split()) if s else ""
same = lambda want, got: bool(got) and bool(want) and (norm(want) in norm(got) or norm(got) in norm(want))
truth = json.load(open(sys.argv[1], encoding="utf8"))
bad = 0
for f in sys.argv[2:]:
    doc = json.load(open(f, encoding="utf8"))
    print("==", f)
    if f.endswith("inventory.json"):
        for a in doc["assets"]:
            m = a["match"]
            print(f"  {a['ip']['value']:<12} match={m['level']:<9} advisories={', '.join(x['advisory'] + ':' + x['level'] for x in m['advisories'][:4]) or '-'}")
        continue
    assets = {a["ip"]: a for a in doc["assets"]}
    for d in truth["devices"]:
        a = assets.get(d["ip"])
        if not a:
            print(f"  {d['ip']:<12} {d['name']:<12} not seen")
            continue
        row = []
        for k in ("vendor", "model", "firmware", "serial"):
            if k not in d:
                continue
            got = (a.get(k) or {}).get("value")
            ok = same(d[k], got)
            note = ""
            if k == "firmware" and not ok and same(d.get("firmware_initial"), got):
                ok, note = True, "(initial)"
            bad += not ok
            row.append(f"{k}={'ok' + note if ok else ('MISSING' if not got else 'WRONG(' + got + ')')}")
        mac = "mac=ok" if a.get("mac") == d["mac"] else f"mac={a.get('mac')}"
        print(f"  {d['ip']:<12} {d['kind']:<9} {' '.join(row) or '(client: no identity expected)'} {mac} role={a['attributes'].get('role')}/{d['role']}")
sys.exit(1 if bad else 0)
