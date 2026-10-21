"""Tiny deterministic process model: closed-form functions of plant time t (seconds), so every device server and the
state feed compute identical values with no IPC.  tank: 60 s fill/drain cycle; conveyor: 20 s on / 10 s off.
vars(unit, t) -> dict of engineering values (state feed);  regs(unit, t) -> int list for holding/input regs 1.. / S7 DB1."""
import math


def _tank(t):
    p = t % 60
    fill = p < 30
    level = 20 + 2 * p if fill else 80 - 2 * (p - 30)                    # percent, 20..80
    v = dict(level_pct=round(level, 1), temp_c=round(65 + 3 * math.sin(t / 11), 1),
             pump_rpm=1450 if fill else 0, inlet_valve_open=fill)
    return v, [int(level * 10), int(v["temp_c"] * 10), v["pump_rpm"], int(fill)]


def _conveyor(t):
    p = t % 30
    run = p < 20
    speed = min(80, 80 * p / 3, 80 * (20 - p) / 3) if run else 0           # 3 s ramps
    parts = int(t // 30) * 10 + (min(10, int(p / 2)) if run else 10)
    v = dict(running=run, speed_pct=round(max(speed, 0), 1), parts_count=parts)
    return v, [int(v["speed_pct"] * 10), int(run), parts & 0xFFFF, 0]


UNITS = {"tank": _tank, "conveyor": _conveyor}
vars = lambda unit, t: UNITS[unit](t)[0]
regs = lambda unit, t: UNITS[unit](t)[1]

if __name__ == "__main__":
    for u in UNITS:
        for t in (0, 15, 29.9, 31, 59.9, 70):
            v, r = UNITS[u](t)
            assert len(r) == 4 and all(0 <= x < 65536 for x in r), (u, t, r)
        print(u, vars(u, 10), regs(u, 10))
    assert vars("tank", 0)["level_pct"] == 20 and vars("tank", 30)["level_pct"] == 80
