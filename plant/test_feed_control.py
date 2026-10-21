#!/usr/bin/env python3
"""python plant/test_feed_control.py - replay clock + upload schedule hold while paused and scale with speed; WebSocket control messages
are validated (masked client frames, junk / oversized frames never hurt the feed). ~6 s."""
import json, os, socket, struct, tempfile, threading, time
import feed

# ---- Clock (fake time): frozen while paused, scales with speed
t = [0.0]
c = feed.Clock(now=lambda: t[0])
t[0] = 2; assert c.get() == 2
c.set(paused=True); t[0] = 10; assert c.get() == 2
c.set(paused=False, speed=2); t[0] = 11; assert c.get() == 4
c.set(speed=0.5); t[0] = 13; assert c.get() == 5
c.reset(); assert c.get() == 0

# ---- replay: 2 s recording, "uploads" at replay t=0.6 and 1.6
rec = os.path.join(tempfile.mkdtemp(), "r.jsonl")
open(rec, "w").write("".join(json.dumps(dict(t=i * 0.2, devices=[], flows=[dict(n=1)], events=[])) + "\n" for i in range(11)))
feed.upload_plan = lambda: [(0.6, ["a"]), (1.6, ["b"])]
ups = []
feed.upload_all = lambda base, paths: ups.append((paths[0], time.monotonic() - T0))

class Fake:
    on_control = None
    def __init__(self): self.frames = []
    def publish(self, f): self.frames.append(dict(f))

fk, ck = Fake(), feed.Clock()
T0 = time.monotonic()
threading.Thread(target=feed.replay, args=(rec, fk, False, 1.0, "http://x", ck), daemon=True).start()
time.sleep(0.3); assert not ups
fk.on_control({"cmd": "pause"})
time.sleep(0.2); n = len([f for f in fk.frames if not f["paused"]]); pos = fk.frames[-1]["pos"]
time.sleep(1.5)                                                # replay time 0.6 would have passed
assert not ups, ups
assert fk.frames[-1]["paused"] is True and fk.frames[-1]["flows"] == [] and fk.frames[-1]["pos"] == pos, fk.frames[-1]
assert len([f for f in fk.frames if not f["paused"]]) == n                    # no new replay frame while paused
assert 1 <= len(fk.frames) - n <= 6                                            # but state is re-sent (heartbeat), not flooded
fk.on_control({"cmd": "play"}); fk.on_control({"cmd": "speed", "x": 2.0})
time.sleep(0.5); assert [u[0] for u in ups] == ["a"], ups                       # 0.3 s left at 2x -> ~0.15 s
assert fk.frames[-1]["paused"] is False and fk.frames[-1]["speed"] == 2.0
t1 = time.monotonic()
while len(ups) < 2 and time.monotonic() - t1 < 3: time.sleep(0.05)
assert [u[0] for u in ups] == ["a", "b"], ups
assert 0.3 < ups[1][1] - ups[0][1] < 0.8, ups                                  # 1.0 s of replay at 2x ~ 0.5 s wall (1.0 s at 1x)
time.sleep(0.4); assert fk.frames[-1]["pos"] == 2.0 and fk.frames[-1]["len"] == 2.2

# ---- WebSocket: masked control frames, junk, oversized
got = []
f = feed.Feed(0, "127.0.0.1"); f.on_control = got.append
f.start(); port = f.srv.server_address[1]

def client():
    s = socket.create_connection(("127.0.0.1", port))
    s.sendall(b"GET /state HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
    assert b"101" in s.recv(1024)
    return s

def send(s, payload, op=1, fin=True):
    d, m = payload if isinstance(payload, bytes) else payload.encode(), b"\x01\x02\x03\x04"
    n = len(d)
    hdr = bytes([(0x80 if fin else 0) | op]) + (bytes([0x80 | n]) if n < 126 else b"\xfe" + struct.pack(">H", n))
    s.sendall(hdr + m + bytes(x ^ m[i % 4] for i, x in enumerate(d)))

s = client()
for bad in ['not json', '[1]', '"pause"', '{"cmd":"reboot"}', '{"cmd":"speed","x":3}', '{"cmd":"speed","x":"2"}', '{"cmd":"speed"}', '{"cmd":"speed","x":true}', '{}']:
    send(s, bad)
send(s, b"\xff\xfe\x00")                                       # not UTF-8
send(s, '{"cmd":"pa', fin=False)                               # fragment: ignored
send(s, b"hi", op=9)                                           # ping -> pong with the same payload
assert s.recv(16) == b"\x8a\x02hi"
for ok in ['{"cmd":"pause"}', '{"cmd":"play"}', '{"cmd":"speed","x":0.5}', '{"cmd":"speed","x":1}', '{"cmd":"speed","x":2}']:
    send(s, ok)
time.sleep(0.3)
assert [(m["cmd"], m.get("x")) for m in got] == [("pause", None), ("play", None), ("speed", 0.5), ("speed", 1), ("speed", 2)], got
send(s, "x" * 5000)                                            # oversized: connection dropped, feed alive
time.sleep(0.2); s.settimeout(2); assert s.recv(16) == b""
s2 = client(); send(s2, b"\x03\xe8", op=8)                     # close is echoed
assert s2.recv(16) == b"\x88\x02\x03\xe8"
f2 = feed.Feed(0, "127.0.0.1"); f2.start()                     # live plant: no handler -> messages ignored
s3 = socket.create_connection(("127.0.0.1", f2.srv.server_address[1])); s3.sendall(b"GET /state HTTP/1.1\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"); s3.recv(1024)
send(s3, '{"cmd":"pause"}'); time.sleep(0.2)
send(s3, b"hi", op=9); assert s3.recv(16) == b"\x8a\x02hi"
print("feed control ok")
