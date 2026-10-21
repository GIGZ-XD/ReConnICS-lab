// Wires feed -> 3D scene + DOM panels. URL params: ?mode=auto|live|demo|replay  ?ws=  ?replay=  ?reconnics=http://127.0.0.1:8088  ?inventory=a.json[,b.json]  ?changes=
import { createViewer } from './scene.js';
import { HERO_IP } from './plant3d.js';
import { startFeed } from './feed.js';
import { statusOf, processOf } from './schema.js';
import { Inventory } from './inventory.js';
import { startLive } from './live.js';
import { renderList, renderPanel, renderLive, renderEvents } from './ui.js';

const q = new URLSearchParams(location.search), $ = id => document.getElementById(id);
const S = { devs: new Map(), prev: {}, changes: [], events: [], seen: new Set(), selected: null, src: null, inv: new Inventory(), live: null, captures: [], selA: 0, selB: 0, heroSig: '', lastHeroEv: {} };

const viewer = createViewer($('view'), { onPick: ip => select(ip, false), onIdentity });
window.viewer = viewer; window.state = S;

// ---------------------------------------------------------------- events
function event(kind, text) { S.events.push({ t: Date.now() / 1000, kind, text }); if (S.events.length > 50) S.events.shift(); renderEvents($('events'), S.events); }
const EVENT_CLASS = { sweep: 'ident', firmware: 'fw', reboot: 'fw', online: 'boot', boot: 'boot' };
function feedEvents(msg, first) {                           // STATE_FEED.md: last 60 events repeated every frame -> key by (t, kind, device)
  for (const e of msg.events || []) {
    const k = `${e.t}|${e.kind}|${e.device}`; if (S.seen.has(k)) continue;
    S.seen.add(k); if (!first) event(EVENT_CLASS[e.kind] ?? 'info', e.msg ?? `${e.device} ${e.kind}`);
  }
}
function onIdentity(f, src, dst, name) {                    // an identity request just reached dst; narrate the hero only
  const now = performance.now();
  if (dst.ip === HERO_IP && now - (S.lastHeroEv[name] || 0) > 1000) { S.lastHeroEv[name] = now; event('ident', `${src.id} -> ${dst.id}: ${name}`); }
}

// ---------------------------------------------------------------- feed handling
function reset() {
  S.prev = {}; S.changes = []; S.events = []; S.seen = new Set(); S.heroSig = ''; S.devs.clear(); S.first = true; viewer.resetLive(); viewer.plant.hero.clearBanner();
  renderEvents($('events'), S.events); refresh();
}
function restarted(msg) {                                   // plant (or a looping replay) restarted: several uptimes jumped back
  let n = 0; for (const d of msg.devices || []) { const p = S.prev[d.ip], u = d.state?.uptime_s; if (p && u != null && p.up != null && u < p.up - 3 && d.state.online !== false) n++; }
  return n >= 3;
}
function onMessage(msg, src) {
  if (src !== S.src) { S.src = src; reset(); }
  else if (restarted(msg)) reset();
  for (const d of msg.devices || []) d.status = statusOf(d, msg.events);
  msg.process = processOf(msg.devices || [], HERO_IP);
  feedEvents(msg, S.first && src === 'live'); S.first = false;   // joining a running plant: do not replay its event history
  let listChanged = false, changed = false;
  for (const d of msg.devices || []) {
    const p = S.prev[d.ip], st = d.status;
    if (!S.devs.has(d.ip)) listChanged = true;
    if (p) for (const f of ['firmware', 'model', 'serial']) if (p[f] != null && d[f] != null && p[f] !== d[f]) { onChange(d, f, p[f], d[f]); changed = true; }
    S.prev[d.ip] = { firmware: d.firmware, model: d.model, serial: d.serial, st, up: d.state?.uptime_s };
    S.devs.set(d.ip, d);
    if (d.ip === HERO_IP) heroPlate(d);
  }
  viewer.apply(msg);
  if (changed) refresh();                                    // after S.devs holds the new values
  if (listChanged) renderList($('devbtns'), [...S.devs.values()], S.selected, HERO_IP);
  else for (const d of msg.devices || []) {                      // status dots only
    const dot = $('devbtns').querySelector(`[data-ip="${CSS.escape(d.ip)}"] .dot`); if (dot) dot.className = 'dot ' + d.status;
  }
  if (S.selected) renderLive($('panel'), S.devs.get(S.selected));
}
function onChange(d, field, from, to) {
  S.changes.push({ t: Date.now() / 1000, ip: d.ip, field, from, to });
  event('fw', `${d.id}: ${field} changed ${from} -> ${to} (seen in the feed)`);
  viewer.pulse(d.ip, 0xffb020, 1.5, 1.6);
  if (d.ip === HERO_IP && field === 'firmware') viewer.heroBanner(`FIRMWARE CHANGED  ${from} -> ${to}`);
}
function heroPlate(d) {
  const o = { fw: d.firmware, serial: d.serial, status: d.status, changed: S.changes.some(c => c.ip === HERO_IP && c.field === 'firmware') };
  const sig = JSON.stringify(o); if (sig !== S.heroSig) { S.heroSig = sig; viewer.heroInfo(o); }
}

