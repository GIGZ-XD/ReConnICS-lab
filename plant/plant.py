#!/usr/bin/env python3
"""Virtual plant on Linux network namespaces: one netns per device (real stacks: pymodbus, cpppo, snap7),
a Linux bridge per network segment (the switch / SPAN point), a router namespace between segments,
tcpdump on every bridge.  Devices come from plant/devices/*.json, the storyline from plant/scenario.json.
Needs root, iproute2, tcpdump. Windows: run inside WSL2 (plant/demo.ps1 does that).

    sudo /root/labvenv/bin/python plant/plant.py [--duration 90] [--out captures/plant] [--feed [PORT]] [--record FILE]
"""
import argparse, copy, gzip, json, os, signal, subprocess, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from devices import DEVICES, SEGMENTS, router_mac
import feed as feedlib
import split

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
SEGS = list(SEGMENTS)
procs, servers = [], {}          # servers: device name -> Popen (restartable)
DEV = {d["name"]: d for d in DEVICES}


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
        veth(i, "rtr", s, f"{SEGMENTS[s][0]}.1", router_mac(s), ifname=f"eth{si}")
    for d in DEVICES:
        i += 1
        sh("ip", "netns", "add", f"rc-{d['name']}")
        sh("ip", "netns", "exec", f"rc-{d['name']}", "sysctl", "-qw", "net.ipv6.conf.default.disable_ipv6=1")
        veth(i, d["name"], d["seg"], d["ip"], d["mac"], gw=f"{SEGMENTS[d['seg']][0]}.1")
        sh("ip", "-n", f"rc-{d['name']}", "link", "set", "lo", "up")


def start_server(d, tmp):
    """(Re)start one device's protocol stack in its namespace, from its current spec (identity may have changed)."""
    k, name, kw = d["kind"], d["name"], {}
    unit = (d.get("process") or {}).get("unit", "tank")
    if k == "modbus":
        cmd = [PY, f"{HERE}/servers/modbus_server.py", d["ip"], json.dumps(d["ident"]), unit]
    elif k == "s7native":
        cmd = [PY, f"{HERE}/servers/s7_native.py", d["ip"], unit]
    elif k == "enip":
        os.makedirs(f"{tmp}/{name}", exist_ok=True)      # cpppo reads ./cpppo.cfg, one cwd per device
        subprocess.run([PY, f"{HERE}/servers/enip_cfg.py", f"{tmp}/{name}/cpppo.cfg", json.dumps(d["cip"])], check=True)
        cmd = [PY, "-m", "cpppo.server.enip", "-a", f"{d['ip']}:44818", "--no-print", "Tag=INT[100]"]
        kw["cwd"] = f"{tmp}/{name}"
    else:
        return
    servers[name] = ns_run(name, *cmd, stdout=open(f"{tmp}/{name}.log", "a"), stderr=subprocess.STDOUT, **kw)


def stop_server(name):
    p = servers.pop(name, None)
    if p:
        p.terminate()
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()


def garp(d, count=2):
    return ns_run(d["name"], PY, f"{HERE}/clients/garp.py", "eth0", d["ip"], d["mac"], count)


def ips(kind):
    return [d["ip"] for d in DEVICES if d["kind"] == kind]


def client(name, *args, wait=False):
    p = ns_run(name, PY, *args, stdout=sys.stdout, stderr=subprocess.STDOUT)
    (p.wait() if wait else procs.append(p))


