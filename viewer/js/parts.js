// Small procedural-geometry helpers shared by plant3d.js. Units are metres.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mats = new Map();
export function M(color, r = .6, m = 0, extra) {          // cached PBR material
  const k = [color, r, m, extra ? JSON.stringify(extra) : ''].join();
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, ...extra }));
  return mats.get(k);
}
const shadow = o => { o.castShadow = o.receiveShadow = true; return o; };
export function put(p, geo, mat, x = 0, y = 0, z = 0) { const o = shadow(new THREE.Mesh(geo, mat)); o.position.set(x, y, z); p.add(o); return o; }
export const box = (p, w, h, d, mat, x, y, z) => put(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
export const cyl = (p, r, h, mat, x, y, z, seg = 20) => put(p, new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z);
export function cylAxis(p, r, a, b, mat, seg = 12) {      // cylinder between two points
  const d = b.clone().sub(a), o = put(p, new THREE.CylinderGeometry(r, r, d.length(), seg), mat);
  o.position.copy(a).addScaledVector(d, .5);
  o.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return o;
}
export function tube(p, pts, r, color, seg = 24) {
  return put(p, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .3), seg, r, 6), M(color, .5));
}

/** Canvas-textured plane; .redraw(...args) re-renders it (labels, screens). */
export function screen(w, h, px, draw, { unlit = false } = {}) {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
  const ctx = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), unlit ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: .7 }));
  m.redraw = (...a) => { draw(ctx, c.width, c.height, ...a); tex.needsUpdate = true; };
  m.redraw();
  return m;
}

/** Indicator LED. set(on, k) / colour(hex). */
export function led(p, x, y, z, color = 0x35ff6a, s = .026) {
  const m = new THREE.MeshStandardMaterial({ color: 0x15181c, emissive: color, emissiveIntensity: 0, roughness: .4 });
  const o = new THREE.Mesh(new THREE.BoxGeometry(s, s, s * .5), m); o.position.set(x, y, z); p.add(o);
  return { mesh: o, on: false, set(on, k = 2.4) { if (on !== this.on || this.k !== k) { m.emissiveIntensity = on ? k : 0; this.on = on; this.k = k; } },
    colour(c) { m.emissive.setHex(c); } };
}

export function label(p, text, x, y, z, cls = '') {
  const d = document.createElement('div'); d.className = 'lbl ' + cls; d.textContent = text;
  const o = new CSS2DObject(d); o.position.set(x, y, z); p.add(o); return o;
}

/** Repeating stripe texture (cable duct fingers, conveyor belt, moving pipe dashes). */
export function stripes(w, h, draw, repeatX, repeatY) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
