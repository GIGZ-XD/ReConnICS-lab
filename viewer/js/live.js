// Live ReConnICS-ng console (?reconnics=http://127.0.0.1:8088): poll its read-only API and hand the parsed result to the page.
// The console must be started with --allow-origin <this page's origin>, otherwise the browser blocks every read.
// Pure parsing is reused from inventory.js; this file only fetches.
import { Inventory } from './inventory.js';

export const hostOf = base => { try { return new URL(base).host; } catch { return base; } };

/** One poll -> {inv: Inventory (single "live" snapshot + change log), captures[], done: n analysed}. Throws if the console is unreachable. */
export async function fetchConsole(base, get = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })) {
  const [inventory, changes, captures] = await Promise.all(['inventory', 'changes', 'captures'].map(p => get(`${base}/api/v1/${p}`)));
  const inv = new Inventory();
  inv.add(inventory, 'ReConnICS-ng live');          // the /api/v1/inventory wrapper; parse() unwraps it
  inv.add(changes, 'changes');                        // change-log array
  return { inv, captures, done: captures.filter(c => c.state === 'done').length };
}

export function startLive(base, { onData, onStatus, every = 3000 }) {
  base = base.replace(/\/+$/, '');
  let stop = false, last = '';
  (async function poll() {
    if (stop) return;
    try {
      const r = await fetchConsole(base);
      onStatus({ ok: true, host: hostOf(base), done: r.done, total: r.captures.length });
      const sig = JSON.stringify([r.inv.snaps.map(s => [s.byIp]), r.inv.changes, r.captures.map(c => [c.id, c.state])]);
      if (sig !== last) { last = sig; onData(r); }
    } catch (e) { onStatus({ ok: false, host: hostOf(base), error: e.message }); }
    setTimeout(poll, every);
  })();
  return { close() { stop = true; } };
}
