// Procedural plant floor. Layout mirrors plant/devices.py: three segments (cell1, cell2, sup) hanging off one
// network cabinet; the Rockwell 1769-L33ER (cell2) is the hero: biggest, most detailed cabinet.
import * as THREE from 'three';
import { V, M, box, cyl, cylAxis, put, tube, screen, led, label, stripes } from './parts.js';
import { cabinet, rail, duct, plc, ioModule, terminals, breaker, relay, psu, cable, networkGear } from './cabinets.js';

export const HERO_IP = '10.10.2.10';
export const SEG_COLOR = { cell1: 0x2a9d8f, cell2: 0x8e7dd6, sup: 0xd4a72c };
const TRUNK = {                                    // stops from the network cabinet outwards
  sup:   [V(-5.35, 2.2, -9.3), V(-5.35, 2.8, -9.3), V(-11, 2.8, -9.3), V(-15, 2.8, -9.3), V(-19, 2.8, -9.3)],
  cell1: [V(-5, 2.2, -9.5), V(-5, 3.0, -9.5), V(4, 3.0, -9.5)],
  cell2: [V(-4.65, 2.2, -9.1), V(-4.65, 3.4, -9.1), V(16, 3.4, -9.1), V(20.2, 3.4, -9.1)],
};
const DROPS = {                                    // ip -> [segment, trunk stop index, points from device up to the stop]
  '10.10.3.1':  ['sup', 0, []],
  '10.10.3.22': ['sup', 2, [V(-11, 2.0, -9.3)]],
  '10.10.3.21': ['sup', 3, [V(-15, .8, -6.7), V(-15, 2.8, -6.7)]],
  '10.10.3.20': ['sup', 4, [V(-19, .8, -6.7), V(-19, 2.8, -6.7)]],
  '10.10.1.10': ['cell1', 2, [V(4, 2.2, -9.5)]], '10.10.1.11': ['cell1', 2, [V(4, 2.2, -9.5)]], '10.10.1.12': ['cell1', 2, [V(4, 2.2, -9.5)]],
  '10.10.2.10': ['cell2', 2, [V(16, 2.2, -9.1)]], '10.10.2.12': ['cell2', 2, [V(16, 2.2, -9.1)]],
  '10.10.2.11': ['cell2', 3, [V(20.2, 1.6, -9.1)]],
};
const SWITCH_PORT = ['10.10.1.10', '10.10.1.11', '10.10.1.12', '10.10.2.10', '10.10.2.11', '10.10.2.12', '10.10.3.20', '10.10.3.21', '10.10.3.22', '10.10.3.1'];

