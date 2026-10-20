"""HMI / historian: persistent Modbus/TCP polling (1 s, FC3), occasional setpoint writes (FC6/FC16), S7 DB reads.
usage: hmi.py PERIOD_S DURATION_S modbus=IP,IP s7=IP"""
import sys, time
from pymodbus.client import ModbusTcpClient
import snap7

period, dur = float(sys.argv[1]), float(sys.argv[2])
args = dict(a.split("=") for a in sys.argv[3:])
mb = [ModbusTcpClient(ip, port=502, timeout=2) for ip in args.get("modbus", "").split(",") if ip]
for c in mb:
    c.connect()
s7 = None
if args.get("s7"):
    s7 = snap7.client.Client()
    s7.connect(args["s7"], 0, 2, 102)
end, n = time.time() + dur, 0
while time.time() < end:
    for c in mb:
        c.read_holding_registers(1, count=10, device_id=1)
        if n % 10 == 0:
            c.write_register(21, 600 + n, device_id=1)           # setpoint
        if n % 30 == 5:
            c.write_registers(30, [1, 0, 1], device_id=1)         # pump enable block
    if s7:
        s7.db_read(1, 0, 16)
    n += 1
    time.sleep(period)
