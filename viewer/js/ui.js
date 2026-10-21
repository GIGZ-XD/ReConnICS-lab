// DOM rendering: device list, identity card, ReConnICS side-by-side, event strip. All inventory text is escaped.
import { compare, diff, field, same } from './inventory.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_TEXT = { ok: 'match', mismatch: 'MISMATCH', missing: 'MISSING', extra: 'no ground truth', na: '-' };
const fmtT = t => new Date(t * 1000).toLocaleTimeString([], { hour12: false });

export function renderList(ul, devices, selected, heroIp) {
  const html = devices.map(d => `<li><button data-ip="${esc(d.ip)}" class="${d.ip === heroIp ? 'hero' : ''}" aria-pressed="${d.ip === selected}">
    <span class="dot ${esc(d.status ?? 'run')}" aria-hidden="true"></span><b>${esc(d.id)}</b><small>${esc(d.ip)} | ${esc(d.segment)} | ${esc(d.role)}</small></button></li>`).join('');
  if (ul.dataset.sig !== html) { const f = document.activeElement?.dataset?.ip; ul.innerHTML = html; ul.dataset.sig = html; if (f) ul.querySelector(`[data-ip="${CSS.escape(f)}"]`)?.focus(); }
}

export function renderEvents(ol, events) {
  ol.innerHTML = events.slice(-6).map(e => `<li class="${e.kind}"><time>${fmtT(e.t)}</time>${esc(e.text)}</li>`).join('');
}

const missingBy = (rec, by) => (rec.completeness.missing || []).filter(m => (m.fillBy ?? by) === by).map(m => m.attr ?? m).join(', ');

function advisoryBlock(rec) {
  if (!rec) return '';
  const m = rec.match;
  if (!m) return `<p class="hint">Advisory matcher did not run for this record (no index loaded when the inventory was made).</p>`;
  const adv = (m.advisories || []).slice(0, 4).map(a => `<li><b>${esc(a.advisory)}</b> <span class="lvl ${esc(a.level)}">${esc(a.level)}</span> CVSS ${esc(a.cvss)}
    <br>${esc(a.title)}<br><span>affected ${esc(a.affected)}${a.kev?.length ? ' | KEV: ' + esc(a.kev.join(', ')) : ''}</span></li>`).join('');
  return `<p>Advisory match <span class="lvl ${esc(m.level)}">${esc(m.level)}</span>${m.kevAtModel ? ' <span class="tag changed">KEV at model</span>' : ''}
    max CVSS ${esc(m.maxCvss)}${m.matchedAs ? ' | matched as ' + esc(m.matchedAs) : ''}</p><ul class="advs">${adv}</ul>`
    + ((m.advisories || []).length > 4 ? `<p class="hint">+ ${m.advisories.length - 4} more</p>` : '');
}

