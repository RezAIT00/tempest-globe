import * as THREE from 'three';
import { clamp, lerp, sat, smooth, damp } from './util.js';
import { makeWorld, RI, RO, SEA, LAND } from './world.js';
import { Weather } from './weather.js';
import { Life, quatYPR } from './life.js';
import { Chaos } from './chaos.js';
import { Particles, Beams, LightList, ConeList, Glitter } from './fx.js';
import { Sound } from './audio.js';
import { Renderer } from './render.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4;
const canvas = document.getElementById('c');
const world = makeWorld(7), wx = new Weather(world), life = new Life(world, wx), parts = new Particles(14000), chaos = new Chaos(world, life, wx, parts);
const beams = new Beams(), lights = new LightList(14000), lightsDyn = new LightList(6000), cones = new ConeList(900), glitter = new Glitter(6000), sound = new Sound(world); chaos.snd = sound;
const R = new Renderer(canvas, world, life, chaos, parts, beams, lights, lightsDyn, cones, glitter);
const U = R.U;

// ------------------------------------------------------------------ globe body
const globe = { pos: new V3(), vel: new V3(), q: new Q(), av: new V3(), acc: new V3(), yaw: 0, pitch: 0, roll: 0, tq: new Q(), held: false, off: new V3(), shake: 0, aLocal: new V3(), tilt: 0 };
const cam = { yaw: 0.32, pitch: 0.12, D: 45.5, tD: 45.5, T: new V3(0, -0.2, 0), tT: new V3(0, -0.2, 0), fov: 30, pos: new V3(), matrixWorld: new M4(), G: new M4(), near: 1, far: 120, shR: 9.6, shC: new V3(), tyaw: 0.32, tpitch: 0.12, sh: 0 };
let timeScale = 1, slowT = 0, slowCd = 0, simT = 0, realT = 0, idle = 0, started = false;
const bullet = (d, cd = 9) => { if (slowCd > 0) return; slowT = d; slowCd = cd + d; };
wx.onTouchdown = () => { bullet(2.6, 7); sound.touchdown(wx.tx, wx.tz); cam.sh = 1; };

