#!/bin/sh
# Independent count of identity-relevant frames per capture using Wireshark dissectors. usage: crosscheck.sh DIR
for f in "$1"/*.pcap; do
  echo "== $f  ($(tshark -r "$f" 2>/dev/null | wc -l) frames)"
  c() { printf '  %-28s %s\n' "$1" "$(tshark -r "$f" -Y "$2" 2>/dev/null | wc -l)"; }
  c "ARP"                       arp
  c "Modbus FC3 (poll)"         "modbus.func_code==3"
  c "Modbus FC6/16 (writes)"    "modbus.func_code==6 || modbus.func_code==16"
  c "Modbus FC43 (identity)"    "modbus.func_code==43"
  c "ENIP ListIdentity"         "enip.command==0x63"
  c "ENIP SendRRData (CIP GAA)" "enip.command==0x6f"
  c "S7 userdata (SZL)"         "s7comm.header.rosctr==7"
  c "S7 read/write var"         "s7comm.param.func==0x04 || s7comm.param.func==0x05"
  c "non-IP/ARP other"          "!ip && !arp"
done
