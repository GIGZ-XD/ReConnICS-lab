# Demo script: plant -> ReConnICS-ng -> site console -> 3D viewer

Focus device: **Rockwell 1769-L33ER** `plc-l33er`, 10.10.2.10, MAC 00:00:bc:00:01:0a, serial 60E1F4A2, firmware
**20.011 -> 24.011** at t=40 s. Advisory ICSA-16-061-02 (affected `<=27.011`) matches EXACT before and after (the update
stays inside the affected range).

Prerequisites: WSL2 distro `kali-linux` with root, `tcpdump`, `iproute2`, `python3-venv` (first run builds
`/root/labvenv`: pymodbus, python-snap7, cpppo); Windows Python 3 and Java 21+. ReConnICS-ng main built (`mvn -q package -DskipTests`) with a verified advisory index in
`data\` — setup is in the [README](../README.md#set-up-reconnics-ng-once-for-a-and-b). No WSL? Skip to "Without WSL".

## 1. Start the plant (about 100 s)

```powershell
cd ReConnICS-lab
.\plant\demo.ps1
```
Expected, immediately:
```
Plant starting in WSL (kali-linux), 90 s. Storyline: boot + gratuitous ARP -> HMI polling -> EWS sweep -> L33ER firmware 20.011 -> 24.011 -> EWS sweep.
State feed (live while the plant runs, ~8 s after start): ws://localhost:8765/state   latest frame: http://localhost:8765/
feed: ws://localhost:8765/state  (GET / returns the latest frame)
```
Timeline (t = seconds after capture start; also in the feed `events`):

| t | event |
|---|---|
| 0-4 | devices up; at 4 every device sends 2 gratuitous ARPs (`boot` event); HMI polls Modbus FC3 / S7 DB1 / ENIP Read Tag every ~1 s (jittered), historian every 5 s |
| 15 | EWS identity sweep: Modbus FC43 x3, ENIP ListIdentity + CIP Get_Attributes_All x2 (L33ER, PowerFlex), S7 SZL; the console prints `modbus ...` / `enip 10.10.2.10 UDP ListIdentity 88 bytes` / `s7 ...` lines |
| 40-47 | L33ER firmware flash: `online:false` for 5 s, restarts reporting 24.011, gratuitous ARP at ~47, HMI reconnects |
| 65 | second EWS sweep: L33ER now answers revision 24.011 |
| 90 | stop; split pcaps, truth file written |

While it runs, check the feed from Windows (any time after ~8 s):
```powershell
curl.exe -s http://localhost:8765/ | python -c "import sys,json; d=json.load(sys.stdin); print(d['t'], [x for x in d['devices'] if x['id']=='plc-l33er'][0])"
```
Expected: `{'id': 'plc-l33er', 'ip': '10.10.2.10', 'mac': '00:00:bc:00:01:0a', 'vendor': 'Rockwell Automation', 'model': '1769-L33ER', 'firmware': '20.011', 'serial': '60E1F4A2', ... 'state': {'online': True, 'unit': 'tank', 'level_pct': ..., 'pump_rpm': ...}}`
(`firmware` is `24.011` after t=45). Schema: `STATE_FEED.md`.

End of run:
```
wrote .../captures/plant
Done. Written to ...\captures\plant :  cell1|cell2|sup .pcap, <seg>-before.pcap, <seg>-after.pcap, plant.truth.json, run.jsonl.gz
```

## 2. 3D viewer, fed by the live console

Same three terminals as [README, Demo A](../README.md#demo-a-replay-with-the-live-console); the commands are repeated here so this page stands alone.

```powershell
# terminal 1, ng repo: a FRESH --data dir for every demo, the viewer's origin allowed (three read-only GETs only)
java -jar target\reconnics-ng.jar serve --index data\index.json --pubkey keys\index-signing.pub --data data\site-demo --allow-origin http://localhost:8123
# terminal 2, lab repo: replay and upload (live plant: .\plant\demo.ps1 -ReconnICS http://127.0.0.1:8088 uploads once the run ends)
.\plant\demo.ps1 -Replay -ReconnICS http://127.0.0.1:8088
# terminal 3
cd viewer; python -m http.server 8123
```
Open `http://localhost:8123/?reconnics=http://127.0.0.1:8088` and click the L33ER (Demo device). Expected:
- Chip `ReConnICS-ng - 127.0.0.1:8088 - 0 analysed`; the ReConnICS-ng column is empty.
- ~5 s after the first sweep the `*-before.pcap` files are uploaded (the feed prints `reconnics: upload cell1-before.pcap -> queued (202)`);
  within seconds the column fills: `sup-before.pcap -> ENIP ListIdentity - frame 358 -> 4 fields -> ICSA-16-061-02 EXACT`, each value with its message and frame under it.
