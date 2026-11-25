// Traffic, pursuit, pedestrians, clubs, boats, aircraft, wildlife.
import { clamp, lerp, sat, smooth, damp, rng } from './util.js';
import { LAND, SEA, RI, GN, HWY, HWYW } from './world.js';
import { KIN, HELD } from './physics.js';
import { dyn } from './fx.js';

export class Inst {
  constructor(n) { this.n = n; this.P = new Float32Array(n * 4); this.Q = new Float32Array(n * 4); this.C = new Float32Array(n * 4).fill(1); for (let i = 0; i < n; i++) this.Q[i * 4 + 3] = 1; this.pa = dyn(this.P, 4); this.qa = dyn(this.Q, 4); this.ca = dyn(this.C, 4); this.dirty = true; }
  set(i, x, y, z, s, qx, qy, qz, qw) { const k = i * 4; this.P[k] = x; this.P[k + 1] = y; this.P[k + 2] = z; this.P[k + 3] = s; this.Q[k] = qx; this.Q[k + 1] = qy; this.Q[k + 2] = qz; this.Q[k + 3] = qw; }
  setYaw(i, x, y, z, s, yaw) { this.set(i, x, y, z, s, 0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)); }
  col(i, r, g, b, w = 0) { const k = i * 4; this.C[k] = r; this.C[k + 1] = g; this.C[k + 2] = b; this.C[k + 3] = w; }
  flush(c = false) { this.pa.needsUpdate = true; this.qa.needsUpdate = true; if (c) this.ca.needsUpdate = true; }
}
export const T_CAR = 1, T_PED = 2, T_TREE = 3, T_LAMP = 4, T_BOAT = 5, T_SHARK = 6;
const CS = 0.115, PS = 0.045;

