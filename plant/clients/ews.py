"""Engineering workstation identity sweep: Modbus FC43/14, ENIP ListIdentity (UDP+TCP) + CIP Get_Attributes_All,
S7 SZL 0x0011/0x001C. usage: ews.py modbus=IP,.. enip=IP,.. s7=IP,..   (run it 2x, ~30 s apart, in the scenario)"""
import socket, struct, sys
from pymodbus.client import ModbusTcpClient
from pymodbus.pdu.mei_message import ReadDeviceInformationRequest
import snap7

args = dict(a.split("=") for a in sys.argv[1:])
ips = lambda k: [i for i in args.get(k, "").split(",") if i]

for ip in ips("modbus"):
    c = ModbusTcpClient(ip, port=502, timeout=3)
    c.connect()
    for code in (1, 2):                    # basic (0-2) then regular (3-6) stream
        r = c.execute(False, ReadDeviceInformationRequest(read_code=code, object_id=0, dev_id=1))
        print("modbus", ip, "code", code, getattr(r, "information", r))
    c.close()

def encap(cmd, data=b"", session=0, ctx=b"RSLINX00"):
    return struct.pack("<HHII8sI", cmd, len(data), session, 0, ctx, 0) + data

def enip(host):
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(2)
    u.sendto(encap(0x63), (host, 44818))
    print("enip", host, "UDP ListIdentity", len(u.recvfrom(2048)[0]), "bytes")
    t = socket.create_connection((host, 44818), timeout=3)
    def rr(pkt):
        t.sendall(pkt)
        h = t.recv(24)
        b = b""
        while len(b) < struct.unpack("<H", h[2:4])[0]:
            b += t.recv(2048)
        return h, b
    rr(encap(0x63))
    h, _ = rr(encap(0x65, struct.pack("<HH", 1, 0)))
    session = struct.unpack("<I", h[4:8])[0]
    gaa = bytes([0x01, 0x02, 0x20, 0x01, 0x24, 0x01])      # Get_Attributes_All, Identity class 1 inst 1
    cpf = struct.pack("<IHH", 0, 5, 2) + struct.pack("<HH", 0, 0) + struct.pack("<HH", 0xB2, len(gaa)) + gaa
    _, b = rr(encap(0x6F, cpf, session))
    print("enip", host, "GAA reply", len(b), "bytes")
    t.close()

for ip in ips("enip"):
    enip(ip)

for ip in ips("s7"):
    c = snap7.client.Client()
    c.connect(ip, 0, 2, 102)
    print("s7", ip, c.get_order_code(), c.get_cpu_info())   # SZL 0x0011 / 0x001C
    c.disconnect()