export function buildPlant(scene) {
  const root = new THREE.Group(); scene.add(root);
  const devs = {}, routes = {}, anims = [];
  const reg = (ip, g, leds, ly = .4, extra = {}) => {
    const lb = label(g, '', 0, ly, 0, 'dev');
    devs[ip] = { ip, root: g, leds, label: lb, ...extra };
    g.traverse(o => { if (o.isMesh) o.userData.ip = ip; });
    return devs[ip];
  };

  // ---------------------------------------------------------------- building: floor, walls, zones
  const floorTex = stripes(256, 256, (c, w, h) => { c.fillStyle = '#6d747c'; c.fillRect(0, 0, w, h); for (let i = 0; i < 2000; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},.03)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, 20, 7);
  const floor = put(root, new THREE.PlaneGeometry(52, 18), new THREE.MeshStandardMaterial({ map: floorTex, roughness: .85, color: 0x9aa1a8 }), 1, 0, -1); floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  const grid = new THREE.GridHelper(52, 52, 0x3a4048, 0x555c64); grid.scale.z = 18 / 52; grid.position.set(1, .004, -1); grid.material.transparent = true; grid.material.opacity = .45; root.add(grid);
  const zone = (x0, x1, z0, z1, col, text, tx, tz) => {
    const p = put(root, new THREE.PlaneGeometry(x1 - x0, z1 - z0), M(col, .9), (x0 + x1) / 2, .006, (z0 + z1) / 2); p.rotation.x = -Math.PI / 2; p.castShadow = false;
    for (const [w, d, x, z] of [[x1 - x0, .08, (x0 + x1) / 2, z0], [x1 - x0, .08, (x0 + x1) / 2, z1], [.08, z1 - z0, x0, (z0 + z1) / 2], [.08, z1 - z0, x1, (z0 + z1) / 2]]) {
      const l = box(root, w, .008, d, M(0xe3b505, .6), x, .01, z); l.castShadow = false;
    }
    label(root, text, tx, 4.1, tz, 'zone');
  };
  zone(-23, -9, -10, 4, 0x3b4a5c, 'CONTROL ROOM  |  sup 10.10.3.0/24', -16, -3);
  zone(.5, 12.5, -10, 0, 0x355650, 'CELL 1 - packaging  |  10.10.1.0/24', 6.5, -3);
  zone(13, 25, -10, 0, 0x4a4468, 'CELL 2 - utilities  |  10.10.2.0/24', 19, -3);
  box(root, 52, 4.6, .2, M(0x2b3138, .8), 1, 2.3, -10.1);                               // back wall
  box(root, .2, 4.6, 14.2, M(0x2b3138, .8), -23.1, 2.3, -3);
  for (let z = -9; z <= 4; z += 2.5) { const p = box(root, .12, 2.6, .12, M(0x3b434b, .6, .4), -9, 1.3, z); p.castShadow = true; }
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xaac8e0, transparent: true, opacity: .16, roughness: .05, metalness: 0, side: THREE.DoubleSide });
  for (const [z0, z1] of [[-10, -2.3], [.3, 4]]) { const gl = box(root, .03, 2.5, z1 - z0, glass, -9, 1.25, (z0 + z1) / 2); gl.castShadow = false; }
  box(root, .1, .1, 14, M(0x3b434b, .6, .4), -9, 2.5, -3);

  // ---------------------------------------------------------------- network cabinet (switch + router)
  const net = cabinet(root, { x: -5, z: -9.3, w: 1.2, doors: 2, open: 1.7 });
  rail(net, 1.78); duct(net, 1.98); duct(net, 1.16);
  const gear = networkGear(net);
  const R = gear.router.L;
  [['p0', 0x35ff6a], ['p1', 0x35ff6a], ['p2', 0x35ff6a]].forEach(([n, c], i) => { R[n] = led(gear.router.g, -.38 + i * .06, -.05, .176, c, .014); });
  R.pwr = led(gear.router.g, -.5, .05, .176, 0x35ff6a, .02); R.run = R.pwr; R.act = R.p2;
  reg('10.10.3.1', gear.router.g, R, .2);
  label(root, 'NETWORK CABINET: switch + router', -5, 2.65, -8.4, 'zone sm');
  const portOf = {}; SWITCH_PORT.forEach((ip, i) => { portOf[ip] = gear.ports[i]; });

  // ---------------------------------------------------------------- cell 1 cabinet: M221, M340, S7-315
  const c1 = cabinet(root, { x: 4, z: -9.3, w: 2.6, doors: 2, open: 1.75 });
  [1.55, .95, .36].forEach(y => rail(c1, y)); [2.07, 1.47, .88, .2].forEach(y => duct(c1, y));
  const m221 = plc(c1, { x: -.85, y: 1.78, w: .75, h: .46, body: 0xdde1e4, accent: 0x3dcd58, title: 'TM221CE16R', sub: 'Modicon M221', titleColor: '#fff',
    leds: [['pwr', 0x35ff6a], ['run', 0x35ff6a], ['err', 0xff3b30], ['io', 0x35ff6a]], ports: 1 });
  [-.12, 0, .12].forEach(o => breaker(c1, .15 + o, 1.78)); terminals(c1, .6, 1.78, 12, [0x9aa0a6, 0x2f6fd0, 0x9aa0a6, 0x3fae49]);
  box(c1.g, 1.9, .5, .02, M(0x20252b, .5), -.2, .95 + .23, c1.pz + .015);                   // M340 backplane
  const m340c = plc(c1, { x: -.95, y: 1.18, w: .3, h: .46, body: 0x5c6670, accent: 0x3dcd58, title: 'CPS2000', sub: 'PSU', leds: [['pwr', 0x35ff6a]] });
  const m340 = plc(c1, { x: -.58, y: 1.18, w: .38, h: .46, body: 0x4b545d, accent: 0x3dcd58, title: 'BMXP342020', sub: 'Modicon M340', ports: 1,
    leds: [['pwr', 0x35ff6a], ['run', 0x35ff6a], ['err', 0xff3b30], ['io', 0x35ff6a]] });
  ioModule(c1, { x: -.25, y: 1.18, title: 'DDI3202', accent: 0x3dcd58 }); ioModule(c1, { x: .07, y: 1.18, title: 'DDO3202', accent: 0x3dcd58 });
  [.4, .7].forEach(x => box(c1.g, .28, .44, .17, M(0x3a4047, .6), x, 1.18, c1.pz + .1));
  const ps7 = plc(c1, { x: -.95, y: .59, w: .26, h: .46, body: 0xb9c0c6, accent: 0x0aa5a8, title: 'PS 307', sub: '5A', leds: [['pwr', 0x35ff6a]], titleColor: '#fff' });
  const s7 = plc(c1, { x: -.55, y: .59, w: .4, h: .46, body: 0xaab2b9, accent: 0x0aa5a8, title: 'CPU 315-2 PN/DP', sub: '6ES7 315-2EH14', ports: 2,
    leds: [['pwr', 0x35ff6a], ['err', 0xff3b30], ['bf', 0xff3b30], ['run', 0x35ff6a], ['stop', 0xffb020]] });
  ioModule(c1, { x: -.2, y: .59, title: 'SM 321', accent: 0x0aa5a8 }); ioModule(c1, { x: .12, y: .59, title: 'SM 322', accent: 0x0aa5a8, color: 0xffb020 });
  terminals(c1, .6, .59, 14, [0x9aa0a6, 0x9aa0a6, 0x3fae49]); [.0, .04, .08, .12].forEach(o => relay(c1, .62 + o + .5, 1.18));
  cable(c1, [[-.55, 1.5, .09], [-.5, 1.47, .12], [-.2, 1.47, .12], [.4, 1.47, .12]], 0xffd22e, .009);
  cable(c1, [[-.55, .9, .09], [-.6, .88, .12], [.2, .88, .12], [.9, .88, .12]], 0xffd22e, .009);
  cable(c1, [[-.85, 1.53, .09], [-.8, 1.47, .12], [-.2, 1.47, .12]], 0x2563eb, .007);
  const light1 = c1.g; label(c1.g, 'CELL 1 PLC CABINET', 0, 2.55, .4, 'zone sm');
  reg('10.10.1.10', m221.g, m221.L, .34); reg('10.10.1.11', m340.g, m340.L, .34); reg('10.10.1.12', s7.g, s7.L, .34);

  // ---------------------------------------------------------------- cell 2 hero cabinet: 1769-L33ER (+ M580)
  const hc = cabinet(root, { x: 16, z: -9.3, w: 3.4, doors: 2, open: 1.95 });
  [1.55, .95, .36].forEach(y => rail(hc, y)); [2.07, 1.47, .88, .2].forEach(y => duct(hc, y));
  const pa4 = plc(hc, { x: -1.34, y: 1.78, w: .36, h: .46, body: 0x2b2f36, accent: 0x9aa3ad, title: '1769-PA4', sub: 'Power supply', leds: [['pwr', 0x35ff6a]] });
  const l33 = plc(hc, { x: -.9, y: 1.78, w: .52, h: .46, d: .24, body: 0x23272d, accent: 0xd5192e, title: '1769-L33ER', sub: 'CompactLogix', ports: 2, noTag: true,
    leds: [['pwr', 0x35ff6a], ['run', 0x35ff6a], ['io', 0x35ff6a], ['sd', 0x35ff6a], ['force', 0xffb020], ['err', 0xff3b30]] });
  const key = cyl(l33.g, .028, .03, M(0xc8cdd2, .3, .9), .14, .08, .125); key.rotation.x = Math.PI / 2;
  box(l33.g, .09, .02, .02, M(0x0b0d0f, .5), .14, -.02, .125);                                 // SD slot
  const plate = screen(.42, .15, 512, (ctx, W, H, o = {}) => {                                 // asset tag: model / FW / SN
    ctx.fillStyle = o.changed ? '#7a3b00' : '#101418'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = o.changed ? '#ffb020' : '#3a4350'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4);
    ctx.fillStyle = '#e8edf2'; ctx.font = `bold ${H * .27}px system-ui`; ctx.textBaseline = 'top'; ctx.fillText('1769-L33ER/A  CompactLogix', 10, 6);
    ctx.fillStyle = o.changed ? '#ffd27a' : '#7fe3a0'; ctx.font = `bold ${H * .3}px ui-monospace,monospace`; ctx.fillText('FW ' + (o.fw || '20.011'), 10, H * .36);
    ctx.fillStyle = '#9fb0c0'; ctx.font = `${H * .2}px ui-monospace,monospace`;
    ctx.fillText(o.status && o.status !== 'run' ? String(o.status).toUpperCase() + (o.pct != null ? ' ' + o.pct + '%' : '') : 'SN ' + (o.serial || '60E1F4A2'), 10, H * .72);
    if (o.changed) { ctx.fillStyle = '#ffb020'; ctx.font = `bold ${H * .2}px system-ui`; ctx.fillText('CHANGED', W - 118, H * .4); }
  });
  plate.position.set(-.03, -.045, .126); l33.g.add(plate);
  const io1 = ioModule(hc, { x: -.49, y: 1.78, title: '1769-IQ16' }), io2 = ioModule(hc, { x: -.19, y: 1.78, title: '1769-OB16', color: 0xffb020 });
  ioModule(hc, { x: .11, y: 1.78, title: '1769-IF4', cols: 1, rows: 4 }); ioModule(hc, { x: .41, y: 1.78, title: '1769-OF2', cols: 1, rows: 2 });
  box(hc.g, .06, .46, .2, M(0x2b2f36, .6), .62, 1.78, hc.pz + .1);
  const xle = psu(hc, 1.2, 1.78, .62, .46);
  [0, .045, .09].forEach(o => breaker(hc, .78 + o, 1.78));
  box(hc.g, 1.95, .5, .02, M(0x20252b, .5), -.54, .95 + .23, hc.pz + .015);                   // M580 backplane
  const cps = plc(hc, { x: -1.3, y: 1.18, w: .34, h: .46, body: 0x5c6670, accent: 0x3dcd58, title: 'CPS3500', sub: 'PSU', leds: [['pwr', 0x35ff6a]] });
  const m580 = plc(hc, { x: -.88, y: 1.18, w: .5, h: .46, body: 0x4b545d, accent: 0x3dcd58, title: 'BMEP582040', sub: 'Modicon M580', ports: 3,
    leds: [['pwr', 0x35ff6a], ['run', 0x35ff6a], ['err', 0xff3b30], ['io', 0x35ff6a]] });
  ioModule(hc, { x: -.5, y: 1.18, title: 'DDI3202', accent: 0x3dcd58 }); [-.15, .2, .55].forEach(x => box(hc.g, .31, .44, .17, M(0x3a4047, .6), x, 1.18, hc.pz + .1));
  terminals(hc, -1.5, .59, 26, [0x9aa0a6, 0x9aa0a6, 0x2f6fd0, 0x3fae49]); terminals(hc, .0, .59, 20, [0x9aa0a6, 0xd6a021, 0x9aa0a6]);
  for (let i = 0; i < 6; i++) relay(hc, 1.0 + i * .06, 1.18, i % 2 ? 0x3d7fc4 : 0xd6a021);
  [1.1, 1.17, 1.24].forEach(x => breaker(hc, x, .59));
  // harness: coloured wires from I/O modules into the ducts; yellow Ethernet from the L33ER up and out of the cabinet
  const wires = [0xd6372e, 0x2563eb, 0x222831, 0xe5e5e5, 0x3fae49, 0xd6a021];
  for (let i = 0; i < 18; i++) {
    const x = -.62 + (i % 6) * .05 + Math.floor(i / 6) * .3, y0 = 1.57, c = wires[i % wires.length];
    cable(hc, [[x, y0, .12], [x + .01, y0 - .04, .14], [x + .03, 1.47, .14], [x + .06, 1.4, .13]], c, .005);
  }
  for (let i = 0; i < 14; i++) cable(hc, [[-1.5 + i * .09, .64, .1], [-1.5 + i * .09 + .01, .88, .13], [-1.4 + i * .09, .92, .13]], wires[i % 6], .005);
  cable(hc, [[-1.0, 1.6, .17], [-1.05, 1.5, .2], [-1.05, 1.48, .2], [-.8, 1.48, .2]], 0xffd22e, .01);
  cable(hc, [[-.99, 1.6, .17], [-1.1, 1.3, .2], [-1.2, 2.07, .1], [-1.2, 2.3, 0]], 0xffd22e, .011);
  // beacon: green = run, amber = flashing / rebooting / recently changed, blue = identity sweep in progress
  const beacon = {}; const bp = new THREE.Group(); bp.position.set(1.45, 2.2, -.1); hc.g.add(bp);
  cyl(bp, .02, .2, M(0x888, .4, .9), 0, .1, 0);
  [['g', 0x35ff6a], ['a', 0xffb020], ['b', 0x3fa9ff]].forEach(([k, c], i) => {
    const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: .05, transparent: true, opacity: .92, roughness: .2 });
    put(bp, new THREE.CylinderGeometry(.065, .065, .09, 20), m, 0, .25 + i * .095, 0); beacon[k] = m;
  });
  const hero = reg(HERO_IP, l33.g, l33.L, .4, { hero: true, io: [...io1.bits, ...io2.bits], plate });
  reg('10.10.2.12', m580.g, m580.L, .34);
  // hero floor marker + banner / callout / scan beam
  const ring = put(root, new THREE.RingGeometry(1.5, 1.62, 64), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: .55 }), 16, .012, -6.3); ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
  const callout = label(hc.g, '', 0, 2.75, .4, 'callout'); callout.element.style.opacity = 0;
  const banner = label(hc.g, '', 0, 3.1, .4, 'banner'); banner.element.style.opacity = 0;
  const heroLabel = hero.label; heroLabel.element.classList.add('hero');
  const beam = put(hc.g, new THREE.PlaneGeometry(3.3, .07), new THREE.MeshBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, .46); beam.castShadow = false;
  const fx = { scan: 9, ident: 9, callout: 9, banner: 9, fw: false };

  // ---------------------------------------------------------------- VFD (PowerFlex 525) in its own small enclosure
  const vc = cabinet(root, { x: 20.2, z: -9.3, w: .9, h: 1.6, d: .55, doors: 1, open: 1.8, light: false });
  rail(vc, .9); duct(vc, 1.35); duct(vc, .22);
  const pf = plc(vc, { x: 0, y: 1.0, w: .42, h: .66, d: .2, body: 0x6c747c, accent: 0xd5192e, title: 'PowerFlex 525', sub: '2.2 kW 240V', ports: 1,
    leds: [['pwr', 0x35ff6a], ['run', 0x35ff6a], ['err', 0xff3b30], ['io', 0x35ff6a]] });
  const lcd = screen(.2, .08, 256, (ctx, W, H, hz = 0, st = '') => { ctx.fillStyle = '#0d3b2a'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#7dffb0'; ctx.font = `bold ${H * .62}px ui-monospace,monospace`; ctx.textBaseline = 'middle'; ctx.fillText(st || hz.toFixed(1) + ' Hz', 12, H / 2); }, { unlit: true });
  lcd.position.set(.0, .09, .11); pf.g.add(lcd);
  for (let i = 0; i < 6; i++) box(pf.g, .03, .018, .01, M(0xdfe3e6, .5), -.12 + i * .048, -.05, .105);
  terminals(vc, -.3, .5, 18, [0x9aa0a6, 0x3fae49]);
  reg('10.10.2.11', pf.g, pf.L, .46, { lcd });

  // ---------------------------------------------------------------- cell 1 field: conveyor
  const conv = new THREE.Group(); conv.position.set(1.5, 0, -5.2); root.add(conv);
  const CL = 10, beltTex = stripes(128, 32, (c, w, h) => { c.fillStyle = '#23262b'; c.fillRect(0, 0, w, h); c.fillStyle = '#34383e'; for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 3, h); }, CL * 1.6, 1);
  box(conv, CL, .06, .8, new THREE.MeshStandardMaterial({ map: beltTex, roughness: .9 }), CL / 2, .88, 0);
  box(conv, CL, .12, .05, M(0xb8bfc6, .35, .85), CL / 2, .86, .43); box(conv, CL, .12, .05, M(0xb8bfc6, .35, .85), CL / 2, .86, -.43);
  box(conv, CL, .02, .05, M(0xe3b505, .5), CL / 2, .96, .43); box(conv, CL, .02, .05, M(0xe3b505, .5), CL / 2, .96, -.43);
  for (let x = .3; x < CL; x += 1.9) for (const z of [-.38, .38]) box(conv, .06, .85, .06, M(0x6b747c, .4, .8), x, .43, z);
  for (const x of [0, CL]) { const r = cyl(conv, .1, .78, M(0x9aa3ab, .3, .9), x, .88, 0); r.rotation.x = Math.PI / 2; }
  const motor = cyl(conv, .18, .5, M(0x2f5f9e, .45, .4), -.5, .55, 0); motor.rotation.z = Math.PI / 2; box(conv, .3, .3, .3, M(0x4a525a, .5, .5), -.2, .6, 0);
  const photo = box(conv, .07, .07, .07, M(0x222, .5), 6.2, 1.15, .6); const pl = led(conv, 6.2, 1.15, .65, 0xff3b30, .03);
  const crates = []; const crateGeo = [[.5, .36, .42], [.42, .3, .38], [.55, .4, .45]];
  for (let i = 0; i < 6; i++) {
    const [w, h, d] = crateGeo[i % 3], cr = box(conv, w, h, d, M(i % 2 ? 0xb98a56 : 0xa97d4b, .85), i * 1.7, .91 + h / 2, (i % 3 - 1) * .08);
    box(cr, w + .01, .02, .08, M(0xd8c9a5, .6), 0, h / 2, 0); crates.push(cr);
  }
  box(root, 1.2, .14, 1.2, M(0x9a7b4f, .9), 12.3, .07, -5.2);                                          // pallet at the belt end
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([a, b]) => box(root, .5, .36, .5, M(0xb98a56, .85), 12.3 - .28 + a * .55, .32, -5.2 - .28 + b * .55));
  label(conv, 'CONVEYOR', CL / 2, 1.9, 0, 'zone sm');

  // ---------------------------------------------------------------- cell 2 field: tank, pump, pipes
  const TX = 22.6, TZ = -5.4, TR = 1.15, TH = 3.0, TB = .35;
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, transparent: true, opacity: .2, roughness: .08, side: THREE.DoubleSide, depthWrite: false });
  const tank = put(root, new THREE.CylinderGeometry(TR, TR, TH, 48, 1, true), shell, TX, TB + TH / 2, TZ); tank.castShadow = false;
  cyl(root, TR + .03, .08, M(0x7d8790, .4, .8), TX, TB, TZ, 48); cyl(root, TR + .03, .08, M(0x7d8790, .4, .8), TX, TB + TH, TZ, 48);
  put(root, new THREE.SphereGeometry(TR, 32, 8, 0, Math.PI * 2, 0, .35), M(0x9aa3ab, .35, .85), TX, TB + TH + .02, TZ).scale.y = .6;
  for (const a of [.8, 2.4, 4.0, 5.6]) box(root, .1, TB, .1, M(0x6b747c, .4, .8), TX + Math.cos(a) * (TR - .1), TB / 2, TZ + Math.sin(a) * (TR - .1));
  const water = put(root, new THREE.CylinderGeometry(TR - .03, TR - .03, 1, 48), new THREE.MeshPhysicalMaterial({ color: 0x1f8fd8, transparent: true, opacity: .72, roughness: .12 }), TX, TB + .5, TZ); water.castShadow = false;
  const gauge = new THREE.Group(); gauge.position.set(TX + TR + .15, TB, TZ); root.add(gauge);          // external sight glass + scale
  put(gauge, new THREE.CylinderGeometry(.045, .045, TH, 12), new THREE.MeshPhysicalMaterial({ color: 0xdff1fa, transparent: true, opacity: .35 }), 0, TH / 2, 0);
  const gwater = put(gauge, new THREE.CylinderGeometry(.03, .03, 1, 12), M(0x1f8fd8, .1), 0, .5, 0);
  for (let i = 0; i <= 10; i++) box(gauge, .12, .012, .02, M(0xf2f2f2, .5), .09, i * TH / 10, 0);
  for (const y of [.9, 2.5]) { cylAxis(root, .03, V(TX + TR, TB + y, TZ), V(TX + TR + .15, TB + y, TZ), M(0x9aa3ab, .4, .8)); }
  const tankLbl = label(root, 'TANK', TX, TB + TH + .7, TZ, 'val');
  box(root, .5, .28, .08, M(0x23272d, .5), TX - .9, 1.6, TZ + TR + .02);                                    // LT-101 transmitter
  const flowTex = stripes(32, 64, (c, w, h) => { c.fillStyle = '#8f9ba5'; c.fillRect(0, 0, w, h); c.fillStyle = '#6bc4ff'; c.fillRect(8, 6, 16, 22); }, 1, 1);
  const pipes = [];
  const pipe = (pts, r = .07) => pts.slice(1).forEach((b, i) => {
    const a = pts[i], len = a.distanceTo(b), t = flowTex.clone(); t.repeat.set(1, len * 2.5); t.needsUpdate = true; pipes.push({ t, dir: a.y > b.y ? -1 : 1 });
    cylAxis(root, r, a, b, new THREE.MeshStandardMaterial({ map: t, roughness: .35, metalness: .75 }));
    put(root, new THREE.SphereGeometry(r * 1.15, 12, 8), M(0x8f9ba5, .35, .8), b.x, b.y, b.z);
  });
  const PX = 19.0;
  pipe([V(TX - TR, TB + .25, TZ), V(PX + .6, TB + .25, TZ)]);                                                // suction
  pipe([V(PX, TB + .25, TZ - .3), V(PX, 3.1, TZ - .3), V(TX, 3.1, TZ - .3), V(TX, TB + TH + .1, TZ - .3)]);   // discharge back over the top
  const wheel = put(root, new THREE.TorusGeometry(.12, .015, 8, 20), M(0xd5192e, .5), TX - TR - .5, TB + .25 + .16, TZ); wheel.rotation.x = Math.PI / 2;
  cylAxis(root, .02, V(TX - TR - .5, TB + .25, TZ), V(TX - TR - .5, TB + .4, TZ), M(0x333, .5, .8));
  const pump = new THREE.Group(); pump.position.set(PX - .35, TB + .1, TZ); root.add(pump);
  box(pump, 1.5, .08, .6, M(0x555d66, .5, .6), -.2, -.06, 0);
  const volute = cyl(pump, .26, .26, M(0x2b6a4a, .35, .5), .55, .2, 0, 32); volute.rotation.z = Math.PI / 2;
  cyl(pump, .08, .5, M(0x2b6a4a, .35, .5), .55, .45, 0);
  const pm = cyl(pump, .3, .8, M(0x2f6f93, .45, .4), -.2, .26, 0, 32); pm.rotation.z = Math.PI / 2;
  for (let i = 0; i < 9; i++) { const f = cyl(pump, .325, .015, M(0x2a6283, .5, .4), -.55 + i * .08, .26, 0, 32); f.rotation.z = Math.PI / 2; }
  box(pump, .22, .2, .26, M(0x2a2e33, .5), -.2, .6, 0);                                                    // terminal box
  const impeller = new THREE.Group(); impeller.position.set(.18, .26, 0); pump.add(impeller);
  for (let i = 0; i < 3; i++) { const b = box(impeller, .03, .22, .02, M(i ? 0xdddddd : 0xff4040, .4), 0, 0, 0); b.rotation.x = i * Math.PI / 3; }
  const imp = cyl(pump, .1, .02, M(0x777, .3, .9), .17, .26, 0); imp.rotation.z = Math.PI / 2;
  pump.add(impeller); const pumpLed = led(pump, -.2, .6, .14, 0x35ff6a, .04);
  tube(root, [V(20.2, .12, -9.0), V(20.0, .12, -7.4), V(18.6, .12, -6.1), V(18.3, .34, TZ - .3)], .035, 0x20252b);   // VFD -> motor cable
  label(root, 'PUMP P-101', PX - .3, 1.45, TZ, 'zone sm');

  // ---------------------------------------------------------------- control room: HMI desk, EWS desk, historian rack
  const desk = (x) => {
    const g = new THREE.Group(); g.position.set(x, 0, -6.3); root.add(g);
    box(g, 1.7, .05, .8, M(0xc9a97a, .55), 0, .75, 0);
    for (const sx of [-.8, .8]) for (const sz of [-.35, .35]) box(g, .05, .75, .05, M(0x4a5058, .4, .7), sx, .375, sz);
    box(g, .5, .02, .18, M(0x15181c, .6), 0, .785, .22); box(g, .12, .015, .08, M(0x15181c, .6), .45, .785, .22);
    const ch = new THREE.Group(); ch.position.set(0, 0, 1.0); g.add(ch);
    cyl(ch, .02, .45, M(0x333, .4, .8), 0, .25, 0); box(ch, .5, .08, .5, M(0x2a2f36, .8), 0, .52, 0); box(ch, .5, .5, .08, M(0x2a2f36, .8), 0, .8, -.22);
    return g;
  };
  const monitor = (g, x, w, h, draw) => {
    box(g, w + .04, h + .04, .035, M(0x15181c, .4, .3), x, .78 + .12 + h / 2, -.28); box(g, .05, .14, .05, M(0x333, .4, .8), x, .85, -.28); box(g, .22, .015, .14, M(0x333, .4, .8), x, .78, -.28);
    const s = screen(w, h, 512, draw, { unlit: true }); s.position.set(x, .9 + h / 2, -.28 + .02); g.add(s); return s;
  };
  const hmiDesk = desk(-19);
  const hmiScr = monitor(hmiDesk, 0, .8, .45, (ctx, W, H, a = {}) => {
    ctx.fillStyle = '#10161d'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#1f2a36'; ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 22px system-ui'; ctx.fillText('HMI  -  LINE 2 UTILITIES', 12, 25);
    const lvl = a.tank_level ?? 0; ctx.strokeStyle = '#6bc4ff'; ctx.lineWidth = 3; ctx.strokeRect(40, 70, 90, 200);
    ctx.fillStyle = '#1f8fd8'; ctx.fillRect(43, 270 - 197 * lvl / 100, 84, 197 * lvl / 100); ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui'; ctx.fillText(lvl.toFixed(0) + ' %', 52, 62);
    ctx.fillStyle = a.pump_on ? '#35ff6a' : '#556'; ctx.beginPath(); ctx.arc(230, 130, 38, 0, 7); ctx.fill(); ctx.fillStyle = '#000'; ctx.font = 'bold 20px system-ui'; ctx.fillText('P-101', 207, 136);
    ctx.fillStyle = '#9fb0c0'; ctx.font = '20px system-ui'; ctx.fillText(a.pump_on ? 'RUNNING' : 'STOPPED', 188, 195);
    ctx.fillStyle = '#e6edf3'; ctx.fillText('Conveyor ' + (a.conveyor_speed ?? 0).toFixed(2) + ' m/s', 330, 100); ctx.fillText('Drive ' + (a.output_hz ?? 0).toFixed(0) + ' Hz', 330, 135);
    ctx.fillStyle = '#35ff6a'; ctx.fillText('Modbus FC3 poll 1 s', 330, 200); ctx.fillStyle = '#ffb020'; ctx.fillText('ENIP read tag 1 s', 330, 228);
  });
  const hmiLed = led(hmiDesk, .75, .8, .28, 0x35ff6a, .03);
  reg('10.10.3.20', hmiDesk, { pwr: hmiLed, act: hmiLed }, 1.7);
  const ewsDesk = desk(-15), ewsLines = [];
  const ewsScr = monitor(ewsDesk, -.4, .6, .38, (ctx, W, H) => {
    ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, W, H); ctx.font = '17px ui-monospace,monospace';
    ctx.fillStyle = '#7dffb0'; ctx.fillText('ews$ reconnics probe --identity', 8, 22);
    ewsLines.slice(-11).forEach((l, i) => { ctx.fillStyle = l.startsWith('!') ? '#ff6bd6' : '#c9d6df'; ctx.fillText(l.replace(/^!/, ''), 8, 46 + i * 20); });
  });
  monitor(ewsDesk, .4, .6, .38, (ctx, W, H) => { ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#3fa9ff'; ctx.font = 'bold 22px system-ui'; ctx.fillText('Engineering workstation', 12, 30);
    ctx.fillStyle = '#9fb0c0'; ctx.font = '18px system-ui'; ['Studio 5000', 'ControlFLASH', 'SoMachine', 'TIA Portal'].forEach((t, i) => ctx.fillText('> ' + t, 20, 80 + i * 32)); });
  const tower = box(ewsDesk, .22, .5, .5, M(0x1b1e23, .5, .4), 0.7, .25, 0); const ewsLed = led(ewsDesk, .7, .42, .26, 0x35ff6a, .03);
  reg('10.10.3.21', ewsDesk, { pwr: ewsLed, act: ewsLed }, 1.7);
  const rg = new THREE.Group(); rg.position.set(-11, 0, -9.3); root.add(rg);
  for (const sx of [-.28, .28]) for (const sz of [-.4, .38]) box(rg, .05, 2.0, .05, M(0x15181c, .5, .5), sx, 1, sz);
  box(rg, .6, .04, .9, M(0x15181c, .5, .5), 0, 2.0, 0); box(rg, .6, .04, .9, M(0x15181c, .5, .5), 0, .04, 0);
  const rc = { g: rg, pz: -.2 }; let hl;
  for (let i = 0; i < 9; i++) {
    const u = plc(rc, { x: 0, y: .25 + i * .185, w: .5, h: .16, d: .5, body: i === 6 ? 0x2c3a52 : 0x2a2d33, accent: i === 6 ? 0x3fa9ff : 0x555c63, title: i === 6 ? 'HISTORIAN' : 'srv-' + i, sub: i === 6 ? 'VMware VM host, 5 s poll' : '', leds: [['pwr', 0x35ff6a], ['act', 0xffb020]] });
    if (i === 6) hl = u;
  }
  reg('10.10.3.22', rg, { pwr: hl.L.pwr, act: hl.L.act }, 2.35);

  // ---------------------------------------------------------------- cable trays: one trunk per segment, drops per device
  const trayMat = s => M(SEG_COLOR[s], .5, .5);
  const link = (a, b, seg) => {
    if (Math.abs(a.y - b.y) > 1e-6) { cylAxis(root, .07, a, b, trayMat(seg)); put(root, new THREE.SphereGeometry(.09, 10, 8), trayMat(seg), b.x, b.y, b.z); return; }
    const len = a.distanceTo(b), m = a.clone().add(b).multiplyScalar(.5), g = new THREE.Group(); g.position.copy(m); g.lookAt(b); root.add(g);
    box(g, .38, .035, len, trayMat(seg), 0, -.02, 0);
    for (const s of [-1, 1]) box(g, .03, .09, len, trayMat(seg), s * .19, .02, 0);
    for (let t = -len / 2 + .3; t < len / 2; t += .5) box(g, .38, .012, .02, M(0x2a2f36, .6), 0, 0, t);
    if (Math.abs(a.x - b.x) > 1) for (let x = Math.min(a.x, b.x) + 1; x < Math.max(a.x, b.x); x += 3) box(root, .06, .06, a.z + 10, M(0x4a525a, .5, .6), x, a.y - .05, (a.z - 10) / 2);   // wall brackets
  };
  for (const [seg, st] of Object.entries(TRUNK)) st.slice(1).forEach((b, i) => link(st[i], b, seg));
  for (const [ip, [seg, tap, pts]] of Object.entries(DROPS)) {
    const chain = [...pts, TRUNK[seg][tap]];
    for (let i = 1; i < chain.length; i++) link(chain[i - 1], chain[i], seg);
    routes[ip] = [...pts, ...TRUNK[seg].slice(0, tap + 1).reverse()];
  }

  // ---------------------------------------------------------------- per-frame update
  const hmiState = { k: '' };
  function update(agg, dt, t, ctx) {
    const lvl = agg.tank_level ?? 0, pumpOn = !!agg.pump_on, sp = agg.conveyor_speed ?? 0, hz = agg.output_hz ?? (pumpOn ? 50 : 0);
    const wh = Math.max(.01, TH * lvl / 100); water.scale.y = wh; water.position.y = TB + wh / 2;
    gwater.scale.y = wh; gwater.position.y = wh / 2;
    const txt = 'TANK ' + Math.round(lvl) + ' %' + (agg.temp_c != null ? '  ' + Math.round(agg.temp_c) + ' C' : ''); if (tankLbl.element.textContent !== txt) tankLbl.element.textContent = txt;
    if (pumpOn) pipes.forEach(p => { p.t.offset.y -= dt * .9 * p.dir; });
    impeller.rotation.x += dt * (hz / 50) * 18; pump.position.y = TB + .1 + (pumpOn ? Math.sin(t * 90) * .002 : 0); pumpLed.set(pumpOn);
    beltTex.offset.x -= dt * sp * 1.6;
    crates.forEach(c => { c.position.x += sp * dt; if (c.position.x > CL - .2) c.position.x -= CL; });
    pl.set(crates.some(c => Math.abs(c.position.x - 4.7) < .3));
    const key = [Math.round(lvl), pumpOn, sp.toFixed(1), Math.round(hz)].join();
    if (key !== hmiState.k && t - (hmiState.t || 0) > .4) { hmiState.k = key; hmiState.t = t; hmiScr.redraw({ tank_level: lvl, pump_on: pumpOn, conveyor_speed: sp, output_hz: hz }); }
    const st = ctx.status['10.10.2.11'], hk = hz.toFixed(1) + st; if (hk !== hmiState.lcd) { hmiState.lcd = hk; lcd.redraw(hz, st && st !== 'run' ? st.toUpperCase() : ''); }
    if (ewsScr._dirty) { ewsScr.redraw(); ewsScr._dirty = false; }
    // hero IO LEDs follow the process
    const bits = hero.io, run = ctx.status[HERO_IP] === 'run';
    bits.forEach((b, i) => b.set(run && (i === 0 || i === 16 ? pumpOn : i === 1 ? lvl < 30 : i === 2 ? lvl > 80 : i === 3 || i === 8 || i === 17 ? true : i === 24 && lvl > 90), 1.8));
    // hero fx
    fx.scan += dt; fx.ident += dt; fx.callout += dt; fx.banner += dt; if (fx.banner > 30) fx.fw = false;
    const b = fx.scan < 1.7 ? 1 - fx.scan / 1.7 : 0;
    beam.position.y = .1 + Math.min(1, fx.scan / 1.5) * 2.0; beam.material.opacity = b * .85;
    const status = ctx.status[HERO_IP];
    beacon.g.emissiveIntensity = status === 'run' ? 2 : .05;
    beacon.a.emissiveIntensity = (status === 'flashing' || status === 'booting' || fx.fw) && ((t * 4) | 0) % 2 ? 2.4 : .05;
    beacon.b.emissiveIntensity = fx.ident < 3 && ((t * 8) | 0) % 2 ? 2.8 : .05;
    callout.element.style.opacity = fx.callout < 3.8 ? Math.min(1, (3.8 - fx.callout) * 2) : 0;
    banner.element.style.opacity = fx.banner < 30 ? 1 : 0;
    ring.material.opacity = .35 + .2 * Math.sin(t * 2) + (fx.ident < 2 ? .4 : 0);
  }

  return {
    root, devs, routes, portOf, update,
    pickables: (() => { const a = []; root.traverse(o => { if (o.isMesh && o.userData.ip) a.push(o); }); return a; })(),
    hero: {
      sweep(text) { fx.scan = 0; fx.ident = 0; fx.callout = 0; callout.element.textContent = text; },
      info(o) { plate.redraw(o); },
      banner(text) { fx.banner = 0; fx.fw = true; banner.element.textContent = text; },
      clearBanner() { fx.banner = 99; fx.fw = false; },
    },
    ewsLog(line) { ewsLines.push(line); if (ewsLines.length > 40) ewsLines.shift(); ewsScr._dirty = true; },
    reset() { ewsLines.length = 0; ewsScr._dirty = true; this.hero.clearBanner(); this.hero.info({}); },
  };
}
