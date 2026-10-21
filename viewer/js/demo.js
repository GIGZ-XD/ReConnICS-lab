// Built-in simulator. Emits frames in the plant's STATE_FEED.md schema (plant/STATE_FEED.md) and follows plant/scenario.json:
// boot (gratuitous ARP) -> HMI/historian polling -> EWS identity sweep @15 s -> L33ER firmware flash @40 s (20.011 -> 24.011,
// down ~7 s) -> EWS identity sweep @65 s -> loop at 90 s. Roster mirrors plant/devices/*.json. Time comes from a ReplayClock (pause / speed).
import { ReplayClock } from './clock.js';
const SEGMENTS = [
  { id: 'cell1', subnet: '10.10.1.0/24', name: 'Line 1 packaging cell (control network)' },
  { id: 'cell2', subnet: '10.10.2.0/24', name: 'Line 2 utilities cell (control network)' },
  { id: 'sup', subnet: '10.10.3.0/24', name: 'Supervisory network: HMI, EWS, historian' },
];
const SEG = { cell1: 0, cell2: 1, sup: 2 };
const OUI = { schneider: '00:80:f4', rockwell: '00:00:bc', siemens: '00:1b:1b', dell: '00:14:22', vmware: '00:0c:29' };
const hex = n => n.toString(16).padStart(2, '0');

// id, seg, host, oui, role, kind, unit, vendor, model, firmware, serial, boot time (s)
const ROSTER = [
  ['plc-m221', 'cell1', 10, 'schneider', 'plc', 'modbus', 'conveyor', 'Schneider Electric', 'TM221CE16R', '1.5.0.1', null, 2.5],
  ['plc-m340', 'cell1', 11, 'schneider', 'plc', 'modbus', 'tank', 'Schneider Electric', 'BMXP342020', '2.10', null, 3],
  ['plc-s7-315', 'cell1', 12, 'siemens', 'plc', 's7native', 'conveyor', 'Siemens', '6ES7 315-2EH14-0AB0', '3.2.6', null, 3.5],
  ['plc-l33er', 'cell2', 10, 'rockwell', 'plc', 'enip', 'tank', 'Rockwell Automation', '1769-L33ER', '20.011', '60E1F4A2', 4],
  ['drive-pf525', 'cell2', 11, 'rockwell', 'drive', 'enip', 'conveyor', 'Rockwell Automation', 'PowerFlex 525', '5.001', 'C07A2214', 3],
  ['plc-m580', 'cell2', 12, 'schneider', 'plc', 'modbus', 'tank', 'Schneider Electric', 'BMEP582040', '2.70', null, 3.5],
  ['hmi', 'sup', 20, 'dell', 'hmi', 'hmi', null, 'Dell', null, null, null, 3],
  ['ews', 'sup', 21, 'dell', 'ews', 'ews', null, 'Dell', null, null, null, 3],
  ['historian', 'sup', 22, 'vmware', 'historian', 'historian', null, 'VMware', null, null, null, 3],
];
const MB = ['plc-m221', 'plc-m340', 'plc-m580'];
const T_BOOT = 4.1, T_SWEEP1 = 15, T_FLASH = 40, FLASH_S = 7, T_SWEEP2 = 65, LOOP = 90, NEW_FW = '24.011';
export const DEMO_LEN = LOOP;

function schedule() {                                   // [{at, src, dst, proto, fc, bytes}] sorted by time
  const ev = [], pair = (at, src, dst, proto, fc, bytes, fcBack = fc) => {
    ev.push({ at, src, dst, proto, fc, bytes }); ev.push({ at: at + .12, src: dst, dst: src, proto, fc: fcBack, bytes: bytes * 2 });
  };
  for (let t = T_BOOT + 1; t < LOOP; t += 1) {          // HMI 1 s polling
    for (const d of MB) pair(t, 'hmi', d, 'modbus', 3, 78);
    pair(t + .1, 'hmi', 'plc-s7-315', 's7comm', 1, 90, 3);
    pair(t + .2, 'hmi', 'plc-l33er', 'enip', 111, 120);
    pair(t + .25, 'hmi', 'drive-pf525', 'enip', 111, 120);
    if (t % 10 === 0) for (const d of MB) pair(t + .3, 'hmi', d, 'modbus', 6, 78);
  }
  for (let t = T_BOOT + 2; t < LOOP; t += 5) for (const d of MB) pair(t + .5, 'historian', d, 'modbus', 3, 78);
  for (const s0 of [T_SWEEP1, T_SWEEP2]) {              // EWS sweep, same order as plant/clients/ews.py
    let t = s0;
    for (const d of MB) { pair(t, 'ews', d, 'modbus', 43, 62); t += .6; }
    for (const d of ['plc-l33er', 'drive-pf525']) { pair(t, 'ews', d, 'enip', 99, 24); pair(t + .5, 'ews', d, 'enip', 101, 28); pair(t + 1, 'ews', d, 'enip', 111, 90); t += 2; }
    pair(t, 'ews', 'plc-s7-315', 's7comm', 224, 40, 208); pair(t + .3, 'ews', 'plc-s7-315', 's7comm', 1, 40, 3); pair(t + .6, 'ews', 'plc-s7-315', 's7comm', 7, 60, 7);
  }
  return ev.sort((a, b) => a.at - b.at);
}

