// DOM rendering: device list, device panel (lab vs ReConnICS-ng), event strip. All inventory text is escaped.
// Data over prose: values, tags and dots; at most one short line per state, and only when the user must act.
import { compare, diff, evidenceInfo, pipeline, captureFor, FIELDS } from './inventory.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEGMENTS = [['cell1', 'Cell 1'], ['cell2', 'Cell 2'], ['sup', 'Control room']];
const segName = id => SEGMENTS.find(g => g[0] === id)?.[1] ?? id;
const segOfPcap = name => { const m = /^(cell1|cell2|sup)/.exec(name ?? ''); return m ? segName(m[1]) : null; };
const fmtT = t => new Date(t * 1000).toLocaleTimeString([], { hour12: false });
const STATUS = { ok: 'match', mismatch: 'mismatch', missing: 'missing', extra: 'no lab value', na: '' };
const CONF = { HIGH: 'high', MEDIUM: 'med', LOW: 'low' };
const LABEL = { vendor: 'Vendor', model: 'Model', firmware: 'Firmware', serial: 'Serial', mac: 'MAC' };

const collapsed = new Set();                                 // segment groups the user closed; survives re-renders
let detailsOpen = false;                                     // the panel's "Details" disclosure

/** Devices grouped by segment in collapsible groups: names only (IP and role in the tooltip), the demo device tagged. */
export function renderList(el, devices, selected, heroIp) {
  const segs = [...new Set([...SEGMENTS.map(g => g[0]), ...devices.map(d => d.segment)])];
  const html = segs.map(seg => {
    const ds = devices.filter(d => d.segment === seg);
    if (!ds.length) return '';
    const open = !collapsed.has(seg) || ds.some(d => d.ip === selected);
    return `<details data-seg="${esc(seg)}" ${open ? 'open' : ''}><summary>${esc(segName(seg))}</summary><ul>${ds.map(d =>
      `<li><button data-ip="${esc(d.ip)}" class="${d.ip === heroIp ? 'hero' : ''}" aria-pressed="${d.ip === selected}" title="${esc(d.ip)} · ${esc(d.role)}">
      <span class="dot ${esc(d.status ?? 'run')}" aria-hidden="true"></span><b>${esc(d.id)}</b>${d.ip === heroIp ? '<span class="tag hero">Demo device</span>' : ''}</button></li>`).join('')}</ul></details>`;
  }).join('');
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('toggle', e => { const g = e.target.dataset?.seg; if (g) e.target.open ? collapsed.delete(g) : collapsed.add(g); }, true); }
  if (el.dataset.sig !== html) { const f = document.activeElement?.dataset?.ip; el.innerHTML = html; el.dataset.sig = html; if (f) el.querySelector(`[data-ip="${CSS.escape(f)}"]`)?.focus(); }
}

export function renderEvents(ol, events) {
  ol.innerHTML = events.slice(-4).map(e => `<li class="${e.kind}"><time>${fmtT(e.t)}</time>${esc(e.text)}</li>`).join('');
}

/** Evidence under a value: "ENIP ListIdentity · frame 573" (or just the frames); the full raw string stays in the cell's tooltip. */
function evidenceLine(ev) {
  const e = evidenceInfo(ev);
  if (!e || (!e.label && !e.frame)) return '';
  const fr = e.frame ? `${e.frame.includes('-') ? 'frames' : 'frame'} ${e.frame}` : '';
  return `<small class="ev">${esc([e.label, fr].filter(Boolean).join(' · '))}</small>`;
}

/** Four short steps from the record itself: capture, decoded message, fields filled, advisory. */
function pipelineStrip(d, rec, B, c) {
  if (!rec) return '';
  const p = pipeline(rec), fr = p.source?.frame, pcap = captureFor(fr, c.captures) ?? B.source?.pcap ?? null;
  const steps = [
    [esc(pcap ?? segName(d.segment)), `Captured on ${esc(segOfPcap(pcap) ?? segName(d.segment))}`],
    [p.source?.label || fr ? esc([p.source?.label, fr && `${fr.includes('-') ? 'frames' : 'frame'} ${fr}`].filter(Boolean).join(' · ')) : '', 'Decoded message'],
    [p.filled.length ? `${p.filled.length} fields` : '', esc(p.filled.join(', '))],
    [p.advisory ? `${esc(p.advisory.id)} <span class="lvl ${esc(p.advisory.level)}">${esc(p.advisory.level)}</span>` : 'no advisory', 'Advisory match'],
  ].filter(s => s[0]);
  return `<ol class="pipe" aria-label="How ReConnICS-ng got this record">${steps.map(([t, tip]) => `<li title="${tip}">${t}</li>`).join('')}</ol>`;
}

