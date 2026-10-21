# Plant state feed (for the 3D viewer)

`ws://localhost:8765/state`, text frames, one JSON object per frame, ~5 Hz (200 ms). Server-to-client; the only client
messages are the replay controls below (everything else is ignored). `GET http://localhost:8765/` returns the latest frame as JSON (curl / debugging).
Reachable from Windows through WSL2 localhost forwarding (verified). stdlib only (`plant/feed.py`).

Sources
- **live**: `plant/plant.py --feed` (or `plant/demo.ps1`): device list from `plant/devices/*.json`, identity changes and
  events from the scenario, process values from `plant/process.py` (same closed-form functions that drive the device
  registers), flows from a tcpdump tap on the three bridges.
- **replay**: `python plant/feed.py --replay plant/demo-run.jsonl.gz [--loop] [--port 8765] [--speed 1]` streams a
  recorded run with the same schema, no WSL needed (`replay: true` is added to every frame; `t` stays monotonic across
  `--loop` iterations). Record a run with `plant.py --record FILE.jsonl.gz`.
  Replay only, a client may send (text frames, masked as RFC 6455 requires): `{"cmd":"pause"}`, `{"cmd":"play"}`,
  `{"cmd":"speed","x":0.5}` (x = 0.5, 1 or 2). Replay time (frames and the timed `--reconnics` uploads) stops while paused and runs at
  `x` times wall speed; the new state is broadcast at once, so every viewer shows the same. A paused replay re-sends its last
  frame (`flows: []`) once a second. The live plant has no clock: it ignores these messages and its frames carry none of the fields below.

## Frame

```jsonc
{
  "t": 23.841,                       // seconds since plant start (replay: since recording start, + n*length when looping)
  "replay": true, "paused": false,   // replay only: flag, and whether the replay clock is stopped
  "speed": 1,                        // replay only: 0.5 | 1 | 2
  "pos": 23.8, "len": 90.2,          // replay only: seconds into the current loop, and the loop length (for a 0:23 / 1:30 readout)
  "devices": [{
    "id": "plc-l33er",               // stable key; flows and events refer to it
    "ip": "10.10.2.10", "mac": "00:00:bc:00:01:0a",
    "vendor": "Rockwell Automation", // clients (hmi/ews/historian): OUI vendor, e.g. "Dell"
    "model": "1769-L33ER",           // null for clients
    "firmware": "20.011",            // changes live when the scenario flashes new firmware (24.011)
    "serial": "60E1F4A2",            // null when the device has none
    "segment": "cell2",              // cell1 | cell2 | sup (see "segments")
    "role": "plc",                   // plc | drive | hmi | ews | historian
    "kind": "enip",                  // protocol stack: modbus | enip | s7native | hmi | ews | historian
    "state": {
      "online": true,                // false while rebooting / flashing
      "uptime_s": 24.2,
      "unit": "tank",                // process unit bound to the device (absent for clients)
      // tank:     level_pct (20..80), temp_c, pump_rpm (0|1450), inlet_valve_open
      // conveyor: running, speed_pct (0..80), parts_count
      "level_pct": 68.5, "temp_c": 67.4, "pump_rpm": 1450, "inlet_valve_open": true
    }
  }],
  "flows": [{                        // packets since the previous frame, aggregated per (src,dst,proto,fc)
    "src": "hmi", "dst": "plc-m221", // device id, "router", or a raw IP if unknown
    "proto": "modbus",               // modbus | enip | s7comm | arp | tcp | udp | icmp
    "fc": 3,                         // modbus: function code; enip: encapsulation command (0x63 ListIdentity, 0x6f SendRRData);
                                     // s7comm: ROSCTR (1 job, 3 ack-data, 7 userdata) or COTP 0xE0/0xD0; arp: opcode; else null
    "bytes": 78, "n": 1,             // wire bytes and packet count in this frame
    "gratuitous": true               // arp only, present when sender IP == target IP
  }],
  "events": [{ "t": 40.0, "kind": "firmware", "device": "plc-l33er", "msg": "firmware started: 20.011 -> 24.011" }],
                                     // last 60, every frame. kinds: boot, sweep, firmware, reboot, online
  "segments": [{ "id": "cell2", "subnet": "10.10.2.0/24", "name": "Line 2 utilities cell (control network)" }]
}
```

Notes for the viewer
- Pure TCP handshakes / ACKs are not reported as flows; request and response are separate flows (opposite `src`/`dst`).
- Packets routed between segments are seen on two bridges but reported once.
- `events` repeats history each frame: key it by `(t, kind, device)` to detect new ones.
- A device flashing firmware goes `online:false` for ~5 s, comes back with the new `firmware` and a gratuitous ARP flow.
- Identity values here equal the plant truth (`plant.truth.json`), not what ReConnICS-ng decoded.
