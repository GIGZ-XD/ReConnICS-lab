"""snap7 native server (independent C implementation; answers SZL 0x0011/0x001C). DB1 words 0..3 follow the process
model (big-endian INTs). usage: s7_native.py BIND_IP PROCESS_UNIT   (env PLANT_T0)"""
import ctypes, os, struct, sys, time, snap7
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import process

t0 = float(os.environ.get("PLANT_T0", time.time()))
db = (ctypes.c_uint8 * 100)()
srv = snap7.server.Server()
srv.register_area(snap7.types.srvAreaDB, 1, db)
srv.start_to(sys.argv[1], 102)
while True:
    ctypes.memmove(db, struct.pack(">4h", *process.regs(sys.argv[2], time.time() - t0)), 8)
    time.sleep(1)
