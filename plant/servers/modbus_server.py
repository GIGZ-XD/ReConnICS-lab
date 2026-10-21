"""pymodbus 3.x server with real FC43/14 identity; hr/ir 1..4 follow the process model (process.py).
usage: modbus_server.py BIND_IP json-identity PROCESS_UNIT   (env PLANT_T0 = plant epoch seconds)"""
import json, os, sys, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import process
from pymodbus import ModbusDeviceIdentification
from pymodbus.datastore import ModbusDeviceContext, ModbusServerContext, ModbusSequentialDataBlock
from pymodbus.server import StartTcpServer

bind, ident, unit = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3]
t0 = float(os.environ.get("PLANT_T0", time.time()))
block = ModbusSequentialDataBlock(1, [0] * 100)
ctx = ModbusServerContext(devices=ModbusDeviceContext(di=block, co=block, hr=block, ir=block), single=True)


def run():  # HMI setpoint writes land in hr[21..], untouched here
    while True:
        block.setValues(1, process.regs(unit, time.time() - t0))
        time.sleep(1)


threading.Thread(target=run, daemon=True).start()
StartTcpServer(context=ctx, identity=ModbusDeviceIdentification(info_name=ident), address=(bind, 502))
