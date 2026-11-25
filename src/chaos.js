// Destruction director: couples physics with city life, runs fires, then rebuilds everything.
import { clamp, lerp, sat, smooth, damp, qRot } from './util.js';
import { LAND, SEA, RI } from './world.js';
import { Phys, KIN, HELD, ANCHOR } from './physics.js';
import { T_CAR, T_PED, T_TREE, T_LAMP, T_BOAT, T_SHARK, CS, PS, Inst } from './life.js';

const o3 = [0, 0, 0];
const ease = (t) => t * t * (3 - 2 * t);

export class Chaos {
  constructor(world, life, wx, parts) {
    this.w = world; this.life = life; this.wx = wx; this.fx = parts; this.t = 0;
    const nProps = life.cars.length + life.people.length + world.trees.length + world.lamps.length + life.boats.length + life.sharks.length;
    const ph = (this.ph = new Phys(world, nProps)); this.props = [];
    const reg = (kind, ref, hx, hy, hz, m, dr, bu, oy) => { const i = ph.addProp(kind, hx, hy, hz, m, dr, bu); const p = { part: i, kind, ref, oy, st: 0, t: 0 }; ref.prop = p; this.props.push(p); return p; };
    for (const c of life.cars) { const k = c.type === 4 ? 1.8 : c.type === 5 ? 1.3 : 1; reg(T_CAR, c, 0.055 * k, 0.018, 0.024, 0.35 * k, 0.16, 0.9, 0.019); }
    for (const p of life.people) reg(T_PED, p, 0.009, 0.021, 0.007, 0.03, 0.75, 1.15, 0.021);
    // trees & lamps as instance sets
    this.treeI = [0, 1].map((k) => new Inst(Math.max(1, world.trees.filter((t) => t.kind === k).length))); const cnt = [0, 0];
    for (const t of world.trees) { t.inst = this.treeI[t.kind]; t.slot = cnt[t.kind]++; t.grow = 1; const g = 0.75 + t.seed * 0.5; t.inst.col(t.slot, g, g * (0.9 + 0.2 * t.seed), g * 0.9, 0); reg(T_TREE, t, 0.02, t.kind ? 0.06 : 0.13, 0.02, 0.1, 0.45, 1.3, (t.kind ? 0.08 : 0.15) * t.s); }
    this.lampI = new Inst(world.lamps.length); world.lamps.forEach((l, i) => { l.slot = i; l.inst = this.lampI; l.grow = 1; l.on = 1; l.y = world.height(l.x, l.z); this.lampI.col(i, 1, 1, 1, 0); reg(T_LAMP, l, 0.012, 0.075, 0.006, 0.08, 0.3, 0.4, 0.08); });
    for (const b of life.boats) { const r = [0.5, 0.11, 0.2, 0.42][b.type] * b.s; reg(T_BOAT, b, r * 1.6, r * 0.4, r * 0.5, [1.6, 0.2, 0.5, 2][b.type], 0.12, 2.1, 0.02); }
    for (const s of life.sharks) reg(T_SHARK, s, 0.16, 0.035, 0.04, 0.3, 0.1, 1.0, 0.0);
    this.placeStatics(true);
    this.body = new Float32Array(256 * 4 * Math.ceil((ph.NC * 2) / 256)); this.bodyDirty = true; this.fires = []; this.sites = []; this.cables = []; this.phase = 'calm'; this.calmT = 0; this.alive = world.B.map(() => 1); this.disp = 0; this.bigEvent = 0; this.power = 1; this.blackout = 0; this.snd = null; this.rebuildT = 0; this.stat = { loose: 0 }; this.flipT = 0; this.dust = 0; this.pulses = []; this.arc = 0;
    ph.onDetach = (b, comp, c) => {
      let m = 0, x = 0, z = 0, y = 1e9; for (const i of comp) { m += ph.mass[i]; x += ph.P[i * 3]; z += ph.P[i * 3 + 2]; y = Math.min(y, ph.P[i * 3 + 1] - ph.E[i * 3 + 1]); } x /= comp.length; z /= comp.length;
      const n = Math.min(60, 4 + comp.length * 2); for (let k = 0; k < n; k++) this.fx.spawn(0, x + (Math.random() - 0.5) * b.w, y + Math.random() * 0.1, z + (Math.random() - 0.5) * b.d, (Math.random() - 0.5) * 0.7, Math.random() * 0.3, (Math.random() - 0.5) * 0.7, 2 + Math.random() * 3, 0.08 + Math.random() * 0.1);
      for (let k = 0; k < 8; k++) this.fx.burst(3, 1, x + (Math.random() - 0.5) * b.w, y, z + (Math.random() - 0.5) * b.d, 0.7, 0.4, 0.9, 0.004);
      if (comp.length > 5 && Math.random() < 0.42) this.ignite(comp[(Math.random() * comp.length) | 0], 0.8 + Math.random() * 0.7);
      for (let k = 0; k < Math.min(26, comp.length); k++) { const a = Math.random() * 6.283; this.fx.spawn(0, x + Math.cos(a) * b.w * 0.5, y + 0.03, z + Math.sin(a) * b.d * 0.5, Math.cos(a) * (0.3 + Math.random() * 0.6), 0.04 + Math.random() * 0.12, Math.sin(a) * (0.3 + Math.random() * 0.6), 4 + Math.random() * 4, 0.16 + Math.random() * 0.16); }
      if (comp.length > 18) { this.bigEvent = Math.max(this.bigEvent, comp.length); this.big = [x, y + 0.5, z]; this.snd && this.snd.collapse(x, y, z, Math.min(1, comp.length / 70)); }
    };
    wx.onStrike = (x, y, z, b, S) => {
      this.snd && this.snd.thunder(x, y, z, S); this.fx.burst(3, 26, x, y + 0.02, z, 0.9, 0.8, 0.8, 0.005); this.fx.spawn(8, x, y + 0.05, z, 0, 0, 0, 0.16, 0.5);
      if (b && S > 0.42 && Math.random() < 0.85) { const i = this.topChunk(b); if (i >= 0) { this.ignite(i, 0.9 + S * 0.6); if (S > 0.8) this.ph.hurt(i, 0.7); } }
    };
  }
  topChunk(b) { let best = -1, y = -1e9; for (let i = b.first; i < b.first + b.count; i++) if (this.ph.cl[i] === ANCHOR) { const q = this.ph.P[i * 3 + 1] + Math.random() * 0.4; if (q > y) { y = q; best = i; } } return best; }
  ignite(i, k) { if (this.fires.length > 90 || this.fires.some((f) => f.i === i)) return; this.fires.push({ i, k, life: 0, acc: Math.random(), sp: 2 + Math.random() * 5 }); this.ph.heat[i] = Math.max(this.ph.heat[i], 0.3); this.bodyDirty = true; }
  placeStatics(all) {
    for (const t of this.w.trees) if (t.prop.st === 0 || all) { t.inst.setYaw(t.slot, t.x, t.y - 0.004, t.z, t.s * t.grow, t.ry); t.inst.C[t.slot * 4 + 3] = 0; }
    for (const l of this.w.lamps) if (l.prop.st === 0 || all) { l.inst.setYaw(l.slot, l.x, l.y, l.z, l.grow, l.ry); l.inst.C[l.slot * 4 + 3] = l.on * this.lampPow(l) > 0.5 ? 1 : -1; }
    for (const I of [...this.treeI, this.lampI]) I.flush(true);
  }
  lampPow(l) { return this.power; }
  // release a kinematic prop into the simulation
  loose(p, vx, vy, vz) {
    if (p.st === 1) return; const ph = this.ph, i = p.part, r = p.ref; let x = r.x, y = r.y, z = r.z, q;
    if (p.kind === T_BOAT || p.kind === T_SHARK) q = r.q; else { const yaw = p.kind === T_TREE || p.kind === T_LAMP ? r.ry : p.kind === T_PED ? r.yaw : r.yaw; q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]; }
    if (p.kind === T_CAR && r.fleet && r.show < 0.5) return;
    if (p.kind === T_PED && r.kind === 8 && r.vis < 0.5) return;
    ph.P[i * 3] = x; ph.P[i * 3 + 1] = y + p.oy; ph.P[i * 3 + 2] = z; ph.Q.set(q, i * 4); ph.cl[i] = KIN;
    if (p.kind === T_PED && r.kind !== 0 && r.kind !== 8) r.home0 = [r.x, r.y, r.z];
    const c = ph.release(i, vx, vy, vz, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3); if (c < 0) return;
    p.st = 1; p.wet = 0; r.state = 1; if (p.kind === T_LAMP) { r.on = 0; } if (p.kind === T_CAR) { const e = r.e; if (e) { const k = e.cars.indexOf(r); if (k >= 0) e.cars.splice(k, 1); } if (Math.random() < 0.3) this.fx.burst(3, 8, x, y, z, 0.8, 0.3, 0.7, 0.004); }
  }
  // write physics transforms back into instance buffers
  syncProps() {
    const ph = this.ph;
    for (const p of this.props) {
      if (p.st === 0) continue; const i = p.part, r = p.ref, i3 = i * 3, i4 = i * 4; let x, y, z, a, b, c, d, s = 1;
      if (p.st === 1) { x = ph.P[i3]; y = ph.P[i3 + 1]; z = ph.P[i3 + 2]; a = ph.Q[i4]; b = ph.Q[i4 + 1]; c = ph.Q[i4 + 2]; d = ph.Q[i4 + 3]; }
      else { x = p.x; y = p.y; z = p.z; a = p.q[0]; b = p.q[1]; c = p.q[2]; d = p.q[3]; s = p.s ?? 1; }
      qRot(o3, a, b, c, d, 0, -p.oy, 0); x += o3[0]; y += o3[1]; z += o3[2];
      if (p.kind === T_CAR) { r.x = x; r.y = y; r.z = z; r.inst.set(r.slot, x, y, z, CS * s, a, b, c, d); r.inst.C[r.slot * 4 + 3] = p.st === 1 && p.t > 3 ? -1 : 0.6; }
      else if (p.kind === T_PED) { r.x = x; r.y = y; r.z = z; this.life.pI.set(r.i, x, y, z, PS * s, a, b, c, d); }
      else if (p.kind === T_TREE) { r.inst.set(r.slot, x, y, z, r.s * s, a, b, c, d); r.inst.C[r.slot * 4 + 3] = 1; this.treeDirty = true; }
      else if (p.kind === T_LAMP) { r.inst.set(r.slot, x, y, z, s, a, b, c, d); r.inst.C[r.slot * 4 + 3] = -1; this.treeDirty = true; }
      else if (p.kind === T_BOAT) { r.x = x; r.y = y; r.z = z; r.q[0] = a; r.q[1] = b; r.q[2] = c; r.q[3] = d; r.inst.set(r.slot, x, y, z, r.s * s, a, b, c, d); }
      else if (p.kind === T_SHARK) { r.x = x; r.y = y; r.z = z; this.life.sharkInst.set(r.i, x, y, z, r.s * s, a, b, c, d); }
      if (p.st === 1) p.t += this.dt;
    }
  }
  writeBody() {
    const ph = this.ph, D = this.body; if (!ph.moved && !this.bodyDirty) return false;
    for (let i = 0; i < ph.NC; i++) { const k = i * 8, i3 = i * 3, i4 = i * 4; D[k] = ph.P[i3]; D[k + 1] = ph.P[i3 + 1]; D[k + 2] = ph.P[i3 + 2]; D[k + 3] = Math.min(1, ph.heat[i]) + (ph.cl[i] !== ANCHOR ? 2 : 0); D[k + 4] = ph.Q[i4]; D[k + 5] = ph.Q[i4 + 1]; D[k + 6] = ph.Q[i4 + 2]; D[k + 7] = ph.Q[i4 + 3]; }
    ph.moved = false; this.bodyDirty = false; return true;
  }

  update(dt, rdt, g, shake, tilt, water) {
    this.t += dt; this.dt = dt; const { ph, wx, life, w } = this, S = wx.S, gx = g[0], gy = g[1], gz = g[2], lat = Math.hypot(gx, gz);
    // ---- who lets go
    const grip = gy > -0.35 || lat > 1.9; const T = wx.T;
    if (grip || S > 0.5 || T > 0.05) {
      const step = this.frame = (this.frame || 0) + 1;
      for (let k = step % 3; k < this.props.length; k += 3) {
        const p = this.props[k]; if (p.st !== 0) continue; const r = p.ref;
        if (p.kind === T_CAR) { if (grip && (gy > 0.1 || Math.random() < 0.2)) { this.loose(p, r.hx ? r.hx * r.v : 0, 0, r.hz ? r.hz * r.v : 0); continue; } if (S > 0.5) { wx.windAt(r.x, r.y + 0.05, r.z, o3); const s2 = o3[0] ** 2 + o3[1] ** 2 * 3 + o3[2] ** 2; if (s2 > 9 + Math.random() * 20 || (s2 > 4.6 && S > 0.8 && Math.random() < 0.006)) this.loose(p, o3[0] * 0.3, 0.25 + Math.max(0, o3[1]) * 0.35, o3[2] * 0.3); } const under = wx.level() - r.y; if (wx.flood > 0.12 && under > 0.06 && Math.random() < 0.01) this.loose(p, 0, 0.05, 0); }
        else if (p.kind === T_PED) { if (r.vis < 0.5) continue; if (grip && (gy > 0.1 || Math.random() < 0.35)) { this.loose(p, 0, 0.05, 0); continue; } if (S > 0.5) { wx.windAt(r.x, r.y + 0.02, r.z, o3); const s2 = o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2; const sh = r.kind === 3 || r.kind === 4 ? 3 : 1; if (s2 > (5 + Math.random() * 16) * sh || (S > 0.8 && Math.random() < 0.0012 / sh)) this.loose(p, o3[0] * 0.4, 0.3 + Math.max(0, o3[1]) * 0.4, o3[2] * 0.4); } const under = wx.level() - r.y; if (wx.flood > 0.15 && under > 0.05 && r.kind !== 2 && Math.random() < 0.01) this.loose(p, 0, 0.1, 0); }
        else if (p.kind === T_TREE || p.kind === T_LAMP) { const lim = p.kind === T_TREE ? 24 : 18; if ((gy > 0.35 && Math.random() < 0.012) || (lat > 3.2 && Math.random() < 0.03)) { this.loose(p, gx * 0.05, 0.05, gz * 0.05); continue; } if (T > 0.1 || S > 0.8) { wx.windAt(r.x, r.y + 0.25, r.z, o3); const s2 = o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2; if (s2 > lim + Math.random() * 14 || (S > 0.85 && Math.random() < 0.0006)) this.loose(p, o3[0] * 0.35, 0.4, o3[2] * 0.35); } }
        else if (p.kind === T_BOAT) { if (gy > -0.75 || lat > 1.3) { this.loose(p, 0, 0, 0); continue; } if (T > 0.1) { wx.windAt(r.x, r.y + 0.1, r.z, o3); if (o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2 > 14) this.loose(p, o3[0] * 0.3, 0.5, o3[2] * 0.3); } if (S > 0.9 && Math.random() < 0.0015) this.loose(p, 0, 0, 0); }
        else if (p.kind === T_SHARK) { if (gy > -0.2 || lat > 2.5) continue; if (T > 0.2) { wx.windAt(r.x, r.y + 0.1, r.z, o3); if (o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2 > 16) this.loose(p, o3[0] * 0.3, 0.8, o3[2] * 0.3); } }
      }
    }
    for (const s of life.sharks) if (s.beach && s.prop.st === 0) { s.beach = false; this.loose(s.prop, 0, 0.1, 0); }
    // stranded sharks thrash
    for (const s of life.sharks) { if (s.prop.st !== 1) continue; const c = ph.cl[s.prop.part]; if (c >= 0) { s.flop -= dt; if (s.flop < 0) { s.flop = 0.35 + Math.random() * 0.9; ph.wake(c); if (s.y < w.height(s.x, s.z) + 0.15) { ph.cv[c * 3] += (Math.random() - 0.5) * 0.35; ph.cv[c * 3 + 1] += 0.18 + Math.random() * 0.22; ph.cv[c * 3 + 2] += (Math.random() - 0.5) * 0.35; ph.cw[c * 3] += (Math.random() - 0.5) * 9; ph.cw[c * 3 + 1] += (Math.random() - 0.5) * 12; ph.cw[c * 3 + 2] += (Math.random() - 0.5) * 9; } } } }
    // ---- tornado rips the skin and then the frame off buildings
    if (T > 0.15) {
      for (const o of ph.bd) { if (!o.alive) continue; const b = o.b, d = Math.hypot(b.x - wx.tx, b.z - wx.tz); if (d > 1.5) continue;
        const n = Math.ceil(o.alive * dt * T * smooth(1.5, 0.25, d) * 1.5 * Math.random() * 1.6 - 0.4);
        for (let k = 0; k < n; k++) { const i = b.first + ((Math.random() * b.count) | 0); if (ph.cl[i] !== ANCHOR) continue; wx.windAt(ph.P[i * 3], ph.P[i * 3 + 1], ph.P[i * 3 + 2], o3); const s2 = o3[0] ** 2 + o3[1] ** 2 + o3[2] ** 2; if (s2 < 7 + Math.random() * 14) continue; for (let q = ph.bs[i]; q < ph.bs[i + 1]; q++) { ph.bh[q] = 0; ph.bh[ph.br[q]] = 0; } ph.found[i] = 0; ph.makeCluster([i], o3[0] * 0.3, 0.3 + o3[1] * 0.3, o3[2] * 0.3, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); o.dirty = true; ph.moved = true; if (Math.random() < 0.5) this.fx.burst(0, 3, ph.P[i * 3], ph.P[i * 3 + 1], ph.P[i * 3 + 2], 0.5, 0.3, 2, 0.1); } }
      for (let k = 0; k < 10; k++) if (Math.random() < T) { const a = Math.random() * 6.28, r = 0.15 + Math.random() * 0.7, x = wx.tx + Math.cos(a) * r, z = wx.tz + Math.sin(a) * r, y = Math.max(w.height(x, z), wx.level()); const water = wx.level() > w.height(x, z); this.fx.spawn(water ? 4 : 0, x, y + 0.03, z, -Math.sin(a) * 1.6, 0.4 + Math.random() * 0.8, Math.cos(a) * 1.6, 1.2 + Math.random() * 2, water ? 0.02 : 0.1 + Math.random() * 0.14); }
    }
    // category 5: random progressive collapses
    if (S > 0.82 && Math.random() < dt * 0.55 * smooth(0.82, 1, S)) { const o = ph.bd[(Math.random() * ph.bd.length) | 0]; if (o.alive > o.b.count * 0.7) { const L = (Math.random() * Math.max(1, o.n * 0.6)) | 0; const C = w.C; for (let i = o.b.first; i < o.b.first + o.b.count; i++) if (C[i].layer === L && ph.cl[i] === ANCHOR) { for (let q = ph.bs[i]; q < ph.bs[i + 1]; q++) if (C[ph.bt[q]].layer !== L && Math.random() < 0.93) { ph.bh[q] = 0; ph.bh[ph.br[q]] = 0; } if (L === 0 && Math.random() < 0.9) ph.found[i] = 0; } o.dirty = true; } }
    ph.structural(dt, gx, 0, gz, (a, b, c, o) => wx.windAt(a, b, c, o), S);
    const up = gy; if (up > 0.12) ph.structural(dt, 0, up, 0, (a, b, c, o) => wx.windAt(a, b, c, o), 0);
    // wake sleepers when gravity or wind changes
    const dg = Math.hypot(gx - (this.lg?.[0] ?? gx), gy - (this.lg?.[1] ?? gy), gz - (this.lg?.[2] ?? gz)); if (dg > 0.12) { this.lg = [gx, gy, gz]; ph.wakeAll(); } if (!this.lg) this.lg = [gx, gy, gz];
    if (T > 0.1 || S > 0.7) { for (let k = 0; k < ph.active.length; k += 1) { const c = ph.active[k]; if (ph.cst[c] !== 2) continue; const d = Math.hypot(ph.cp[c * 3] - wx.tx, ph.cp[c * 3 + 2] - wx.tz); if ((T > 0.1 && d < 1.3) || (S > 0.8 && Math.random() < 0.004 && ph.cdrag[c] > 0.14)) ph.wake(c); } }
    // ---- simulate
    const env = { g, windAt: (a, b, c, o) => wx.windAt(a, b, c, o), water, flow: wx.flow, storm: S };
    let rem = Math.min(dt, 1 / 24); const n = ph.active.length; const hmax = n > 2600 ? 1 / 45 : 1 / 90; const steps = Math.max(1, Math.ceil(rem / hmax)); for (let s = 0; s < steps; s++) { ph.step(rem / steps, env); this.drainImpacts(); }
    // ---- fires
    for (let k = this.fires.length - 1; k >= 0; k--) {
      const f = this.fires[k], i = f.i; f.life += dt; const x = ph.P[i * 3], y = ph.P[i * 3 + 1], z = ph.P[i * 3 + 2], ex = ph.E[i * 3], ey = ph.E[i * 3 + 1], ez = ph.E[i * 3 + 2]; ph.heat[i] = Math.min(1, ph.heat[i] + dt * 0.09); if (((this.frame | 0) & 15) === 0) this.bodyDirty = true;
      f.acc += dt * (16 + 14 * f.k); let m = 0; while (f.acc > 1 && m++ < 4) { f.acc -= 1; const sx = (Math.random() - 0.5) * 2.2, sz = (Math.random() - 0.5) * 2.2; const px = x + ex * sx, py = y + ey * (Math.random() * 1.6 - 0.4), pz = z + ez * sz; this.fx.spawn(2, px, py, pz, (Math.random() - 0.5) * 0.12, 0.1 + Math.random() * 0.16, (Math.random() - 0.5) * 0.12, 0.5 + Math.random() * 0.6, 0.045 + Math.random() * 0.05 * f.k); if (Math.random() < 0.42) this.fx.spawn(1, px, py + 0.08, pz, (Math.random() - 0.5) * 0.1, 0.18 + Math.random() * 0.12, (Math.random() - 0.5) * 0.1, 3 + Math.random() * 3, 0.06 + Math.random() * 0.05, 1); if (Math.random() < 0.35) this.fx.spawn(5, px, py, pz, (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.6, 0.0035); }
      f.sp -= dt; if (f.sp < 0) { f.sp = 2.5 + Math.random() * 5; for (let q = ph.bs[i]; q < ph.bs[i + 1]; q++) if (Math.random() < 0.3 && ph.cl[ph.bt[q]] === ANCHOR && ph.heat[ph.bt[q]] < 0.5) { this.ignite(ph.bt[q], f.k * 0.8); break; } }
      f.k -= dt * (0.008 + wx.rain * 0.012 + (f.hose || 0) * 0.5); f.hose = 0; const under = water[3] - (water[0] * x + water[1] * y + water[2] * z); if (under > 0 || f.k < 0.08 || ph.cl[i] === HELD) { for (let q = 0; q < 8; q++) this.fx.spawn(7, x, y, z, (Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3, 2.5, 0.08); this.fires.splice(k, 1); }
    }
    // ---- power grid
    let lost = 0, tot = 0; for (let k = 0; k < ph.bd.length; k++) { const o = ph.bd[k]; tot += o.b.count; lost += o.lost; const a = 1 - o.lost / o.b.count; this.alive[k] = a; o.b.alive = a; const want = a < 0.62 ? 0 : this.power > 0.5 || o.b.x * 1.3 + o.b.z * 0.7 + 9 < this.relight * 20 ? 1 : 0; o.b.power = damp(o.b.power, want * (S > 0.6 && Math.random() < 0.03 ? 0.2 : 1), 6, dt); }
    this.damage = lost / tot; this.disp = lost;
    const wantP = this.damage > 0.24 || (wx.flood > 0.3 && this.damage > 0.08) ? 0 : 1; if (this.phase !== 'rebuild') { if (!wantP && this.power > 0.5) { if (this.arc <= 0) this.arc = 3.2; this.snd && this.snd.powerDown(); } this.power = damp(this.power, wantP, 3, dt); this.relight = this.power > 0.5 ? 2 : 0; }
    // transformers and lines arcing as the grid dies; tossed cars burn
    this.arc -= dt; for (let k = this.pulses.length - 1; k >= 0; k--) { const p = this.pulses[k]; p[6] -= dt / p[8]; if (p[6] <= 0) this.pulses.splice(k, 1); }
    if ((this.arc > 0 && Math.random() < dt * 22) || (S > 0.7 && this.power > 0.5 && Math.random() < dt * 4)) { const l = w.lamps[(Math.random() * w.lamps.length) | 0], y = l.y + 0.12; this.fx.spawn(8, l.x, y, l.z, 0, 0, 0, 0.2, 0.22); this.fx.burst(3, 14, l.x, y, l.z, 0.7, 0.5, 0.9, 0.004); this.pulses.push([l.x, y, l.z, 2.2, 5, 4.6, 1, 0.9, 0.22]); }
    if (S > 0.55 && Math.random() < dt * 1.4) { const c = life.cars[(Math.random() * life.cars.length) | 0]; if (c.prop.st === 1 && c.prop.t > 0.4) this.explode(c.x, c.y + 0.02, c.z, 0.7); }
    this.director(dt, shake, tilt);
    this.syncProps();
    // keep statics cheap
    this.tree0 = (this.tree0 || 0) + 1; if (this.treeDirty || this.tree0 % 20 === 0) { this.placeStaticsPartial(); this.treeDirty = false; }
  }
  placeStaticsPartial() {
    for (const t of this.w.trees) if (t.prop.st === 0) { t.inst.setYaw(t.slot, t.x, t.y - 0.004, t.z, t.s * t.grow, t.ry); t.inst.C[t.slot * 4 + 3] = 0; }
    for (const l of this.w.lamps) if (l.prop.st === 0) { l.inst.setYaw(l.slot, l.x, l.y, l.z, l.grow, l.ry); l.inst.C[l.slot * 4 + 3] = l.on * this.power > 0.5 || l.x * 1.3 + l.z * 0.7 + 9 < this.relight * 20 ? 1 : -1; }
    for (const I of [...this.treeI, this.lampI]) I.flush(true);
  }
  drainImpacts() {
    const I = this.ph.impacts; const n = Math.min(I.length, 5 * 70);
    for (let k = 0; k < n; k += 5) {
      const x = I[k], y = I[k + 1], z = I[k + 2], e = I[k + 3], ty = I[k + 4];
      if (ty === 2) { for (let q = 0; q < 5 + e * 6; q++) this.fx.spawn(4, x, y + 0.02, z, (Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 0.6 * (0.5 + e), (Math.random() - 0.5) * 0.7, 0.7 + Math.random() * 0.8, 0.008 + Math.random() * 0.014); this.snd && this.snd.hit(x, y, z, e * 0.4, 1); continue; }
      const m = Math.min(5, 1 + e * 0.7) | 0; for (let q = 0; q < m; q++) this.fx.spawn(0, x, y, z, (Math.random() - 0.5) * 0.8, Math.random() * 0.35, (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 3, 0.04 + Math.min(0.12, e * 0.02) + Math.random() * 0.06);
      if (e > 2.2) { this.fx.burst(6, 3, x, y, z, 1, 0.5, 1.6, 0.007); if (Math.random() < 0.25) this.fx.burst(3, 4, x, y, z, 0.9, 0.4, 0.6, 0.004); }
      if (e > 3) this.snd && this.snd.hit(x, y, z, Math.min(1, e / 9), 0);
      this.dust = Math.min(1, this.dust + e * 0.0006);
    }
  }

  explode(x, y, z, k) {
    this.fx.spawn(8, x, y + 0.05, z, 0, 0.1, 0, 0.22, 0.42 * k); for (let q = 0; q < 22 * k; q++) this.fx.spawn(2, x, y, z, (Math.random() - 0.5) * 0.9 * k, Math.random() * 0.7 * k, (Math.random() - 0.5) * 0.9 * k, 0.5 + Math.random() * 0.8, 0.07 + Math.random() * 0.07); for (let q = 0; q < 16 * k; q++) this.fx.spawn(1, x, y, z, (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5, 3 + Math.random() * 3, 0.09 + Math.random() * 0.06, 1); this.fx.burst(3, 26, x, y, z, 1.3, 0.8, 1.1, 0.005); this.fx.burst(5, 16, x, y, z, 0.8, 0.6, 2, 0.004);
    this.pulses.push([x, y + 0.1, z, 9, 4.2, 1.2, 1, 1.3, 0.5]); this.snd && this.snd.collapse(x, y, z, 0.3 * k); const ph = this.ph; for (const c of ph.active) { const dx = ph.cp[c * 3] - x, dy = ph.cp[c * 3 + 1] - y, dz = ph.cp[c * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < 0.3) { const d = Math.sqrt(d2) + 0.05, i = (0.9 * k * (0.55 - d)) / d / Math.max(0.5, ph.cm[c]); ph.wake(c); ph.cv[c * 3] += dx * i; ph.cv[c * 3 + 1] += (dy + 0.2) * i; ph.cv[c * 3 + 2] += dz * i; } }
  }
  // ------------------------------------------------------------ recovery director
  director(dt, shake, tilt) {
    const wx = this.wx, ph = this.ph; const quiet = shake < 0.35 && tilt < 0.3 && wx.S < 0.6 && !wx.storming && !wx.tActive && wx.flood < 0.07 && wx.slosh() < 0.5;
    const looseProps = this.props.reduce((a, p) => a + (p.st !== 0 ? 1 : 0), 0); this.stat.loose = looseProps;
    const need = this.disp > 0 || looseProps > 0 || this.fires.length > 0;
    if (!quiet) { if (this.phase === 'rebuild') this.abort(); this.phase = need ? 'disaster' : 'calm'; this.calmT = 0; this.life.fleetOn = false; for (const p of this.life.crew) p.show = 0; return; }
    if (!need && this.phase !== 'rebuild') { this.phase = 'calm'; this.life.fleetOn = false; this.relight = 2; return; }
    this.calmT += dt;
    if (this.phase !== 'rebuild') { this.phase = 'aftermath'; this.life.fleetOn = true; if (this.calmT > 2.6) this.startRebuild(); this.recover(dt); return; }
    this.recover(dt); this.rebuild(dt);
  }
  startRebuild() {
    this.phase = 'rebuild'; this.rebuildT = 0; this.relight = this.power > 0.5 ? 2 : 0; this.queue = []; this.sites = []; this.flying = [];
    const ph = this.ph; ph.bd.forEach((o, k) => { if (o.lost > 0) this.queue.push(o); }); this.queue.sort((a, b) => a.b.x * 1.3 + a.b.z * 0.7 - (b.b.x * 1.3 + b.b.z * 0.7)); this.total = this.disp || 1;
    this.snd && this.snd.rebuildStart();
  }
  abort() { const ph = this.ph; for (const f of this.flying || []) { ph.cl[f.i] = KIN; ph.release(f.i, 0, 0, 0); } this.flying = []; this.sites = []; this.queue = []; this.cables.length = 0; }
  rebuild(dt) {
    const ph = this.ph, C = this.w.C; this.rebuildT += dt; this.cables.length = 0; const MAXS = 34;
    while (this.sites.length < MAXS && this.queue.length) {
      const o = this.queue.shift(); const list = []; for (let i = o.b.first; i < o.b.first + o.b.count; i++) if (ph.cl[i] !== ANCHOR) list.push(i); if (!list.length) continue; list.sort((a, b) => C[a].layer - C[b].layer);
      const s = { o, x: o.b.x, z: o.b.z, list, next: 0, air: 0, done: 0, rise: 0, wait: Math.random() * 0.5, h: o.b.H + 0.55, yaw: Math.random() * 6.28, cx: o.b.x + (o.b.w / 2 + 0.06) * (Math.random() < 0.5 ? 1 : -1), cz: o.b.z + (o.b.d / 2 + 0.06) * (Math.random() < 0.5 ? 1 : -1), tall: o.b.H > 0.55, tgt: 0 };
      this.sites.push(s);
    }
    const crew = this.life.crew; let ci = 0;
    for (let k = this.sites.length - 1; k >= 0; k--) {
      const s = this.sites[k], fin = s.done >= s.list.length; s.rise = damp(s.rise, fin ? 0 : 1, fin ? 2.2 : 1.8, dt); if (fin && s.rise < 0.02) { ph.refreshStruct(s.o); for (let l = 0; l < s.o.n; l++) s.o.K[l] = Math.max(1e-6, (s.o.mh[l] + 1e-3) / Math.max(1e-6, s.o.cap[l])) * s.o.weak[l]; this.sites.splice(k, 1); continue; }
      s.wait -= dt; const par = s.list.length > 60 ? 5 : s.list.length > 20 ? 3 : 2;
      if (s.rise > 0.7 && s.wait < 0 && s.air < par && s.next < s.list.length) {
        const i = s.list[s.next]; const lay = C[i].layer; const blocked = this.flying.some((f) => f.s === s && C[f.i].layer < lay);
        if (!blocked) { s.next++; s.air++; s.wait = 0.1; if (ph.cl[i] >= 0) ph.take(i); ph.cl[i] = HELD; const d = Math.hypot(ph.P[i * 3] - ph.HP[i * 3], ph.P[i * 3 + 2] - ph.HP[i * 3 + 2]); this.flying.push({ i, s, t: 0, T: clamp(0.7 + d * 0.22, 0.8, 2.0), x: ph.P[i * 3], y: ph.P[i * 3 + 1], z: ph.P[i * 3 + 2], q: [ph.Q[i * 4], ph.Q[i * 4 + 1], ph.Q[i * 4 + 2], ph.Q[i * 4 + 3]] }); }
      }
      // crews on foot around the plot
      for (let q = 0; q < 3 && ci < crew.length; q++) { const p = crew[ci++]; if (p.state !== 0) continue; const a = s.yaw * 0 + q * 2.1 + s.x * 3, r = Math.max(s.o.b.w, s.o.b.d) / 2 + 0.07; p.x = s.x + Math.cos(a) * r; p.z = s.z + Math.sin(a) * r; p.yaw = Math.atan2(s.x - p.x, s.z - p.z); p.show = fin ? 0 : 1; p.mode = 7; }
      if (!fin && Math.random() < dt * 5) { const i = s.list[Math.max(0, s.next - 1)]; this.fx.burst(3, 5, ph.HP[i * 3] + ph.E[i * 3], ph.HP[i * 3 + 1], ph.HP[i * 3 + 2] + ph.E[i * 3 + 2], 0.3, 0.1, 0.7, 0.003); this.weld = [ph.HP[i * 3], ph.HP[i * 3 + 1], ph.HP[i * 3 + 2]]; }
    }
    for (; ci < crew.length; ci++) crew[ci].show = 0;
    for (let k = this.flying.length - 1; k >= 0; k--) {
      const f = this.flying[k], i = f.i; f.t += dt / f.T; const t = ease(Math.min(1, f.t)), hx = ph.HP[i * 3], hy = ph.HP[i * 3 + 1], hz = ph.HP[i * 3 + 2], top = Math.max(f.y, hy) + 0.32, u = smooth(0, 1, t), rise = smooth(0, 0.35, t), low = smooth(0.6, 1, t);
      const x = lerp(f.x, hx, smooth(0.18, 0.78, t)), z = lerp(f.z, hz, smooth(0.18, 0.78, t)), y = lerp(lerp(f.y, top, rise), hy, low); ph.P[i * 3] = x; ph.P[i * 3 + 1] = y; ph.P[i * 3 + 2] = z; const q = f.q, h = ph.HQ.subarray(i * 4, i * 4 + 4), sg = q[3] * h[3] < 0 ? -1 : 1; let a = lerp(q[0], 0, u), b = lerp(q[1], 0, u), c = lerp(q[2], 0, u), d = lerp(q[3], sg, u); const l = Math.hypot(a, b, c, d) || 1; ph.Q[i * 4] = a / l; ph.Q[i * 4 + 1] = b / l; ph.Q[i * 4 + 2] = c / l; ph.Q[i * 4 + 3] = d / l; ph.heat[i] = Math.max(0, ph.heat[i] - dt * 0.5); ph.moved = true;
      const s = f.s; if (s.tall) { const tipY = LAND + s.h * s.rise, L = Math.min(0.8, Math.hypot(x - s.cx, z - s.cz)), an = Math.atan2(z - s.cz, x - s.cx); s.tgt = an; this.cables.push([s.cx + Math.cos(an) * L, tipY, s.cz + Math.sin(an) * L, x, y + ph.E[i * 3 + 1], z]); }
      if (f.t >= 1) { ph.restore(i); s.done++; s.air--; this.flying.splice(k, 1); this.fx.burst(0, 2, hx, hy - ph.E[i * 3 + 1], hz, 0.2, 0.05, 1, 0.03); this.snd && Math.random() < 0.2 && this.snd.hit(hx, hy, hz, 0.16, 2); }
    }
    for (const s of this.sites) { let d = s.tgt - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); s.yaw += d * Math.min(1, dt * 4); }
    if (this.damage < 0.2 || this.rebuildT > 20) { this.relight = Math.min(2, (this.relight || 0) + dt * 0.11); if (this.relight > 1.1 && this.power < 0.5) { this.power = 1; this.snd && this.snd.powerUp(); } }
    if (!this.sites.length && !this.queue.length && !this.flying.length) { const loose = this.props.some((p) => p.st !== 0); let l = 0; for (const o of ph.bd) l += o.lost; if (l > 0) { for (const o of ph.bd) if (o.lost > 0) this.queue.push(o); } else if (!loose) { this.phase = 'calm'; this.power = 1; this.relight = 2; this.life.fleetOn = false; for (const p of crew) p.show = 0; } }
    // hoses
    let h = 0; for (const c of this.life.fleet) { if (c.type !== 5 || c.state !== 0 || c.show < 0.5) continue; let best = null, bd = 2.4; for (const f of this.fires) { const d = Math.hypot(ph.P[f.i * 3] - c.x, ph.P[f.i * 3 + 2] - c.z); if (d < bd) { bd = d; best = f; } } if (best && h++ < 10) { best.hose = 1; const x = ph.P[best.i * 3], y = ph.P[best.i * 3 + 1], z = ph.P[best.i * 3 + 2], T = 0.9; for (let q = 0; q < 2; q++) this.fx.spawn(4, c.x, c.y + 0.05, c.z, ((x - c.x) / T) * 1.35 + (Math.random() - 0.5) * 0.1, ((y - c.y) / T) * 1.2 + 0.55 * T + (Math.random() - 0.5) * 0.1, ((z - c.z) / T) * 1.35 + (Math.random() - 0.5) * 0.1, T * 1.1, 0.01); } }
  }
  // props find their way home
  recover(dt) {
    const ph = this.ph, w = this.w, life = this.life; let budget = 14;
    for (const p of this.props) {
      const r = p.ref;
      if (p.st === 1 && budget > 0 && this.calmT > 1.2 && Math.random() < 0.06) {
        budget--; const i = p.part; p.x = ph.P[i * 3]; p.y = ph.P[i * 3 + 1]; p.z = ph.P[i * 3 + 2]; p.q = [ph.Q[i * 4], ph.Q[i * 4 + 1], ph.Q[i * 4 + 2], ph.Q[i * 4 + 3]]; ph.take(i); ph.cl[i] = KIN; p.st = 2; p.u = 0; p.from = [p.x, p.y, p.z, ...p.q]; p.to = this.home(p); p.T = p.kind === T_PED ? 1.2 : 1.8; p.mode = 0;
        const far = Math.hypot(p.to[0] - p.x, p.to[2] - p.z) > 0.9 || p.y < SEA - 0.1 || p.y > LAND + 0.8; if ((far && p.kind !== T_BOAT) || p.kind === T_TREE) p.mode = 1; // replaced rather than carried
      } else if (p.st === 2) {
        p.u += dt / p.T; const t = Math.min(1, p.u);
        if (p.mode === 1) { if (t < 0.45) { p.s = 1 - ease(t / 0.45); } else { p.x = p.to[0]; p.y = p.to[1]; p.z = p.to[2]; p.q = [0, Math.sin(p.to[3] / 2), 0, Math.cos(p.to[3] / 2)]; p.s = ease((t - 0.45) / 0.55); } }
        else { const e = ease(t), f = p.from; p.x = lerp(f[0], p.to[0], e); p.z = lerp(f[2], p.to[2], e); p.y = lerp(f[1], p.to[1], e) + Math.sin(e * Math.PI) * (p.kind === T_PED ? 0.0 : p.kind === T_BOAT ? 0.5 : 0.1); const q2 = [0, Math.sin(p.to[3] / 2), 0, Math.cos(p.to[3] / 2)], sg = f[3] * q2[0] + f[4] * q2[1] + f[5] * q2[2] + f[6] * q2[3] < 0 ? -1 : 1, q = [0, 1, 2, 3].map((k) => lerp(f[3 + k], q2[k] * sg, e)), l = Math.hypot(...q) || 1; p.q = q.map((v) => v / l); p.s = 1; if (p.kind === T_BOAT && p.q) r.yaw = p.to[3]; }
        if (t >= 1) { p.st = 0; r.state = 0; p.t = 0; p.s = 1; if (p.kind === T_TREE) { r.grow = 1; } if (p.kind === T_LAMP) r.on = 1; if (p.kind === T_CAR) this.rejoin(r); if (p.kind === T_PED) { r.yawC = undefined; if (r.home0) { r.x = r.home0[0]; r.y = r.home0[1]; r.z = r.home0[2]; } } if (p.kind === T_SHARK) { r.street = 0; } this.treeDirty = true; }
      }
    }
  }
  home(p) {
    const r = p.ref, w = this.w, life = this.life;
    if (p.kind === T_TREE) { p.mode = 1; return [r.x, r.y - 0.004 + p.oy, r.z, r.ry]; }
    if (p.kind === T_LAMP) return [r.x, r.y + p.oy, r.z, r.ry];
    if (p.kind === T_CAR) {
      if (r.kind === 0) { if (r.e) { r.turn = null; let best = r.e, bs = 1e9; for (let k = 0; k < 24; k++) { const e = life.edges[(Math.random() * life.edges.length) | 0]; const d = Math.hypot(e.i + e.dx * 0.5 - p.x, e.j + e.dz * 0.5 - p.z) + e.cars.length; if (d < bs) { bs = d; best = e; } } r.e = best; r.s = 0.25 + Math.random() * 0.5; const ox = r.x, oz = r.z; life.placeGrid(r); const out = [r.x, r.y + p.oy, r.z, r.yaw]; r.x = ox; r.z = oz; return out; } }
      if (r.kind === 1) { const o = {}; life.hwyAt(r.u, r.dir, r.lane, o); return [o.x, LAND + p.oy, o.z, o.yaw]; }
      if (r.kind === 2) { const b = w.props.bridge, u = r.dir > 0 ? r.u : 1 - r.u, x = lerp(b.x0, b.x1, u); return [x, b.deckY(x) + p.oy, b.z + r.dir * 0.055, r.dir > 0 ? 0 : Math.PI]; }
      return [life.sus.x, LAND + p.oy, life.sus.z, life.sus.yaw];
    }
    if (p.kind === T_PED) {
      if (r.kind === 0) { const b = r.b; const e = Math.floor(r.s), f = r.s - e, o = r.off, q = (f - 0.5) * 2 * o; const x = e === 0 ? b.cx + q : e === 1 ? b.cx + o : e === 2 ? b.cx - q : b.cx - o, z = e === 0 ? b.cz - o : e === 1 ? b.cz + q : e === 2 ? b.cz + o : b.cz - q; return [x, LAND + p.oy, z, r.yaw]; }
      if (!r.hm) r.hm = r.home0 || [r.x, r.y, r.z];
      const h = r.home0 || r.hm; return [h[0], h[1] + p.oy, h[2], r.yaw];
    }
    if (p.kind === T_BOAT) { const st = r.state; r.state = 0; const sx = r.x, sy = r.y, sz = r.z, q = r.q.slice(); life.updBoatOne && life.updBoatOne(r); const a = r.u * 6.28318; let out; if (r.path === 'lag') out = [Math.cos(a) * r.rx, SEA + 0.02, 3.95 + Math.sin(a) * r.rz, r.yaw]; else if (r.path === 'dock') out = [r.x0, SEA + 0.02, r.z0, -Math.PI / 2]; else { const v = r.u > 0.5 ? 1 - (r.u - 0.5) * 2 : r.u * 2, an = 1.08 + 5.64 * v, rad = 8.2 + (r.u > 0.5 ? 0.42 : -0.34); out = [Math.cos(an) * rad, SEA + 0.02, Math.sin(an) * rad, r.yaw]; } r.state = st; r.x = sx; r.y = sy; r.z = sz; r.q = q; return out; }
    return [Math.cos(r.a) * r.r, SEA - r.d, Math.sin(r.a) * r.r, r.yaw];
  }
  rejoin(c) { if (c.kind === 0 && c.e) { c.turn = null; c.v = 0; if (!c.e.cars.includes(c)) c.e.cars.push(c); } }
}