// ------------------------------------------------------------------ input: drag, wheel, touch, device motion. No interface.
const ptr = new Map(); let mode = null, lastP = null, pinch = 0, pinchA = 0, ndc = [0, 0]; const rev = { lx: 0, ly: 0, e: 0 };
const insideView = () => cam.D < 16;
const toNDC = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]; };
function rayLocal(n) { const t = Math.tan((cam.fov * Math.PI) / 360), d = new V3(n[0] * t * (innerWidth / innerHeight), n[1] * t, -1).normalize().transformDirection(cam.matrixWorld), Gi = new M4().copy(cam.G).invert(); return { o: cam.pos.clone().applyMatrix4(Gi), d: d.transformDirection(Gi) }; }
function pick(n) {
  const { o, d } = rayLocal(n); const b = o.dot(d), c = o.dot(o) - RI * RI, h = b * b - c; if (h < 0) return null; let t = Math.max(0, -b - Math.sqrt(h)), t1 = -b + Math.sqrt(h); let best = t1 * 0.5, hit = false; const lvl = wx.level(); const C = world.C, P = chaos.ph.P, cl = chaos.ph.cl;
  for (let k = 0; k < C.length; k++) { if (cl[k] === -3) continue; const q = C[k], x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2], ix = 1 / (d.x || 1e-9), iy = 1 / (d.y || 1e-9), iz = 1 / (d.z || 1e-9); let a = (x - q.hx - o.x) * ix, e = (x + q.hx - o.x) * ix; let t0 = Math.min(a, e), tt = Math.max(a, e); a = (y - q.hy - o.y) * iy; e = (y + q.hy - o.y) * iy; t0 = Math.max(t0, Math.min(a, e)); tt = Math.min(tt, Math.max(a, e)); a = (z - q.hz - o.z) * iz; e = (z + q.hz - o.z) * iz; t0 = Math.max(t0, Math.min(a, e)); tt = Math.min(tt, Math.max(a, e)); if (t0 < tt && tt > 0 && (!hit || t0 < best)) { if (q.kind >= 10) continue; best = Math.max(t0, 0); hit = true; } }
  for (let s = 0; s < 400 && t < t1; s++) { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, g = Math.max(world.height(x, z), lvl); if (y < g) { if (!hit || t < best) { best = t; hit = true; } break; } t += Math.max(0.004, (y - g) * 0.4 + 0.004); }
  return hit ? new V3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best) : null;
}
// does the segment from the focus point to the camera pass through a standing building?
function blocked(T, p) {
  const C = world.C, cl = chaos.ph.cl, dx = p.x - T.x, dy = p.y - T.y, dz = p.z - T.z, ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9), m = 0.012;
  for (let k = 0; k < C.length; k++) { if (cl[k] !== -1) continue; const q = C[k]; if (q.kind >= 10) continue; let a = (q.x - q.hx - m - T.x) * ix, b = (q.x + q.hx + m - T.x) * ix, t0 = Math.min(a, b), t1 = Math.max(a, b); if (t1 < 0 || t0 > 1) continue; a = (q.z - q.hz - m - T.z) * iz; b = (q.z + q.hz + m - T.z) * iz; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); if (t0 > t1) continue; a = (q.y - q.hy - T.y) * iy; b = (q.y + q.hy + m - T.y) * iy; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); if (t0 < t1 && t1 > 0.12 && t0 < 1) return true; }
  return false;
}
let lift2 = 0;
const hitsGlobe = (n) => { const { o, d } = rayLocal(n); const b = o.dot(d), c = o.dot(o) - RO * RO; return b * b - c > 0 || o.y + d.y * -b < -6; };
const wake = () => { idle = 0; if (!started) { started = true; sound.start(); motion(); } else sound.start(); };
function motion() { const on = () => addEventListener('devicemotion', (e) => { const a = e.acceleration; if (!a || a.x === null) return; const m = Math.hypot(a.x, a.y, a.z); if (m > 9) { globe.vel.x += a.x * 0.35; globe.vel.y += a.y * 0.35; globe.vel.z += a.z * 0.35; idle = 0; } }); try { const D = window.DeviceMotionEvent; if (D && D.requestPermission) D.requestPermission().then((s) => s === 'granted' && on()).catch(() => {}); else if (D) on(); } catch (e) { /* no motion sensor */ } }
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { wake(); try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } ptr.set(e.pointerId, [e.clientX, e.clientY]); lastP = [e.clientX, e.clientY]; const n = toNDC(e); ndc = n; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); pinchA = Math.atan2(b[1] - a[1], b[0] - a[0]); mode = 'pinch'; return; } if (e.button === 2 || e.shiftKey) mode = 'tilt'; else if (!insideView() && hitsGlobe(n)) { mode = 'grab'; globe.held = true; } else mode = 'orbit'; canvas.style.cursor = 'grabbing'; });
canvas.addEventListener('pointermove', (e) => {
  const n = toNDC(e); ndc = n; if (!ptr.has(e.pointerId)) { if (!mode) canvas.style.cursor = !insideView() && hitsGlobe(n) ? 'grab' : 'default'; return; }
  idle = 0; const p = ptr.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1]; ptr.set(e.pointerId, [e.clientX, e.clientY]);
  if (mode === 'pinch' && ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]); zoom(Math.log(pinch / d) * 1.0, toNDC({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 })); let da = an - pinchA; da = Math.atan2(Math.sin(da), Math.cos(da)); rollGlobe(0, 0, -da); pinch = d; pinchA = an; return; }
  const k = Math.PI / Math.min(innerWidth, innerHeight);
  if (mode === 'grab') { grab(dx, dy, k); } else if (mode === 'tilt') { rollGlobe(dx * k * 1.15, dy * k * 1.15, 0); shakeFrom(dx, dy, 0.35); } else { cam.tyaw -= dx * k * 1.0; cam.tpitch = clamp(cam.tpitch + dy * k * 0.8, -0.35, 1.5); shakeFrom(dx, dy, insideView() ? 1 : 0); }
});
const up = (e) => { ptr.delete(e.pointerId); if (ptr.size === 0) { mode = null; globe.held = false; canvas.style.cursor = 'default'; } };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); addEventListener('blur', () => { ptr.clear(); mode = null; globe.held = false; });
canvas.addEventListener('dblclick', () => { globe.tq.identity(); cam.tD = 45.5; cam.tT.set(0, -0.2, 0); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); idle = 0; zoom((e.deltaMode ? e.deltaY * 18 : e.deltaY) * 0.00125, toNDC(e)); }, { passive: false });
addEventListener('keydown', (e) => { if (e.code === 'Space') { slowHold = true; wake(); e.preventDefault(); } }); addEventListener('keyup', (e) => { if (e.code === 'Space') slowHold = false; }); let slowHold = false;
function rollGlobe(dx, dy, dz) { // rotate about screen axes
  const m = cam.matrixWorld, x = new V3(1, 0, 0).transformDirection(m), z = new V3(0, 0, 1).transformDirection(m); const q = new Q(); if (dx) q.premultiply(new Q().setFromAxisAngle(z, -dx)); if (dy) q.premultiply(new Q().setFromAxisAngle(x, dy)); if (dz) q.premultiply(new Q().setFromAxisAngle(z, dz)); globe.tq.premultiply(q).normalize();
}
function grab(dx, dy, k) {
  const m = cam.matrixWorld, x = new V3(1, 0, 0).transformDirection(m), y = new V3(0, 1, 0).transformDirection(m), wpp = (2 * cam.D * Math.tan((cam.fov * Math.PI) / 360)) / innerHeight; globe.off.addScaledVector(x, dx * wpp * 0.55).addScaledVector(y, -dy * wpp * 0.55); if (globe.off.length() > 6) globe.off.setLength(6);
  globe.tq.premultiply(new Q().setFromAxisAngle(new V3(0, 1, 0), dx * k * 0.75)); const ax = new V3(1, 0, 0).transformDirection(m); globe.tq.premultiply(new Q().setFromAxisAngle(ax, dy * k * 0.95)).normalize();
}
function shakeFrom(dx, dy, g) { // rapid reversals while zoomed in count as shaking
  if (dx * rev.lx < -9 || dy * rev.ly < -9) rev.e = Math.min(5, rev.e + 1); if (Math.abs(dx) > 1) rev.lx = dx; if (Math.abs(dy) > 1) rev.ly = dy; if (rev.e > 1.6 && g > 0) { const m = cam.matrixWorld, x = new V3(1, 0, 0).transformDirection(m), y = new V3(0, 1, 0).transformDirection(m); globe.vel.addScaledVector(x, dx * 0.12 * g).addScaledVector(y, -dy * 0.12 * g); }
}
function zoom(k, n) {
  const D0 = cam.tD, D1 = clamp(D0 * Math.exp(k), 0.11, 62); if (k < 0) { const p = pick(n); if (p) { const dest = p.clone(); const cb = world.clubs.find((c) => Math.abs(p.x - c.x) < c.w * 0.55 && Math.abs(p.z - c.z) < c.d * 0.55); if (cb) dest.y = LAND + 0.03; else if (D1 < 2) dest.y += 0.02; cam.tT.lerp(dest, clamp((1 - D1 / D0) * (D1 < 14 ? 1.15 : 0.85), 0, 1)); } } else { const u = smooth(8, 42, D1); cam.tT.lerp(new V3(0, -0.2, 0), clamp(u * 0.5 + (1 - D0 / D1) * 0.5, 0, 1)); }
  if (D1 > 38) cam.tT.lerp(new V3(0, -0.2, 0), 0.5); cam.tD = D1;
}

