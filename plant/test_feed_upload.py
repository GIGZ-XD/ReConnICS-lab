#!/usr/bin/env python3
"""python plant/test_feed_upload.py - upload timing comes from scenario.json; upload() logs, treats 409 as done, never raises."""
import http.server, io, contextlib, os, threading
import feed

plan = feed.upload_plan({"events": [{"t": 65, "do": "sweep"}, {"t": 15, "do": "sweep"}, {"t": 40, "do": "firmware"}]})
assert [t for t, _ in plan] == [20, 70], plan                                  # first / last sweep + 5 s, order-independent
assert [os.path.basename(p) for p in plan[0][1]] == [f"{s}-before.pcap" for s in ("cell1", "cell2", "sup")]
assert [os.path.basename(p) for p in plan[1][1]] == [f"{s}-after.pcap" for s in ("cell1", "cell2", "sup")]
assert all(os.path.exists(p) for _, ps in feed.upload_plan() for p in ps), "committed captures missing"   # real scenario.json

seen = []
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        seen.append((self.path, self.headers["Content-Type"], len(self.rfile.read(int(self.headers["Content-Length"])))))
        self.send_response(409 if len(seen) == 2 else 202); self.send_header("Content-Length", "0"); self.end_headers()
    log_message = lambda *a: None
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}"

def run(base, p):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        feed.upload(base, p)
    return out.getvalue()

p = plan[0][1][0]
assert "queued (202)" in run(url, p) and seen[0][:2] == ("/api/v1/captures?name=cell1-before.pcap", "application/octet-stream")
assert "already there (409)" in run(url, p)
assert "failed" in run("http://127.0.0.1:1", p)                                # console down: logged, not raised
assert "failed" in run(url, "no-such.pcap")                                    # missing file: logged, not raised
print("feed upload ok")
