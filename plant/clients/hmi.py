"""HMI / historian: persistent polling with +-10% jitter: Modbus/TCP FC3, occasional setpoint writes (FC6/FC16),
S7 DB reads, ENIP CIP Read Tag (SendRRData).  Reconnects when a device reboots (firmware flash).
usage: hmi.py PERIOD_S DURATION_S modbus=IP,IP s7=IP enip=IP,IP"""
import random, socket, struct, sys, time
from pymodbus.client import ModbusTcpClient
import snap7

period, dur = float(sys.argv[1]), float(sys.argv[2])
args = dict(a.split("=") for a in sys.argv[3:])
ips = lambda k: [i for i in args.get(k, "").split(",") if i]


def encap(cmd, data=b"", session=0):
    return struct.pack("<HHII8sI", cmd, len(data), session, 0, b"HMI00000", 0) + data


class Enip:
    """Register a session, then read INT tag 'Tag' with the Logix Read Tag service (0x4C) in an unconnected SendRRData."""
    def __init__(self, host):
        self.host, self.s = host, None

    def _rx(self):
        h = self.s.recv(24)
        b = b""
        while len(b) < struct.unpack("<H", h[2:4])[0]:
            b += self.s.recv(2048)
        return h, b

    def poll(self):
        try:
            if not self.s:
                self.s = socket.create_connection((self.host, 44818), timeout=2)
                self.s.sendall(encap(0x65, struct.pack("<HH", 1, 0)))
                self.session = struct.unpack("<I", self._rx()[0][4:8])[0]
            cip = bytes([0x4C, 3, 0x91, 3]) + b"Tag\0" + struct.pack("<H", 1)
            cpf = struct.pack("<IHH", 0, 5, 2) + struct.pack("<HH", 0, 0) + struct.pack("<HH", 0xB2, len(cip)) + cip
            self.s.sendall(encap(0x6F, cpf, self.session))
            self._rx()
        except (OSError, IndexError, struct.error):
            if self.s:
                self.s.close()
            self.s = None                               # device down: retry next cycle


mb = {ip: ModbusTcpClient(ip, port=502, timeout=2) for ip in ips("modbus")}
en = [Enip(ip) for ip in ips("enip")]
s7ip, s7 = args.get("s7"), None
end, n = time.time() + dur, 0
while time.time() < end:
    for c in mb.values():
        if not c.connected:
            c.connect()
        c.read_holding_registers(1, count=10, device_id=1)
        if n % 10 == 0:
            c.write_register(21, 600 + n, device_id=1)           # setpoint
        if n % 30 == 5:
            c.write_registers(30, [1, 0, 1], device_id=1)         # pump enable block
    for e in en:
        e.poll()
    if s7ip:
        try:
            if not s7:
                s7 = snap7.client.Client()
                s7.connect(s7ip, 0, 2, 102)
            s7.db_read(1, 0, 16)
        except Exception:
            s7 = None
    n += 1
    time.sleep(period * random.uniform(0.9, 1.1))
