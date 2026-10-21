# 3D plant viewer

Browser viewer for the netns plant (`plant/`): a procedural plant floor bound to the plant's state feed, with a
side-by-side of what ReConnICS-ng inferred versus the plant's actual values. Static files, no build step. Three.js
0.160.0 is loaded from jsdelivr via an import map (internet needed on first load; vendor it if the lab is offline).

![overview](docs/overview-sweep.jpg)

## Run

```sh
cd viewer && python -m http.server 8123      # then open http://localhost:8123/
```

### With the live ReConnICS-ng console (the demo)

`?reconnics=http://127.0.0.1:8088` polls the console's read-only API every 3 s (`/api/v1/inventory`, `/changes`, `/captures`), so nothing needs a
file picker. The ReConnICS-ng column starts empty, fills when the first capture has been analysed, and shows the firmware change after the second upload.
Needs the `--allow-origin` flag of `serve` (ReConnICS-ng main; the console never answers CORS preflight; the flag opens only those three GETs to the exact origin).

```powershell
# 1. ng repo (fresh --data dir per demo)
java -jar target\reconnics-ng.jar serve --index data\index.json --pubkey keys\index-signing.pub --data data\site-demo --allow-origin http://localhost:8123
# 2. lab repo: replay the plant; the feed uploads the committed before/after pcaps as the story passes each sweep
.\plant\demo.ps1 -Replay -ReconnICS http://127.0.0.1:8088
# 3. viewer, then open http://localhost:8123/?reconnics=http://127.0.0.1:8088
cd viewer; python -m http.server 8123
```
Header chip: `ReConnICS-ng - 127.0.0.1:8088 - N analysed`, or `not reachable` (console down, or started without `--allow-origin <this page's origin>`).

| Mode | How | Badge |
|---|---|---|
| auto (default) | tries `ws://localhost:8765/state` for 2.5 s, falls back to the built-in simulator, retries live every 6 s | LIVE / DEMO DATA |
| live | `?mode=live` (optionally `&ws=ws://host:port/state`); waits and retries if the feed is down | LIVE |
| plant replay | start `python plant/feed.py --replay plant/demo-run.jsonl.gz --loop` (stdlib, any OS) and open the viewer normally; frames carry `replay: true` | REPLAY (plant feed.py) |
| file replay | `?replay=sample/demo-run.jsonl.gz` plays a recording client-side (JSON array, NDJSON or `.gz`, honours `t`, loops) | REPLAY |
| demo | `?mode=demo`; built-in simulator, same schema | DEMO DATA |

Replays (plant feed.py, `?replay=`) and the built-in demo have Pause/Play (Space) and 0.5x / 1x / 2x in the header next to the badge; the badge reads PAUSED. With feed.py the clock is shared by every viewer and the timed ReConnICS-ng uploads pause with it.

Live plant: `.\plant\demo.ps1` (WSL2) or `sh plant/run.sh --feed`. `sample/demo-run.jsonl.gz` is a copy of the committed
`plant/demo-run.jsonl.gz` (lab commit 4137997/c213a25).

Other URL params: `?reconnics=URL` (live console), `?inventory=a.json,b.json` (ReConnICS-ng inventories, file fallback), `?changes=log.json`, `?view=overview|cell1|cell2|control|hero`,
`?select=10.10.2.10`.

## Storyline (feed `events`, same in the demo simulator)

boot + gratuitous ARP (t=4) -> HMI polling -> **EWS identity sweep (t=15)** -> **L33ER firmware flash 20.011 -> 24.011
(t=40, offline ~7 s)** -> **second sweep (t=65)** -> loop at 90 s.

- **Hero: Rockwell 1769-L33ER (10.10.2.10)**, the most detailed cabinet: PSU, controller with LED set, asset-tag plate (model / FW /
  serial), four I/O modules whose channel LEDs follow the tank (pump, low/high level), M580 rack, terminal blocks, relays, breakers,
  wiring harness, beacon (green run / amber flash / blue sweep), floor marker. Key `5` / "L33ER cabinet" flies to it.
- **Identity sweep visual**: identity requests (everything the EWS initiates, plus FC43 / ENIP ListIdentity from clients) are
  magenta, larger, haloed and slower than normal traffic. When one reaches a device a ring pulses there; at the L33ER you also get a
  magenta scan beam through the cabinet, a callout naming the request, the blue beacon, and an event line. The EWS monitor scrolls the probes.
