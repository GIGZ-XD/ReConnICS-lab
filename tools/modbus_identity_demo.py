#!/usr/bin/env python3
import socket
import struct
import threading

HOST = "127.0.0.1"
PORT = 15022
ready = threading.Event()

def recv_exact(sock, n):
    data = b""
    while len(data) < n:
        part = sock.recv(n - len(data))
        if not part:
            raise RuntimeError("Connection closed early")
        data += part
    return data

def mbap(transaction, unit, pdu):
    return struct.pack("!HHHB", transaction, 0, 1 + len(pdu), unit) + pdu

request = mbap(3, 1, bytes([0x2B, 0x0E, 0x01, 0x00]))

objects = [
    (0x00, b"Acme"),
    (0x01, b"PLC-1"),
    (0x02, b"1.2.3"),
]
pdu = bytearray([0x2B, 0x0E, 0x01, 0x01, 0x00, 0x00, len(objects)])
for object_id, value in objects:
    pdu.extend([object_id, len(value)])
    pdu.extend(value)

response = mbap(3, 1, bytes(pdu))

def server():
    with socket.socket() as srv:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((HOST, PORT))
        srv.listen(1)
        ready.set()
        conn, _ = srv.accept()
        with conn:
            header = recv_exact(conn, 6)
            length = struct.unpack("!H", header[4:6])[0]
            received = header + recv_exact(conn, length)
            print("Server received:", received.hex())
            if received != request:
                raise RuntimeError("Unexpected request")
            conn.sendall(response)
            print("Server sent:    ", response.hex())

thread = threading.Thread(target=server, daemon=True)
thread.start()
if not ready.wait(5):
    raise RuntimeError("Server did not start")

with socket.create_connection((HOST, PORT), timeout=5) as client:
    client.sendall(request)
    header = recv_exact(client, 6)
    length = struct.unpack("!H", header[4:6])[0]
    received = header + recv_exact(client, length)
    print("Client received:", received.hex())
    if received != response:
        raise RuntimeError("Unexpected response")
    print("PASS: received synthetic FC43/14 identity response.")

thread.join(timeout=2)
