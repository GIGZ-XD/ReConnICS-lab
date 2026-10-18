import socket
import threading
import time

HOST = "127.0.0.1"
PORT = 15020

def receive_exact(sock, count):
    data = b""
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise ConnectionError("Peer closed connection")
        data += chunk
    return data

def server():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((HOST, PORT))
        listener.listen(1)
        ready.set()

        conn, address = listener.accept()
        with conn:
            mbap = receive_exact(conn, 7)
            transaction, protocol, length, unit = (
                int.from_bytes(mbap[0:2], "big"),
                int.from_bytes(mbap[2:4], "big"),
                int.from_bytes(mbap[4:6], "big"),
                mbap[6],
            )
            pdu = receive_exact(conn, length - 1)

            if protocol != 0 or pdu[0] != 3 or len(pdu) != 5:
                raise ValueError(f"Unexpected request: {pdu.hex()}")

            start = int.from_bytes(pdu[1:3], "big")
            quantity = int.from_bytes(pdu[3:5], "big")
            if quantity != 2:
                raise ValueError(f"Expected 2 registers, got {quantity}")

            # Deterministic demo values for registers 0 and 1.
            values = [123, 456]
            payload = b"".join(v.to_bytes(2, "big") for v in values)
            response_pdu = bytes([3, len(payload)]) + payload
            response = (
                transaction.to_bytes(2, "big")
                + protocol.to_bytes(2, "big")
                + (len(response_pdu) + 1).to_bytes(2, "big")
                + bytes([unit])
                + response_pdu
            )
            conn.sendall(response)
            print(f"SERVER {HOST}:{PORT}: FC3, registers {start}-{start+1}")
            print(f"SERVER response values: {values}")

ready = threading.Event()
thread = threading.Thread(target=server, daemon=True)
thread.start()

if not ready.wait(3):
    raise RuntimeError("Server did not become ready")

time.sleep(0.2)
with socket.create_connection((HOST, PORT), timeout=3) as client:
    # MBAP header + FC3 request: read two holding registers from address 0.
    request = (
        (1).to_bytes(2, "big")
        + (0).to_bytes(2, "big")
        + (6).to_bytes(2, "big")
        + bytes([1, 3, 0, 0, 0, 2])
    )
    client.sendall(request)
    mbap = receive_exact(client, 7)
    response_length = int.from_bytes(mbap[4:6], "big")
    response_pdu = receive_exact(client, response_length - 1)
    print(f"CLIENT request: FC3, start=0, quantity=2")
    print(f"CLIENT response PDU: {response_pdu.hex()}")
    if response_pdu != bytes.fromhex("0304007b01c8"):
        raise ValueError(f"Unexpected response PDU: {response_pdu.hex()}")

thread.join(timeout=3)
print("Loopback demo completed.")
