#!/usr/bin/env python3
"""Virtual plant on Linux network namespaces: one netns per device (real stacks: pymodbus, cpppo, snap7),
a Linux bridge per network segment (the switch / SPAN point), a router namespace between segments,
tcpdump on every bridge. Needs root, iproute2, tcpdump. Windows: run inside WSL2.

    sudo /root/labvenv/bin/python plant/plant.py [--duration 90] [--out captures/plant]
"""
import argparse, json, os, signal, subprocess, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from devices import DEVICES, SEGMENTS, OUI

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
SEGS = list(SEGMENTS)
procs = []


def sh(*a, check=True):
    return subprocess.run(a, check=check, capture_output=True, text=True)


def ns_run(ns, *cmd, **kw):
    return subprocess.Popen(["ip", "netns", "exec", f"rc-{ns}", *map(str, cmd)], **kw)


def cleanup():
    for n in sh("ip", "netns", "list", check=False).stdout.split():
        if n.startswith("rc-"):
            sh("ip", "netns", "del", n, check=False)
    for s in SEGS:
        sh("ip", "link", "del", f"rc-{s}", check=False)


def veth(i, ns, br, ip, mac, gw=None, ifname="eth0"):
    h, n = f"vh{i}", f"vn{i}"
    sh("ip", "link", "add", h, "type", "veth", "peer", "name", n)
    sh("ip", "link", "set", n, "netns", f"rc-{ns}")
    sh("ip", "link", "set", h, "master", f"rc-{br}", "up")
    x = ["ip", "-n", f"rc-{ns}"]
    sh(*x, "link", "set", n, "name", ifname)
    sh(*x, "link", "set", ifname, "address", mac, "up")
    sh(*x, "addr", "add", f"{ip}/24", "dev", ifname)
    if gw:
        sh(*x, "route", "add", "default", "via", gw)


def build():
    cleanup()
    for s in SEGS:
        sh("ip", "link", "add", f"rc-{s}", "type", "bridge")
        sh("ip", "link", "set", f"rc-{s}", "up")
        sh("sysctl", "-qw", f"net.ipv6.conf.rc-{s}.disable_ipv6=1")      # plant is IPv4-only: no ND/MLD noise
    sh("ip", "netns", "add", "rc-rtr")
    sh("ip", "netns", "exec", "rc-rtr", "sysctl", "-qw", "net.ipv6.conf.default.disable_ipv6=1")
    sh("ip", "netns", "exec", "rc-rtr", "sysctl", "-qw", "net.ipv4.ip_forward=1")
    i = 0
    for si, s in enumerate(SEGS):
        i += 1
        veth(i, "rtr", s, f"{SEGMENTS[s][0]}.1", f"00:1a:a1:00:{si:02x}:01", ifname=f"eth{si}")
    for d in DEVICES:
        i += 1
        si = SEGS.index(d["seg"])
        d["ip"] = f"{SEGMENTS[d['seg']][0]}.{d['host']}"
        d["mac"] = f"{OUI[d['oui']]}:00:{si:02x}:{d['host']:02x}"
        sh("ip", "netns", "add", f"rc-{d['name']}")
        sh("ip", "netns", "exec", f"rc-{d['name']}", "sysctl", "-qw", "net.ipv6.conf.default.disable_ipv6=1")
        veth(i, d["name"], d["seg"], d["ip"], d["mac"], gw=f"{SEGMENTS[d['seg']][0]}.1")
    for d in DEVICES:
        sh("ip", "-n", f"rc-{d['name']}", "link", "set", "lo", "up")


def start_servers(tmp):
    for d in DEVICES:
        k, name, kw = d["kind"], d["name"], {}
        if k == "modbus":
            cmd = [PY, f"{HERE}/servers/modbus_server.py", d["ip"], json.dumps(d["ident"])]
        elif k == "s7native":
            cmd = [PY, f"{HERE}/servers/s7_native.py", d["ip"]]
        elif k == "enip":
            os.makedirs(f"{tmp}/{name}")      # cpppo reads ./cpppo.cfg, one cwd per device
            subprocess.run([PY, f"{HERE}/servers/enip_cfg.py", f"{tmp}/{name}/cpppo.cfg", json.dumps(d["cip"])], check=True)
            cmd = [PY, "-m", "cpppo.server.enip", "-a", f"{d['ip']}:44818", "--no-print", "Tag=INT[100]"]
            kw["cwd"] = f"{tmp}/{name}"
        else:
            continue
        procs.append(ns_run(name, *cmd, stdout=open(f"{tmp}/{name}.log", "w"), stderr=subprocess.STDOUT, **kw))


def ips(kind):
    return [d["ip"] for d in DEVICES if d["kind"] == kind]


def client(name, *args, wait=False):
    p = ns_run(name, PY, *args, stdout=sys.stdout, stderr=subprocess.STDOUT)
    (p.wait() if wait else procs.append(p))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=int, default=90)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "captures", "plant"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="plant-")
    build()
    try:
        for s in SEGS:
            procs.append(subprocess.Popen(["tcpdump", "-i", f"rc-{s}", "-s", "0", "-U", "-w", f"{a.out}/{s}.pcap"],
                                          stderr=subprocess.DEVNULL))
        time.sleep(1)
        start_servers(tmp)
        time.sleep(4)
        mb, en, s7 = ",".join(ips("modbus")), ",".join(ips("enip")), ",".join(ips("s7native"))
        client("hmi", f"{HERE}/clients/hmi.py", 1, a.duration, f"modbus={mb}", f"s7={s7}")
        client("historian", f"{HERE}/clients/hmi.py", 5, a.duration, f"modbus={mb}")
        sweep = lambda: client("ews", f"{HERE}/clients/ews.py", f"modbus={mb}", f"enip={en}", f"s7={s7}", wait=True)
        t0 = time.time()
        for t in (5, a.duration // 2):
            time.sleep(max(0, t - (time.time() - t0)))
            sweep()
        time.sleep(max(0, a.duration - (time.time() - t0)))
    finally:
        for p in procs:
            p.send_signal(signal.SIGINT if p.args[0] == "tcpdump" else signal.SIGTERM)
        for p in procs:
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        cleanup()
    truth = dict(scenario="plant", description="netns plant: " + "; ".join(f"{k}={v[0]}.0/24" for k, v in SEGMENTS.items()),
                 files=[f"{s}.pcap" for s in SEGS],
                 devices=[dict(id=d["ip"], name=d["name"], ip=d["ip"], segment=d["seg"], mac=d["mac"], kind=d["kind"], **d["truth"])
                          for d in DEVICES],
                 routers=[dict(ip=f"{SEGMENTS[s][0]}.1", mac=f"00:1a:a1:00:{i:02x}:01", segment=s) for i, s in enumerate(SEGS)])
    json.dump(truth, open(f"{a.out}/plant.truth.json", "w"), indent=1)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
