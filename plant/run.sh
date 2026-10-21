#!/bin/sh
# One-command capture inside Linux/WSL2 (root): ensures the venv, then runs the plant. Extra args go to plant.py.
#   sh plant/run.sh [--duration 90] [--feed] [--record plant/demo-run.jsonl.gz]
set -e
cd "$(dirname "$0")/.."
VENV=${LABVENV:-/root/labvenv}
for c in ip tcpdump python3; do command -v $c >/dev/null || { echo "missing: $c (apt install iproute2 tcpdump python3-venv)"; exit 1; }; done
[ "$(id -u)" = 0 ] || { echo "run as root (network namespaces): sudo sh plant/run.sh"; exit 1; }
[ -x "$VENV/bin/python" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" -q install -r plant/requirements.txt; }
exec "$VENV/bin/python" plant/plant.py "$@"
