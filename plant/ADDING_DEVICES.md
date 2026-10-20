# Adding a device to the plant

A device is **one JSON file** in `plant/devices/`. `plant/devices.py` loads and validates every `*.json` there (sorted by
file name), derives the IP and MAC, and `plant.py` builds the namespace, starts the protocol stack, announces it with a
gratuitous ARP and includes it in the EWS sweeps, the truth file and the state feed. Nothing else needs editing.

```sh
python plant/devices.py          # validate the registry; prints name / segment / ip / mac / kind
```

## Spec fields

| Field | Meaning |
|---|---|
| `name` | unique id; namespace `rc-<name>`, `id` in the state feed |
| `seg` | segment key from `SEGMENTS` in `devices.py` (`cell1`, `cell2`, `sup`) |
| `host` | last octet, 2..254, unique per segment. IP = `<subnet>.<host>` |
| `oui` | key of `OUI` in `devices.py`; MAC = `<oui>:00:<segment index>:<host>`, so unique per device and vendor-OUI |
| `kind` | protocol stack: `modbus` (pymodbus, FC43/14), `enip` (cpppo: ListIdentity + CIP GAA), `s7native` (snap7; fixed CPU 315 identity), or a client: `hmi`, `ews`, `historian` |
| `ident` | `modbus` only: FC43 objects `VendorName, ProductCode, MajorMinorRevision, VendorUrl, ProductName, ModelName` |
| `cip` | `enip` only: `vendor, devtype, pc` (product code), `rev` `[major, minor]`, `serial`, `status`, `name` |
| `process` | optional `{"unit": "tank" \| "conveyor"}`: which process unit (`plant/process.py`) drives its registers / DB1 / state-feed `state` |
| `truth` | what ReConnICS-ng must decode: `vendor, model, firmware, serial, role`. Conventions: Modbus firmware without the leading `V`; CIP revision `major.%03d`; serial `%08X` |
| `_note` | any key starting with `_` is a comment and ignored |

## Worked example: a second CompactLogix on cell2

`plant/devices/10-plc-l30er.json`:

```json
{
 "name": "plc-l30er", "seg": "cell2", "host": 13, "oui": "rockwell", "kind": "enip",
 "process": {"unit": "conveyor"},
 "cip": {"vendor": 1, "devtype": 14, "pc": 94, "rev": [20, 11], "serial": 1622036993, "status": 12640,
         "name": "1769-L30ER/A LOGIX5330ER"},
 "truth": {"vendor": "Rockwell Automation", "model": "1769-L30ER", "firmware": "20.011",
           "serial": "60AE5201", "role": "plc"}
}
```

Gives `10.10.2.13`, MAC `00:00:bc:00:01:0d`. (`serial` in `cip` is an integer, in `truth` the 8-digit hex string; keep
them equal: `hex(1622036993)` is `0x60AE5201`.) Then `python plant/devices.py`, `sh plant/run.sh`, and the device
appears in `captures/plant/*.pcap`, `plant.truth.json`, `plant/verify.py` and the state feed.

To put it in the storyline, add an event to `plant/scenario.json`, e.g. a firmware change:
`{"t": 40, "do": "firmware", "device": "plc-l30er", "down_s": 5, "cip": {"rev": [24, 11]}, "firmware": "24.011"}`
(`cip` / `ident` hold the identity fields that change; `firmware` is the new truth value).

Pick identity values that are real: model/firmware ranges that have an advisory in the ReConnICS-ng index, so the
advisory stage has something to hit (`grep` the product in `ReConnICS-ng/data/index.json`).

## Planned devices (not implemented, stubs only)

| Device | What it needs | Notes |
|---|---|---|
| Siemens S7-1200 (6ES7 214-1AG40-0XB0, FW V4.x in an advisory range) | new `kind: s7szl`: a classic-S7comm SZL responder (COTP CR/CC, setup-communication, userdata SZL 0x0011 / 0x001C) replacing snap7's fixed identity | byte builders to reference: `ReConnICS-ng/eval/lab/pcapgen.py` (`cotp_cc`, `s7_setup_ack`, `szl_0011_records`, `szl_001c_records`, `s7_szl_resp`) |
| Siemens S7-1500 (6ES7 518-4AX00-1AB0, FW in a KEV-listed range if one exists) | same `s7szl` kind with different records | check the index `kev` column for the product first |
| Modbus TCP gateway with 3 serial units | `kind: modbus_gw`: one IP, unit ids 1-3 each answering FC43 with a different `ident` | `ident` becomes a map unit id -> identity; EWS must sweep unit ids 1..3 |
| ENIP chassis: 1756-L7x in slot 0 + 1756-EN2T | `kind: enip_chassis`: answer Unconnected_Send (service 0x52) routed by port/slot to per-slot Identity objects | ReConnICS-ng already decodes the routed reply (`parseRequest` in `EnipIdentityParser`); EWS would send GAA through a slot route; cpppo cannot do this, so a small custom ENIP server is needed |