// ------------------------------------------------------------------ static lights rebuild on change
let lightTimer = 0;
const base = world.lights;
function rebuildLights() {
  lights.begin(); const ph = chaos.ph, n = wx.night, B = world.B; const day = lerp(0.03, 1, smooth(0.05, 0.35, n));
  for (const l of base) {
    let x = l.x, y = l.y, z = l.z, k = day, pw = chaos.power > 0.5 || l.x * 1.3 + l.z * 0.7 + 9 < chaos.relight * 20 ? 1 : 0;
    if (l.parent >= 0) { const c = l.parent; if (ph.cl[c] !== -1) { if (ph.cl[c] < 0) continue; x += ph.P[c * 3] - ph.HP[c * 3]; y += ph.P[c * 3 + 1] - ph.HP[c * 3 + 1]; z += ph.P[c * 3 + 2] - ph.HP[c * 3 + 2]; k *= 0.25; } k *= B[world.C[c].b].power; } else { k *= pw; if (l.parent < -1) { const lp = world.lamps[-2 - l.parent]; if (!lp.on) continue; } }
    if (k < 0.01) continue; const f = l.kind === 1 ? 0.92 + 0.08 * Math.sin(simT * 3 + x * 9) : 1; lights.add(x, y, z, l.r * k * f, l.g * k * f, l.b * k * f, l.rad);
  }
  lights.end();
}
function dynamicLights() {
  lightsDyn.begin(); cones.begin(); const n = smooth(0.05, 0.35, wx.night), t = simT;
  for (const c of life.cars) { if (c.fleet && c.show < 0.5) continue; const on = c.state === 0 ? 1 : 0; const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw); if (on && n > 0.02) { cones.add(c.x + fx * 0.05, c.z + fz * 0.05, fx, fz, 0.95 * n, 0.85 * n, 0.62 * n, 0.5); lightsDyn.add(c.x - fx * 0.08, c.y + 0.03, c.z - fz * 0.08, 0.55 * n, 0.02, 0.01, 0.11); } if (c.emer && on) { const k = (t * 3.1) % 1 < 0.5 ? 1 : 0; lightsDyn.add(c.x, c.y + 0.07, c.z, k * 1.1 + 0.05, 0.03, (1 - k) * 1.5 + 0.05, 0.6); } }
  world.clubs.forEach((c, i) => { const b = world.B[c.b].power, be = sound.beat; for (let q = 0; q < 5; q++) { const a = t * (0.7 + q * 0.13) + q * 1.26, hu = t * 0.12 + q * 0.2 + i * 0.33, cr = 0.5 + 0.5 * Math.cos(6.28 * hu), cg = 0.5 + 0.5 * Math.cos(6.28 * (hu + 0.33)), cb = 0.5 + 0.5 * Math.cos(6.28 * (hu + 0.67)), k = b * (0.16 + 0.75 * be); lightsDyn.add(c.x + Math.cos(a) * 0.17, LAND + 0.09, c.z + Math.sin(a * 1.2) * 0.15, cr * k, cg * k, cb * k, 0.22); } lightsDyn.add(c.x, LAND + 0.1, c.z - c.d * 0.36, 0.16 * b * (0.6 + be), 0.24 * b, 0.34 * b, 0.28); });
  for (const r of life.roofs) { const hu = t * 0.1 + r.seed, k = (0.5 + sound.beat) * r.power * n; lightsDyn.add(r.x, LAND + r.H + 0.08, r.z, (0.5 + 0.5 * Math.cos(6.28 * hu)) * k, (0.5 + 0.5 * Math.cos(6.28 * (hu + 0.33))) * k, (0.5 + 0.5 * Math.cos(6.28 * (hu + 0.67))) * k, 0.3); }
  for (const f of chaos.fires) { const i = f.i, fl = 0.75 + 0.35 * Math.sin(t * 13 + i) * Math.sin(t * 7.7 + i * 2); lightsDyn.add(chaos.ph.P[i * 3], chaos.ph.P[i * 3 + 1] + 0.05, chaos.ph.P[i * 3 + 2], 3.4 * fl * f.k, 1.25 * fl * f.k, 0.25 * fl * f.k, 0.75); }
  for (const b of life.boats) { if (b.state) continue; const k = n * (b.type === 0 ? 1.1 : 0.4); lightsDyn.add(b.x, b.y + 0.12 * b.s + 0.04, b.z, 0.9 * k, 0.75 * k, 0.5 * k, b.type === 0 ? 0.7 : 0.3); if (b.type === 0) lightsDyn.add(b.x, SEA - 0.4, b.z, 0.1 * n, 1.3 * n, 1.6 * n, 0.9); }
  const s = life.ship; lightsDyn.add(s.x, s.y - 0.3, s.z, 0.9 * n, 0.7 * n, 0.5 * n, 0.8); for (let q = 0; q < 10; q++) { const a = q * 0.628 + t * 0.01, r = 8.4; lightsDyn.add(Math.cos(a) * r, SEA - 1.6, Math.sin(a) * r, 0.03 + 0.12 * n, 0.22 + 0.5 * n, 0.3 + 0.65 * n, 1.5); }
  for (const p of chaos.pulses) lightsDyn.add(p[0], p[1], p[2], p[3] * p[6], p[4] * p[6], p[5] * p[6], p[7]);
  if (chaos.weld && Math.random() < 0.6) lightsDyn.add(chaos.weld[0], chaos.weld[1], chaos.weld[2], 2, 2.4, 3, 0.35);
  // beams
  beams.begin(); const L = world.props.lighthouse, la = t * 0.7; for (const k of [0, Math.PI]) { const dx = Math.cos(la + k), dz = Math.sin(la + k); if (n * chaos.power > 0.05) beams.add(L.x, L.y, L.z, 0.03, L.x + dx * 9, L.y + 0.1, L.z + dz * 9, 0.55, 0.34 * n, 0.3 * n, 0.21 * n, 1); }
  for (const h of life.helis) { if (h.role !== 'police' && h.role !== 'news') continue; const ax = h.aim, d = Math.hypot(ax[0] - h.x, ax[2] - h.z); if (n > 0.05 && d < 4) { beams.add(h.x, h.y - 0.03, h.z, 0.01, ax[0], ax[1], ax[2], 0.17, 0.4 * n, 0.44 * n, 0.5 * n, 1); lightsDyn.add(ax[0], LAND + 0.03, ax[2], 1.9 * n, 2.0 * n, 2.2 * n, 0.24); } }
  const be = sound.beat; world.clubs.forEach((c, i) => { const pw = world.B[c.b].power, vis = Math.max(c.open, 0.0); if (pw < 0.2 || vis < 0.02) return; for (let q = 0; q < 12; q++) { const a = t * 0.9 + q * 0.52, sw = Math.sin(t * 1.7 + q * 0.8) * 0.5, hu = t * 0.1 + (q % 3) * 0.33 + i * 0.2, x0 = c.x + ((q % 6) / 5 - 0.5) * c.w * 0.78, z0 = c.z - c.d * 0.42 + (q > 5 ? c.d * 0.7 : 0), y0 = LAND + c.h - 0.02, x1 = c.x + Math.sin(a + sw) * c.w * 0.4, z1 = c.z + 0.03 + Math.cos(a * 1.3) * c.d * 0.3; const k = vis * (0.35 + 0.9 * be) * 0.8; beams.add(x0, y0, z0, 0.0015, x1, LAND + 0.012, z1, 0.028, (0.5 + 0.5 * Math.cos(6.28 * hu)) * k, (0.5 + 0.5 * Math.cos(6.28 * (hu + 0.33))) * k, (0.5 + 0.5 * Math.cos(6.28 * (hu + 0.67))) * k, 1); } for (let q = 0; q < 16; q++) { const f = (q - 7.5) * 0.085 + Math.sin(t * 1.2 + i) * 0.35, st = Math.sin(t * 2.1 + q * 0.2) * 0.04; const k = vis * ((Math.floor(sound.phase / 4 + i) % 2) === (q & 1) || be > 0.5 ? 2.4 : 0.5); beams.add(c.x, LAND + 0.125, c.z - c.d * 0.43, 0.0007, c.x + Math.sin(f) * c.w * 0.62, LAND + 0.085 + st, c.z - c.d * 0.43 + Math.cos(f) * c.d * 0.86, 0.0009, 0.1 * k + (i === 1 ? k : 0), (i !== 1 ? k : 0.05), (i === 0 ? k : 0.05), 0); } });
  if (n > 0.1 && chaos.power > 0.5 && wx.S < 0.8) for (let q = 0; q < 6; q++) { const a = t * 0.22 + q * 1.05; const px = [-0.5, 0.5, -1.5, 1.5, 3.5, 0][q], pz = [0.5, 0.5, 1.5, 1.5, 2.5, -1.5][q]; beams.add(px, LAND + 0.2, pz, 0.02, px + Math.sin(a) * 2.6, 5.0, pz + Math.cos(a * 1.3) * 2.6, 0.3, 0.16 * n, 0.2 * n, 0.28 * n, 1); }
  for (const b of wx.bolts) { const k = b.age < b.life ? (0.35 + 0.65 * Math.random()) * b.k * (1 - (b.age / b.life) * 0.6) : 0; if (k > 0.01) for (const s2 of b.segs) beams.add(s2[0][0], s2[0][1], s2[0][2], 0.016 * s2[2] + 0.004, s2[1][0], s2[1][1], s2[1][2], 0.016 * s2[2] + 0.004, 26 * k * s2[2], 30 * k * s2[2], 44 * k * s2[2], 2); }
  for (const c of chaos.cables) beams.add(c[0], c[1], c[2], 0.0022, c[3], c[4], c[5], 0.0022, 0.12, 0.12, 0.13, 3);
  for (const p of chaos.sites) if (p.tall && p.rise > 0.1) lightsDyn.add(p.x, LAND + p.h * p.rise, p.z, 0.9, 0.8, 0.6, 0.5);
  beams.end(); lightsDyn.end(); cones.end();
}

