// Three.js scene: renderer, camera presets, picking, live binding (LEDs, packets, process animation).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPlant, HERO_IP } from './plant3d.js';
import { isIdentity, fcName } from './schema.js';

export const PROTO_COLOR = { modbus: 0x4aa3ff, enip: 0xffa31a, s7comm: 0x4cd964, s7: 0x4cd964 };   // arp / tcp / udp / icmp: grey
export const IDENT_COLOR = 0xff2bd6;
const VIEWS = {
  overview: { p: [1, 22, 34], t: [1, 0, -4] },
  cell1:    { p: [6, 4.2, 0], t: [6.5, 1.2, -8] },
  cell2:    { p: [19.5, 4.6, 0], t: [19.5, 1.3, -7.5] },
  control:  { p: [-16, 5, 3], t: [-15, 1, -6.5] },
  hero:     { p: [16, 1.9, -4.3], t: [16, 1.3, -9.3] },
};
const MAXP = 600, MAXH = 80;

export function createViewer(container, { onPick, onIdentity }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
  container.appendChild(renderer.domElement);
  const css = new CSS2DRenderer(); css.domElement.className = 'css2d'; container.appendChild(css.domElement);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d1217);
  scene.fog = new THREE.Fog(0x0d1217, 55, 110);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495; controls.minDistance = 1.2; controls.maxDistance = 70;

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2f36, .55));
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.3); sun.position.set(-6, 26, 16); sun.target.position.set(2, 0, -4);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 18, bottom: -18, near: 1, far: 70 });
  scene.add(sun, sun.target);

  const plant = buildPlant(scene);
  const devs = plant.devs, tmp = new THREE.Vector3();
  for (const d of Object.values(devs)) d.pos = d.root.getWorldPosition(new THREE.Vector3());
  window.__plant = plant;

  // ------------------------------------------------------------ camera presets
  let fly = null;
  function view(name) {
    const v = VIEWS[name]; if (!v) return;
    flyTo(new THREE.Vector3(...v.p), new THREE.Vector3(...v.t));
  }
  function flyTo(p, t) { fly = { t0: performance.now(), p0: camera.position.clone(), t0v: controls.target.clone(), p, t }; }
  const ease = x => x * x * (3 - 2 * x);
  function focus(ip) {
    if (ip === HERO_IP) return view('hero');
    const d = devs[ip]; if (!d) return;
    const desk = d.pos.y < 1.2 && !d.hero && ip.startsWith('10.10.3.');
    flyTo(d.pos.clone().add(new THREE.Vector3(desk ? 0 : 0, desk ? 3.5 : .4, desk ? 5.5 : 3.4)), d.pos.clone());
  }
  camera.position.set(...VIEWS.overview.p); controls.target.set(...VIEWS.overview.t);

  // ------------------------------------------------------------ packets (instanced) and pulses
  const pk = new THREE.InstancedMesh(new THREE.SphereGeometry(.09, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), MAXP);
  const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(.16, 12, 8), new THREE.MeshBasicMaterial({ color: IDENT_COLOR, transparent: true, opacity: .4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), MAXH);
  for (const m of [pk, halo]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; scene.add(m); }
  pk.setColorAt(0, new THREE.Color()); 
  const packets = [], rings = [];
  const ringGeo = new THREE.RingGeometry(.92, 1, 48);
  function pulse(ip, color, r1 = 1.6, life = 1.2) {
    const d = devs[ip]; if (!d) return;
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
    m.renderOrder = 20; m.position.copy(d.pos); scene.add(m); rings.push({ m, age: 0, life, r1, r0: .15 });
  }
  const dedupe = pts => pts.filter((p, i) => i === 0 || p.distanceToSquared(pts[i - 1]) > 1e-6);

  function spawn(f, src, dst) {
    const rs = plant.routes[src.ip], rd = plant.routes[dst.ip];
    if (!rs || !rd || packets.length >= MAXP) return;
    const path = dedupe([...rs, ...[...rd].reverse()]).map(p => p.clone().add(new THREE.Vector3(0, .12, 0)));
    const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
    const ident = isIdentity(f, src);
    packets.push({ path, cum, len: cum.at(-1), d: 0, speed: ident ? 8 : 10, scale: ident ? 1.8 : (.7 + Math.min(f.bytes || 60, 1500) / 1500 * .9) * (PROTO_COLOR[f.proto] ? 1 : .7),
      color: ident ? IDENT_COLOR : PROTO_COLOR[f.proto] ?? 0xd0d7de, ident, f, src, dst });
    act[src.ip] = .35;
  }

  // ------------------------------------------------------------ live state
  const ROUTER = { id: 'router', ip: '10.10.3.1', role: 'router', segment: 'sup' };   // appears in flows only (ARP), not in the device list
  const byId = { router: ROUTER }, byIp = {}, status = {}, act = {}; let agg = {};
  function apply(msg) {                                    // msg: normalised frame (devices[].status, process{})
    agg = msg.process || {};
    for (const d of msg.devices || []) {
      byId[d.id] = byIp[d.ip] = d; status[d.ip] = d.status ?? 'run';
      const dev = devs[d.ip];
      if (dev && dev.name !== d.id) { dev.name = d.id; dev.label.element.textContent = (dev.hero ? '★ ' : '') + d.id + ' ' + d.ip; }
    }
    for (const f of msg.flows || []) {
      const s = byId[f.src] ?? byIp[f.src], d = byId[f.dst] ?? byIp[f.dst];
      if (!s || !d) continue;
      if (s === d) { if (f.gratuitous) pulse(s.ip, 0xffffff, 1.3, 1); continue; }          // gratuitous ARP: device announces itself
      spawn(f, s, d);
      if (s.role === 'ews' && f.proto !== 'arp') plant.ewsLog(`!> ${fcName(f, s)}  ${d.ip}`);
    }
  }
  function arrive(p) {
    act[p.dst.ip] = .35;
    if (!p.ident) return;
    const hero = p.dst.ip === HERO_IP;
    pulse(p.dst.ip, IDENT_COLOR, hero ? 1.3 : .8, hero ? 1.6 : 1);
    if (hero) { for (const k of [.25, .5]) setTimeout(() => pulse(p.dst.ip, IDENT_COLOR, 1.3, 1.4), k * 1000); plant.hero.sweep(`IDENTITY REQUEST from ${p.src.id}: ${fcName(p.f, p.src)}`); }
    onIdentity?.(p.f, p.src, p.dst, fcName(p.f, p.src));
  }

  // ------------------------------------------------------------ picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hover = null, selected = null, down = null, pointer = null;
  const hoverBox = new THREE.BoxHelper(new THREE.Object3D(), 0x9fb0c0), selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x3fe0ff);
  hoverBox.visible = selBox.visible = false; scene.add(hoverBox, selBox);
  const pickAt = e => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(plant.pickables, false)[0]?.object.userData.ip ?? null;
  };
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  el.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) onPick(pickAt(e)); down = null; });
  el.addEventListener('pointermove', e => { pointer = e; });

  function select(ip) { selected = ip; if (ip) selBox.setFromObject(devs[ip].root); selBox.visible = !!ip; }

  // ------------------------------------------------------------ frame loop
  let labelsOn = true;
  const clock = new THREE.Clock();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color(), pos = new THREE.Vector3();
  function resize() {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h); css.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  function frame() {
    const dt = Math.min(clock.getDelta(), .1), t = clock.elapsedTime;
    if (fly) {
      const k = Math.min(1, (performance.now() - fly.t0) / 1000), e = ease(k);
      camera.position.lerpVectors(fly.p0, fly.p, e); controls.target.lerpVectors(fly.t0v, fly.t, e);
      if (k >= 1) fly = null;
    }
    controls.update();

    // LEDs
    for (const [ip, dev] of Object.entries(devs)) {
      const st = status[ip], L = dev.leds, on = st && st !== 'off';
      act[ip] = Math.max(0, (act[ip] || 0) - dt);
      const flick = act[ip] > 0 && ((t * 16) | 0) % 2 === 0;
      L.pwr?.set(!!on);
      if (L.run && L.run !== L.pwr) L.run.set(st === 'run' || (st === 'booting' && ((t * 2) | 0) % 2 === 0));
      L.err?.set(st === 'flashing' ? ((t * 6) | 0) % 2 === 0 : false);
      L.io?.set(st === 'run'); L.sd?.set(!!on); L.force?.set(false); L.bf?.set(false); L.stop?.set(false);
      L.act?.set(!!on && flick); L.link?.set(!!on);
      const p = plant.portOf[ip]; if (p) { p.link.set(!!on); p.act.set(!!on && flick); }
    }
    // packets
    let n = 0, h = 0;
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]; p.d += p.speed * dt;
      if (p.d >= p.len) { arrive(p); packets.splice(i, 1); }
    }
    for (const p of packets) {
      let s = 1; while (s < p.cum.length - 1 && p.cum[s] < p.d) s++;
      const f = (p.d - p.cum[s - 1]) / Math.max(1e-6, p.cum[s] - p.cum[s - 1]);
      pos.lerpVectors(p.path[s - 1], p.path[s], Math.min(1, f));
      m4.compose(pos, q, sc.setScalar(p.scale)); pk.setMatrixAt(n, m4); pk.setColorAt(n, col.setHex(p.color)); n++;
      if (p.ident && h < MAXH) { m4.compose(pos, q, sc.setScalar(.8 + .2 * Math.sin(t * 20))); halo.setMatrixAt(h++, m4); }
    }
    pk.count = n; halo.count = h; pk.instanceMatrix.needsUpdate = halo.instanceMatrix.needsUpdate = true; if (pk.instanceColor) pk.instanceColor.needsUpdate = true;
    // pulses
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.age += dt; const k = r.age / r.life;
      if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); continue; }
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * k); r.m.material.opacity = 1 - k; r.m.quaternion.copy(camera.quaternion);
    }
    plant.update(agg, dt, t, { status });
    // hover + labels
    if (pointer) { const ip = pickAt(pointer); pointer = null; if (ip !== hover) { hover = ip; el.style.cursor = ip ? 'pointer' : 'grab'; } }
    hoverBox.visible = !!hover && hover !== selected; if (hoverBox.visible) hoverBox.setFromObject(devs[hover].root);
    if (selected) selBox.setFromObject(devs[selected].root);
    for (const [ip, d] of Object.entries(devs)) {
      const vis = labelsOn && !!d.name && (d.hero || ip === selected || ip === hover || (!/^10\.10\.[12]\./.test(ip) && camera.position.distanceTo(d.pos) < 13));
      if (vis !== d.vis) { d.vis = vis; d.label.visible = vis; d.label.element.style.display = vis ? '' : 'none'; }
      d.label.element.classList.toggle('sel', ip === selected);
    }
    renderer.render(scene, camera); css.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    apply, view, focus, select, pulse, plant, camera, controls, packetCount: () => packets.length,
    setLabels(on) { labelsOn = on; },
    get labels() { return labelsOn; },
    resetLive() { packets.length = 0; for (const k in status) delete status[k]; plant.reset(); },
    heroInfo: o => plant.hero.info(o), heroBanner: t => plant.hero.banner(t),
    canvas: renderer.domElement,
  };
}
