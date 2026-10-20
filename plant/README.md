# Virtual plant (netns): real protocol stacks, real packets, full identity exchanges

Linux network namespaces, one per device; a Linux bridge per segment (switch / SPAN point); a router namespace
between the segments; `tcpdump` on every bridge. Windows: run inside WSL2 (tested on Kali WSL2, root).

| Segment | Subnet | Devices (real stack) |
|---|---|---|
| cell1 | 10.10.1.0/24 | Schneider M221 TM221CE16R V1.5.0.1 and M340 BMXP342020 V2.10 (pymodbus, FC43/14); Siemens S7-300 CPU 315-2 PN/DP (snap7 native server) |
| cell2 | 10.10.2.0/24 | Rockwell 1769-L33ER 20.011 and PowerFlex 525 5.001 (cpppo ENIP, ListIdentity UDP+TCP, CIP GAA); Schneider M580 BMEP582040 V2.70 (pymodbus) |
| sup   | 10.10.3.0/24 | HMI (1 s Modbus FC3 polls, FC6/16 writes, S7 DB reads), historian (5 s polls), EWS (2 identity sweeps) |

```sh
# one time (WSL2/Linux, root): python3 -m venv /root/labvenv && /root/labvenv/bin/pip install -r plant/requirements.txt
sudo /root/labvenv/bin/python plant/plant.py --duration 90          # -> captures/plant/{cell1,cell2,sup}.pcap + plant.truth.json
sh plant/crosscheck.sh captures/plant                              # Wireshark counts of every identity-relevant frame (needs tshark)
java -jar reconnics-ng.jar analyze captures/plant/sup.pcap -o results/plant/sup.json
python plant/verify.py captures/plant/plant.truth.json results/plant/sup.json
```
`sup.pcap` is the "core" tap: it sees every PLC through the router, so PLC MACs are the router's (ReConnICS drops them by
design). `cell1/cell2.pcap` give the real PLC MACs. Device list and expected identity: `plant/devices.py`.

Known gaps: only one S7 identity (snap7 serves a fixed CPU 315 identity), no S7-1200/1500, no Modbus gateway units,
no ENIP backplane slots, no switch/HMI/historian identity, no process model driving anything visible.