export class Life {
  constructor(world, weather) {
    this.w = world; this.wx = weather; this.R = rng(99); this.t = 0;
    this.initCars(); this.initPeople(); this.initBoats(); this.initAir(); this.initSea();
  }
  // ---------------------------------------------------------------- traffic
  initCars() {
    const w = this.w, R = this.R, edges = (this.edges = []), out = new Map(), key = (i, j) => i * 100 + j;
    for (let j = -GN; j <= GN; j++) for (let i = -GN; i <= GN; i++) {
      const a = w.idx(i, j); const add = (i2, j2) => { const e = { i, j, i2, j2, dx: i2 - i, dz: j2 - j, cars: [], id: edges.length }; edges.push(e); if (!out.has(key(i, j))) out.set(key(i, j), []); out.get(key(i, j)).push(e); };
      if (w.hE[a] === 255) { add(i + 1, j); }
      if (w.vE[a] === 255) { add(i, j + 1); }
      if (i > -GN && w.hE[w.idx(i - 1, j)] === 255) add(i - 1, j);
      if (j > -GN && w.vE[w.idx(i, j - 1)] === 255) add(i, j - 1);
    }
    this.out = out; this.key = key;
    const PAL = [[0.72, 0.06, 0.05], [0.85, 0.83, 0.78], [0.03, 0.035, 0.04], [0.05, 0.16, 0.34], [0.55, 0.57, 0.6], [0.08, 0.3, 0.24], [0.78, 0.5, 0.1], [0.42, 0.08, 0.16], [0.5, 0.66, 0.66], [0.28, 0.24, 0.2], [0.75, 0.35, 0.18], [0.16, 0.12, 0.32]];
    const cars = (this.cars = []);
    const NG = 250, NH = 96;
    for (let k = 0; k < NG; k++) {
      const r = R(), type = r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.86 ? 2 : r < 0.92 ? 4 : r < 0.955 ? 6 : 0;
      const e = edges[(R() * edges.length) | 0]; const c = { kind: 0, type, e, s: 0.15 + R() * 0.7, v: 0, vmax: 0.16 + R() * 0.08, turn: null, yaw: 0, x: 0, y: LAND, z: 0, col: type === 2 ? [0.95, 0.66, 0.08] : type === 4 ? [0.75, 0.72, 0.62] : type === 6 ? [0.9, 0.9, 0.9] : PAL[(R() * PAL.length) | 0], chase: 0, emer: 0, brake: 0 };
      if (!e.cars.every((o) => Math.abs(o.s - c.s) > 0.17)) { continue; }
      e.cars.push(c); cars.push(c);
    }
    for (let k = 0; k < NH; k++) { const type = R() < 0.6 ? 0 : R() < 0.75 ? 1 : R() < 0.5 ? 4 : 2; cars.push({ kind: 1, type, u: (k / NH + R() * 0.004) * w.hwy.length, dir: k % 2 ? 1 : -1, v: 0.34, yaw: 0, x: 0, y: LAND, z: 0, lane: 0.075, col: type === 2 ? [0.95, 0.66, 0.08] : type === 4 ? [0.75, 0.72, 0.62] : PAL[(R() * PAL.length) | 0], chase: 0, emer: 0 }); }
    for (let k = 0; k < 10; k++) cars.push({ kind: 2, type: k % 3 === 0 ? 1 : 0, u: k / 10, dir: k % 2 ? 1 : -1, v: 0.3, yaw: 0, x: 0, y: LAND, z: 0, col: PAL[(R() * PAL.length) | 0], chase: 0, emer: 0 });
    // pursuit: one getaway car, five interceptors following its trail
    const e = edges[(edges.length / 2) | 0];
    this.sus = { kind: 0, type: 1, e, s: 0.3, v: 0.6, vmax: 0.78, turn: null, yaw: 0, x: 0, y: LAND, z: 0, col: [0.9, 0.05, 0.03], chase: 1, emer: 0 }; cars.push(this.sus);
    this.trail = []; this.cops = [];
    for (let k = 0; k < 5; k++) { const c = { kind: 3, type: 3, lag: 0.34 + k * 0.26, off: (k % 2 ? 1 : -1) * 0.028, yaw: 0, x: 0, y: LAND, z: 0, col: [0.02, 0.022, 0.03], chase: 2, emer: 1, v: 0 }; cars.push(c); this.cops.push(c); }
    // emergency fleet: hidden until needed, roams with lights during rebuilds
    this.fleet = [];
    for (let k = 0; k < 14; k++) { const ed = edges[(R() * edges.length) | 0]; const c = { kind: 0, type: k % 3 === 0 ? 6 : 5, e: ed, s: 0.3 + R() * 0.4, v: 0, vmax: 0.42, turn: null, yaw: 0, x: 0, y: LAND, z: 0, col: k % 3 === 0 ? [0.92, 0.92, 0.92] : [0.78, 0.05, 0.03], chase: 0, emer: 1, fleet: 1, show: 0 }; cars.push(c); this.fleet.push(c); }
    cars.forEach((c, i) => { c.i = i; c.state = 0; c.px = 0; c.py = 0; c.pz = 0; });
    // instances grouped by type
    this.carInst = []; for (let t = 0; t < 7; t++) { const l = cars.filter((c) => c.type === t); const I = new Inst(Math.max(1, l.length)); l.forEach((c, k) => { c.inst = I; c.slot = k; I.col(k, ...c.col, 0); }); this.carInst.push(I); }
    for (const c of cars) if (c.kind === 0) this.placeGrid(c);
  }
  placeGrid(c) {
    if (c.turn) { const q = c.turn, u = c.s / q.L, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; c.x = q.ax * a + q.bx * b + q.cx * d; c.z = q.az * a + q.bz * b + q.cz * d; c.hx = (q.bx - q.ax) * (1 - u) + (q.cx - q.bx) * u; c.hz = (q.bz - q.az) * (1 - u) + (q.cz - q.bz) * u; }
    else { const e = c.e; c.x = e.i + e.dx * c.s - e.dz * 0.065; c.z = e.j + e.dz * c.s + e.dx * 0.065; c.hx = e.dx; c.hz = e.dz; }
    c.yaw = Math.atan2(-c.hz, c.hx); c.y = LAND;
  }
  nextEdge(c) { const l = this.out.get(this.key(c.e.i2, c.e.j2)) || []; const f = l.filter((e) => !(e.dx === -c.e.dx && e.dz === -c.e.dz)); const s = f.length ? f : l; return s[(this.R() * s.length) | 0]; }
  updCars(dt, calm) {
    const t = this.t, w = this.w;
    for (const e of this.edges) e.cars.sort((a, b) => b.s - a.s);
    for (const c of this.cars) {
      if (c.state !== 0) { c.v = 0; continue; }
      const spd = c.chase ? 1 : calm;
      if (c.kind === 0) {
        if (c.fleet) { c.show = damp(c.show, this.fleetOn ? 1 : 0, 1.5, dt); }
        let vt = c.vmax * (c.fleet ? 1 : spd); const R0 = 0.15, end = 1 - R0;
        if (!c.turn) {
          const l = c.e.cars, k = l.indexOf(c); if (k > 0 && !c.chase) { const gap = l[k - 1].s - c.s - (l[k - 1].type === 4 || c.type === 4 ? 0.2 : 0.135); vt = Math.min(vt, Math.max(0, gap * 3.2)); }
          if (!c.chase && !c.emer) { const ph = (Math.floor(t / 6 + ((c.e.i2 * 7 + c.e.j2 * 13) & 3) * 0.5) & 1) === 0; const green = ph === (c.e.dx !== 0); if (!green) { const gap = end - 0.04 - c.s; if (gap > -0.01) vt = Math.min(vt, Math.max(0, gap * 3)); } }
          if (c.chase) vt = c.vmax * (0.8 + 0.2 * Math.sin(t * 1.1));
        } else vt *= c.chase ? 0.72 : 0.62;
        c.brake = vt < c.v - 0.01 ? 1 : 0; c.v = damp(c.v, vt, c.chase ? 3 : 2.4, dt); c.s += c.v * dt;
        if (!c.turn && c.s >= end) {
          const n = this.nextEdge(c); const e = c.e, i = e.cars.indexOf(c); if (i >= 0) e.cars.splice(i, 1);
          const ax = e.i + e.dx * end - e.dz * 0.065, az = e.j + e.dz * end + e.dx * 0.065, cx = n.i + n.dx * R0 - n.dz * 0.065, cz = n.j + n.dz * R0 + n.dx * 0.065;
          const st = n.dx === e.dx && n.dz === e.dz, bx = st ? (ax + cx) / 2 : e.dx ? cx : ax, bz = st ? (az + cz) / 2 : e.dx ? az : cz, uT = n.dx === -e.dx && n.dz === -e.dz;
          c.turn = { ax, az, bx: uT ? e.i2 + e.dx * 0.02 : bx, bz: uT ? e.j2 + e.dz * 0.02 : bz, cx, cz, L: st ? Math.hypot(cx - ax, cz - az) : Math.max(0.12, Math.hypot(bx - ax, bz - az) * 0.85 + Math.hypot(cx - bx, cz - bz) * 0.85), n }; c.s = 0;
        } else if (c.turn && c.s >= c.turn.L) { const n = c.turn.n; c.e = n; c.turn = null; c.s = R0; n.cars.push(c); }
        const oy = c.yaw; this.placeGrid(c); if (c.chase) { let d = c.yaw - oy; d = Math.atan2(Math.sin(d), Math.cos(d)); c.drift = damp(c.drift || 0, clamp(d / Math.max(dt, 1e-3) * 0.16, -0.7, 0.7), 5, dt); c.yaw += c.drift; }
      } else if (c.kind === 1) {
        c.u = (c.u + (c.dir * c.v * spd * dt) / 0.05 + w.hwy.length * 4) % w.hwy.length; this.hwyAt(c.u, c.dir, c.lane, c);
      } else if (c.kind === 2) {
        const b = w.props.bridge; c.u = (c.u + (c.v * spd * dt) / (b.x1 - b.x0) + 1) % 1; const u = c.dir > 0 ? c.u : 1 - c.u; c.x = lerp(b.x0, b.x1, u); c.z = b.z + c.dir * 0.055; c.y = b.deckY(c.x); const dy = b.deckY(c.x + 0.05 * c.dir) - c.y; c.yaw = c.dir > 0 ? 0 : Math.PI; c.pitch = Math.atan2(dy, 0.05);
      } else if (c.kind === 3) {
        const T = this.trail, want = this.t - c.lag; let k = T.length - 1; while (k > 0 && T[k][3] > want) k--; const p = T[k]; if (p) { const n = T[Math.min(k + 1, T.length - 1)], u = n[3] > p[3] ? clamp((want - p[3]) / (n[3] - p[3]), 0, 1) : 0; const wv = Math.sin(t * 2.3 + c.lag * 20) * 0.02 + c.off, yw = Math.atan2(Math.sin(p[2]) * (1 - u) + Math.sin(n[2]) * u, Math.cos(p[2]) * (1 - u) + Math.cos(n[2]) * u); const x = lerp(p[0], n[0], u) + Math.sin(yw) * wv, z = lerp(p[1], n[1], u) + Math.cos(yw) * wv; c.x = x; c.z = z; c.yaw = yw + Math.cos(t * 2.3 + c.lag * 20) * 0.1; c.y = LAND; c.v = 0.7; }
      }
    }
    if (this.sus.state === 0) { this.trail.push([this.sus.x, this.sus.z, this.sus.yaw, this.t]); if (this.trail.length > 400) this.trail.splice(0, 100); }
  }
  hwyAt(u, dir, lane, o) {
    const H = this.w.hwy, n = H.length, i = Math.floor(u), f = u - i, a = H[(i + n) % n], b = H[(i + 1) % n], c = H[(i + 3) % n], e = H[(i - 2 + n) % n];
    const tx = c[0] - e[0], tz = c[1] - e[1], l = Math.hypot(tx, tz) || 1, dx = (tx / l) * dir, dz = (tz / l) * dir;
    o.x = lerp(a[0], b[0], f) - dz * lane; o.z = lerp(a[1], b[1], f) + dx * lane; o.yaw = Math.atan2(-dz, dx); o.y = LAND; o.hx = dx; o.hz = dz;
  }
  // ---------------------------------------------------------------- people
  initPeople() {
    const w = this.w, R = this.R, P = (this.people = []);
    const look = (p) => { p.look = [R() * R() * 0.9 + R() * 0.1, R() * 0.999, R() * 0.999, R()]; p.seed = R(); P.push(p); return p; };
    const walkB = w.blocks.filter((b) => w.blockT[w.idx(b.i, b.j)] > 0);
    const near = (b) => Math.exp(-Math.hypot(b.cx, b.cz - 0.6) / 4);
    for (let k = 0; k < 1500; k++) { let b = walkB[(R() * walkB.length) | 0]; if (R() > near(b) * 1.4) b = walkB[(R() * walkB.length) | 0]; look({ kind: 0, b, s: R() * 4, dir: R() < 0.5 ? 1 : -1, v: 0.026 + R() * 0.02, off: 0.335 + R() * 0.03 }); }
    for (const b of walkB) if (w.blockT[w.idx(b.i, b.j)] === 2) for (let k = 0; k < 10; k++) look({ kind: 1, x: b.cx + (R() - 0.5) * 0.5, z: b.cz + (R() - 0.5) * 0.5, yaw: R() * 6.28, sit: R() < 0.35 });
    for (let k = 0; k < 260; k++) { const i = (R() * w.hwy.length) | 0, p = w.hwy[i], q = w.hwy[(i + 1) % w.hwy.length], tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1, o = 0.27 + R() * 0.26, x = p[0] + (tz / l) * o, z = p[1] - (tx / l) * o; if (w.dist(x, z) < 0.04) { look({ kind: 2, x, z, yaw: R() * 6.28 }); } else look({ kind: 1, x, z, yaw: R() * 6.28, sit: R() < 0.5 }); }
    w.clubs.forEach((c, k) => {
      for (let q = 0; q < 112; q++) { const a = R() * 6.28, r = Math.sqrt(R()); look({ kind: 3, club: k, x: c.x + Math.cos(a) * r * c.w * 0.31, z: c.z + 0.03 + Math.sin(a) * r * c.d * 0.27, yaw: Math.PI + (R() - 0.5) * 1.8 }); }
      for (let q = 0; q < 3; q++) look({ kind: 3, club: k, x: c.x + (q - 1) * 0.05, z: c.z - c.d / 2 + 0.06, yaw: 0, dj: 1, up: 0.028 });
      for (let q = 0; q < 16; q++) { const s = q % 2 ? 1 : -1; look({ kind: 4, club: k, x: c.x + s * (c.w / 2 - 0.085), z: c.z + 0.04 + (q / 16 - 0.5) * c.d * 0.48, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2 }); }
      for (let q = 0; q < 22; q++) look({ kind: 5, club: k, x: c.x - 0.05 + (R() - 0.5) * 0.012, z: c.z + c.d / 2 + 0.03 + 0 * q, x0: c.x - 0.1 + q * 0.011 - 0.1, yaw: Math.PI / 2 });
    });
    // rooftop parties
    const roofs = w.B.filter((b) => b.kind === 0 && b.H > 0.7 && b.H < 2 && b.tiers.length === 1).slice(0, 9);
    this.roofs = roofs; for (const b of roofs) for (let k = 0; k < 16; k++) look({ kind: 6, b: w.B.indexOf(b), x: b.x + (R() - 0.5) * (b.w - 0.07), z: b.z + (R() - 0.5) * (b.d - 0.07), y: LAND + b.H, yaw: R() * 6.28 });
    this.deckStart = P.length;
    for (let k = 0; k < 46; k++) { const u = R(); const lv = u < 0.4 ? 0 : u < 0.7 ? 1 : 2; look({ kind: 7, lx: lv === 0 ? -1.12 + R() * 0.24 : lv === 1 ? -0.83 + R() * 0.2 : -0.56 + R() * 0.18, lz: (R() - 0.5) * (lv === 0 ? 0.34 : 0.3), ly: lv === 0 ? 0.163 : lv === 1 ? 0.291 : 0.411, yaw: R() * 6.28 }); }
    // crews in hi-vis
    this.crew = []; for (let k = 0; k < 110; k++) { const p = look({ kind: 8, x: 0, z: 0, yaw: R() * 6.28, show: 0 }); p.look[1] = 1.5; p.look[2] = 0.3; this.crew.push(p); }
    P.forEach((p, i) => { p.i = i; p.state = 0; p.y = p.y ?? LAND; p.x ??= 0; p.z ??= 0; p.vis = 1; p.ph = R() * 6.28; });
    const n = P.length; this.pI = new Inst(n); this.pAnim = new Float32Array(n * 4); this.pLook = new Float32Array(n * 4); P.forEach((p, i) => { this.pLook.set(p.look, i * 4); this.pAnim[i * 4 + 3] = p.seed; }); this.pAnimA = dyn(this.pAnim, 4); this.pLookA = dyn(this.pLook, 4);
  }
  updPeople(dt, panic) {
    const w = this.w, A = this.pAnim, I = this.pI, yt = this.yacht;
    for (const p of this.people) {
      const k = p.i * 4; let mode = 0, spd = 0;
      if (p.state === 1) { A[k] = 6; continue; }
      if (p.state === 2) continue;
      if (p.kind === 0) {
        const run = panic > 0.35; mode = run ? 2 : 1; spd = p.v * (run ? 3.4 : 1); p.s = (p.s + p.dir * spd * dt + 4) % 4; p.ph += (spd * dt) / PS * (run ? 2.6 : 3.6);
        const e = Math.floor(p.s), f = p.s - e, o = p.off, q = (f - 0.5) * 2 * o; let dx, dz;
        if (e === 0) { p.x = p.b.cx + q; p.z = p.b.cz - o; dx = 1; dz = 0; } else if (e === 1) { p.x = p.b.cx + o; p.z = p.b.cz + q; dx = 0; dz = 1; } else if (e === 2) { p.x = p.b.cx - q; p.z = p.b.cz + o; dx = -1; dz = 0; } else { p.x = p.b.cx - o; p.z = p.b.cz - q; dx = 0; dz = -1; }
        dx *= p.dir; dz *= p.dir; const yaw = Math.atan2(dx, dz); let d = yaw - p.yawC; if (p.yawC === undefined) p.yawC = yaw; else { d = Math.atan2(Math.sin(d), Math.cos(d)); p.yawC += d * Math.min(1, dt * 7); } p.yaw = p.yawC; p.y = LAND;
      } else if (p.kind === 1) { mode = panic > 0.4 ? 5 : p.sit ? 4 : 0; p.y = w.height(p.x, p.z); }
      else if (p.kind === 2) { mode = 8; p.y = this.wx.level() + this.wx.wave(p.x, p.z) - 0.022; }
      else if (p.kind === 3) { mode = panic > 0.55 ? 5 : 3; p.y = LAND + 0.012 + (p.up || 0); if (p.dj && mode === 3) mode = 7; }
      else if (p.kind === 4) { mode = panic > 0.55 ? 5 : 0; p.y = LAND + 0.005; }
      else if (p.kind === 5) { p.x = p.x0; mode = panic > 0.4 ? 5 : 0; p.y = LAND; }
      else if (p.kind === 6) { mode = panic > 0.5 ? 5 : 3; }
      else if (p.kind === 7) { if (yt.state === 0) { const o = this.rotY(yt, p.lx * yt.s, p.ly * yt.s, p.lz * yt.s); p.x = o[0]; p.y = o[1]; p.z = o[2]; } mode = panic > 0.6 ? 5 : 3; }
      else if (p.kind === 8) { mode = p.mode ?? 7; p.y = w.height(p.x, p.z); if (p.mode === 1) p.ph += dt * 5; p.vis = damp(p.vis, p.show, 3, dt); }
      A[k] = mode; A[k + 1] = p.ph; A[k + 2] = spd;
      const sc = PS * p.vis; I.setYaw(p.i, p.x, p.y, p.z, sc < 0.002 ? 0 : sc, p.yaw);
    }
  }
  rotY(b, x, y, z) { // rotate local offset by boat quaternion
    const qx = b.q[0], qy = b.q[1], qz = b.q[2], qw = b.q[3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [b.x + x + qw * tx + qy * tz - qz * ty, b.y + y + qw * ty + qz * tx - qx * tz, b.z + z + qw * tz + qx * ty - qy * tx];
  }
  // ---------------------------------------------------------------- boats
  initBoats() {
    const R = this.R, B = (this.boats = []);
    const add = (type, o) => { const b = Object.assign({ type, state: 0, x: 0, y: SEA, z: 0, q: [0, 0, 0, 1], yaw: 0, u: R(), sp: 0.02, s: 0.36 }, o); B.push(b); return b; };
    this.yacht = add(0, { path: 'lag', rx: 1.35, rz: 0.42, sp: 0.005, s: 0.42, u: 0.7 }); add(0, { path: 'ring', sp: 0.0028, s: 0.36, u: 0.2 }); add(0, { path: 'ring', sp: 0.0026, s: 0.33, u: 0.72 });
    for (let i = 0; i < 7; i++) add(1, { path: 'ring', sp: 0.009 + R() * 0.006, s: 0.3 + R() * 0.06, u: R(), jit: (R() - 0.5) * 0.35 }); add(1, { path: 'lag', rx: 1.85, rz: 0.7, sp: 0.026, s: 0.28 }); add(1, { path: 'lag', rx: 0.6, rz: 0.2, sp: -0.035, s: 0.28 });
    for (let i = 0; i < 6; i++) add(2, { path: 'ring', sp: 0.0026 + R() * 0.001, s: 0.4 + R() * 0.1, u: i / 6 + 0.06, jit: (R() - 0.5) * 0.3 }); for (let i = 0; i < 4; i++) add(i % 2 ? 1 : 2, { path: 'dock', x0: -1.2 + i * 0.75 * 1 - (i > 2 ? 0.1 : 0), z0: 3.1, s: 0.3 });
    add(3, { path: 'ring', sp: 0.0016, s: 0.46, u: 0.46 });
    this.boatInst = [0, 1, 2, 3].map((t) => { const l = B.filter((b) => b.type === t), I = new Inst(Math.max(1, l.length)); l.forEach((b, k) => { b.inst = I; b.slot = k; const c = t === 1 ? [[0.8, 0.1, 0.08], [0.1, 0.3, 0.5], [0.9, 0.85, 0.75], [0.1, 0.45, 0.4], [0.85, 0.55, 0.1]][(R() * 5) | 0] : [1, 1, 1]; I.col(k, ...c, 0); }); return I; });
  }
  updBoats(dt) {
    const wx = this.wx, lvl = wx.level();
    for (const b of this.boats) {
      if (b.state !== 0) continue;
      const jt = b.jit || 0; let hx, hz;
      if (b.path === 'lag') { b.u = (b.u + b.sp * dt + 1) % 1; const a = b.u * 6.28318; b.x = Math.cos(a) * b.rx; b.z = 3.95 + Math.sin(a) * b.rz; hx = -Math.sin(a) * b.rx * Math.sign(b.sp); hz = Math.cos(a) * b.rz * Math.sign(b.sp); }
      else if (b.path === 'ring') {
        b.u = (b.u + b.sp * dt) % 1; const at = (u) => { u = ((u % 1) + 1) % 1; const A0 = 1.08, A1 = 6.72, m = 0.5; const back = u > m, v = back ? 1 - (u - m) / m : u / m; const ev = v; const a = A0 + (A1 - A0) * ev; const end = Math.min(v, 1 - v) * (A1 - A0) * 8.2; const k = smooth(0, 0.5, end); const r = 8.2 + (back ? 0.42 : -0.34) * k + jt * k * 0.6; return [Math.cos(a) * r, Math.sin(a) * r]; };
        const p = at(b.u), q = at(b.u + 0.0012); b.x = p[0]; b.z = p[1]; hx = q[0] - p[0]; hz = q[1] - p[1];
      } else { b.x = b.x0; b.z = b.z0; hx = 0; hz = 1; }
      const yaw = Math.atan2(-hz, hx), L = b.s * (b.type === 0 ? 1.1 : b.type === 3 ? 0.95 : 0.42), dx = Math.cos(yaw) * L, dz = -Math.sin(yaw) * L, wd = b.s * 0.22;
      const h0 = wx.wave(b.x, b.z), hf = wx.wave(b.x + dx, b.z + dz), hb = wx.wave(b.x - dx, b.z - dz), hl = wx.wave(b.x + dz / L * wd, b.z - dx / L * wd), hr = wx.wave(b.x - dz / L * wd, b.z + dx / L * wd);
      const fast = b.type === 1 && b.path !== 'dock'; b.y = damp(b.y, lvl + (h0 * 2 + hf + hb) / 4 + (fast ? 0.012 : 0), 6, dt);
      const pt = Math.atan2(hf - hb, 2 * L) + (fast ? 0.09 + 0.03 * Math.sin(this.t * 6 + b.u * 90) : 0), rl = Math.atan2(hl - hr, 2 * wd) * 0.6 + (b.type === 2 ? 0.16 + 0.06 * Math.sin(this.t * 0.7 + b.u * 40) : 0);
      b.yaw = yaw; quatYPR(b.q, yaw, pt, rl);
      if (fast || (b.type !== 2 && b.path !== 'dock')) b.wake = 1;
    }
  }
  // ---------------------------------------------------------------- aircraft
  initAir() {
    this.helis = []; for (let i = 0; i < 6; i++) this.helis.push({ i, role: i < 2 ? 'police' : i === 2 ? 'news' : i === 3 ? 'medevac' : 'crane', x: Math.cos(i) * 4, y: 3.2, z: Math.sin(i) * 4, vx: 0, vy: 0, vz: 0, yaw: 0, q: [0, 0, 0, 1], aim: [0, LAND, 0] });
    this.heliInst = new Inst(6); this.helis.forEach((h) => this.heliInst.col(h.i, ...(h.role === 'police' ? [0.03, 0.04, 0.07] : h.role === 'news' ? [0.85, 0.85, 0.88] : h.role === 'medevac' ? [0.85, 0.1, 0.08] : [0.95, 0.6, 0.06]), 0));
    this.ship = { x: 0, y: 5.4, z: 0, q: [0, 0, 0, 1], a: 0.6, yaw: 0 }; this.shipInst = new Inst(1); this.shipInst.col(0, 1, 1, 1, 0);
    this.wheelInst = new Inst(1); this.wheelInst.col(0, 1, 1, 1, 0); this.gondInst = new Inst(20); const c = [[0.85, 0.2, 0.12], [0.1, 0.5, 0.6], [0.95, 0.7, 0.2], [0.2, 0.6, 0.4], [0.9, 0.9, 0.86]]; for (let i = 0; i < 20; i++) this.gondInst.col(i, ...c[i % 5], 0); this.wheelA = 0; this.wheelV = 0.12;
  }
  updAir(dt, S, sites) {
    const t = this.t, o = [0, 0, 0];
    for (const h of this.helis) {
      let tx, ty, tz; const gone = S > 0.82;
      if (h.role === 'police' && this.sus.state === 0) { tx = this.sus.x + Math.cos(t * 0.5 + h.i * 3) * 0.75; tz = this.sus.z + Math.sin(t * 0.5 + h.i * 3) * 0.75; ty = LAND + this.clear(tx, tz) + 0.75 + h.i * 0.4; h.aim = [this.sus.x, LAND, this.sus.z]; }
      else if (h.role === 'crane' && sites.length) { const s = sites[(h.i + Math.floor(t * 0.16)) % sites.length]; tx = s.x + Math.cos(t * 0.3 + h.i) * 0.3; tz = s.z + Math.sin(t * 0.3 + h.i) * 0.3; ty = LAND + this.clear(tx, tz) + 0.8; h.aim = [s.x, LAND + 0.1, s.z]; }
      else { const a = t * 0.11 * (h.i % 2 ? 1 : -1) + h.i * 1.7, r = 3.2 + h.i * 0.55; tx = Math.cos(a) * r; tz = Math.sin(a) * r - 0.5; ty = LAND + Math.max(2.4 + 0.5 * Math.sin(t * 0.3 + h.i), this.clear(tx, tz) + 0.6); h.aim = [tx * 0.7, LAND, tz * 0.7]; }
      const k = gone ? 0.35 : 1; this.wx.windAt(h.x, h.y, h.z, o);
      const ax = clamp((tx - h.x) * 0.9 - h.vx * 1.4, -0.8, 0.8) * k, ay = clamp((ty - h.y) * 1.2 - h.vy * 1.6, -0.6, 0.6) * k, az = clamp((tz - h.z) * 0.9 - h.vz * 1.4, -0.8, 0.8) * k;
      h.vx += (ax + (o[0] - h.vx) * 0.12 * S) * dt; h.vy += (ay + (o[1] - h.vy) * 0.12 * S) * dt; h.vz += (az + (o[2] - h.vz) * 0.12 * S) * dt;
      h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt; const r = Math.hypot(h.x, h.y, h.z); if (r > 8.6) { const q = 8.6 / r; h.x *= q; h.y *= q; h.z *= q; h.vx *= 0.8; h.vz *= 0.8; } const fl = LAND + 0.4; if (h.y < fl) { h.y = fl; h.vy = Math.abs(h.vy); }
      const sp = Math.hypot(h.vx, h.vz); if (sp > 0.03) { const y = Math.atan2(-h.vz, h.vx); let d = y - h.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); h.yaw += d * Math.min(1, dt * 1.8); }
      const f = Math.cos(h.yaw) * ax - Math.sin(h.yaw) * az, s = Math.sin(h.yaw) * ax + Math.cos(h.yaw) * az, sh = S > 0.6 ? Math.sin(t * 7 + h.i) * 0.25 * (S - 0.6) * 2.5 : 0;
      quatYPR(h.q, h.yaw, clamp(-f * 0.5 - sp * 0.14, -0.5, 0.5) + sh, clamp(-s * 0.5, -0.5, 0.5) + sh); this.heliInst.set(h.i, h.x, h.y, h.z, 0.24, ...h.q);
    }
    const sh = this.ship; sh.a += dt * 0.035; const r = 4.9, n = S > 0.5 ? (S - 0.5) * 2 : 0; sh.x = Math.cos(sh.a) * r; sh.z = Math.sin(sh.a) * r - 0.3; sh.y = 3.55 + 0.15 * Math.sin(t * 0.3) + n * 1.4 + Math.sin(t * 2.1) * 0.1 * n; quatYPR(sh.q, -sh.a - Math.PI / 2, Math.sin(t * 1.7) * 0.2 * n + 0.02 * Math.sin(t * 0.4), Math.sin(t * 1.3) * 0.25 * n); this.shipInst.set(0, sh.x, sh.y, sh.z, 0.62, ...sh.q);
    const w = this.w.props.wheel; this.wheelV = damp(this.wheelV, S > 0.5 ? 0.12 + (S - 0.5) * 7 : 0.12, 0.4, dt); this.wheelA += this.wheelV * dt; this.wheelInst.set(0, w.x, w.y, w.z, w.r, 0, 0, Math.sin(this.wheelA / 2), Math.cos(this.wheelA / 2));
    for (let i = 0; i < 20; i++) { const a = this.wheelA + (i / 20) * 6.28318, sw = Math.sin(t * 2 + i) * 0.04 * (1 + S * 8); this.gondInst.set(i, w.x + Math.cos(a) * w.r, w.y + Math.sin(a) * w.r, w.z, 0.85, 0, 0, Math.sin(sw / 2), Math.cos(sw / 2)); }
  }
  clear(x, z) { let m = 0; for (const b of this.w.B) if (Math.abs(b.x - x) < b.w / 2 + 0.25 && Math.abs(b.z - z) < b.d / 2 + 0.25) m = Math.max(m, b.H * (b.alive ?? 1)); return m; }
  // ---------------------------------------------------------------- sea
  initSea() {
    const R = this.R; this.sharks = []; for (let i = 0; i < 10; i++) this.sharks.push({ i, state: 0, a: i * 0.628 + R() * 0.2, r: 7.9 + R() * 0.7, d: 0.3 + R() * 0.9, v: 0.16 + R() * 0.08, x: 0, y: -3, z: 0, yaw: 0, q: [0, 0, 0, 1], s: 0.42 + R() * 0.16, street: 0, u: R() * this.w.hwy.length, flop: 0, ph: R() * 6 }); this.sharkInst = new Inst(10);
    this.dolph = []; for (let i = 0; i < 6; i++) this.dolph.push({ i, a: 2.2 + i * 0.07 + (i > 2 ? 2.4 : 0), ph: i * 0.9, r: 8.35 + (i % 3) * 0.16 }); this.dolphInst = new Inst(6); for (let i = 0; i < 6; i++) this.dolphInst.col(i, 1, 1, 1); for (let i = 0; i < 10; i++) this.sharkInst.col(i, 1, 1, 1);
  }
  updSea(dt) {
    const wx = this.wx, lvl = wx.level(), t = this.t, n = wx.wn, up = n[1] > 0.9;
    for (const s of this.sharks) {
      if (s.state !== 0) continue;
      const flood = wx.flood > 0.2 && up; s.street = damp(s.street, flood ? 1 : 0, flood ? 0.5 : 1.2, dt); s.ph += dt * 7;
      s.a += (s.v / s.r) * dt; s.u = (s.u + (s.v * 1.4 * dt) / 0.05) % this.w.hwy.length;
      const wob = 0.25 * Math.sin(t * 0.6 + s.i * 2), ax = Math.cos(s.a) * (s.r + wob), az = Math.sin(s.a) * (s.r + wob); const o = {}; this.hwyAt(s.u, 1, 0.05 * Math.sin(t * 0.8 + s.i), o);
      const px = s.x, pz = s.z, k = s.street; let x = lerp(ax, o.x, k), z = lerp(az, o.z, k); const gh = this.w.height(x, z); let y = lerp(lvl - s.d + 0.06 * Math.sin(t + s.i), lvl - 0.035, smooth(0.1, 0.8, k)); y = Math.max(y, gh + 0.05);
      if (!up) { // follow the sloshing water plane
        const d = lvl - s.d, lx = ax, lz = az, X = wx.basisX, Z = wx.basisZ; x = n[0] * d + X[0] * lx + Z[0] * lz; y = n[1] * d + X[1] * lx + Z[1] * lz; z = n[2] * d + X[2] * lx + Z[2] * lz; const r = Math.hypot(x, y, z); if (r > 9.2) { x *= 9.2 / r; y *= 9.2 / r; z *= 9.2 / r; } }
      s.x = x; s.y = y; s.z = z; const vx = x - px, vz = z - pz; if (vx * vx + vz * vz > 1e-8) { const yw = Math.atan2(-vz, vx); let d = yw - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); s.yaw += d * Math.min(1, dt * 3); }
      const wag = Math.sin(s.ph) * 0.12; quatYPR(s.q, s.yaw + wag, 0, 0); this.sharkInst.set(s.i, x, y, z, s.s, ...s.q);
      if (k > 0.7 && !flood && y - 0.04 < gh + 0.06 && lvl < gh + 0.03) { s.state = 1; s.beach = true; }
    }
    for (const d of this.dolph) { d.a += dt * 0.035; const c = (t * 0.42 + d.ph) % 3, jump = c < 1 ? c : -1, x = Math.cos(d.a) * d.r, z = Math.sin(d.a) * d.r; let y, pt; if (jump >= 0) { y = lvl + 0.3 * Math.sin(jump * Math.PI) - 0.07; pt = Math.cos(jump * Math.PI) * 1.0; if ((jump < 0.06 || jump > 0.94) && Math.random() < 0.3) this.splash && this.splash(x, lvl, z, 0.25); } else { y = lvl - 0.22; pt = Math.sin(t * 3 + d.ph) * 0.15; } quatYPR(d.q || (d.q = [0, 0, 0, 1]), -d.a - Math.PI / 2, pt, 0); this.dolphInst.set(d.i, x, y, z, up ? 0.24 : 0, ...d.q); }
  }
  update(dt, S, calm, panic, sites) { this.t += dt; this.updCars(dt, calm); this.updBoats(dt); this.updPeople(dt, panic); this.updAir(dt, S, sites); this.updSea(dt); }
  flushCars() {
    for (const c of this.cars) {
      if (c.state === 0) { let s = CS * (c.fleet ? c.show : 1); if (s < 0.01) s = 0; if (c.pitch) { quatYPR(Q4, c.yaw, c.pitch, 0); c.inst.set(c.slot, c.x, c.y, c.z, s, Q4[0], Q4[1], Q4[2], Q4[3]); } else c.inst.setYaw(c.slot, c.x, c.y, c.z, s, c.yaw); c.inst.C[c.slot * 4 + 3] = c.brake ? 0.7 : 0.1; }
    }
    for (const I of this.carInst) I.flush(true); for (const b of this.boats) if (b.state === 0) b.inst.set(b.slot, b.x, b.y, b.z, b.s, ...b.q); for (const I of this.boatInst) I.flush();
    this.heliInst.flush(); this.shipInst.flush(); this.wheelInst.flush(); this.gondInst.flush(); this.sharkInst.flush(); this.dolphInst.flush(); this.pI.flush(); this.pAnimA.needsUpdate = true;
  }
}
const Q4 = [0, 0, 0, 1];
export function quatYPR(o, yaw, pitch, roll) { // yaw about y, pitch about local z (nose up +), roll about local x
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  const ax = sy * sp, ay = sy * cp, az = cy * sp, aw = cy * cp; // qy * qz
  o[0] = aw * sr + ax * cr; o[1] = ay * cr + az * sr; o[2] = az * cr - ay * sr; o[3] = aw * cr - ax * sr; return o;
}
export { CS, PS };