export function createDemo(emit, onRestart, clock = new ReplayClock()) {
  let last, events, timer, level, valve, parts, log, logged;
  const restart = () => { clock.reset(); last = -1; events = schedule(); level = 20; valve = true; parts = 0; logged = new Set(); log = [{ t: T_BOOT, kind: 'boot', device: null, msg: 'plant up; devices announce themselves (gratuitous ARP)' }]; onRestart?.(); };
  const addEvent = (t, kind, device, msg) => { log.push({ t, kind, device, msg }); if (log.length > 60) log.shift(); };
  const once = (k, at, kind, device, msg) => { if (!logged.has(k)) { logged.add(k); addEvent(at, kind, device, msg); } };

  function tick() {
    const t = clock.get();
    if (t >= LOOP) { restart(); return; }
    const dt = Math.min(.5, t - Math.max(last, 0));
    const lDown = t >= T_FLASH && t < T_FLASH + FLASH_S, booted = id => t >= ROSTER.find(r => r[0] === id)[11] + 1;
    const SW = 'identity sweep: Modbus FC43, ENIP ListIdentity + CIP GAA, S7 SZL';
    if (t >= T_SWEEP1) once('s1', T_SWEEP1, 'sweep', 'ews', SW);
    if (t >= T_FLASH) once('fw', T_FLASH, 'firmware', 'plc-l33er', `firmware started: 20.011 -> ${NEW_FW}`);
    if (t >= T_FLASH + FLASH_S) once('back', T_FLASH + FLASH_S, 'online', 'plc-l33er', `back online, firmware ${NEW_FW}`);
    if (t >= T_SWEEP2) once('s2', T_SWEEP2, 'sweep', 'ews', SW);
    // process: tank fills while the inlet valve / pump are on, drains otherwise; conveyor runs at 80 %
    if (level < 25) valve = true; if (level > 80) valve = false; if (lDown) valve = false;
    level = Math.max(2, Math.min(98, level + (valve ? 4.5 : -1.4) * dt)); parts += dt * 1.2;
    const flows = events.filter(e => e.at > last && e.at <= t && (!(lDown && (e.src === 'plc-l33er' || e.dst === 'plc-l33er')) && booted(e.src) && booted(e.dst)))
      .map(({ src, dst, proto, fc, bytes }) => ({ src, dst, proto, fc, bytes, n: 1 }));
    for (const r of ROSTER) { const b = r[11], at = r[0] === 'plc-l33er' && t >= T_FLASH ? T_FLASH + FLASH_S + 1 : b + 1;   // gratuitous ARP when a device comes up
      if (at > last && at <= t) flows.push({ src: r[0], dst: r[0], proto: 'arp', fc: 1, bytes: 42, n: 1, gratuitous: true }); }
    last = t;
    const devices = ROSTER.map(([id, seg, host, oui, role, kind, unit, vendor, model, fw0, serial, boot]) => {
      const flashing = id === 'plc-l33er' && lDown, up = t >= boot && !flashing, since = id === 'plc-l33er' && t >= T_FLASH + FLASH_S ? t - T_FLASH - FLASH_S : t - boot;
      const state = { online: up, uptime_s: up ? +since.toFixed(1) : 0 };
      if (unit) state.unit = unit;
      if (unit === 'tank') Object.assign(state, { level_pct: +level.toFixed(1), temp_c: +(65 + 2 * Math.sin(t / 5)).toFixed(1), pump_rpm: valve ? 1450 : 0, inlet_valve_open: valve });
      if (unit === 'conveyor') Object.assign(state, { running: true, speed_pct: 80, parts_count: Math.floor(parts) });
      return { id, ip: `10.10.${SEG[seg] + 1}.${host}`, mac: `${OUI[oui]}:00:${hex(SEG[seg])}:${hex(host)}`, vendor, model, firmware: id === 'plc-l33er' && t >= T_FLASH + FLASH_S ? NEW_FW : fw0, serial, segment: seg, role, kind, state };
    });
    emit({ t: +t.toFixed(3), devices, flows, events: log.slice(), segments: SEGMENTS });
  }

  return {
    start() { restart(); tick(); timer = setInterval(tick, 200); },
    stop() { clearInterval(timer); },
    restart,
  };
}
