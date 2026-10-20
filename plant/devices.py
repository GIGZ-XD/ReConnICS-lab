"""Single source of truth for the virtual plant: segments, OUIs, and the device registry (plant/devices/*.json).
Adding a device = dropping one JSON file in plant/devices/ (see ADDING_DEVICES.md); nothing else to edit.

Identity strings are real device families that have advisories in the ReConnICS-ng index, at firmware levels
that fall inside an affected range, so the advisory stage has something to hit.
Truth conventions follow ReConnICS-ng/eval (Modbus fw without leading V, CIP rev major.%03d, serial %08X).
"""
import glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUI = {"schneider": "00:80:f4", "rockwell": "00:00:bc", "siemens": "00:1b:1b", "dell": "00:14:22", "vmware": "00:0c:29"}

# bridge name -> (subnet prefix, description). The router ns owns .1 on each.
SEGMENTS = {
    "cell1": ("10.10.1", "Line 1 packaging cell (control network)"),
    "cell2": ("10.10.2", "Line 2 utilities cell (control network)"),
    "sup":   ("10.10.3", "Supervisory network: HMI, EWS, historian"),
}
KINDS = {"modbus": "ident", "enip": "cip", "s7native": None, "hmi": None, "ews": None, "historian": None}  # kind -> required stack key


def router_mac(seg):
    return f"00:1a:a1:00:{list(SEGMENTS).index(seg):02x}:01"


def load(devdir=os.path.join(HERE, "devices")):
    devs, seen = [], set()
    for f in sorted(glob.glob(os.path.join(devdir, "*.json"))):
        d = json.load(open(f))
        d = {k: v for k, v in d.items() if not k.startswith("_")}        # "_note" etc. are comments
        where = os.path.basename(f)
        for k in ("name", "seg", "host", "oui", "kind", "truth"):
            assert k in d, f"{where}: missing '{k}'"
        assert d["seg"] in SEGMENTS and d["oui"] in OUI and d["kind"] in KINDS, f"{where}: unknown seg/oui/kind"
        assert KINDS[d["kind"]] is None or KINDS[d["kind"]] in d, f"{where}: kind {d['kind']} needs '{KINDS[d['kind']]}'"
        assert 2 <= d["host"] <= 254, f"{where}: host out of range"
        assert d["name"] not in seen and (d["seg"], d["host"]) not in seen, f"{where}: duplicate name or seg/host"
        seen |= {d["name"], (d["seg"], d["host"])}
        si = list(SEGMENTS).index(d["seg"])
        d["ip"] = f"{SEGMENTS[d['seg']][0]}.{d['host']}"
        d["mac"] = f"{OUI[d['oui']]}:00:{si:02x}:{d['host']:02x}"       # unique per device; OUI = vendor
        devs.append(d)
    return devs


DEVICES = load()

if __name__ == "__main__":
    for d in DEVICES:
        print(f"{d['name']:<12} {d['seg']:<6} {d['ip']:<12} {d['mac']} {d['kind']}")
