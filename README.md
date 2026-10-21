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

## Run the demo

Three demos, from least to most setup. Commands are PowerShell on Windows, run from the folder named in the comment.

| Demo | Needs | Shows |
|---|---|---|
| A. Replay + console | Python 3, Java 21+, ReConnICS-ng, internet on first load | The full story with no WSL: plant replay, 3D viewer, ReConnICS-ng console filling in as pcaps are analysed |
| B. Live plant | A, plus WSL2 (Kali, root) | The same story from a real run of the plant |
| C. Viewer only | Python 3, internet on first load | The 3D viewer on built-in demo data, no console |

The viewer loads Three.js from a CDN, so the first page load needs internet.

### Set up ReConnICS-ng (once, for A and B)

Skip this for C.

```powershell
# next to this repo, so it sits at ..\ReConnICS-ng
git clone https://github.com/Skoelle18/ReConnICS-ng ..\ReConnICS-ng
cd ..\ReConnICS-ng
mvn -q package -DskipTests          # builds target\reconnics-ng.jar (Java 21+, Maven 3.9+)
```

You also need a signed advisory index and the matching public key. `serve` refuses an index whose signature does not
verify against `--pubkey`, and it cannot start without an index. CI rebuilds a signed index daily and publishes it as the
`advisory-index` release; the public key is `keys\index-signing.pub` in the ReConnICS-ng repo.

```powershell
# in ..\ReConnICS-ng, on up-to-date main (git pull gets the current keys\index-signing.pub)
gh release download advisory-index -R Skoelle18/ReConnICS-ng -D staging
java -jar target\reconnics-ng.jar verify --index staging\index.json --pubkey keys\index-signing.pub   # expect: verify: OK, generated ..., N rows
New-Item -ItemType Directory -Force data | Out-Null
Move-Item staging\index.json, staging\index.json.sig data\ -Force
```

> **Older ReConnICS-ng checkout?** Run `git pull` first, then `mvn -q package -DskipTests`, and replace any
> `data\index.json` and `data\index.json.sig` you downloaded earlier. The signing key was replaced; an index signed with
> the old key no longer verifies, so `serve --pubkey keys\index-signing.pub` will refuse it.

No GitHub access? Local demos only: `java -jar target\reconnics-ng.jar keygen --keys keys-local`, then
`build-index --sign-key keys-local\index-signing.key` (needs internet to mirror the CSAF/KEV feeds), and pass
`keys-local\index-signing.pub` to `serve --pubkey`. That index is signed by you, not by the project.

### Demo A: replay with the live console

Three terminals. Start them in this order.

```powershell
# 1. console, in ..\ReConnICS-ng (use a fresh --data dir each time)
java -jar target\reconnics-ng.jar serve --index data\index.json --pubkey keys\index-signing.pub --data data\site-demo --allow-origin http://localhost:8123

# 2. plant replay + pcap uploads, in this repo
.\plant\demo.ps1 -Replay -ReconnICS http://127.0.0.1:8088

# 3. viewer, in this repo
cd viewer; python -m http.server 8123
```

Then open <http://localhost:8123/?reconnics=http://127.0.0.1:8088> and click the L33ER (tagged "Demo device").

If PowerShell blocks `demo.ps1` (execution policy), run `powershell -ExecutionPolicy Bypass -File .\plant\demo.ps1 -Replay -ReconnICS http://127.0.0.1:8088`,
or skip the script: `python plant\feed.py --replay plant\demo-run.jsonl.gz --loop --reconnics http://127.0.0.1:8088`.

What happens (t is seconds into the 90 s loop):

| t | What you see |
|---|---|
| 0 | Header chip says `ReConnICS-ng - 127.0.0.1:8088 - 0 analysed`; the ReConnICS-ng column is empty |
| about 20 | First pcaps uploaded to the console; the column fills: L33ER firmware 20.011, advisory ICSA-16-061-02 `EXACT` |
| 40-47 | L33ER firmware flash. The plant now says 24.011, the console still says 20.011: red `mismatch` |
| about 70 | Second pcaps uploaded; the console reports 24.011, adds a change-log entry `firmware 20.011 -> 24.011`, and the viewer shows it in the event strip |

The viewer header has Pause/Play (Space) and 0.5x / 1x / 2x. Uploads follow replay time, so they wait while paused and
slow down with the speed.

The console itself is at <http://127.0.0.1:8088/>: **Capture queue** (the uploads), **Inventory** (click a device, then
Attributes / Advisories / History tabs), **Change log**.

**Restarting the demo:** Ctrl+C the console and the replay, then start both again with a new or emptied `--data` dir
(for example `data\site-demo2`), and hard-refresh the viewer (Ctrl+F5). The console keeps its captures, and the replay
loops: a second loop would re-send the same pcaps (`409 already there`) and play the story against a console that already
says 24.011.

### Demo B: live plant in WSL2

Same three terminals, but terminal 2 runs the real plant for 90 s, then uploads the captures it wrote:

```powershell
.\plant\demo.ps1 -ReconnICS http://127.0.0.1:8088
```

Needs a WSL2 distro `kali-linux` with root, `tcpdump`, `iproute2` and `python3-venv` (first run builds a venv). Not yet
tested end to end with `-ReconnICS`; the replay path in A is. The live feed ends with the run, and the uploads happen once
it has ended, so the console fills at the end rather than during the story.

### Demo C: viewer only

```powershell
cd viewer; python -m http.server 8123
```

Open <http://localhost:8123/?mode=demo> for the built-in simulator, or click "Load sample" in the identity panel to load a
real ReConnICS-ng result without a console. Details and URL options: [`viewer/README.md`](viewer/README.md). The step-by-step
script with expected output is [`plant/DEMO.md`](plant/DEMO.md).

## Verify

```sh
python plant/verify.py captures/plant/plant.truth.json results/plant/cell2.json   # score ReConnICS-ng output vs truth
sh plant/crosscheck.sh captures/plant                                              # tshark counts of identity frames
```

## Not done yet

- S7-1200/1500, a Modbus gateway and a ControlLogix chassis (stubs in `plant/ADDING_DEVICES.md`).
- A Docker Compose version, so the plant runs without WSL2.
- The viewer loads Three.js from a CDN, so its first load needs internet.
- Demo B (live plant with `-ReconnICS`) has not been tested end to end.
