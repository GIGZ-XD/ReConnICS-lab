"""pymodbus 3.x server with real FC43/14 identity and a slowly moving process image.
usage: modbus_server.py BIND_IP [json-identity]"""
import json, math, sys, threading, time
from pymodbus import ModbusDeviceIdentification
from pymodbus.datastore import ModbusDeviceContext, ModbusServerContext, ModbusSequentialDataBlock
from pymodbus.server import StartTcpServer

bind, ident = sys.argv[1], json.loads(sys.argv[2])
block = ModbusSequentialDataBlock(1, [0] * 100)
ctx = ModbusServerContext(devices=ModbusDeviceContext(di=block, co=block, hr=block, ir=block), single=True)

def process():  # tank level / temperature / pump speed drift; HMI setpoint writes land in hr[20..]
    t0 = time.time()
    while True:
        t = time.time() - t0
        block.setValues(1, [int(500 + 400 * math.sin(t / 30)), int(650 + 30 * math.sin(t / 11)),
                            int(1450 + 50 * math.sin(t / 7))])
        time.sleep(1)

threading.Thread(target=process, daemon=True).start()
StartTcpServer(context=ctx, identity=ModbusDeviceIdentification(info_name=ident), address=(bind, 502))