// ---------------------------------------------------------------- selection / panel
function refresh() {
  const n = S.inv.snaps.length; S.selB = Math.min(S.selB, Math.max(0, n - 1)); S.selA = Math.min(S.selA, Math.max(0, n - 1));
  renderPanel($('panel'), { dev: S.devs.get(S.selected), changes: S.changes, inv: S.inv, selA: S.selA, selB: S.selB, heroIp: HERO_IP, live: S.live, captures: S.captures });
  if (S.selected) renderLive($('panel'), S.devs.get(S.selected));
  renderList($('devbtns'), [...S.devs.values()], S.selected, HERO_IP);
}
function select(ip, fly = true) {
  S.selected = ip || null; viewer.select(S.selected); if (fly && ip) viewer.focus(ip);
  refresh();
}
$('devbtns').addEventListener('click', e => { const b = e.target.closest('button[data-ip]'); if (b) select(b.dataset.ip, true); });
$('devbtns').addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const bs = [...$('devbtns').querySelectorAll('button')].filter(b => b.closest('details')?.open !== false), i = bs.indexOf(document.activeElement);   // skip devices in collapsed groups
  bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); e.preventDefault();
});

// ---------------------------------------------------------------- inventories
async function addInventory(json, name) {
  try { S.inv.add(json, name); } catch (e) { event('info', `${name}: ${e.message}`); return; }
  if (S.inv.snaps.length > 1) { S.selA = S.inv.snaps.length - 2; S.selB = S.inv.snaps.length - 1; } else S.selA = S.selB = 0;
  event('info', `ReConnICS inventory loaded: ${name}`); refresh();
}
const fetchJson = async u => (await fetch(u)).json();
async function loadUrls(urls) { for (const u of urls) { try { await addInventory(await fetchJson(u), u.split('/').pop()); } catch (e) { event('info', `cannot load ${u}: ${e.message}`); } } }
$('panel').addEventListener('change', async e => {
  if (e.target.id === 'invFile') for (const f of e.target.files) { try { await addInventory(JSON.parse(await f.text()), f.name); } catch (err) { event('info', `${f.name}: ${err.message}`); } }
  if (e.target.id === 'snapA') { S.selA = +e.target.value; refresh(); }
  if (e.target.id === 'snapB') { S.selB = +e.target.value; refresh(); }
});
$('panel').addEventListener('click', async e => {
  if (e.target.id === 'invSample') { S.inv.clear(); await loadUrls(['sample/inventory-before.json', 'sample/inventory-after.json']); }
  if (e.target.id === 'invClear') { S.inv.clear(); refresh(); }
  if (e.target.closest('#pickHero')) select(HERO_IP, true);
});
const list = k => (q.get(k) || '').split(',').filter(Boolean);
loadUrls([...list('inventory'), ...list('changes')]);

// ---------------------------------------------------------------- live ReConnICS-ng console (?reconnics=URL)
const rcUrl = q.get('reconnics'), seenChanges = new Set();
if (rcUrl) {
  const chip = $('rcChip'); chip.hidden = false;
  S.live = { ok: true, done: 0 };
  startLive(rcUrl, {
    onStatus: st => {
      chip.className = 'chip ' + (st.ok ? 'ok' : 'down');
      chip.textContent = st.ok ? `ReConnICS-ng · ${st.host} · ${st.done} analysed` : `ReConnICS-ng not reachable · ${st.host}`;
      chip.title = st.ok ? '' : `${st.error}. The console must run with --allow-origin ${location.origin}`;
      const sig = JSON.stringify([st.ok, st.done]); if (sig !== S.liveSig) { S.liveSig = sig; S.live = st; refresh(); } else S.live = st;
    },
    onData: r => {
      const first = !S.inv.loaded;
      for (const c of r.inv.changes) {                       // narrate identity changes the console logs, not the history it already had
        const k = `${c.at}|${c.asset}|${c.field}`; if (seenChanges.has(k)) continue; seenChanges.add(k);
        if (!first && ['vendor', 'model', 'firmware', 'serial'].includes(c.field) && c.from) {
          event('fw', `ReConnICS-ng logged ${c.asset}: ${c.field} ${c.from} -> ${c.to}`);
          if (c.asset === HERO_IP) viewer.pulse(c.asset, 0x3fe0ff, 1.5, 1.6);
        }
      }
      S.inv = r.inv; S.captures = r.captures; S.selA = S.selB = 0;
      if (first && r.inv.snaps[0] && Object.keys(r.inv.snaps[0].byIp).length) event('info', `ReConnICS-ng analysed ${r.done} capture${r.done === 1 ? '' : 's'}`);
      refresh();
    },
  });
}

// ---------------------------------------------------------------- toolbar / keys
const go = v => viewer.view(v);
$('presets').addEventListener('click', e => { const v = e.target.dataset.view; if (v) go(v); });
const toggleLabels = () => { viewer.setLabels(!viewer.labels); $('labelsBtn').setAttribute('aria-pressed', viewer.labels); };
$('labelsBtn').onclick = toggleLabels;
addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const v = ['overview', 'cell1', 'cell2', 'control', 'hero'][+e.key - 1];
  if (v) go(v); else if (e.key === 'l' || e.key === 'L') toggleLabels(); else if (e.key === 'Escape') select(null);
});

// ---------------------------------------------------------------- start
const mode = q.get('mode') || (q.get('replay') ? 'replay' : 'auto');
const feed = startFeed({ mode, wsUrl: q.get('ws') || 'ws://localhost:8765/state', replayUrl: q.get('replay') },
  { onMessage, onStatus: ({ kind, text, title }) => { const b = $('badge'); b.className = 'badge ' + kind; b.textContent = text; b.title = title || ''; $('restartBtn').hidden = kind !== 'demo'; }, onReset: () => reset() });
$('restartBtn').onclick = () => feed.restartDemo();
if (q.get('view')) go(q.get('view'));
if (q.get('select')) { const t = q.get('select'); const f = () => { if (S.devs.has(t)) select(t, !q.get('view')); else setTimeout(f, 300); }; f(); }
