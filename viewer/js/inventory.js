// ReConnICS-ng inventory handling: parse (inventory.json, analyze output, /api/v1/inventory wrapper,
// change-log array from /api/v1/changes), compare against ground truth, diff two snapshots. No DOM here.
export const FIELDS = ['vendor', 'model', 'firmware', 'serial', 'mac'];
const LOOSE = new Set(['vendor', 'model']);          // substring match, like plant/verify.py
const clean = s => String(s ?? '').toLowerCase().replace(/\s+/g, '');
export const norm = (s, f) => { const v = clean(s); return f === 'firmware' ? v.replace(/^v/, '') : v; };
const val = x => (x && typeof x === 'object' ? x.value : x) ?? null;

export function field(rec, f) {                       // {value, conf, evidence} or null
  const x = rec?.[f];
  const value = val(x);
  return value == null || value === '' ? null : { value: String(value), conf: x.confidence ?? null, evidence: x.evidence ?? null };
}

// Evidence strings are free text from reconnics-ng, e.g. "ethernet-ip ListIdentity vendorId=1, frame 573, txn session=0, ...".
// Parsed defensively: label = protocol + message, frame = "573" or "21-1102"; either may be null (then show the raw text).
const MESSAGES = [
  [/ethernet-ip ListIdentity/i, () => 'ENIP ListIdentity'],
  [/ethernet-ip CIP Get_Attributes_All/i, () => 'ENIP CIP Get_Attributes_All'],
  [/modbus FC43\/14 Read Device Identification/i, () => 'Modbus FC43/14 Read Device Identification'],
  [/s7comm SZL (0x[0-9a-f]+)(?: ([A-Za-z]+ [A-Za-z]+))?/i, m => `S7 SZL ${m[1]}${m[2] ? ' ' + m[2] : ''}`],
];
export function evidenceInfo(ev) {
  const raw = String(ev ?? '').trim();
  if (!raw) return null;
  const fm = /\bframes? (\d+)(?:-(\d+))?/.exec(raw), hit = MESSAGES.map(([re, f]) => { const m = re.exec(raw); return m && f(m); }).find(Boolean);
  return { label: hit || null, frame: fm ? (fm[2] ? `${fm[1]}-${fm[2]}` : fm[1]) : null, raw };
}

/** Pipeline facts for one record: the first identity field with evidence says which message/frame it was decoded from. */
export function pipeline(rec) {
  const ids = FIELDS.filter(f => f !== 'mac').map(f => ({ f, v: field(rec, f) })).filter(x => x.v);
  const src = ids.map(x => evidenceInfo(x.v.evidence)).find(e => e?.label) ?? ids.map(x => evidenceInfo(x.v.evidence)).find(Boolean) ?? null;
  const top = rec?.match?.advisories?.[0];
  return { filled: ids.map(x => x.f), source: src, advisory: top ? { id: top.advisory, level: top.level } : null, level: rec?.match?.level ?? null };
}

/**
 * Which capture an evidence frame number came from. The merged inventory does not record it, but identity ties go to the
 * latest capture (reconnics-ng Inventory.LATEST_WINS), so take the latest finished capture long enough to hold that frame.
 * ponytail: a guess when several late captures are long enough; the console naming the source capture per field would make it exact.
 */
export function captureFor(frame, captures = []) {
  const n = parseInt(frame, 10);
  return Number.isFinite(n) ? [...captures].reverse().find(c => c.state === 'done' && (c.summary?.frames ?? 0) >= n)?.file ?? null : null;
}

export function same(f, a, b) {
  const x = norm(a, f), y = norm(b, f);
  return LOOSE.has(f) ? !!x && !!y && (x.includes(y) || y.includes(x)) : x === y;
}

/** truth: {vendor, model, firmware, serial, mac}; rec: inventory record or null. */
export function compare(truth, rec) {
  return FIELDS.map(f => {
    const t = truth?.[f] || null, r = field(rec, f);
    const status = !t ? (r ? 'extra' : 'na') : !r ? 'missing' : same(f, t, r.value) ? 'ok' : 'mismatch';
    return { field: f, truth: t, rc: r?.value ?? null, conf: r?.conf ?? null, evidence: r?.evidence ?? null, status };
  });
}

export function diff(a, b) {                          // what changed for one asset between two records
  const out = [];
  for (const f of FIELDS) {
    const x = field(a, f)?.value ?? null, y = field(b, f)?.value ?? null;
    if (norm(x, f) !== norm(y, f)) out.push({ field: f, from: x, to: y });
  }
  const adv = r => (r?.match?.advisories || []).map(m => m.advisory).sort();
  const la = a?.match?.level ?? null, lb = b?.match?.level ?? null;
  if (la !== lb) out.push({ field: 'advisory match level', from: la, to: lb });
  const A = adv(a), B = adv(b);
  const gone = A.filter(i => !B.includes(i)), added = B.filter(i => !A.includes(i));
  if (gone.length) out.push({ field: 'advisories no longer matched', from: gone.join(', '), to: null });
  if (added.length) out.push({ field: 'advisories newly matched', from: null, to: added.join(', ') });
  return out;
}

const ipOf = a => String(a.id || val(a.ip) || '').split('/')[0];
const normChange = (e, asset) => ({
  at: e.at ?? e.t ?? e.ts ?? null, asset: ipOf({ id: e.asset ?? e.id ?? e.ip ?? asset }), field: e.field ?? '', from: e.from ?? null,
  to: e.to ?? null, actor: e.actor ?? null, source: e.source ?? null,
});

/** -> {snapshot|null, changes[]}. Throws on shapes it does not recognise. */
export function parse(json, name = 'inventory') {
  let o = json;
  if (Array.isArray(o) && o.length && o[0].asset !== undefined && o[0].field !== undefined)
    return { snapshot: null, changes: o.map(e => normChange(e)) };            // /api/v1/changes
  if (o && !Array.isArray(o) && o.inventory?.assets) o = o.inventory;          // /api/v1/inventory wrapper
  const assets = Array.isArray(o) ? o : o?.assets;
  if (!Array.isArray(assets)) throw new Error('not an inventory (no "assets" array) and not a change log');
  const byIp = {}, subs = {};
  for (const a of assets) {
    const ip = ipOf(a);
    if (!ip) continue;
    subs[ip] = (subs[ip] || 0) + 1;
    if (!byIp[ip] || (byIp[ip].subaddr != null && a.subaddr == null)) byIp[ip] = a;   // prefer the device-level record
  }
  const changes = [
    ...(Array.isArray(o.changes) ? o.changes.map(e => normChange(e)) : []),
    ...assets.flatMap(a => [...(a.history || []), ...(a.changes || [])].map(e => normChange(e, ipOf(a)))),
  ];
  const src = (!Array.isArray(o) && o.source) || {};
  return { snapshot: { name, byIp, subs, source: src, generated: src.generated ?? src.at ?? null, summary: o.summary ?? null }, changes };
}

export class Inventory {
  snaps = []; changes = [];
  add(json, name) {
    const { snapshot, changes } = parse(json, name);
    if (snapshot) this.snaps.push(snapshot);
    this.changes.push(...changes);
    return { snapshots: snapshot ? 1 : 0, changes: changes.length };
  }
  get loaded() { return this.snaps.length > 0 || this.changes.length > 0; }
  changesFor(ip) { return this.changes.filter(c => c.asset === ip); }
  clear() { this.snaps = []; this.changes = []; }
}
