#!/usr/bin/env python3
"""Split a classic pcap at an absolute epoch time: split.py IN.pcap EPOCH -> IN-before.pcap / IN-after.pcap
(plant.py uses it to give the site console a before-firmware-change and an after capture of each bridge)."""
import struct, sys


def split(path, at):
    d = open(path, "rb").read()
    out = {k: [d[:24]] for k in ("before", "after")}
    i = 24
    while i + 16 <= len(d):
        sec, usec, cap = struct.unpack("<IIi", d[i:i + 12])
        if i + 16 + cap > len(d):
            break                                              # tcpdump killed mid-record
        out["before" if sec + usec / 1e6 < at else "after"].append(d[i:i + 16 + cap])
        i += 16 + cap
    for k, v in out.items():
        open(path.removesuffix(".pcap") + f"-{k}.pcap", "wb").write(b"".join(v))


if __name__ == "__main__":
    split(sys.argv[1], float(sys.argv[2]))
