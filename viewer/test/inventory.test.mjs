// node viewer/test/inventory.test.mjs  - checks parse/compare/diff against the sample inventories.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Inventory, compare, diff } from '../js/inventory.js';

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
console.log('inventory ok');