// ------------------------------------------------------------------ sky and key light
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function sky() {
  const s = wx.sunDir(), y = s[1], S = wx.S, day = smooth(-0.08, 0.28, y), gold = Math.exp(-((y - 0.05) ** 2) / 0.022), n = wx.night; let d, c;
  if (y > -0.045) { const k = smooth(-0.045, 0.2, y); c = mix3([1.0, 0.34, 0.1], [1.0, 0.94, 0.84], smooth(0.02, 0.45, y)).map((v) => v * 3.1 * k * (1 - 0.82 * smooth(0.3, 0.9, S))); d = s; } else { const m = [-s[0], Math.max(0.28, -s[1]), s[2]]; const l = Math.hypot(...m); d = m.map((v) => v / l); const k = smooth(-0.045, -0.2, y); c = [0.2, 0.27, 0.42].map((v) => v * 0.62 * k * (1 - 0.85 * smooth(0.3, 0.85, S))); }
  let zen = mix3([0.006, 0.011, 0.026], [0.1, 0.24, 0.58], day), hor = mix3([0.014, 0.02, 0.036], [0.46, 0.58, 0.74], day); hor = mix3(hor, [0.95, 0.34, 0.12], gold * 0.75); zen = mix3(zen, [0.2, 0.16, 0.36], gold * 0.5);
  const st = smooth(0.35, 0.9, S), g = mix3([0.052, 0.062, 0.070], [0.20, 0.225, 0.20], day); zen = mix3(zen, g.map((v) => v * 0.55), st); hor = mix3(hor, g, st);
  if (wx.flash[3] > 0.45) { d = [wx.flash[0] * 0.3, 1, wx.flash[2] * 0.3]; const l = Math.hypot(...d); d = d.map((v) => v / l); c = [0.62, 0.72, 1].map((v) => v * 1.35 * wx.flash[3]); }
  U.uSunDir.value.set(...d); U.uSunCol.value.set(...c); U.uZenith.value.set(...zen); U.uHorizon.value.set(...hor); const aS = mix3(zen, hor, 0.45); U.uAmbS.value.set(aS[0] * 0.85 + 0.0028, aS[1] * 0.85 + 0.0034, aS[2] * 0.85 + 0.0052); U.uAmbG.value.set(hor[0] * 0.26 + 0.002, hor[1] * 0.24 + 0.002, hor[2] * 0.22 + 0.002); U.uNight.value = n; return n;
}