export function renderPanel(el, c) {
  const d = c.dev;
  if (!d) { el.innerHTML = '<p class="hint">Select a device in 3D or from the list.</p>'; return; }
  const hero = d.ip === c.heroIp, mine = c.changes.filter(x => x.ip === d.ip);
  const fwChanged = mine.some(x => x.field === 'firmware');
  const row = (k, v, extra = '') => `<dt>${k}</dt><dd ${extra}>${v ? esc(v) : '<span class="hint">not exposed</span>'}</dd>`;
  const fwCls = fwChanged ? 'class="flash"' : '';
  let html = `<section class="card ${hero ? 'hero' : ''}" aria-label="Identity card">
    <h2>${esc(d.id)}${hero ? '<span class="tag hero">demo hero</span>' : ''}</h2>
    <div class="sub">${esc(d.vendor || d.role)} ${esc(d.model)} <span class="tag ${esc(d.segment)}">${esc(d.segment)}</span><span class="tag">${esc(d.role)}</span></div>
    <dl>${row('Vendor', d.vendor)}${row('Model', d.model)}
      <dt>Firmware</dt><dd ${fwCls}>${d.firmware ? esc(d.firmware) : '<span class="hint">not exposed</span>'}${fwChanged ? ' <span class="tag changed">changed</span>' : ''}</dd>
      ${row('Serial', d.serial)}${row('IP', d.ip)}${row('MAC', d.mac)}${row('Segment', d.segment)}${row('Role', d.role)}</dl>
    ${mine.length ? `<p class="hint" style="margin-bottom:0">Seen changing in this feed:</p><ul class="diff">${mine.map(x => `<li>${fmtT(x.t)} <b>${esc(x.field)}</b> <s>${esc(x.from)}</s> &rarr; <ins>${esc(x.to)}</ins></li>`).join('')}</ul>` : ''}</section>`;

  // ---- ReConnICS view
  const inv = c.inv, B = inv.snaps[c.selB], A = inv.snaps[c.selA];
  html += `<section class="rc" aria-label="ReConnICS view"><h3>ReConnICS view (passive inference vs ground truth)</h3>
    <div class="tools"><label>Inventory JSON <input type="file" id="invFile" accept=".json,application/json" multiple></label>
      <button id="invSample">Load sample (before + after)</button>${inv.loaded ? '<button id="invClear">Clear</button>' : ''}</div>`;
  if (!B) {
    html += `<p class="hint">${inv.changes.length ? 'Only a change log is loaded. ' : ''}Load one or two ReConnICS-ng <code>inventory.json</code> files (or open with <code>?inventory=url[,url2]</code>) to see what the passive tool inferred for ${esc(d.ip)} next to the plant's ground truth.</p>`;
  } else {
    if (inv.snaps.length > 1) {
      const opts = sel => inv.snaps.map((s, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      html += `<div class="tools">compare <select id="snapA" aria-label="Earlier inventory">${opts(c.selA)}</select> &rarr; <select id="snapB" aria-label="Later inventory">${opts(c.selB)}</select></div>`;
    } else html += `<p class="hint">Inventory: ${esc(B.name)}${B.source?.pcap ? ' (' + esc(B.source.pcap) + ')' : ''}</p>`;
    const rec = B.byIp[d.ip];
    if (!rec) html += `<p class="note bad">${esc(d.ip)} is <b>not in this inventory</b> - the passive tool never saw it, or saw it without identity data.</p>`;
    const rows = compare(d, rec), bad = rows.filter(r => r.status === 'mismatch').length, miss = rows.filter(r => r.status === 'missing').length;
    html += `<table><thead><tr><th>Field</th><th>Ground truth</th><th>ReConnICS</th><th></th></tr></thead><tbody>${rows.map(r =>
      `<tr class="${r.status}"><td>${r.field}</td><td>${r.truth ? esc(r.truth) : '-'}</td>
       <td ${r.evidence ? `title="${esc(r.evidence)}"` : ''}>${r.rc ? esc(r.rc) : '-'}${r.conf ? `<span class="conf">${esc(r.conf)}</span>` : ''}</td>
       <td class="st ${r.status}">${STATUS_TEXT[r.status]}</td></tr>`).join('')}</tbody></table>`;
    if (rec) html += `<p class="hint">${rows.filter(r => r.status === 'ok').length} match, ${bad} mismatch, ${miss} missing. Hover a ReConnICS value for its evidence.</p>`;
    for (const r of rows) {                                           // the demo's key point: inventory is stale after a change
      const ch = mine.find(x => x.field === r.field);
      if (ch && r.status === 'mismatch') html += `<p class="note bad"><b>Stale inventory:</b> ${esc(r.field)} changed on the device from <b>${esc(ch.from)}</b> to <b>${esc(ch.to)}</b>
        while this inventory still says <b>${esc(r.rc)}</b>${r.rc && String(r.rc).replace(/^v/i, '') === String(ch.from).replace(/^v/i, '') ? ' (the pre-change value)' : ''}.</p>`;
      else if (r.status === 'mismatch' && inv.snaps.length > 1) {
        const agree = inv.snaps.filter(s => { const v = field(s.byIp[d.ip], r.field)?.value; return v && same(r.field, r.truth, v); });
        html += `<p class="note">${esc(r.field)}: the live ground truth <b>${esc(r.truth)}</b> ${agree.length ? 'matches ' + agree.map(s => '<b>' + esc(s.name) + '</b>').join(', ') : 'matches none of the loaded inventories'}.</p>`;
      }
      if (ch && r.status === 'ok') html += `<p class="note"><b>${esc(r.field)} change detected:</b> this inventory already reflects ${esc(ch.to)} (was ${esc(ch.from)}).</p>`;
    }
    html += advisoryBlock(rec);
    if (rec?.completeness) html += `<p class="hint">Completeness ${esc(rec.completeness.filled)}/${esc(rec.completeness.of)} fields; best possible match ${esc(rec.completeness.matchCeiling)}${missingBy(rec, 'passive') ? '<br>Still missing (passive): ' + esc(missingBy(rec, 'passive')) : ''}${missingBy(rec, 'human') ? '<br>Needs a human: ' + esc(missingBy(rec, 'human')) : ''}${rec.completeness.nextStep ? '<br>Next step: ' + esc(rec.completeness.nextStep) : ''}</p>`;
    for (const r of rows) { const h = r.status === 'missing' && rec.completeness.missing?.find(m => m.attr === r.field); if (h?.hint) html += `<p class="hint"><b>${esc(r.field)}:</b> ${esc(h.hint)}</p>`; }
    (rec?.attributes?.mergeNotes || []).forEach(n => { html += `<p class="hint">${esc(n)}</p>`; });
    if (A && A !== B) {
      const dd = diff(A.byIp[d.ip], B.byIp[d.ip]);
      html += `<h3>Change between inventories</h3>` + (dd.length
        ? `<div class="note"><b>${esc(d.id)} changed between ${esc(A.name)} and ${esc(B.name)}</b></div><ul class="diff">${dd.map(x => `<li><b>${esc(x.field)}</b> ${x.from != null ? `<s>${esc(x.from)}</s>` : ''} ${x.from != null && x.to != null ? '&rarr;' : ''} ${x.to != null ? `<ins>${esc(x.to)}</ins>` : ''}</li>`).join('')}</ul>`
        : `<p class="hint">No difference for this device between the two inventories.</p>`);
    }
  }
  const hist = inv.changesFor(d.ip);
  if (hist.length) html += `<h3>ReConnICS change history</h3><ul class="diff">${hist.map(x => `<li>${esc(String(x.at ?? '').replace('T', ' ').replace('Z', ''))} <b>${esc(x.field)}</b> <s>${esc(x.from)}</s> &rarr; <ins>${esc(x.to)}</ins>${x.source ? ` <span class="hint">${esc(x.source)}</span>` : ''}</li>`).join('')}</ul>`;
  html += '</section><section class="card" aria-label="Live process state"><div id="live"><p class="hint">No process state.</p></div></section>';
  if (el.dataset.sig === html) return;
  el.dataset.sig = html; el.innerHTML = html;
}

export function renderLive(el, d) {
  const live = el?.querySelector('#live'); if (!live || !d) return;
  const s = Object.entries(d.state || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'number' ? +v.toFixed(2) : v)}</dd>`).join('');
  live.innerHTML = s ? `<h3>Live process state</h3><dl>${s}</dl>` : '<p class="hint">No process state.</p>';
}
