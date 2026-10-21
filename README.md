# ReConnICS lab

A simulated OT plant that produces realistic industrial network traffic, so
[ReConnICS-ng](https://github.com/Skoelle18/ReConnICS-ng) can be tested and demoed against captures with complete
identity data. It also includes a 3D viewer that shows the plant live, next to what ReConnICS-ng inferred.

Every device runs a real protocol stack and answers identity requests the way the hardware does. If ReConnICS-ng misses
a field on these captures, the gap is in the tool, not the data.

## What's in it

| Path | What |
|---|---|
| [`plant/`](plant/README.md) | The virtual plant: Linux network namespaces in WSL2, 3 segments, 9 devices, capture on every segment, live state feed |
| [`viewer/`](viewer/README.md) | 3D plant viewer (Three.js, static files): live, replay or demo mode, ReConnICS side-by-side |
| `captures/plant/`, `results/plant/` | Committed output of the demo run: pcaps, truth file, ReConnICS-ng results |
| `captures/`, `ground-truth/`, `notes/`, `reports/`, `results/`, `tools/` | Earlier evaluation material: loopback Modbus demos and GRFICS captures (Modbus reads/writes only, no identity exchanges) |
| `GRFICSv3` | A gitlink to a GRFICSv3 commit with no `.gitmodules` entry, so it does not check out; kept for reference |

## The plant

| Segment | Subnet | Devices |
|---|---|---|
| cell1 | 10.10.1.0/24 | Schneider M221 (.10), M340 (.11), Siemens S7-315 (.12) |
| cell2 | 10.10.2.0/24 | Rockwell 1769-L33ER (.10), PowerFlex 525 (.11), Schneider M580 (.12) |
| sup | 10.10.3.0/24 | HMI (.20), engineering workstation (.21), historian (.22) |

Stacks: pymodbus (Modbus FC43 device identification), python-snap7 (S7comm SZL), cpppo (EtherNet/IP ListIdentity and
CIP Get_Attributes_All). Firmware versions sit inside real advisory ranges, so advisory matching has something to find.
Devices are data, one JSON file each in `plant/devices/`; see [`plant/ADDING_DEVICES.md`](plant/ADDING_DEVICES.md).

Demo storyline (`plant/scenario.json`): boot with gratuitous ARP, HMI and historian polling, an engineering-workstation
identity sweep at 15 s, a firmware change on the L33ER (20.011 -> 24.011) at 40 s, a second sweep at 65 s.

## Quick start

Requirements: Windows with WSL2 (tested on Kali, root) for the live plant; Python 3 for replay and the viewer; Java 21+
and a ReConnICS-ng build to analyze the captures.

```powershell
.\plant\demo.ps1             # live plant in WSL2, 90 s: pcaps in captures\plant, feed on ws://localhost:8765/state
.\plant\demo.ps1 -Replay     # no WSL: replays the committed recording on the same feed

cd viewer; python -m http.server 8123    # open http://localhost:8123/ (falls back to built-in demo data)
```

Then analyze the captures with ReConnICS-ng, or upload `captures\plant\cell2-before.pcap` and `cell2-after.pcap` to its
site console. The full step-by-step demo with expected output is [`plant/DEMO.md`](plant/DEMO.md).

## Verify

```sh
python plant/verify.py captures/plant/plant.truth.json results/plant/cell2.json   # score ReConnICS-ng output vs truth
sh plant/crosscheck.sh captures/plant                                              # tshark counts of identity frames
```

## Not done yet

- S7-1200/1500, a Modbus gateway and a ControlLogix chassis (stubs in `plant/ADDING_DEVICES.md`).
- A Docker Compose version, so the plant runs without WSL2.
- The viewer loads Three.js from a CDN, so its first load needs internet.