// ------------------------------------------------------------------ frame
let last = 0, expo = 1.25, fps = 60, slowFrames = 0, scale = 1, fadeIn = 0;
const tmpQ = new Q(), tv = new V3(), rainOff = new V3();
function simulate(rdt) {
  realT += rdt; idle += rdt; rev.e = Math.max(0, rev.e - rdt * 3.2);
  // ---- globe body (real time)
  const up = new V3(0, 1, 0).applyQuaternion(globe.tq), tiltT = Math.acos(clamp(up.y, -1, 1));
  if (!globe.held && mode !== 'tilt' && mode !== 'pinch') { globe.off.multiplyScalar(Math.exp(-rdt * 7)); if (tiltT < 1.25 && tiltT > 1e-4) { const ax = new V3().crossVectors(up, new V3(0, 1, 0)); if (ax.lengthSq() > 1e-9) globe.tq.premultiply(tmpQ.setFromAxisAngle(ax.normalize(), tiltT * (1 - Math.exp(-rdt * 4.5)))).normalize(); } } else globe.off.multiplyScalar(Math.exp(-rdt * 1.1));
  const c = Math.cos(tiltT), s = Math.abs(Math.sin(tiltT)), lift = Math.max(0, Math.max(10.05, 10.2 * c + 9.25 * s) - 10.2) + (globe.held || tiltT > 0.04 ? smooth(0, 0.25, tiltT) * 1.6 + (globe.held ? 0.5 : 0) : 0);
  const tgt = tv.set(globe.off.x, Math.max(0, globe.off.y) + lift, globe.off.z * 0.6); const n = Math.max(1, Math.ceil(rdt / 0.006)), h = rdt / n; const v0 = globe.vel.clone(); const wasY = globe.pos.y, vy0 = globe.vel.y; let peak = 0;
  for (let i = 0; i < n; i++) { const k = 210, d = 19; const ax = (tgt.x - globe.pos.x) * k - globe.vel.x * d, ay = (tgt.y - globe.pos.y) * k - globe.vel.y * d, az = (tgt.z - globe.pos.z) * k - globe.vel.z * d; globe.vel.x += ax * h; globe.vel.y += ay * h; globe.vel.z += az * h; globe.pos.addScaledVector(globe.vel, h); if (globe.pos.y < 0) { if (globe.vel.y < -2.2) { sound.clink(Math.min(1, -globe.vel.y * 0.12)); } globe.pos.y = 0; globe.vel.y = Math.max(0, globe.vel.y * -0.15); } peak = Math.max(peak, Math.hypot(ax, ay, az)); }
  void wasY; void vy0; const acc = globe.vel.clone().sub(v0).divideScalar(Math.max(rdt, 1e-3)); globe.acc.lerp(acc, 1 - Math.exp(-rdt * 26));
  const q0 = globe.q.clone(); globe.q.slerp(globe.tq, 1 - Math.exp(-rdt * 13)); const dq = globe.q.clone().multiply(q0.invert()); const ang = 2 * Math.acos(clamp(Math.abs(dq.w), -1, 1)) / Math.max(rdt, 1e-3);
  cam.G.compose(globe.pos, globe.q, new V3(1, 1, 1)); const am = globe.acc.length(); globe.shake = damp(globe.shake, Math.max(0, am * 0.0125 + Math.max(0, ang - 8) * 0.06 - 0.12), am * 0.0125 > globe.shake ? 16 : 3, rdt);
  const iq = globe.q.clone().invert(); const gl = new V3(0, -1.1, 0).addScaledVector(globe.acc, -0.0105); const mag = gl.length(); if (mag > 5.5) gl.setLength(5.5); gl.applyQuaternion(iq); const upL = new V3(0, 1, 0).applyQuaternion(globe.q); globe.tilt = Math.acos(clamp(upL.y, -1, 1));
  // ---- slow motion
  slowCd -= rdt; slowT -= rdt; if (globe.tilt > 1.75 && !globe.flipped) { globe.flipped = true; bullet(3.2, 4); } if (globe.tilt < 0.6) globe.flipped = false;
  if (chaos.bigEvent > 34) { bullet(2.4, 8); cam.sh = Math.max(cam.sh, 0.7); } chaos.bigEvent = 0; const sl = slowHold || slowT > 0; timeScale = damp(timeScale, sl ? 0.14 : 1, sl ? 5 : 1.7, rdt); wx.slow = sl;
  const dt = Math.min(rdt, 0.045) * timeScale; simT += dt; parts.time = simT;
  // ---- world
  const g = [gl.x, gl.y, gl.z]; wx.update(dt, rdt, g, globe.shake); const wn = wx.wn; const ref = Math.abs(wn[1]) > 0.96 ? [1, 0, 0] : [0, 1, 0]; let X; { const d = ref[0] * wn[0] + ref[1] * wn[1] + ref[2] * wn[2]; X = [ref[0] - wn[0] * d, ref[1] - wn[1] * d, ref[2] - wn[2] * d]; const l = Math.hypot(...X); X = X.map((v) => v / l); } if (wx.basisX) { const p = wx.basisX, d = p[0] * wn[0] + p[1] * wn[1] + p[2] * wn[2]; const Y = [p[0] - wn[0] * d, p[1] - wn[1] * d, p[2] - wn[2] * d], l = Math.hypot(...Y); if (l > 0.1) X = Y.map((v) => v / l); if (wn[1] > 0.995) { const k = 1 - Math.exp(-dt * 2); X = [lerp(X[0], 1, k), X[1], lerp(X[2], 0, k)]; const dd = X[0] * wn[0] + X[1] * wn[1] + X[2] * wn[2]; X = [X[0] - wn[0] * dd, X[1] - wn[1] * dd, X[2] - wn[2] * dd]; const l2 = Math.hypot(...X); X = X.map((v) => v / l2); } } wx.basisX = X; wx.basisZ = [X[1] * wn[2] - X[2] * wn[1], X[2] * wn[0] - X[0] * wn[2], X[0] * wn[1] - X[1] * wn[0]];
  const water = [wn[0], wn[1], wn[2], wx.level()]; const S = wx.S, panic = Math.max(smooth(0.4, 0.75, S), smooth(0.3, 1.2, globe.shake)); life.update(dt, S, 1 - 0.75 * smooth(0.6, 0.9, S), panic, chaos.sites); chaos.update(dt, rdt, g, globe.shake, globe.tilt, water); life.flushCars();
  glitter.update(dt, g, globe.shake, wx, world.height);
  // boat wakes, fountain jets, yacht spray
  if (Math.random() < 0.9) for (const b of life.boats) if (b.state === 0 && b.wake && Math.random() < 0.25) { const L = b.s * (b.type === 0 ? 1.15 : 0.3), x = b.x - Math.cos(b.yaw) * L, z = b.z + Math.sin(b.yaw) * L; parts.spawn(4, x + (Math.random() - 0.5) * 0.06, b.y + 0.01, z + (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12, 0.07 + Math.random() * 0.08, (Math.random() - 0.5) * 0.12, 0.5, 0.012); }
  for (const px of [0.5, -0.5]) if (Math.random() < 0.8 && chaos.power > 0.5 && wn[1] > 0.9) { const a = Math.random() * 6.28; parts.spawn(4, px, LAND + 0.08, 1.5, Math.cos(a) * 0.05, 0.34 + Math.random() * 0.06, Math.sin(a) * 0.05, 0.68, 0.006); }
  if (wx.slosh() > 0.35) for (let k = 0; k < 8; k++) { const a = Math.random() * 6.28, rr = Math.sqrt(RI * RI - SEA * SEA) * 0.97, d = wx.level(), x = wx.basisX, z = wx.basisZ, u = Math.cos(a) * rr, v = Math.sin(a) * rr; parts.spawn(4, wn[0] * d + x[0] * u + z[0] * v, wn[1] * d + x[1] * u + z[1] * v, wn[2] * d + x[2] * u + z[2] * v, (Math.random() - 0.5) + wn[0] * 0.6, (Math.random() - 0.5) + wn[1] * 0.8, (Math.random() - 0.5) + wn[2] * 0.6, 1.2, 0.03); }
  parts.flush(); return { dt, g, water, S };
}
life.splash = (x, y, z, e) => { for (let q = 0; q < 10; q++) parts.spawn(4, x, y + 0.01, z, (Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5, 0.8, 0.012); };

function camera(rdt) {
  if (idle > 14) { cam.tyaw += rdt * 0.035 * Math.min(1, (idle - 14) / 6); }
  const k = 1 - Math.exp(-rdt * 7.5); cam.yaw += (cam.tyaw - cam.yaw) * k; cam.pitch += (cam.tpitch - cam.pitch) * k; cam.D = Math.exp(lerp(Math.log(cam.D), Math.log(cam.tD), 1 - Math.exp(-rdt * 5.5))); cam.T.lerp(cam.tT, 1 - Math.exp(-rdt * 6));
  const D = cam.D, a = smooth(13, 9.4, D); cam.fov = lerp(50, 30, smooth(1.2, 26, D)); let pitch = Math.max(cam.pitch, lerp(cam.T.y < SEA - 0.1 ? -0.5 : 0.04, -0.4, smooth(6, 14, D)));
  { let want = 0; if (D < 5 && globe.tilt < 0.5 && cam.T.y > SEA) for (let k = 0; k < 9; k++) { const pp = pitch + k * 0.16; if (pp > 1.45) break; want = k * 0.16; const q = new V3(cam.T.x + Math.sin(cam.yaw) * Math.cos(pp) * D, cam.T.y + Math.sin(pp) * D, cam.T.z + Math.cos(cam.yaw) * Math.cos(pp) * D); if (!blocked(cam.T, q)) break; } lift2 += (want - lift2) * (1 - Math.exp(-rdt * 5)); pitch = Math.min(1.5, pitch + lift2); }
  const asp = innerWidth / innerHeight, fit = asp < 1.05 ? lerp(1, 1.05 / asp, smooth(14, 40, D)) : 1; const d = new V3(Math.sin(cam.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(cam.yaw) * Math.cos(pitch)); let off = d.clone().multiplyScalar(D * fit); const lift_ = smooth(0.4, 2.4, globe.tilt) * globe.pos.y * 0.75; const T = cam.T.clone().add(new V3(0, lift_, 0)).lerp(cam.T.clone().applyMatrix4(cam.G), a); off.multiplyScalar(1 + 0.07 * smooth(0.4, 2.4, globe.tilt) * (1 - a)); 
  let p = T.clone().add(off);
  // frame: outside the camera stands in the room, inside it rides with the globe
  if (a > 0) { const Gi = new M4().copy(cam.G).invert(), l = p.clone().applyMatrix4(Gi); const gy = Math.max(world.height(l.x, l.z), SEA) + Math.max(0.012, D * 0.03); if (l.y < (cam.T.y < SEA - 0.1 ? world.height(l.x, l.z) + 0.05 : gy) && l.length() < RO) l.y = lerp(l.y, cam.T.y < SEA - 0.1 ? world.height(l.x, l.z) + 0.05 : gy, a); const lim = RI - 0.12; if (l.length() < RO + 0.6 && l.length() > lim && D < 9.5) l.setLength(lim); p.copy(l.applyMatrix4(cam.G)); }
  cam.sh = Math.max(0, cam.sh - rdt * 0.5); const trem = (cam.sh * 0.6 + globe.shake * 0.5 * a + smooth(0.7, 1, wx.S) * 0.16 * a) * D * 0.011; const tt = realT * 13; const e = new V3(Math.sin(tt) + Math.sin(tt * 1.7 + 1), Math.sin(tt * 1.3 + 2) + Math.sin(tt * 2.1), Math.sin(tt * 0.9 + 4)).multiplyScalar(trem * 0.5);
  p.add(e); const m = new M4().lookAt(p, T, new V3(0, 1, 0)); const q = new Q().setFromRotationMatrix(m); cam.pos.copy(p); cam.matrixWorld.compose(p, q, new V3(1, 1, 1));
  const pl = p.clone().applyMatrix4(new M4().copy(cam.G).invert()), r = pl.length(); if (r > RO) { cam.near = Math.max(0.25, r - 11.5); cam.far = r + 13; } else { cam.near = clamp(D * 0.025, 0.004, 0.25); cam.far = 22; }
  cam.shR = clamp(D * 1.15, 0.9, 9.6); cam.shC.copy(cam.T); if (cam.shR > 8) cam.shC.set(0, -0.5, 0);
  return { r, pl };
}
function uniforms(rdt, s, cv) {
  const n = sky(), D = cam.D; U.uTime.value = simT; U.uRT.value = realT; U.uD.value = D; U.uWet.value = wx.wet; U.uStorm.value = wx.S; U.uRain.value = wx.rain; U.uCover.value = wx.cover; U.uSpin.value = wx.spin; U.uBeat.value = sound.beat; U.uPower.value = chaos.power; U.uFloodLvl.value = sat(wx.flood * 4); U.uGlitter.value = glitter.vis; U.uWater.value.set(...s.water); U.uWX.value.set(...wx.basisX); U.uWZ.value.set(...wx.basisZ); U.uFlash.value.set(...wx.flash); U.uGrav.value.set(...s.g);
  const o = [0, 0, 0]; wx.windAt(3, -1, 0, o); U.uWind.value.set(lerp(0.14, o[0], 0.6) + 0.1, 0, o[2] * 0.6); U.uTor.value.set(wx.tx, 0, wx.tz, wx.T); U.uTor2.value.set(Math.max(0, wx.tdrop), 0, 0, 0); U.uWave.value.set(wx.waveA(), wx.waveB(), wx.waveT, 0);
  const op = world.clubs.map((c) => { const d = Math.hypot(cv.pl.x - c.x, cv.pl.y - LAND, cv.pl.z - c.z), td = Math.hypot(cam.T.x - c.x, cam.T.z - c.z); c.open = damp(c.open, smooth(2.6, 1.5, d) * smooth(0.75, 0.45, td), 4, rdt); return c.open; }); U.uClubOpen.value.set(...op);
  U.uAOr.value = clamp(D * 0.011, 0.022, 0.26); { const fd = cam.pos.distanceTo(new V3().copy(cam.T).applyMatrix4(cam.G)); U.uFocus.value = cv.r > RO ? fd - 1.0 : Math.max(0.05, fd); } U.uApert.value = cv.r > RO ? 0.85 : lerp(0.14, 0.3, smooth(0.3, 2.5, D)); U.uMaxR.value = cv.r > RO ? 0.011 : 0.0085;
  const night = n, tgt = lerp(0.78, 1.5, night) * (1 + 0.35 * smooth(0.6, 0.95, wx.S) * (1 - chaos.power)) * lerp(1, 0.8, smooth(6, 0.6, D) * night * chaos.power); let ae = 1; if (R.glow) { const l = R.glow[0] * 0.21 + R.glow[1] * 0.72 + R.glow[2] * 0.07; ae = lerp(1, clamp(0.24 / (l + 0.06), 0.34, 1.5), smooth(14, 4, D)); } expo = damp(expo, tgt * ae, 2.2, rdt); U.uExpo.value = expo; U.uBloomK.value = lerp(0.03, lerp(0.05, 0.075, smooth(2, 10, D)), night); U.uSlow.value = 1 - timeScale; const gw = R.glow; if (gw) { const gv = U.uGlowAvg.value; const k = 1 - Math.exp(-rdt * 4); gv.set(lerp(gv.x, gw[0] * 0.8, k), lerp(gv.y, gw[1] * 0.8, k), lerp(gv.z, gw[2] * 0.8, k)); }
  // rain: three nested boxes so drops stay individual at every zoom level
  const vel = new V3(s.g[0] * 2.6 + o[0] * 0.55, s.g[1] * 2.6, s.g[2] * 2.6 + o[2] * 0.55); rainOff.addScaledVector(vel, s.dt); U.uVel.value.copy(vel); U.uShut.value = 0.016 * Math.max(0.05, timeScale);
  R.rain.forEach((m, k) => { const B = [19.2, 4.2, 0.9][k], ex = m.userData, vis = wx.rain * (k === 0 ? 1 : k === 1 ? smooth(9, 3.5, D) : smooth(1.6, 0.7, D)); ex.uBox.value = B; ex.uOff.value.copy(rainOff); ex.uCen.value.copy(k === 0 ? new V3(0, 0, 0) : cv.pl.clone().lerp(cam.T, 0.45)); ex.uAlpha.value = vis * ([0.55, 0.6, 0.55][k] + (k === 0 ? 0.55 : -0.2) * smooth(0.5, 0.9, wx.S)); ex.uDrop.value = [0.0075, 0.0021, 0.0007][k]; m.visible = vis > 0.02; m.geometry.instanceCount = Math.round(13000 * clamp(vis * 1.4, 0, 1)); });
  if (chaos.writeBody()) R.bodyTex.needsUpdate = true; world.B.forEach((b, i) => (R.bld[i * 16 + 7] = b.power)); R.bldTex.needsUpdate = true;
  for (let k = 0; k < 40; k++) { const st = chaos.sites[k], q = k * 4; if (st && st.tall && st.rise > 0.02) { R.crP[q] = st.cx; R.crP[q + 1] = LAND + st.h * st.rise - st.h; R.crP[q + 2] = st.cz; R.crP[q + 3] = 1; R.crQ[q] = 0; R.crQ[q + 1] = Math.sin(-st.yaw / 2); R.crQ[q + 2] = 0; R.crQ[q + 3] = Math.cos(-st.yaw / 2); R.crC.set([1, 1, 1, st.h], q); } else R.crP[q + 3] = 0; } R.crI.pa.needsUpdate = R.crI.qa.needsUpdate = R.crI.ca.needsUpdate = true;
  lightTimer -= rdt; if (lightTimer < 0) { lightTimer = chaos.ph.awake ? 0.05 : 0.2; rebuildLights(); } dynamicLights(); fadeIn = Math.min(1, fadeIn + rdt * 0.7); U.uFadeIn.value = fadeIn * fadeIn * (3 - 2 * fadeIn);
}
let probe = null, locked = false;
function fitSize() { const pr = Math.min(window.devicePixelRatio || 1, 1.5); R.resize(Math.max(2, Math.round(innerWidth * pr)), Math.max(2, Math.round(innerHeight * pr)), scale); }
function tick(rdt) { const s = simulate(rdt), cv = camera(rdt); uniforms(rdt, s, cv); R.render(cam, realT); const f = U.uCamF.value; sound.update(rdt, { cam: [U.uCam.value.x, U.uCam.value.y, U.uCam.value.z], fwd: [f.x, f.y, f.z], up: [0, 1, 0], D: cam.D, S: wx.S, rain: wx.rain, T: wx.T, rate: timeScale, life, wx, fires: chaos.fires, ph: chaos.ph, power: chaos.power, phase: chaos.phase, shake: Math.min(1, globe.shake) }); }
function frame(t) {
  requestAnimationFrame(frame); const rdt = Math.min(0.08, Math.max(0.001, (t - last) / 1000)); last = t; if (document.hidden) return; fps = lerp(fps, 1 / rdt, 0.06); slowFrames++;
  // adaptive resolution: step down when slow, but give the pixels back if it did not help (a capped display, not a slow GPU)
  if (!window.__NOSCALE && !locked && slowFrames > 110) {
    if (probe) { if (fps < probe.fps * 1.08) { scale = probe.scale; locked = true; fitSize(); } probe = null; slowFrames = 0; }
    else if (fps < 40 && scale > 0.5) { probe = { fps, scale }; scale = Math.max(0.5, scale * 0.85); fitSize(); slowFrames = 0; }
    else if (fps > 57 && scale < 1 && slowFrames > 500) { scale = Math.min(1, scale * 1.08); fitSize(); slowFrames = 0; }
  }
  tick(rdt);
}
addEventListener('resize', fitSize); fitSize();
async function ready() { const r = R.r, jobs = [R.sMain, R.sShadow, R.sLight, R.sFx].map((s) => r.compileAsync(s, R.cam)); for (const k in R.P) { const m = new THREE.Mesh(R.fsq.geometry, R.P[k]), s = new THREE.Scene(); s.add(m); jobs.push(r.compileAsync(s, R.cam)); } await Promise.all(jobs); canvas.style.opacity = 1; }
if (window.__MANUAL) { window.__g = { tick, cam, globe, wx, life, chaos, world, sound, R, U, V3, Q, set: (o) => Object.assign(cam, o), rollGlobe, grab, zoom, bullet, parts, get timeScale() { return timeScale; }, get simT() { return simT; }, fade: () => { fadeIn = 1; } }; window.__ready = true; } else { window.__fps = () => fps; window.__state = () => ({ S: wx.S, T: wx.T, dmg: chaos.damage, phase: chaos.phase, tilt: globe.tilt, D: cam.D, shake: globe.shake, scale, tod: wx.tod, audio: sound.ctx ? sound.ctx.state : 'off' }); ready().then(() => requestAnimationFrame((t) => { last = t; frame(t); window.__live = true; })); }
