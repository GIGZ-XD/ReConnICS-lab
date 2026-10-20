#!/usr/bin/env python3
"""Score ReConnICS-ng output against plant.truth.json.  usage: verify.py plant.truth.json cell1.json [cell2.json ..]
(each json = `reconnics-ng analyze <seg>.pcap -o <seg>.json`).  Prints, per capture, every truth field as ok/MISSING/WRONG."""
import json, sys

norm = lambda s: "".join(str(s).lower().lstrip("v").split()) if s else ""
truth = json.load(open(sys.argv[1]))
for f in sys.argv[2:]:
    assets = {a["ip"]: a for a in json.load(open(f))["assets"]}
    print("==", f)
    for d in truth["devices"]:
        a = assets.get(d["ip"])
        if not a:
            print(f"  {d['ip']:<12} {d['name'] if 'name' in d else d['id']:<12} not seen")
            continue
        row = []
        for k in ("vendor", "model", "firmware", "serial"):
            if k not in d:
                continue
            got = (a.get(k) or {}).get("value")
            ok = norm(d[k]) in norm(got) or (got and norm(got) in norm(d[k]))
            row.append(f"{k}={'ok' if ok else ('MISSING' if not got else 'WRONG(' + got + ')')}")
        mac = "mac=ok" if a.get("mac") == d["mac"] else f"mac={a.get('mac')}"
        print(f"  {d['ip']:<12} {d['kind']:<9} {' '.join(row) or '(client: no identity expected)'} {mac} role={a['attributes'].get('role')}/{d['role']}")
