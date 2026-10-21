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
