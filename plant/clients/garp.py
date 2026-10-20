"""Gratuitous ARP (announce) from this netns: broadcast ARP request with sender IP == target IP, as hosts send at boot /
link-up.  usage: garp.py IFACE IP MAC [count]"""
import socket, struct, sys, time
iface, ip, mac = sys.argv[1:4]
m, a = bytes.fromhex(mac.replace(":", "")), socket.inet_aton(ip)
frame = b"\xff" * 6 + m + b"\x08\x06" + struct.pack("!HHBBH", 1, 0x0800, 6, 4, 1) + m + a + b"\0" * 6 + a
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW)
s.bind((iface, 0))
for _ in range(int(sys.argv[4]) if len(sys.argv) > 4 else 2):   # RFC 5227 announces: 2, 2 s apart (1 s here)
    s.send(frame.ljust(60, b"\0"))
    time.sleep(1)
