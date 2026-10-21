// node viewer/test/inventory.test.mjs  - checks parse/compare/diff against the sample inventories.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Inventory, compare, diff, evidenceInfo, pipeline, captureFor } from '../js/inventory.js';
import { fetchConsole } from '../js/live.js';

const rd = f => JSON.parse(readFileSync(new URL('../sample/' + f, import.meta.url)));
const inv = new Inventory();
inv.add(rd('inventory-before.json'), 'before'); inv.add(rd('inventory-after.json'), 'after'); inv.add(rd('changes.json'), 'changes');
const [a, b] = inv.snaps, ip = '10.10.2.10';
assert.equal(inv.snaps.length, 2); assert.equal(inv.changesFor(ip).length, 1);

const truth = { vendor: 'Rockwell Automation', model: '1769-L33ER', firmware: '24.011', serial: '60E1F4A2', mac: '00:00:bc:00:01:0a' };
const st = (r) => Object.fromEntries(compare(truth, r).map(x => [x.field, x.status]));
// sup.pcap sees PLCs through the router: ReConnICS drops the (router) MAC by design -> mac is missing
assert.deepEqual(st(b.byIp[ip]), { vendor: 'ok', model: 'ok', firmware: 'ok', serial: 'ok', mac: 'missing' });
assert.equal(st(a.byIp[ip]).firmware, 'mismatch');            // stale inventory: truth moved to 24.011
assert.equal(st(null).vendor, 'missing');
assert.equal(compare({}, null)[0].status, 'na');

const d = diff(a.byIp[ip], b.byIp[ip]);
assert.ok(d.some(x => x.field === 'firmware' && x.from === '20.011' && x.to === '24.011'));
assert.ok(!d.some(x => x.field === 'advisory match level'));   // 24.011 is still inside the advisory range (<=27.011): exposure persists
assert.deepEqual(diff(a.byIp['10.10.1.10'], b.byIp['10.10.1.10']), []);

// evidence parser: real evidence strings from reconnics-ng (ENIP, Modbus FC43, S7 SZL) and the unparsable cases
const ev = e => { const x = evidenceInfo(e); return x && [x.label, x.frame]; };
assert.deepEqual(ev('ethernet-ip ListIdentity vendorId=1, frame 573, txn session=0, mapped from ODVA CIP Vendor ID table'), ['ENIP ListIdentity', '573']);
assert.deepEqual(ev('ethernet-ip CIP Get_Attributes_All Identity revision, frame 584, txn session=3611947963 request frame 583, productCode=104; also saw "20.011" (HIGH, ... frame 179, ...)'), ['ENIP CIP Get_Attributes_All', '584']);
assert.deepEqual(ev('modbus FC43/14 Read Device Identification objectId=0x02, frame 544, txn 2, unit=1 conformity=0x83'), ['Modbus FC43/14 Read Device Identification', '544']);
assert.deepEqual(ev('s7comm SZL 0x001C Component Identification index=0x0007, frame 616, txn pduRef=512, module type name, entry=5'), ['S7 SZL 0x001C Component Identification', '616']);
assert.deepEqual(ev('s7comm SZL 0x0011 Module Identification vendor from S7 context, frame 614, txn pduRef=256'), ['S7 SZL 0x0011 Module Identification', '614']);
assert.deepEqual(ev('from device type cip:0x0E (ethernet-ip ListIdentity deviceType=14, frame 573, txn session=0)'), ['ENIP ListIdentity', '573']);
assert.deepEqual(ev('reconnics-ng HEADER_VALIDATED+MESSAGE_DECODED, frames 21-1102'), [null, '21-1102']);    // no message name: the UI shows the raw text
assert.deepEqual(ev('something we have never seen'), [null, null]);
assert.equal(evidenceInfo(''), null); assert.equal(evidenceInfo(null), null);

// live console wrapper: the /api/v1/{inventory,changes,captures} answers of a real run (trimmed), parsed through the same Inventory model
const live = n => JSON.parse(readFileSync(new URL('../sample/' + n, import.meta.url)));
const captures = [{ file: 'cell2-before.pcap', state: 'done', summary: { frames: 447 } }, { file: 'sup-before.pcap', state: 'done', summary: { frames: 926 } },
  { file: 'sup-after.pcap', state: 'done', summary: { frames: 1100 } }, { file: 'cell1-after.pcap', state: 'queued' }];
const answers = { inventory: live('live-inventory.json'), changes: live('live-changes.json'), captures };
const r = await fetchConsole('http://console', async u => answers[u.split('/').pop()]);
assert.equal(r.done, 3); assert.equal(r.inv.snaps.length, 1);
const l33 = r.inv.snaps[0].byIp[ip];
assert.equal(l33.firmware.value, '24.011');
assert.ok(r.inv.changesFor(ip).some(c => c.field === 'firmware' && c.from === '20.011' && c.to === '24.011'));
const p = pipeline(l33);
assert.deepEqual([p.source.label, p.source.frame, p.advisory.id, p.advisory.level], ['ENIP ListIdentity', '573', 'ICSA-16-061-02', 'EXACT']);
assert.deepEqual(p.filled, ['vendor', 'model', 'firmware', 'serial']);
assert.deepEqual(pipeline(null), { filled: [], source: null, advisory: null, level: null });
assert.equal(captureFor('573', captures), 'sup-after.pcap');      // latest finished capture long enough to hold the frame
assert.equal(captureFor('358', captures.slice(0, 2)), 'sup-before.pcap');
assert.equal(captureFor('2000', captures), null); assert.equal(captureFor(null, captures), null);
await assert.rejects(fetchConsole('http://console', async () => { throw new Error('refused'); }));   // unreachable -> caller shows "not reachable"
console.log('inventory ok');
