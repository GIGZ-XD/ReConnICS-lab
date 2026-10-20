#!/usr/bin/env python3
"""Live state feed for the 3D viewer: WebSocket ws://HOST:8765/state, JSON ~5 Hz (schema: STATE_FEED.md).
stdlib only (own minimal RFC 6455 server, send-only), so it runs in WSL next to the plant *and* on plain Windows.

  library (used by plant.py):  Feed(port).start(); Feed.publish(frame_dict)
                               FrameBuilder(devices, segments, t0): .flow() .event() .patch() .online() .frame()
                               Sniffer(bridge, builder)
  replay a recorded run:       python plant/feed.py --replay plant/demo-run.jsonl.gz [--loop] [--port 8765]
"""
import argparse, base64, gzip, hashlib, json, os, socket, socketserver, struct, subprocess, sys, threading, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import process

WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class Feed:
    def __init__(self, port=8765, host="0.0.0.0"):
        self.addr, self.clients, self.lock, self.latest = (host, port), [], threading.Lock(), b"{}"

    def start(self):
        feed = self

        class H(socketserver.BaseRequestHandler):
            def handle(self):
                feed._serve(self.request)

        socketserver.ThreadingTCPServer.allow_reuse_address = True
        socketserver.ThreadingTCPServer.daemon_threads = True
        self.srv = socketserver.ThreadingTCPServer(self.addr, H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        print(f"feed: ws://localhost:{self.addr[1]}/state  (GET / returns the latest frame)", flush=True)

    def _serve(self, s):
        s.settimeout(10)
        req = b""
        while b"\r\n\r\n" not in req and len(req) < 8192:
            c = s.recv(1024)
            if not c:
                return
            req += c
        head = req.decode("latin-1").split("\r\n")
        h = {l.split(":", 1)[0].strip().lower(): l.split(":", 1)[1].strip() for l in head[1:] if ":" in l}
        if "sec-websocket-key" not in h:                      # plain HTTP: latest frame, handy for curl
            body = self.latest
            s.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n"
                      b"Content-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
            return
        acc = base64.b64encode(hashlib.sha1(h["sec-websocket-key"].encode() + WS_GUID).digest())
        s.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  b"Sec-WebSocket-Accept: " + acc + b"\r\n\r\n")
        s.settimeout(None)
        with self.lock:
            self.clients.append(s)
        try:                                                   # we only send; read to notice close and answer ping
            while True:
                b0, b1 = self._rx(s, 2)
                n = b1 & 0x7F
                n = struct.unpack(">H", self._rx(s, 2))[0] if n == 126 else struct.unpack(">Q", self._rx(s, 8))[0] if n == 127 else n
                mask = self._rx(s, 4) if b1 & 0x80 else b"\0" * 4
                data = self._rx(s, n)
                if b0 & 0x0F == 8:
                    return
                if b0 & 0x0F == 9:
                    with self.lock:
                        s.sendall(self._frame(10, bytes(x ^ mask[i % 4] for i, x in enumerate(data))))
        except (OSError, EOFError):
            pass
        finally:
            with self.lock:
                if s in self.clients:
                    self.clients.remove(s)

    @staticmethod
    def _rx(s, n):
        b = b""
        while len(b) < n:
            c = s.recv(n - len(b))
            if not c:
                raise EOFError
            b += c
        return b

    @staticmethod
    def _frame(op, data):
        n = len(data)
        return bytes([0x80 | op]) + (bytes([n]) if n < 126 else b"\x7e" + struct.pack(">H", n) if n < 65536
                                    else b"\x7f" + struct.pack(">Q", n)) + data

    def publish(self, frame):
        data = json.dumps(frame, separators=(",", ":")).encode()
        self.latest, msg = data, self._frame(1, data)
        with self.lock:
            for s in list(self.clients):
                try:
                    s.settimeout(2)
                    s.sendall(msg)
                    s.settimeout(None)
                except OSError:
                    self.clients.remove(s)


class FrameBuilder:
    """Holds device identity/health + event log; the live plant pushes changes, frame() snapshots."""
    def __init__(self, devices, segments, t0, router_ips=()):
        self.t0, self.segments, self.lock = t0, segments, threading.Lock()
        self.devs = {d["name"]: dict(d, online=True, up_since=0.0) for d in devices}
        self.byip = {d["ip"]: d["name"] for d in devices} | {ip: "router" for ip in router_ips}
        self.events, self.flows, self.seen, self.stop = [], {}, {}, threading.Event()

    def t(self):
        return round(time.time() - self.t0, 3)

    def event(self, kind, device=None, msg=""):
        with self.lock:
            self.events.append(dict(t=self.t(), kind=kind, device=device, msg=msg))
            del self.events[:-60]

    def patch(self, name, **truth):                           # e.g. firmware="28.011"
        with self.lock:
            self.devs[name]["truth"] = dict(self.devs[name]["truth"], **truth)

    def online(self, name, up):
        with self.lock:
            self.devs[name]["online"] = up
            if up:
                self.devs[name]["up_since"] = self.t()

    def flow(self, src_ip, dst_ip, proto, fc, nbytes, **extra):
        k = (self.byip.get(src_ip, src_ip), self.byip.get(dst_ip, dst_ip), proto, fc, tuple(extra.items()))
        with self.lock:
            f = self.flows.setdefault(k, dict(src=k[0], dst=k[1], proto=proto, fc=fc, bytes=0, n=0, **extra))
            f["bytes"] += nbytes
            f["n"] += 1

    def frame(self):
        t = self.t()
        with self.lock:
            flows, self.flows = list(self.flows.values()), {}
            devs = []
            for d in self.devs.values():
                tr, unit = d["truth"], (d.get("process") or {}).get("unit")
                st = dict(online=d["online"], uptime_s=round(t - d["up_since"], 1) if d["online"] else 0)
                if unit:
                    st["unit"] = unit
                    st.update(process.vars(unit, t))
                devs.append(dict(id=d["name"], ip=d["ip"], mac=d["mac"], vendor=tr.get("vendor") or d["oui"].title(),
                                 model=tr.get("model"), firmware=tr.get("firmware"), serial=tr.get("serial"),
                                 segment=d["seg"], role=tr["role"], kind=d["kind"], state=st))
            return dict(t=t, devices=devs, flows=flows[:200], events=list(self.events),
                        segments=[dict(id=k, subnet=v[0] + ".0/24", name=v[1]) for k, v in self.segments.items()])

    def run(self, feed, record=None, hz=5):
        """Publish frames forever (daemon thread); record: text-mode file object, one JSON frame per line."""
        while not self.stop.is_set():
            fr = self.frame()
            feed.publish(fr)
            if record:
                record.write(json.dumps(fr, separators=(",", ":")) + "\n")
            self.stop.wait(1 / hz)


