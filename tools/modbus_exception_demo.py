#!/usr/bin/env python3
import socket
import struct
import threading

HOST = "127.0.0.1"
PORT = 15021
EXPECTED_REQUEST = struct.pack(
    "!HHHBBHH",
    2,       # transaction ID
    0,       # protocol ID
    6,       # MBAP length: unit ID + PDU
    1,       # unit ID
    3,       # Read Holding Registers
    0,       # starting address
    2,       # quantity
)

def receive_exact(sock, count):
    data = b""
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise RuntimeError("Connection closed before full message arrived")
        data += chunk
    return data

def server():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as srv:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((HOST, PORT))
        srv.listen(1)
        ready.set()
        conn, _ = srv.accept()
        with conn:
            header = receive_exact(conn, 6)
            length = struct.unpack("!H", header[4:6])[0]
            body = receive_exact(conn, length)
            request = header + body
            print("Server received:", request.hex())

            if request != EXPECTED_REQUEST:
                raise RuntimeError("Request differed from expected test request")

            # Transaction ID 2, protocol 0, length 3, unit 1,
            # function 0x83 (exception for FC3), exception 0x02.
            response = struct.pack("!HHHBBB", 2, 0, 3, 1, 0x83, 0x02)
            conn.sendall(response)
            print("Server sent:    ", response.hex())

ready = threading.Event()
thread = threading.Thread(target=server, daemon=True)
thread.start()

if not ready.wait(timeout=5):
    raise RuntimeError("Server failed to start")

with socket.create_connection((HOST, PORT), timeout=5) as client:
    client.sendall(EXPECTED_REQUEST)
    header = receive_exact(client, 6)
    length = struct.unpack("!H", header[4:6])[0]
    response = header + receive_exact(client, length)
    print("Client received:", response.hex())

    expected = struct.pack("!HHHBBB", 2, 0, 3, 1, 0x83, 0x02)
    if response != expected:
        raise RuntimeError("Unexpected response")
    print("PASS: received Modbus exception code 2 (Illegal Data Address).")

thread.join(timeout=2)
