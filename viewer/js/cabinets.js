// Control cabinets: shell with opening doors, mounting plate, DIN rails, wire ducts, modules with LEDs.
// Cabinet local frame: origin on the floor at the centre, front faces +z. Returns what plant3d needs to register devices.
import * as THREE from 'three';
import { V, M, box, cyl, put, tube, screen, led, label, stripes } from './parts.js';

const ductTex = stripes(64, 16, (c, w, h) => { c.fillStyle = '#8f9aa5'; c.fillRect(0, 0, w, h); c.fillStyle = '#4b535b'; for (let x = 0; x < w; x += 8) c.fillRect(x, 0, 2, h); }, 1, 1);
const DUCT = new THREE.MeshStandardMaterial({ map: ductTex, roughness: .7 });
const RAIL = M(0xc3c9d0, .3, .9);

export function cabinet(parent, { x, z, w, h = 2.2, d = .8, doors = 2, open = 1.9, light = true }) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const shell = M(0xd5d9dc, .45, .35), dark = M(0x3b4148, .6, .3);
  box(g, w, .1, d, dark, 0, .05, 0);                                              // plinth
  box(g, .03, h - .1, d, shell, -w / 2 + .015, h / 2 + .05, 0);                    // sides
  box(g, .03, h - .1, d, shell, w / 2 - .015, h / 2 + .05, 0);
  box(g, w, .03, d + .02, shell, 0, h - .015, 0);                                  // roof
  box(g, w, h - .1, .02, M(0xe6e8ea, .6), 0, h / 2 + .05, -d / 2 + .01);           // back
  const pz = -d / 2 + .06;                                                          // mounting-plate surface
  box(g, w - .1, h - .45, .02, M(0xe19532, .55, .35), 0, h / 2 + .02, -d / 2 + .05);
  if (light) { const l = new THREE.PointLight(0xfff0d8, 1.6, 4.2, 1.6); l.position.set(0, h * .62, d / 2 - .1); g.add(l); }
  const hinge = (sx, dw) => {                                                       // sx: -1 left hinge, +1 right hinge
    const pv = new THREE.Group(); pv.position.set(sx * w / 2, 0, d / 2); g.add(pv);
    box(pv, dw, h - .12, .04, M(0xc7ccd1, .4, .4), -sx * dw / 2, h / 2 + .02, .02);
    for (let i = 0; i < 7; i++) box(pv, dw * .5, .012, .012, dark, -sx * dw / 2, .42 + i * .035, .045);   // vent louvres
    box(pv, .035, .22, .04, dark, -sx * (dw - .1), h / 2, .06);                                              // handle
    const pocket = box(pv, .3, .22, .004, M(0xf2f2ee, .9), -sx * dw * .5, h * .72, .044); pocket.castShadow = false;
    pv.rotation.y = -sx * open;
  };
  if (doors === 2) { hinge(-1, w / 2); hinge(1, w / 2); } else hinge(-1, w);
  return { g, w, h, d, pz, iw: w - .14, zc: pz + .11 };
}

export const rail = (c, y, x0 = -c.iw / 2, x1 = c.iw / 2) => box(c.g, x1 - x0, .035, .012, RAIL, (x0 + x1) / 2, y, c.pz + .02);
export const duct = (c, y, x0 = -c.iw / 2, x1 = c.iw / 2) => {
  const o = box(c.g, x1 - x0, .08, .07, DUCT, (x0 + x1) / 2, y, c.pz + .045);
  o.material = new THREE.MeshStandardMaterial({ map: ductTex.clone(), roughness: .7 }); o.material.map.repeat.set((x1 - x0) * 8, 1); o.material.map.needsUpdate = true; return o;
};

