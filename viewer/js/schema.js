// State-feed schema adapter (plant/STATE_FEED.md): derive what the viewer needs from a raw frame. Pure functions, no DOM.
const CLIENT_ROLES = ['hmi', 'ews', 'historian'];

/** status: run | booting | flashing, from state.online + the latest per-device event (kinds: firmware, online, boot, reboot). */
export function statusOf(d, events = []) {
  if (d.state?.status) return d.state.status;                              // tolerate the older assumed schema
  if (d.state?.online !== false) return 'run';
  let last = null; for (const e of events) if (e.device === d.id && ['firmware', 'reboot', 'online'].includes(e.kind) && (!last || e.t >= last.t)) last = e;
  return last?.kind === 'firmware' ? 'flashing' : 'booting';
}

/** Process values for the 3D field equipment; the first device that carries a value wins (hero PLC first). */
export function processOf(devices, heroIp) {
  const p = {}, ordered = [...devices].sort((a, b) => (b.ip === heroIp) - (a.ip === heroIp));
  for (const { state: s = {} } of ordered) {
    p.tank_level ??= s.level_pct ?? s.tank_level;
    p.temp_c ??= s.temp_c;
    if (p.pump_on === undefined && (s.pump_rpm !== undefined || s.pump_on !== undefined)) { p.pump_on = s.pump_rpm !== undefined ? s.pump_rpm > 0 : !!s.pump_on; p.pump_rpm = s.pump_rpm; }
    if (p.conveyor_speed === undefined && (s.speed_pct !== undefined || s.conveyor_speed !== undefined)) p.conveyor_speed = s.running === false ? 0 : s.speed_pct !== undefined ? s.speed_pct / 100 : s.conveyor_speed;  // 80 % -> 0.8 m/s
  }
  p.output_hz = p.pump_rpm !== undefined ? p.pump_rpm / 1450 * 50 : p.pump_on ? 50 : 0;                          // VFD frequency follows the pump
  return p;
}

/** Identity request = traffic initiated by the engineering workstation (sweep), or an identity function code from a client. */
export function isIdentity(f, src) {
  if (f.identity === true) return true;
  if (src?.role === 'ews' && f.proto !== 'arp') return true;
  if (src && !CLIENT_ROLES.includes(src.role)) return false;               // responses come from servers
  return (f.proto === 'modbus' && f.fc === 43) || (f.proto === 'enip' && f.fc === 99) || /ident|get_?attributes_?all|szl/i.test(String(f.fc ?? ''));
}

const NAMES = {
  modbus: { 3: 'FC3 Read Holding Registers', 6: 'FC6 Write Register', 16: 'FC16 Write Registers', 43: 'FC43/14 Read Device Identification' },
  enip: { 99: 'ListIdentity', 101: 'RegisterSession', 111: 'SendRRData' },
  s7comm: { 1: 'Job (read var)', 3: 'Ack-data', 7: 'Userdata (SZL read)', 224: 'COTP connect request', 208: 'COTP connect confirm' },
  arp: { 1: 'ARP request', 2: 'ARP reply' },
};
export function fcName(f, src) {
  const n = NAMES[f.proto]?.[f.fc];
  if (f.proto === 'enip' && f.fc === 111 && src?.role === 'ews') return 'SendRRData (CIP Get_Attributes_All)';
  return n ?? String(f.fc ?? f.proto);
}