def main():
    sc = json.load(open(f"{HERE}/scenario.json"))
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=int, default=sc["duration"])
    ap.add_argument("--out", default=os.path.join(HERE, "..", "captures", "plant"))
    ap.add_argument("--feed", nargs="?", type=int, const=8765, help="serve the state feed on this port (default 8765)")
    ap.add_argument("--record", help="write the feed frames of this run to FILE (.jsonl.gz) for feed.py --replay")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="plant-")
    initial = copy.deepcopy({d["name"]: d["truth"] for d in DEVICES})
    history = {d["name"]: [] for d in DEVICES}
    fb = feedlib.FrameBuilder(DEVICES, SEGMENTS, time.time(), [f"{SEGMENTS[s][0]}.1" for s in SEGS])
    build()
    rec = gzip.open(a.record, "wt") if a.record else None
    sniffers = []
    try:
        for s in SEGS:
            procs.append(subprocess.Popen(["tcpdump", "-i", f"rc-{s}", "-s", "0", "-U", "-w", f"{a.out}/{s}.pcap"],
                                          stderr=subprocess.DEVNULL))
        time.sleep(1)
        t0 = time.time()
        fb.t0 = t0
        os.environ["PLANT_T0"] = str(t0)
        if a.feed or rec:
            sniffers = [feedlib.Sniffer(f"rc-{s}", fb) for s in SEGS]
            for sn in sniffers:
                sn.start()
            fd = feedlib.Feed(a.feed or 8765)
            if a.feed:
                fd.start()
            ft = threading.Thread(target=fb.run, args=(fd, rec), daemon=True)
            ft.start()
        for d in DEVICES:
            start_server(d, tmp)
        time.sleep(4)
        for d in DEVICES:                                    # boot: announce MAC/IP like a host coming up
            garp(d)
        fb.event("boot", msg="plant up; devices announce themselves (gratuitous ARP)")
        mb, en, s7 = ",".join(ips("modbus")), ",".join(ips("enip")), ",".join(ips("s7native"))
        client("hmi", f"{HERE}/clients/hmi.py", 1, a.duration, f"modbus={mb}", f"s7={s7}", f"enip={en}")
        client("historian", f"{HERE}/clients/hmi.py", 5, a.duration, f"modbus={mb}")

        def sweep(ev):
            fb.event("sweep", "ews", "identity sweep: Modbus FC43, ENIP ListIdentity + CIP GAA, S7 SZL")
            client("ews", f"{HERE}/clients/ews.py", f"modbus={mb}", f"enip={en}", f"s7={s7}", wait=True)

        def reflash(ev):
            d = DEV[ev["device"]]
            old = d["truth"].get("firmware")
            fb.event(ev["do"], d["name"], f"{ev['do']} started" + (f": {old} -> {ev['firmware']}" if ev.get("firmware") else ""))
            fb.online(d["name"], False)
            stop_server(d["name"])
            time.sleep(ev.get("down_s", 5))
            if ev.get("cip"):
                d["cip"] = {**d["cip"], **ev["cip"]}
            if ev.get("ident"):
                d["ident"] = {**d["ident"], **ev["ident"]}
            if ev.get("firmware"):
                d["truth"] = {**d["truth"], "firmware": ev["firmware"]}
                fb.patch(d["name"], firmware=ev["firmware"])
            start_server(d, tmp)
            time.sleep(2)
            garp(d)
            fb.online(d["name"], True)
            history[d["name"]].append(dict(t=round(time.time() - t0, 1), firmware=d["truth"].get("firmware")))
            fb.event("online", d["name"], f"back online, firmware {d['truth'].get('firmware')}")

        threads = []
        for ev in sc["events"]:
            f = {"sweep": sweep, "firmware": reflash, "reboot": reflash}[ev["do"]]

            def go(ev=ev, f=f):
                time.sleep(max(0, ev["t"] - (time.time() - t0)))
                f(ev)
            threads.append(threading.Thread(target=go))
            threads[-1].start()
        for th in threads:
            th.join()
        time.sleep(max(0, a.duration - (time.time() - t0)))
    finally:
        for p in procs + list(servers.values()):
            p.send_signal(signal.SIGINT if p.args[0] == "tcpdump" else signal.SIGTERM)
        for p in procs + list(servers.values()):
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        fb.stop.set()
        for sn in sniffers:
            sn.stop()
        if rec:
            ft.join()
            rec.close()
        cleanup()
    truth = dict(scenario="plant", description="netns plant: " + "; ".join(f"{k}={v[0]}.0/24" for k, v in SEGMENTS.items()),
                 files=[f"{s}.pcap" for s in SEGS], events=sc["events"],
                 devices=[dict(id=d["ip"], name=d["name"], ip=d["ip"], segment=d["seg"], mac=d["mac"], kind=d["kind"],
                               **d["truth"], **({"firmware_initial": initial[d["name"]].get("firmware"),
                                                 "firmware_history": history[d["name"]]} if history[d["name"]] else {}))
                          for d in DEVICES],
                 routers=[dict(ip=f"{SEGMENTS[s][0]}.1", mac=router_mac(s), segment=s) for s in SEGS])
    json.dump(truth, open(f"{a.out}/plant.truth.json", "w"), indent=1)
    flash = [e for e in sc["events"] if e["do"] == "firmware"]
    if flash:                                                # <seg>-before.pcap / <seg>-after.pcap around the first firmware change
        for s in SEGS:
            split.split(f"{a.out}/{s}.pcap", t0 + flash[0]["t"])
    print("wrote", a.out)


if __name__ == "__main__":
    main()