/** Generic PLC module. leds: [[name, hex]] in two columns at the top. ports: number of RJ45 sockets at the bottom. */
export function plc(c, { x, y, w, h, body = 0x2d3138, accent = 0xffffff, title, sub = '', leds = [], ports = 0, d = .22, titleColor = '#fff', noTag = false }) {
  const g = new THREE.Group(); g.position.set(x, y, c.pz + d / 2); c.g.add(g);
  box(g, w, h, d, M(body, .45, .25), 0, 0, 0);
  box(g, w, .04, d + .004, M(accent, .45), 0, h / 2 - .02, 0);
  const tag = screen(w * .92, h * .26, 256, (ctx, W, H, s2 = sub, t2 = '#aab') => {
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(8,10,12,.78)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = titleColor; ctx.font = `bold ${H * .42}px system-ui,sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(title, 8, 4);
    ctx.fillStyle = t2; ctx.font = `${H * .28}px system-ui,sans-serif`; ctx.fillText(s2, 8, H * .55);
  });
  tag.position.set(0, -h * .08, d / 2 + .002); tag.visible = !noTag; g.add(tag);
  const L = {};
  leds.forEach(([n, col], i) => { L[n] = led(g, -w / 2 + .05 + (i % 2) * .05, h / 2 - .1 - Math.floor(i / 2) * .045, d / 2 + .004, col, .024); });
  for (let i = 0; i < ports; i++) {
    const px = w / 2 - .09 - i * .09;
    box(g, .07, .05, .05, M(0x0b0d0f, .5), px, -h / 2 + .06, d / 2 - .01);
    L['link' + i] = led(g, px - .015, -h / 2 + .105, d / 2 + .004, 0x35ff6a, .014);
    L['act' + i] = led(g, px + .015, -h / 2 + .105, d / 2 + .004, 0xffb020, .014);
  }
  if (ports) { L.link = L.link0; L.act = L.act0; }
  return { g, L, tag, d };
}

/** I/O module with a matrix of channel LEDs; returns leds[] indexed row-major by column. */
export function ioModule(c, { x, y, w = .3, h = .46, title, accent = 0x9aa3ad, cols = 2, rows = 8, color = 0x35ff6a }) {
  const m = plc(c, { x, y, w, h, body: 0x32373e, accent, title, d: .2, leds: [['pwr', 0x35ff6a]] });
  const bits = [];
  for (let col = 0; col < cols; col++) for (let r = 0; r < rows; r++)
    bits.push(led(m.g, -w / 2 + .1 + col * .08, h / 2 - .1 - r * .022, .1 + .004, color, .014));
  return { ...m, bits };
}

export const terminals = (c, x0, y, n, colors = [0x9aa0a6]) => { for (let i = 0; i < n; i++) {
  box(c.g, .026, .075, .05, M(colors[i % colors.length], .5), x0 + i * .03, y, c.pz + .035);
  box(c.g, .012, .012, .01, M(0x333, .4, .8), x0 + i * .03, y + .02, c.pz + .062); } };
export const breaker = (c, x, y) => { box(c.g, .036, .1, .07, M(0xe9ebee, .5), x, y, c.pz + .045); box(c.g, .016, .03, .02, M(0x111, .5), x, y + .02, c.pz + .085); };
export const relay = (c, x, y, col = 0x3d7fc4) => { box(c.g, .04, .075, .055, M(col, .5), x, y, c.pz + .04); return led(c.g, x, y + .02, c.pz + .07, 0xffb020, .01); };
export const psu = (c, x, y, w = .5, h = .42) => {
  const m = plc(c, { x, y, w, h, body: 0x70787f, accent: 0x7fbf3f, title: '24 VDC', sub: '10 A', leds: [['pwr', 0x35ff6a]], d: .16 }); return m;
};
export const cable = (c, pts, color = 0x222831, r = .007) => tube(c.g, pts.map(p => V(p[0], p[1], c.pz + p[2])), r, color);

/** Switch / router / patch panel for the network cabinet. Returns port LEDs for each slot. */
export function networkGear(c, nPorts = 24) {
  const out = { ports: [] };
  const z = c.pz + .2;
  const unit = (y, h, title, sub, accent) => plc(c, { x: 0, y, w: c.iw - .1, h, body: 0x23282e, accent, title, sub, d: .34, titleColor: '#fff' });
  // patch panel
  const pp = unit(1.9, .12, 'PATCH PANEL', 'seg: cell1 teal / cell2 violet / sup mustard', 0x555c63);
  for (let i = 0; i < 24; i++) box(pp.g, .03, .035, .02, M(0x0b0d0f, .5), -.46 + i * .04, -.0, .17);
  // switch
  const sw = unit(1.62, .17, 'SWITCH (per-segment VLAN / SPAN)', 'managed L2, 24 x 10/100', 0x2f80ed);
  for (let i = 0; i < nPorts; i++) {
    const px = -.47 + (i % 12) * .085, py = i < 12 ? .01 : -.045;
    box(sw.g, .05, .035, .03, M(0x0b0d0f, .5), px, py - .02, .17);
    out.ports.push({ link: led(sw.g, px - .012, py, .186, 0x35ff6a, .011), act: led(sw.g, px + .012, py, .186, 0xffb020, .011) });
  }
  const rt = unit(1.36, .17, 'ROUTER (netns rc-rtr)', 'eth0 10.10.1.1 | eth1 10.10.2.1 | eth2 10.10.3.1', 0xe6a23c);
  out.router = rt;
  // patch cords up to the duct, coloured per segment
  const cords = [[0x2a9d8f, -.4], [0x8e7dd6, -.1], [0xd4a72c, .2]];
  cords.forEach(([col, x], i) => {
    cable(c, [[x, 1.84, .27], [x - .06, 1.7, .3], [x - .06, 1.1, .3], [x + .1, .9, .3]], col, .012);
    cable(c, [[x + .05, 1.84, .27], [x, 2.0, .3], [x - .02, 2.12, .1], [x, 2.25, .0]], col, .012);
  });
  return out;
}