- **Firmware change**: during the flash the controller LEDs go red/amber and the plate shows FLASHING; when it returns the plate turns
  amber with `FW 24.011 CHANGED`, a banner floats over the cabinet, the identity card tags it `changed` and keeps a history.

## Identity card and ReConnICS view

The device list is grouped by segment (collapsible), names only (IP and role in the tooltip); the L33ER is tagged **Demo device**
(wired end to end: identity, advisory, firmware change). Click a device in 3D or use the list (Up/Down, Enter). The panel shows the device,
then lab vs ReConnICS-ng, then live process state:

- Live from the console (`?reconnics=`); fallback: the small "Load inventory file..." link (several files), "Load sample" or `?inventory=`. Accepted: `reconnics-ng inventory` output
  (`schema:1`), `analyze` output, the `/api/v1/inventory` wrapper, and a change log array (`/api/v1/changes` shape `{at, asset, field, from, to}`).
- One row of steps from the record: `pcap -> decoded message, frame N -> n fields -> advisory LEVEL`. Message and frame are parsed from the evidence strings
  (`ethernet-ip ListIdentity ... frame 573`, `modbus FC43/14 ...`, `s7comm SZL 0x001C ...`; the raw text stays in the tooltip). The pcap name is inferred: the merged
  inventory does not name the capture, so the viewer takes the latest finished capture whose frame count can hold that frame.
- Table per field: "Lab (actual)" (a feed change shows as struck old -> new) | "ReConnICS-ng (from pcap)" value, confidence and a one-line evidence | status dot / mismatch / missing; advisory
  match level and advisories (top 3). A "Details" disclosure holds completeness, what is still missing, merge notes and the console's capture log; the two-inventory picker lives there too.
- Two inventories loaded from files: what changed for that device (firmware, advisory level, advisories) is listed under the table. The console's change log entries for
  the identity fields (e.g. `firmware 20.011 -> 24.011`) are listed too.
- `sample/inventory-before.json` / `inventory-after.json` are real `reconnics-ng` runs over the plant's `captures/plant/sup-before.pcap` /
  `sup-after.pcap` (index signature **not** verified; the lab has no public key). "Load sample" loads them. `sample/changes.json` is
  hand-written and not loaded by default. `sample/live-inventory.json` / `live-changes.json` are real `/api/v1/inventory` and `/api/v1/changes`
  answers from a console that analysed all six plant captures (trimmed to two assets; used by the test).

## Verify

```sh
node viewer/test/inventory.test.mjs          # parse / compare / diff, evidence parser, live-console wrapper (sample/live-*.json)
python plant/test_feed_upload.py             # feed.py upload timing (from scenario.json) and error handling
```
Rendering: open the page, check the DevTools console is empty, step through the five camera presets.

## Screenshots

Chrome DevTools: Ctrl+Shift+P -> "Capture screenshot" (viewport) at 1568x733 or similar. The canvas uses `preserveDrawingBuffer`, so
`viewer.canvas.toDataURL('image/png')` in the console also works. For a repeatable shot: `?mode=demo&view=hero&select=10.10.2.10&inventory=sample/inventory-before.json,sample/inventory-after.json`
and wait ~50 s for the firmware change. Committed examples in `docs/`.

## Files

`index.html`, `style.css`; `js/main.js` (wiring, events, selection), `live.js` (polls the console), `feed.js` (live/replay/demo sources), `schema.js` (STATE_FEED.md
adapter, identity detection), `demo.js` (simulator), `scene.js` (renderer, packets, LEDs, picking), `plant3d.js` + `cabinets.js` +
`parts.js` (procedural geometry), `inventory.js` (parse/compare/diff, DOM-free), `ui.js` (panels).

## Limitations / next steps

- Conformance to STATE_FEED.md is done for `devices`, `flows`, `events` (drives the event strip, keyed by `(t, kind, device)`) and device
  `state`; `segments` is read but not used. Flows from `router` are routed to the network cabinet; raw-IP endpoints are resolved by IP.
- Process binding: `level_pct`, `pump_rpm`, `speed_pct`, `temp_c`; the first device carrying a value wins (L33ER first). Unit assignments in the feed
  (e.g. PF525 = conveyor) do not match the 3D layout (PF525 drives the pump); the VFD display follows `pump_rpm`.
- The 3D layout is static and keyed by the plant's IPs; devices added to `plant/devices/` appear in the list but not in 3D.
- Three.js comes from a CDN; picking ignores doors (clicks go through); no automated browser test.
