"""snap7 native server (independent C implementation; answers SZL 0x0011/0x001C). usage: s7_native.py BIND_IP"""
import sys, time, snap7
srv = snap7.server.Server()
srv.register_area(snap7.types.srvAreaDB, 1, (snap7.types.wordlen_to_ctypes[snap7.types.S7WLByte] * 100)())
srv.start_to(sys.argv[1], 102)
while True:
    time.sleep(1)