- t=40-47: the plant's firmware is 24.011 (Lab column `20.011 -> 24.011`), the console still says 20.011: red `mismatch`.
- ~5 s after the second sweep (t=70) the `*-after.pcap` files are uploaded; the console reports 24.011 (match), logs
  `firmware 20.011 -> 24.011`, and the viewer shows it in the event strip.
- Too fast? The viewer header has Pause/Play (Space) and 0.5x / 1x / 2x for the replay; the uploads follow replay time, so they wait while paused and slow down with the speed.
- The replay loops. A second loop re-sends the same pcaps (`409 already there`) and the console already says 24.011 from t=0, so the
  next loop shows a reversed mismatch before the firmware flash. To see the story from the start again, Ctrl+C the console and the feed, restart both
  (new `--data` dir) and hard-refresh the viewer.

Without `?reconnics` the panel shows one line on how to connect; "Load inventory file..." and the sample inventories still work.
The live feed ends when a live run ends; to watch the same storyline without WSL use `-Replay`. Live plant with `-ReconnICS` has not been tested end to end.

Expected in the viewer (feed `ws://localhost:8765/state`): 9 devices on 3 segments; tank/conveyor values moving (tank level 20-80 % on a 60 s cycle);
at t~15 a burst of `enip`/`modbus`/`s7comm` flows from `ews` to every PLC; at t=40 `plc-l33er` goes offline, returns
at ~47 s with firmware 24.011 and an `arp` gratuitous flow; event `firmware: 20.011 -> 24.011`.

## 3. ReConnICS-ng decode and advisory match (CLI)

```powershell
java -jar target\reconnics-ng.jar analyze captures\plant\cell2-before.pcap -o results\plant\cell2-before.json
java -jar target\reconnics-ng.jar inventory --in results\plant\cell2-before.json --out results\plant\inv-before --index data\index.json --pubkey keys\index-signing.pub
python plant\verify.py captures\plant\plant.truth.json results\plant\cell2-before.json results\plant\inv-before\inventory.json
```
Expected for 10.10.2.10: `vendor=ok model=ok firmware=ok(initial) serial=ok mac=ok`, `match=EXACT advisories=ICSA-16-061-02:EXACT, ICSA-13-011-03:PROBABLE`.
For `cell2-after.pcap`: same row with firmware ok (24.011), still EXACT.

## 4. Site console

```powershell
java -jar target\reconnics-ng.jar serve --index data\index.json --pubkey keys\index-signing.pub --data data\site-demo
```
(`-ReconnICS` above does this for you.) By hand: open http://127.0.0.1:8088/ -> **Capture queue** -> upload `captures\plant\cell2-before.pcap`, wait for `done`, then upload
`captures\plant\cell2-after.pcap` (UI = `POST /api/v1/captures`; `curl -X POST -H "Content-Type: application/octet-stream" --data-binary @file "http://127.0.0.1:8088/api/v1/captures?name=file.pcap"` does the same).

Expected (verified on ng `fix/p0-ui-data` 667974c, screenshots taken):
- **Inventory -> 10.10.2.10**: title `1769-L33ER/A LOGIX5333ER`, badge **EXACT**; IP 10.10.2.10; MAC 00:00:bc:00:01:0a; Protocols ethernet-ip;
  Ports 44818/tcp, 44818/udp; Role PLC (HIGH); Manufacturer Rockwell Automation; Model 1769-L33ER/A LOGIX5333ER; OS/firmware
  **24.011** with a `conflict` tag and evidence `also saw "20.011"`; Serial 60E1F4A2; Device type cip:0x0E. **Advisories (2)**: ICSA-16-061-02 EXACT (`<=27.011`), ICSA-13-011-03 PROBABLE.
- **Capture queue**: c0001 `new:7`, c0002 `changed:1`.
- **Change log**: two `capture` rows, `cell2-before.pcap merged {"new":7,...}` and `cell2-after.pcap merged {"changed":1,"notSeen":1}`.

Note: current ng main also logs a per-asset row (`10.10.2.10 firmware 20.011 -> 24.011`, source `capture c0006`); older builds only logged counts.
The merged inventory does not say which capture an evidence frame came from; the viewer infers it (latest finished capture long enough to hold that frame number).

## Without WSL

`.\plant\demo.ps1 -Replay` for the viewer; use the committed `captures\plant\*.pcap` for steps 3-4.