function advisories(rec) {
  const m = rec?.match;
  if (!m?.advisories?.length) return '';
  const top = m.advisories.slice(0, 3).map(a => `<li><b>${esc(a.advisory)}</b> <span class="lvl ${esc(a.level)}">${esc(a.level)}</span> <span class="dim">CVSS ${esc(a.cvss)}</span>${a.kev?.length ? ' <span class="tag bad">KEV</span>' : ''}
    <span class="adv-title" title="${esc(a.title)} (affected ${esc(a.affected)})">${esc(a.title)}</span></li>`).join('');
  return `<ul class="advs">${top}</ul>${m.advisories.length > 3 ? `<span class="dim">+${m.advisories.length - 3} more</span>` : ''}`;
}

/** Everything useful but secondary, behind one disclosure: completeness, merge notes, selectors/diff between inventories, log. */
function details(d, rec, c) {
  const inv = c.inv, B = inv.snaps[c.selB], A = inv.snaps[c.selA], parts = [];
  const miss = by => (rec?.completeness?.missing || []).filter(m => (m.fillBy ?? by) === by).map(m => m.attr ?? m).join(', ');
  if (rec?.completeness) parts.push(`<p>Filled ${esc(rec.completeness.filled)}/${esc(rec.completeness.of)} · best match ${esc(rec.completeness.matchCeiling)}${miss('passive') ? `<br>Not seen: ${esc(miss('passive'))}` : ''}${miss('human') ? `<br>Needs a person: ${esc(miss('human'))}` : ''}${rec.completeness.nextStep ? `<br>Next: ${esc(rec.completeness.nextStep)}` : ''}</p>`);
  (rec?.attributes?.mergeNotes || []).forEach(n => parts.push(`<p>${esc(n)}</p>`));
  if (inv.snaps.length > 1) {
    const opts = sel => inv.snaps.map((s, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    parts.push(`<div class="tools"><select id="snapA" aria-label="Earlier inventory">${opts(c.selA)}</select> &rarr; <select id="snapB" aria-label="Later inventory">${opts(c.selB)}</select></div>`);
  }
  const log = inv.changesFor(d.ip).filter(x => !FIELDS.includes(x.field));
  if (log.length) parts.push(`<ul class="log">${log.map(x => `<li>${esc(String(x.at ?? '').replace('T', ' ').slice(0, 19))} ${esc(x.to)}</li>`).join('')}</ul>`);
  return parts.length ? `<details class="more" ${detailsOpen ? 'open' : ''}><summary>Details</summary>${parts.join('')}</details>` : '';
}

const note = (live, origin) => live && !live.ok
  ? `<p class="note bad">ReConnICS-ng not reachable at ${esc(live.host)} – start <code>serve --allow-origin ${esc(origin)}</code></p>` : '';

export function renderPanel(el, c) {
  const d = c.dev, origin = location.origin;
  if (!el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('toggle', e => { if (e.target.classList?.contains('more')) detailsOpen = e.target.open; }, true); }
  if (!d) {
    const html = `<p class="empty">Select a device</p><button id="pickHero" class="primary">L33ER <span class="tag hero">Demo device</span></button>${note(c.live, origin)}`;
    if (el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; }
    return;
  }
  const hero = d.ip === c.heroIp, mine = c.changes.filter(x => x.ip === d.ip), inv = c.inv, B = inv.snaps[c.selB], A = inv.snaps[c.selA], live = c.live, rec = B?.byIp[d.ip];
  const waiting = !!live?.ok && !rec && live.done === 0;           // console reachable, nothing analysed yet: the column is still empty
  let html = `<section class="card ${hero ? 'hero' : ''}" aria-label="Device"><h2>${esc(d.id)}${hero ? '<span class="tag hero">Demo device</span>' : ''}</h2>
    <div class="sub">${esc(d.ip)} · ${esc(segName(d.segment))} · ${esc(d.role)}</div></section><section class="rc" aria-label="Lab vs ReConnICS-ng">`;
  html += note(live, origin);
  if (!B && !live) html += `<p class="note">Not connected – start <code>serve --allow-origin ${esc(origin)}</code>, open with <code>?reconnics=URL</code></p>`;
  if (B || !live) {
    if (B && !rec && !waiting) html += `<p class="note bad">Not seen in any capture</p>`;
    const rows = compare(d, rec).map(r => waiting ? { ...r, status: 'na' } : r);
    html += pipelineStrip(d, rec, B, c);
    html += `<table><thead><tr><th scope="col">Field</th><th scope="col">Lab (actual)</th><th scope="col">ReConnICS-ng (from pcap)</th><th scope="col"><span class="sr">Status</span></th></tr></thead><tbody>${rows.map(r => {
      const ch = mine.find(x => x.field === r.field), st = waiting ? 'waiting' : STATUS[r.status];
      return `<tr class="${r.status}"><th scope="row">${LABEL[r.field]}</th>
        <td>${ch ? `<span class="chg"><s>${esc(ch.from)}</s> &rarr; <ins>${esc(ch.to)}</ins></span>` : r.truth ? esc(r.truth) : '–'}</td>
        <td ${r.evidence ? `title="${esc(r.evidence)}"` : ''}>${r.rc ? esc(r.rc) : '–'}${r.conf ? `<span class="conf" title="confidence ${esc(r.conf)}">${esc(CONF[r.conf] ?? r.conf)}</span>` : ''}${evidenceLine(r.evidence)}</td>
        <td class="st ${waiting ? 'na' : r.status}"><i class="sdot" aria-hidden="true"></i>${r.status === 'ok' ? `<span class="sr">${st}</span>` : st}</td></tr>`;
    }).join('')}</tbody></table>`;
    if (A && A !== B) {                                                // two loaded inventories: what changed for this device
      const dd = diff(A.byIp[d.ip], B.byIp[d.ip]);
      if (dd.length) html += `<ul class="diff">${dd.map(x => `<li><b>${esc(x.field)}</b> ${x.from != null ? `<s>${esc(x.from)}</s>` : ''}${x.from != null && x.to != null ? ' &rarr; ' : ''}${x.to != null ? `<ins>${esc(x.to)}</ins>` : ''}</li>`).join('')}</ul>`;
    }
    html += advisories(rec);
    const hist = inv.changesFor(d.ip).filter(x => FIELDS.includes(x.field) && x.from);   // what the console logged, e.g. firmware 20.011 -> 24.011
    if (hist.length) html += `<ul class="diff">${hist.map(x => `<li><b>${esc(x.field)}</b> <s>${esc(x.from)}</s> &rarr; <ins>${esc(x.to)}</ins> <span class="dim">${x.at ? esc(new Date(x.at).toLocaleTimeString([], { hour12: false })) : ''}</span></li>`).join('')}</ul>`;
    html += details(d, rec, c);
  }
  html += `<p class="fallback"><label class="link">Load inventory file…<input type="file" id="invFile" accept=".json,application/json" multiple hidden></label>${live ? '' : ' <button class="link" id="invSample">Load sample</button>'}${inv.loaded && !live ? ' <button class="link" id="invClear">Clear</button>' : ''}</p>`;
  html += '</section><section class="card" aria-label="Live state"><div id="live"></div></section>';
  if (el.dataset.sig === html) return;
  el.dataset.sig = html; el.innerHTML = html;
}

export function renderLive(el, d) {
  const live = el?.querySelector('#live'); if (!live || !d) return;
  const s = Object.entries(d.state || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'number' ? +v.toFixed(2) : v)}</dd>`).join('');
  live.innerHTML = s ? `<h3>Live state</h3><dl>${s}</dl>` : '';
}
