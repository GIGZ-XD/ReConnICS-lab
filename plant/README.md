# Virtual plant (netns): real protocol stacks, real packets, full identity exchanges

Linux network namespaces, one per device; a Linux bridge per segment (switch / SPAN point); a router namespace between the
segments; `tcpdump` on every bridge. Windows: runs inside WSL2 (tested on Kali WSL2, root).

| Segment | Subnet | Devices (real stack) |
|---|---|---|
| cell1 | 10.10.1.0/24 | Schneider M221 TM221CE16R V1.5.0.1 and M340 BMXP342020 V2.10 (pymodbus, FC43/14); Siemens S7-300 CPU 315-2 PN/DP (snap7 native server) |
| cell2 | 10.10.2.0/24 | **Rockwell 1769-L33ER 20.011** and PowerFlex 525 5.001 (cpppo ENIP, ListIdentity UDP+TCP, CIP GAA, Read Tag); Schneider M580 BMEP582040 V2.70 (pymodbus) |
| sup   | 10.10.3.0/24 | HMI (jittered 1 s Modbus FC3 polls, FC6/16 writes, S7 DB reads, ENIP Read Tag), historian (5 s polls), EWS (2 identity sweeps) |

Devices are data: one JSON file each in `devices/` (see `ADDING_DEVICES.md`). The storyline is `scenario.json`; the tank /
conveyor model driving registers, DB1 and the feed is `process.py`.

## Run

```powershell
.\plant\demo.ps1                 # Windows: WSL plant + live feed + pcaps, 90 s   (storyline and expected output: DEMO.md)
.\plant\demo.ps1 -Replay         # Windows, no WSL: replay the committed recording on the same feed
```
```sh
sh plant/run.sh                                  # Linux/WSL2 as root; builds /root/labvenv on first use. -> captures/plant/
sh plant/run.sh --feed --record /tmp/run.jsonl.gz   # also serve ws://localhost:8765/state and record the frames
python plant/feed.py --replay plant/demo-run.jsonl.gz --loop   # any OS, stdlib only
sh plant/crosscheck.sh captures/plant            # Wireshark counts of every identity-relevant frame (needs tshark)
java -jar reconnics-ng.jar analyze captures/plant/cell2.pcap -o results/plant/cell2.json
python plant/verify.py captures/plant/plant.truth.json results/plant/cell2.json
```

Outputs in `captures/plant`: `cell1|cell2|sup.pcap` (whole run), `<seg>-before.pcap` / `<seg>-after.pcap` (split at the
firmware change, for the site console change log), `plant.truth.json`. `sup.pcap` is the "core" tap: it sees every PLC
through the router, so PLC MACs there are the router's (ReConnICS drops them by design); `cell1/cell2` carry the real PLC MACs.

State feed for the 3D viewer: `STATE_FEED.md`.

## Not done / unverified
- No S7-1200/1500, Modbus gateway units or ENIP backplane chassis (planned, stubs in `ADDING_DEVICES.md`).
- `docker-compose.yml` alternative not written.
- The netns path is the verified one; everything was run on Kali WSL2 only.