class Sniffer(threading.Thread):
    """tcpdump -w - on a bridge; calls builder.flow() once per distinct packet (routed frames show on 2 bridges)."""
    def __init__(self, bridge, builder):
        super().__init__(daemon=True)
        self.p = subprocess.Popen(["tcpdump", "-i", bridge, "-U", "-s", "200", "-w", "-"], stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL)
        self.b = builder

    def stop(self):
        self.p.terminate()

    def run(self):
        r = self.p.stdout
        r.read(24)
        while True:
            h = r.read(16)
            if len(h) < 16:
                return
            _, _, caplen, origlen = struct.unpack("<IIII", h)
            try:
                self.packet(r.read(caplen), origlen)
            except (struct.error, IndexError):
                pass                                           # truncated / odd frame: not a flow

    def packet(self, f, wire):
        et = struct.unpack(">H", f[12:14])[0]
        if et == 0x0806 and len(f) >= 42:
            op, spa, tpa = struct.unpack(">H", f[20:22])[0], socket.inet_ntoa(f[28:32]), socket.inet_ntoa(f[38:42])
            self.b.flow(spa, tpa, "arp", op, wire, **({"gratuitous": True} if spa == tpa else {}))
            return
        if et != 0x0800 or len(f) < 34:
            return
        ihl, proto, ident = (f[14] & 15) * 4, f[23], struct.unpack(">H", f[18:20])[0]
        src, dst, l4 = socket.inet_ntoa(f[26:30]), socket.inet_ntoa(f[30:34]), 14 + ihl
        sp = dp = 0
        pl = b""
        if proto == 6:
            sp, dp = struct.unpack(">HH", f[l4:l4 + 4])
            pl = f[l4 + (f[l4 + 12] >> 4) * 4:]
            if not pl:
                return                                         # SYN / pure ACK: not an application flow
        elif proto == 17:
            sp, dp = struct.unpack(">HH", f[l4:l4 + 4])
            pl = f[l4 + 8:]
        key, now = (src, dst, ident, wire, sp), time.time()
        if now - self.b.seen.get(key, 0) < 2:                  # same packet seen on the cell bridge and the sup bridge
            return
        self.b.seen[key] = now
        if len(self.b.seen) > 5000:
            self.b.seen = {k: v for k, v in self.b.seen.items() if now - v < 2}
        ports, fc, name = {sp, dp}, None, {6: "tcp", 17: "udp", 1: "icmp"}.get(proto, str(proto))
        if 502 in ports and len(pl) >= 8:
            name, fc = "modbus", pl[7]
        elif 44818 in ports and len(pl) >= 2:
            name, fc = "enip", struct.unpack("<H", pl[:2])[0]
        elif 102 in ports and len(pl) >= 6:
            name = "s7comm"
            fc = pl[5] if pl[5] in (0xE0, 0xD0) else pl[8] if len(pl) > 8 and pl[5] == 0xF0 and pl[7] == 0x32 else None
        self.b.flow(src, dst, name, fc, wire)


def replay(path, feed, loop=False, speed=1.0):
    frames = [json.loads(l) for l in (gzip.open if path.endswith(".gz") else open)(path, "rt") if l.strip()]
    span = frames[-1]["t"] - frames[0]["t"] + 0.2
    n = 0
    while True:
        t0, w0 = frames[0]["t"], time.time()
        for fr in frames:
            time.sleep(max(0, (fr["t"] - t0) / speed - (time.time() - w0)))
            feed.publish(dict(fr, t=round(fr["t"] + n * span, 3), replay=True))
        n += 1
        if not loop:
            print("replay done (last frame stays on GET /)", flush=True)
            return


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", required=True, help="recorded run (.jsonl or .jsonl.gz) written by plant.py --record")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--speed", type=float, default=1.0)
    a = ap.parse_args()
    fd = Feed(a.port, a.host)
    fd.start()
    replay(a.replay, fd, a.loop, a.speed)
    while True:
        time.sleep(3600)                                       # keep serving GET / and connected clients
