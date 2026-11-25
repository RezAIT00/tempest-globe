// Bonded-chunk destruction: buildings are lattices of chunks joined by breakable bonds.
// Connected groups of broken-off chunks become rigid clusters with full inertia.
import { HN, HS, RI } from './world.js';

const CELL = 0.36, GD = 56, GO = 10.08;
export const ANCHOR = -1, KIN = -2, HELD = -3;

export class Phys {
  constructor(world, nProps) {
    const C = world.C, NC = C.length, N = NC + nProps;
    this.world = world; this.NC = NC; this.N = N; this.np = NC;
    const f = (n) => new Float32Array(n);
    this.P = f(N * 3); this.Q = f(N * 4); this.HP = f(N * 3); this.HQ = f(N * 4);
    this.E = f(N * 3); this.rad = f(N); this.mass = f(N); this.drag = f(N); this.buoy = f(N);
    this.cl = new Int32Array(N).fill(KIN); this.off = f(N * 3); this.oq = f(N * 4);
    this.found = f(N); this.type = new Uint8Array(N); this.touch = f(N); this.heat = f(N);
    this.H = world.H; this.D = world.D;
    // bonds in CSR form
    this.bs = new Int32Array(N + 1);
    let nb = 0; for (let i = 0; i < NC; i++) { this.bs[i] = nb; nb += world.bonds[i].length; }
    for (let i = NC; i <= N; i++) this.bs[i] = nb;
    this.bt = new Int32Array(nb); this.bh = f(nb); this.bv = new Uint8Array(nb); this.ba = f(nb); this.br = new Int32Array(nb);
    { let k = 0; const map = new Map();
      for (let i = 0; i < NC; i++) for (const [j, v, a] of world.bonds[i]) { this.bt[k] = j; this.bh[k] = 1; this.bv[k] = v; this.ba[k] = a; map.set(i * 65536 + j, k); k++; }
      for (let i = 0; i < NC; i++) for (let q = this.bs[i]; q < this.bs[i + 1]; q++) this.br[q] = map.get(this.bt[q] * 65536 + i); }
    for (let i = 0; i < NC; i++) {
      const c = C[i];
      this.P.set([c.x, c.y, c.z], i * 3); this.HP.set([c.x, c.y, c.z], i * 3); this.Q[i * 4 + 3] = 1; this.HQ[i * 4 + 3] = 1;
      this.E.set([c.hx, c.hy, c.hz], i * 3);
      this.rad[i] = Math.min(0.17, Math.cbrt(c.hx * c.hy * c.hz) * 1.04);
      this.mass[i] = Math.max(0.12, c.hx * c.hy * c.hz * 800); this.drag[i] = c.kind >= 10 ? 0.42 : 0.1; this.buoy[i] = 0.35;
      this.cl[i] = ANCHOR; this.found[i] = c.layer === 0 ? 1 : 0;
    }
    // cluster pool
    const M = N; this.M = M;
    this.cp = f(M * 3); this.cq = f(M * 4); this.cv = f(M * 3); this.cw = f(M * 3); this.cm = f(M); this.ci = f(M * 6); this.cs = f(M); this.cn = new Int32Array(M);
    this.cst = new Uint8Array(M); this.csl = f(M); this.cdrag = f(M); this.cb = f(M); this.cdirty = new Uint8Array(M); this.cr = f(M); this.cgr = new Uint8Array(M);
    this.mem = new Array(M).fill(null); this.free = []; for (let i = M - 1; i >= 0; i--) this.free.push(i);
    this.active = []; this.dirtyList = [];
    // grids
    this.sHead = new Int32Array(GD * GD * GD).fill(-1); this.sItems = []; this.buildStatic();
    this.dHead = new Int32Array(GD * GD * GD).fill(-1); this.dNext = new Int32Array(N); this.dCell = new Int32Array(N); this.dN = 0; this.dList = new Int32Array(N);
    this.moved = true; this.awake = 0; this.impacts = []; this.mark = new Int32Array(N); this.markN = 0; this.stack = new Int32Array(N);
    // per building structural data
    const B = world.B; this.bd = B.map((b) => this.initStruct(b));
    this.tmp = f(3);
    this.onDetach = null; this.kinDirty = true;
  }

  addProp(type, hx, hy, hz, mass, drag, buoy) {
    const i = this.np++;
    this.E.set([hx, hy, hz], i * 3); this.rad[i] = Math.min(0.16, Math.max(0.012, Math.cbrt(hx * hy * hz) * 1.05)); this.mass[i] = mass; this.drag[i] = drag; this.buoy[i] = buoy; this.type[i] = type; this.Q[i * 4 + 3] = 1;
    return i;
  }

  initStruct(b) {
    const C = this.world.C, n = b.layers, o = { b, A: 2.7 + Math.random() * 4.4, U: 0.55 + Math.random() * 0.9, weak: [], base: null, n, dirty: true, cap: new Float32Array(n), ma: new Float32Array(n), mh: new Float32Array(n), y: new Float32Array(n), K: new Float32Array(n), lost: 0, alive: b.count, fatigue: 0 };
    if (b.club >= 0) { o.A = 3.4; }
    if (b.layers <= 2) o.A += 1.6;
    for (let i = b.first; i < b.first + b.count; i++) o.y[C[i].layer] = C[i].y - C[i].hy;
    for (let l = 0; l < n; l++) o.weak.push(0.8 + Math.random() * 0.6);
    this.refreshStruct(o);
    for (let l = 0; l < n; l++) o.K[l] = Math.max(1e-6, (o.mh[l] + 1e-3) / Math.max(1e-6, o.cap[l])) * o.weak[l];
    return o;
  }
  refreshStruct(o) {
    const C = this.world.C, b = o.b; o.cap.fill(0); o.ma.fill(0); o.mh.fill(0);
    let alive = 0;
    for (let i = b.first; i < b.first + b.count; i++) {
      if (this.cl[i] !== ANCHOR) continue;
      alive++;
      const L = C[i].layer;
      if (L === 0) { o.cap[0] += this.found[i] * C[i].hx * C[i].hz * 4; }
      for (let q = this.bs[i]; q < this.bs[i + 1]; q++) { const j = this.bt[q]; if (this.bh[q] > 0 && C[j].layer < L && this.cl[j] === ANCHOR) o.cap[L] += this.bh[q] * this.ba[q]; }
      for (let l = 0; l <= L; l++) { o.ma[l] += this.mass[i]; o.mh[l] += this.mass[i] * (C[i].y - o.y[l]); }
    }
    o.alive = alive; o.lost = b.count - alive; o.dirty = false;
  }

  buildStatic() {
    const cells = new Map();
    for (let i = 0; i < this.NC; i++) {
      const x0 = this.ix(this.HP[i * 3] - this.E[i * 3]), x1 = this.ix(this.HP[i * 3] + this.E[i * 3]), y0 = this.ix(this.HP[i * 3 + 1] - this.E[i * 3 + 1]), y1 = this.ix(this.HP[i * 3 + 1] + this.E[i * 3 + 1]), z0 = this.ix(this.HP[i * 3 + 2] - this.E[i * 3 + 2]), z1 = this.ix(this.HP[i * 3 + 2] + this.E[i * 3 + 2]);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const k = (y * GD + z) * GD + x; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); }
    }
    for (const [k, v] of cells) { this.sHead[k] = this.sItems.length; this.sItems.push(Int32Array.from(v)); }
  }
  ix(v) { const k = ((v + GO) / CELL) | 0; return k < 0 ? 0 : k >= GD ? GD - 1 : k; }
  height(x, z) {
    let fx = (x / HS + 0.5) * HN - 0.5, fz = (z / HS + 0.5) * HN - 0.5;
    if (fx < 0) fx = 0; if (fz < 0) fz = 0; if (fx > HN - 1.01) fx = HN - 1.01; if (fz > HN - 1.01) fz = HN - 1.01;
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * HN + i, H = this.H;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + HN] * (1 - u) + H[k + HN + 1] * u) * v;
  }

  // ---- clusters
  makeCluster(list, vx, vy, vz, wx, wy, wz) {
    if (!this.free.length) return -1;
    const c = this.free.pop(), P = this.P, E = this.E;
    let m = 0, x = 0, y = 0, z = 0, dr = 0, bu = 0;
    for (const i of list) { const k = this.mass[i]; m += k; x += P[i * 3] * k; y += P[i * 3 + 1] * k; z += P[i * 3 + 2] * k; dr += this.drag[i] * k; bu += this.buoy[i] * k; }
    x /= m; y /= m; z /= m;
    let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0, rr = 0;
    for (const i of list) {
      const k = this.mass[i], dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z, ex = E[i * 3], ey = E[i * 3 + 1], ez = E[i * 3 + 2];
      xx += k * (dy * dy + dz * dz + (ey * ey + ez * ez) / 3); yy += k * (dx * dx + dz * dz + (ex * ex + ez * ez) / 3); zz += k * (dx * dx + dy * dy + (ex * ex + ey * ey) / 3);
      xy -= k * dx * dy; xz -= k * dx * dz; yz -= k * dy * dz;
      rr = Math.max(rr, Math.hypot(dx, dy, dz) + this.rad[i]);
      this.off[i * 3] = dx; this.off[i * 3 + 1] = dy; this.off[i * 3 + 2] = dz;
      this.oq[i * 4] = this.Q[i * 4]; this.oq[i * 4 + 1] = this.Q[i * 4 + 1]; this.oq[i * 4 + 2] = this.Q[i * 4 + 2]; this.oq[i * 4 + 3] = this.Q[i * 4 + 3];
      this.cl[i] = c;
    }
    this.cp[c * 3] = x; this.cp[c * 3 + 1] = y; this.cp[c * 3 + 2] = z;
    this.cq[c * 4] = this.cq[c * 4 + 1] = this.cq[c * 4 + 2] = 0; this.cq[c * 4 + 3] = 1;
    this.cv[c * 3] = vx; this.cv[c * 3 + 1] = vy; this.cv[c * 3 + 2] = vz; this.cw[c * 3] = wx; this.cw[c * 3 + 1] = wy; this.cw[c * 3 + 2] = wz;
    this.cm[c] = m; this.cn[c] = list.length; this.cdrag[c] = dr / m; this.cb[c] = bu / m; this.cr[c] = rr; this.cgr[c] = 0;
    const tr = (xx + yy + zz) / 3; this.cs[c] = 1 / Math.max(1e-6, tr);
    const a = yy * zz - yz * yz, b2 = xz * yz - xy * zz, d = xy * yz - xz * yy, det = xx * a + xy * b2 + xz * d || 1e-9, id = 1 / det, I = this.ci, o = c * 6;
    I[o] = a * id; I[o + 1] = b2 * id; I[o + 2] = d * id; I[o + 3] = (xx * zz - xz * xz) * id; I[o + 4] = (xy * xz - xx * yz) * id; I[o + 5] = (xx * yy - xy * xy) * id;
    this.mem[c] = list; this.cst[c] = 1; this.csl[c] = 0; this.cdirty[c] = 0;
    this.active.push(c);
    return c;
  }
  killCluster(c) { this.cst[c] = 0; this.mem[c] = null; this.cdirty[c] = 0; this.free.push(c); const k = this.active.indexOf(c); if (k >= 0) { this.active[k] = this.active[this.active.length - 1]; this.active.pop(); } }
  release(i, vx, vy, vz, wx = 0, wy = 0, wz = 0) { if (this.cl[i] >= 0) return this.cl[i]; return this.makeCluster([i], vx, vy, vz, wx, wy, wz); }
  // pull one part out of whatever cluster it is in
  take(i) {
    const c = this.cl[i];
    if (c >= 0) {
      const l = this.mem[c];
      if (l.length === 1) this.killCluster(c);
      else { const v = [this.cv[c * 3], this.cv[c * 3 + 1], this.cv[c * 3 + 2]], rest = l.filter((q) => q !== i); this.killCluster(c); this.cl[i] = HELD; this.makeCluster(rest, ...v, 0, 0, 0); for (let q = this.bs[i]; q < this.bs[i + 1]; q++) { this.bh[q] = 0; this.bh[this.br[q]] = 0; } if (this.cl[rest[0]] >= 0) this.markDirty(this.cl[rest[0]]); }
    }
    this.cl[i] = HELD;
  }
  wake(c) { if (this.cst[c] === 2) { this.cst[c] = 1; this.csl[c] = 0; } }
  wakeAll() { for (const c of this.active) this.wake(c); }
  markDirty(c) { if (!this.cdirty[c]) { this.cdirty[c] = 1; this.dirtyList.push(c); } }

  hurt(i, amt) {
    const c = this.cl[i];
    let broke = false;
    for (let q = this.bs[i]; q < this.bs[i + 1]; q++) {
      if (this.bh[q] <= 0) continue;
      const h = this.bh[q] - amt * (0.4 + Math.random());
      this.bh[q] = h; this.bh[this.br[q]] = h; if (h <= 0) broke = true;
    }
    if (this.found[i] > 0) { this.found[i] -= amt * (0.2 + Math.random() * 0.6); if (this.found[i] <= 0) broke = true; }
    if (broke) { if (c >= 0) this.markDirty(c); else if (c === ANCHOR && i < this.NC) { const o = this.bd[this.world.C[i].b]; if (!o.dirty) o.dirty = true; } }
    return broke;
  }

  components(list, test) {
    const out = [], m = ++this.markN, st = this.stack;
    for (const s of list) {
      if (this.mark[s] === m) continue;
      const comp = []; let n = 0; st[n++] = s; this.mark[s] = m;
      while (n) { const i = st[--n]; comp.push(i); for (let q = this.bs[i]; q < this.bs[i + 1]; q++) { const j = this.bt[q]; if (this.bh[q] > 0 && this.mark[j] !== m && test(j)) { this.mark[j] = m; st[n++] = j; } } }
      out.push(comp);
    }
    return out;
  }
  splitDirty() {
    const list = this.dirtyList; this.dirtyList = [];
    for (const c of list) {
      if (!this.cst[c] || !this.cdirty[c]) continue;
      this.cdirty[c] = 0;
      const l = this.mem[c]; if (l.length < 2) continue;
      const comps = this.components(l, (j) => this.cl[j] === c);
      if (comps.length < 2) continue;
      const p = [this.cp[c * 3], this.cp[c * 3 + 1], this.cp[c * 3 + 2]], v = [this.cv[c * 3], this.cv[c * 3 + 1], this.cv[c * 3 + 2]], w = [this.cw[c * 3], this.cw[c * 3 + 1], this.cw[c * 3 + 2]];
      this.killCluster(c);
      for (const comp of comps) {
        let x = 0, y = 0, z = 0; for (const i of comp) { x += this.P[i * 3]; y += this.P[i * 3 + 1]; z += this.P[i * 3 + 2]; }
        x = x / comp.length - p[0]; y = y / comp.length - p[1]; z = z / comp.length - p[2];
        this.makeCluster(comp, v[0] + w[1] * z - w[2] * y, v[1] + w[2] * x - w[0] * z, v[2] + w[0] * y - w[1] * x, w[0] * (0.7 + Math.random() * 0.6), w[1] * (0.7 + Math.random() * 0.6), w[2] * (0.7 + Math.random() * 0.6));
      }
    }
  }
  detachLoose(o) {
    const b = o.b, m = ++this.markN, st = this.stack; let n = 0;
    for (let i = b.first; i < b.first + b.count; i++) if (this.cl[i] === ANCHOR && this.found[i] > 0) { this.mark[i] = m; st[n++] = i; }
    while (n) { const i = st[--n]; for (let q = this.bs[i]; q < this.bs[i + 1]; q++) { const j = this.bt[q]; if (this.bh[q] > 0 && this.mark[j] !== m && this.cl[j] === ANCHOR) { this.mark[j] = m; st[n++] = j; } } }
    const loose = [];
    for (let i = b.first; i < b.first + b.count; i++) if (this.cl[i] === ANCHOR && this.mark[i] !== m) loose.push(i);
    if (loose.length) {
      const set = new Set(loose);
      const comps = this.components(loose, (j) => set.has(j));
      for (const comp of comps) {
        const c = this.makeCluster(comp, (Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.12);
        if (c >= 0 && this.onDetach) this.onDetach(b, comp, c);
      }
      this.moved = true;
    }
    this.refreshStruct(o);
  }
  // progressive structural failure from inertial and wind loads
  structural(dt, ax, ay, az, windAt, storm) {
    const lat = Math.hypot(ax, az), w = this.tmp;
    for (const o of this.bd) {
      if (!o.alive) continue;
      let wl = 0;
      if (storm > 0.25) { windAt(o.b.x, -1.72 + o.b.H * 0.6, o.b.z, w); const s2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2]; wl = s2 * 0.035; }
      const a = lat + wl;
      const up = Math.max(0, ay);
      if (o.dirty) this.detachLoose(o);
      if (a < o.A * 0.6 && up < 0.25) continue;
      const C = this.world.C;
      for (let l = 0; l < o.n; l++) {
        if (o.ma[l] <= 0) continue;
        const r = o.cap[l] > 1e-6 ? (o.mh[l] + 1e-3) / o.cap[l] / o.K[l] : 9;
        const stress = Math.max((a * r) / o.A, (up / o.U) * (0.5 + 0.5 * r) * (o.weak[l] < 0.95 || l === 0 ? 1 : 0.6));
        if (stress <= 1) continue;
        const dmg = Math.min(2.4, (stress - 1) * 1.5 + 0.2) * dt;
        for (let i = o.b.first; i < o.b.first + o.b.count; i++) {
          if (C[i].layer !== l || this.cl[i] !== ANCHOR) continue;
          if (l === 0) { this.found[i] -= dmg * Math.random() * 2; if (this.found[i] <= 0) o.dirty = true; }
          for (let q = this.bs[i]; q < this.bs[i + 1]; q++) if (this.bh[q] > 0) { const j = this.bt[q], vert = C[j].layer !== l; const h = this.bh[q] - dmg * Math.random() * (vert ? 2.2 : 0.5); this.bh[q] = h; this.bh[this.br[q]] = h; if (h <= 0) o.dirty = true; }
        }
      }
      if (o.dirty) this.detachLoose(o);
    }
  }

  // ---- simulation
  step(dt, env) {
    const { cp, cq, cv, cw, cm, cs, ci, P, Q, E, rad, cl } = this;
    this.impacts.length = 0;
    let awake = 0;
    const g = env.g, gm = Math.hypot(g[0], g[1], g[2]), w = this.tmp;
    const wn = env.water, linDamp = Math.exp(-dt * 0.05), angDamp = Math.exp(-dt * 0.35);
    for (let a = 0; a < this.active.length; a++) {
      const c = this.active[a];
      if (this.cst[c] !== 1) continue;
      awake++;
      const c3 = c * 3, c4 = c * 4;
      let vx = cv[c3], vy = cv[c3 + 1], vz = cv[c3 + 2];
      vx += g[0] * dt; vy += g[1] * dt; vz += g[2] * dt;
      const x = cp[c3], y = cp[c3 + 1], z = cp[c3 + 2];
      env.windAt(x, y, z, w);
      const dx = w[0] - vx, dy = w[1] - vy, dz = w[2] - vz, sp = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const under = wn[3] - (wn[0] * x + wn[1] * y + wn[2] * z);
      if (under > 0) {
        const k = Math.min(1, under / 0.08), b = this.cb[c] * k * gm, dr = Math.exp(-dt * 3.2 * k);
        vx += wn[0] * b * dt; vy += wn[1] * b * dt; vz += wn[2] * b * dt;
        vx = env.flow[0] + (vx - env.flow[0]) * dr; vy *= dr; vz = env.flow[2] + (vz - env.flow[2]) * dr;
        cw[c3] *= dr; cw[c3 + 1] *= dr; cw[c3 + 2] *= dr;
        if (under < 0.06 && !this.cgr[c] && sp > 0 && vx * vx + vy * vy + vz * vz > 0.05) { this.cgr[c] = 1; this.impacts.push(x, y, z, Math.min(3, cm[c]) * 0.4, 2); }
      } else {
        this.cgr[c] = 0;
        const k = this.cdrag[c] * Math.min(sp, 7) * dt / (1 + this.cn[c] * 0.12);
        const kk = k > 0.6 ? 0.6 : k;
        vx += dx * kk; vy += dy * kk; vz += dz * kk;
        if (env.storm > 0.2 && sp > 1.2) { const t = kk * 1.6; cw[c3] += (Math.random() - 0.5) * t * sp; cw[c3 + 1] += (Math.random() - 0.5) * t * sp; cw[c3 + 2] += (Math.random() - 0.5) * t * sp; }
      }
      vx *= linDamp; vy *= linDamp; vz *= linDamp;
      const s2 = vx * vx + vy * vy + vz * vz; if (s2 > 100) { const k = 10 / Math.sqrt(s2); vx *= k; vy *= k; vz *= k; }
      let wx = cw[c3] * angDamp, wy = cw[c3 + 1] * angDamp, wz = cw[c3 + 2] * angDamp;
      const wm = wx * wx + wy * wy + wz * wz, wmax = this.cn[c] > 4 ? 5 : 22; if (wm > wmax * wmax) { const k = wmax / Math.sqrt(wm); wx *= k; wy *= k; wz *= k; }
      cv[c3] = vx; cv[c3 + 1] = vy; cv[c3 + 2] = vz; cw[c3] = wx; cw[c3 + 1] = wy; cw[c3 + 2] = wz;
      cp[c3] += vx * dt; cp[c3 + 1] += vy * dt; cp[c3 + 2] += vz * dt;
      let qx = cq[c4], qy = cq[c4 + 1], qz = cq[c4 + 2], qw = cq[c4 + 3]; const h = dt * 0.5;
      const nx = qx + h * (wx * qw + wy * qz - wz * qy), ny = qy + h * (wy * qw + wz * qx - wx * qz), nz = qz + h * (wz * qw + wx * qy - wy * qx), nw = qw - h * (wx * qx + wy * qy + wz * qz);
      const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
      cq[c4] = nx * il; cq[c4 + 1] = ny * il; cq[c4 + 2] = nz * il; cq[c4 + 3] = nw * il;
      this.sync(c);
    }
    this.awake = awake;
    if (!awake) return;
    this.moved = true;
    // dynamic grid
    const dH = this.dHead, dN = this.dNext;
    for (let k = 0; k < this.dN; k++) dH[this.dList[k]] = -1;
    this.dN = 0;
    for (const c of this.active) { const l = this.mem[c]; for (let q = 0; q < l.length; q++) { const i = l[q], k = (this.ix(P[i * 3 + 1]) * GD + this.ix(P[i * 3 + 2])) * GD + this.ix(P[i * 3]); if (dH[k] === -1) this.dList[this.dN++] = k; dN[i] = dH[k]; dH[k] = i; } }
    // contacts
    for (let a = 0; a < this.active.length; a++) {
      const c = this.active[a];
      if (this.cst[c] !== 1) continue;
      const l = this.mem[c], single = l.length === 1;
      let grounded = false;
      for (let q = 0; q < l.length; q++) {
        const i = l[q], i3 = i * 3, r = rad[i];
        let px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
        // terrain
        const th = this.height(px, pz);
        if (py - r * 1.8 < th) {
          if (single && this.type[i] !== 2) {
            // box corners
            const ex = E[i3], ey = E[i3 + 1], ez = E[i3 + 2], qx = Q[i * 4], qy = Q[i * 4 + 1], qz = Q[i * 4 + 2], qw = Q[i * 4 + 3];
            for (let k = 0; k < 8; k++) {
              const lx = k & 1 ? ex : -ex, ly = k & 2 ? ey : -ey, lz = k & 4 ? ez : -ez;
              const tx = 2 * (qy * lz - qz * ly), ty = 2 * (qz * lx - qx * lz), tz = 2 * (qx * ly - qy * lx);
              const ry = ly + qw * ty + qz * tx - qx * tz, wy = P[i3 + 1] + ry;
              if (wy < th) { const rx = lx + qw * tx + qy * tz - qz * ty, rz = lz + qw * tz + qx * ty - qy * tx; this.contactS(c, i, P[i3] + rx, wy, P[i3 + 2] + rz, 0, 1, 0, th - wy, 0.75, 0.12); grounded = true; }
            }
          } else if (py - r < th) { this.contactS(c, i, px, py - r, pz, 0, 1, 0, th - py + r, 0.75, 0.08); grounded = true; }
          if (py < th - 0.4) { cp[c * 3 + 1] += th - py; cv[c * 3 + 1] = Math.max(0, cv[c * 3 + 1]); }
        }
        // glass
        const d2 = px * px + py * py + pz * pz, lim = RI - r;
        if (d2 > lim * lim) { const d = Math.sqrt(d2), nx = -px / d, ny = -py / d, nz = -pz / d; this.contactS(c, i, px - nx * r, py - ny * r, pz - nz * r, nx, ny, nz, d - lim, 0.35, 0.2); grounded = true; }
        // static chunks
        const x0 = this.ix(px - r), x1 = this.ix(px + r), y0 = this.ix(py - r), y1 = this.ix(py + r), z0 = this.ix(pz - r), z1 = this.ix(pz + r);
        for (let Y = y0; Y <= y1; Y++) for (let Z = z0; Z <= z1; Z++) for (let X = x0; X <= x1; X++) {
          const k = this.sHead[(Y * GD + Z) * GD + X]; if (k < 0) continue;
          const it = this.sItems[k];
          for (let t = 0; t < it.length; t++) {
            const j = it[t]; if (cl[j] !== ANCHOR) continue;
            const j3 = j * 3, dx = px - this.HP[j3], dy = py - this.HP[j3 + 1], dz = pz - this.HP[j3 + 2], ex = E[j3], ey = E[j3 + 1], ez = E[j3 + 2];
            let qx = dx < -ex ? -ex : dx > ex ? ex : dx, qy = dy < -ey ? -ey : dy > ey ? ey : dy, qz = dz < -ez ? -ez : dz > ez ? ez : dz;
            let nx = dx - qx, ny = dy - qy, nz = dz - qz, s = nx * nx + ny * ny + nz * nz;
            if (s > r * r) continue;
            let pen;
            if (s < 1e-10) { // inside: push out of nearest face
              const ax = ex - Math.abs(dx), ay = ey - Math.abs(dy), az = ez - Math.abs(dz);
              if (ay <= ax && ay <= az) { nx = 0; ny = dy < 0 ? -1 : 1; nz = 0; pen = ay + r; } else if (ax <= az) { nx = dx < 0 ? -1 : 1; ny = 0; nz = 0; pen = ax + r; } else { nx = 0; ny = 0; nz = dz < 0 ? -1 : 1; pen = az + r; }
              pen = Math.min(pen, 0.05);
            } else { s = Math.sqrt(s); nx /= s; ny /= s; nz /= s; pen = r - s; }
            const dv = this.contactS(c, i, px - nx * r, py - ny * r, pz - nz * r, nx, ny, nz, pen, 0.6, 0.05);
            if (dv > 0.55) { const en = dv * Math.min(6, this.cm[c]) / this.mass[j]; if (en > 1.4) this.hurt(j, Math.min(0.9, (en - 1.4) * 0.16)); }
            if (ny > 0.5) grounded = true;
          }
        }
        // dynamic pairs
        px = P[i3]; py = P[i3 + 1]; pz = P[i3 + 2];
        const R = r + 0.15, u0 = this.ix(px - R), u1 = this.ix(px + R), v0 = this.ix(py - R), v1 = this.ix(py + R), s0 = this.ix(pz - R), s1 = this.ix(pz + R);
        for (let Y = v0; Y <= v1; Y++) for (let Z = s0; Z <= s1; Z++) for (let X = u0; X <= u1; X++) {
          for (let j = dH[(Y * GD + Z) * GD + X]; j >= 0; j = dN[j]) {
            const cj = cl[j]; if (cj === c || cj < 0) continue;
            const sl = this.cst[cj] === 2; if (!sl && j < i) continue;
            const rs = r + rad[j], dx = px - P[j * 3], dy = py - P[j * 3 + 1], dz = pz - P[j * 3 + 2], s = dx * dx + dy * dy + dz * dz;
            if (s >= rs * rs || s < 1e-9) continue;
            const d = Math.sqrt(s), nx = dx / d, ny = dy / d, nz = dz / d;
            this.contactD(c, i, cj, j, px - nx * r, py - ny * r, pz - nz * r, nx, ny, nz, rs - d, sl);
            if (ny > 0.4) grounded = true;
          }
        }
      }
      // sleep
      const c3 = c * 3, v2 = cv[c3] ** 2 + cv[c3 + 1] ** 2 + cv[c3 + 2] ** 2, w2 = cw[c3] ** 2 + cw[c3 + 1] ** 2 + cw[c3 + 2] ** 2;
      if (grounded && v2 < 0.004 && w2 < 0.5) { this.csl[c] += dt; cw[c3] *= 0.9; cw[c3 + 1] *= 0.9; cw[c3 + 2] *= 0.9; cv[c3] *= 0.92; cv[c3 + 2] *= 0.92; if (this.csl[c] > 0.45) { this.cst[c] = 2; cv[c3] = cv[c3 + 1] = cv[c3 + 2] = cw[c3] = cw[c3 + 1] = cw[c3 + 2] = 0; } }
      else if (grounded && v2 < 0.02) this.csl[c] = Math.max(0, this.csl[c] - dt * 0.3);
      else this.csl[c] = 0;
    }
    this.splitDirty();
    for (const o of this.bd) if (o.dirty && o.alive) this.detachLoose(o);
  }

  sync(c) {
    const c3 = c * 3, c4 = c * 4, { cp, cq, P, Q, off, oq } = this;
    const X = cp[c3], Y = cp[c3 + 1], Z = cp[c3 + 2], qx = cq[c4], qy = cq[c4 + 1], qz = cq[c4 + 2], qw = cq[c4 + 3], l = this.mem[c];
    for (let q = 0; q < l.length; q++) {
      const i = l[q], i3 = i * 3, i4 = i * 4, x = off[i3], y = off[i3 + 1], z = off[i3 + 2];
      const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
      P[i3] = X + x + qw * tx + qy * tz - qz * ty; P[i3 + 1] = Y + y + qw * ty + qz * tx - qx * tz; P[i3 + 2] = Z + z + qw * tz + qx * ty - qy * tx;
      const bx = oq[i4], by = oq[i4 + 1], bz = oq[i4 + 2], bw = oq[i4 + 3];
      Q[i4] = qw * bx + qx * bw + qy * bz - qz * by; Q[i4 + 1] = qw * by - qx * bz + qy * bw + qz * bx; Q[i4 + 2] = qw * bz + qx * by - qy * bx + qz * bw; Q[i4 + 3] = qw * bw - qx * bx - qy * by - qz * bz;
    }
  }
  applyI(c, jx, jy, jz, rx, ry, rz, sgn) {
    // impulse (jx,jy,jz) at offset r
    const { cv, cw, cm } = this, c3 = c * 3, im = sgn / cm[c];
    cv[c3] += jx * im; cv[c3 + 1] += jy * im; cv[c3 + 2] += jz * im;
    const tx = (ry * jz - rz * jy) * sgn, ty = (rz * jx - rx * jz) * sgn, tz = (rx * jy - ry * jx) * sgn;
    if (this.cn[c] === 1) { const s = this.cs[c]; cw[c3] += tx * s; cw[c3 + 1] += ty * s; cw[c3 + 2] += tz * s; return; }
    this.mulI(c, tx, ty, tz); cw[c3] += this.ox; cw[c3 + 1] += this.oy; cw[c3 + 2] += this.oz;
  }
  mulI(c, x, y, z) {
    if (this.cn[c] === 1) { const s = this.cs[c]; this.ox = x * s; this.oy = y * s; this.oz = z * s; return; }
    const c4 = c * 4, o = c * 6, I = this.ci; let qx = -this.cq[c4], qy = -this.cq[c4 + 1], qz = -this.cq[c4 + 2]; const qw = this.cq[c4 + 3];
    let tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    const bx = x + qw * tx + qy * tz - qz * ty, by = y + qw * ty + qz * tx - qx * tz, bz = z + qw * tz + qx * ty - qy * tx;
    const ax = I[o] * bx + I[o + 1] * by + I[o + 2] * bz, ay = I[o + 1] * bx + I[o + 3] * by + I[o + 4] * bz, az = I[o + 2] * bx + I[o + 4] * by + I[o + 5] * bz;
    qx = -qx; qy = -qy; qz = -qz;
    tx = 2 * (qy * az - qz * ay); ty = 2 * (qz * ax - qx * az); tz = 2 * (qx * ay - qy * ax);
    this.ox = ax + qw * tx + qy * tz - qz * ty; this.oy = ay + qw * ty + qz * tx - qx * tz; this.oz = az + qw * tz + qx * ty - qy * tx;
  }
  invMassAt(c, rx, ry, rz, nx, ny, nz) {
    const ax = ry * nz - rz * ny, ay = rz * nx - rx * nz, az = rx * ny - ry * nx;
    this.mulI(c, ax, ay, az);
    const bx = this.oy * rz - this.oz * ry, by = this.oz * rx - this.ox * rz, bz = this.ox * ry - this.oy * rx;
    return 1 / this.cm[c] + Math.max(0, bx * nx + by * ny + bz * nz);
  }
  stressPart(c, i, j, x, y, z) {
    const dv = j / this.mass[i];
    if (dv > 0.7) {
      const imp = Math.min(dv, 14);
      if (this.impacts.length < 900 && (imp > 1.1)) this.impacts.push(x, y, z, imp * Math.min(1.5, this.mass[i]), 0);
      if (this.cn[c] > 1 && imp > 1.5) this.hurt(i, (imp - 1.5) * 0.24);
    }
    return dv;
  }
  contactS(c, i, x, y, z, nx, ny, nz, pen, mu, e) {
    const { cp, cv, cw } = this, c3 = c * 3, rx = x - cp[c3], ry = y - cp[c3 + 1], rz = z - cp[c3 + 2];
    let vx = cv[c3] + cw[c3 + 1] * rz - cw[c3 + 2] * ry, vy = cv[c3 + 1] + cw[c3 + 2] * rx - cw[c3] * rz, vz = cv[c3 + 2] + cw[c3] * ry - cw[c3 + 1] * rx;
    const vn = vx * nx + vy * ny + vz * nz;
    const k = pen * (this.cn[c] > 1 ? 0.3 : 0.35), kk = k > 0.04 ? 0.04 : k;
    cp[c3] += nx * kk; cp[c3 + 1] += ny * kk; cp[c3 + 2] += nz * kk;
    let dv = 0;
    if (vn < 0) {
      const im = this.invMassAt(c, rx, ry, rz, nx, ny, nz), j = (-(1 + (vn < -0.35 ? e : 0)) * vn) / im;
      this.applyI(c, nx * j, ny * j, nz * j, rx, ry, rz, 1);
      vx -= nx * vn; vy -= ny * vn; vz -= nz * vn;
      const vt = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vt > 1e-4) { const tx = vx / vt, ty = vy / vt, tz = vz / vt, it = this.invMassAt(c, rx, ry, rz, tx, ty, tz); let jt = vt / it; if (jt > mu * j) jt = mu * j; this.applyI(c, -tx * jt, -ty * jt, -tz * jt, rx, ry, rz, 1); }
      dv = this.stressPart(c, i, j, x, y, z);
    }
    return dv;
  }
  contactD(c, i, d, k, x, y, z, nx, ny, nz, pen, asleep) {
    const { cp, cv, cw, cm } = this, c3 = c * 3, d3 = d * 3;
    const rx = x - cp[c3], ry = y - cp[c3 + 1], rz = z - cp[c3 + 2], sx = x - cp[d3], sy = y - cp[d3 + 1], sz = z - cp[d3 + 2];
    let vx = cv[c3] + cw[c3 + 1] * rz - cw[c3 + 2] * ry, vy = cv[c3 + 1] + cw[c3 + 2] * rx - cw[c3] * rz, vz = cv[c3 + 2] + cw[c3] * ry - cw[c3 + 1] * rx;
    if (!asleep) { vx -= cv[d3] + cw[d3 + 1] * sz - cw[d3 + 2] * sy; vy -= cv[d3 + 1] + cw[d3 + 2] * sx - cw[d3] * sz; vz -= cv[d3 + 2] + cw[d3] * sy - cw[d3 + 1] * sx; }
    const vn = vx * nx + vy * ny + vz * nz;
    if (asleep && vn < -0.5 && cm[c] > cm[d] * 0.25) { this.wake(d); asleep = false; }
    const tot = asleep ? cm[c] : cm[c] + cm[d], f = asleep ? 1 : cm[d] / tot, pk = Math.min(0.03, pen * 0.28);
    cp[c3] += nx * pk * f; cp[c3 + 1] += ny * pk * f; cp[c3 + 2] += nz * pk * f;
    if (!asleep) { const g = pk * (1 - f); cp[d3] -= nx * g; cp[d3 + 1] -= ny * g; cp[d3 + 2] -= nz * g; }
    if (vn < 0) {
      const im = this.invMassAt(c, rx, ry, rz, nx, ny, nz) + (asleep ? 0 : this.invMassAt(d, sx, sy, sz, nx, ny, nz)), j = (-1.05 * vn) / im;
      this.applyI(c, nx * j, ny * j, nz * j, rx, ry, rz, 1); if (!asleep) this.applyI(d, nx * j, ny * j, nz * j, sx, sy, sz, -1);
      vx -= nx * vn; vy -= ny * vn; vz -= nz * vn;
      const vt = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vt > 1e-4) { let jt = vt / im * 0.8; if (jt > 0.55 * j) jt = 0.55 * j; const tx = vx / vt * jt, ty = vy / vt * jt, tz = vz / vt * jt; this.applyI(c, -tx, -ty, -tz, rx, ry, rz, 1); if (!asleep) this.applyI(d, -tx, -ty, -tz, sx, sy, sz, -1); }
      this.stressPart(c, i, j, x, y, z); if (!asleep) this.stressPart(d, k, j, x, y, z);
    }
  }
  // restore a chunk to its home lattice position
  restore(i) {
    this.P.set(this.HP.subarray(i * 3, i * 3 + 3), i * 3); this.Q.set(this.HQ.subarray(i * 4, i * 4 + 4), i * 4);
    this.cl[i] = ANCHOR; this.heat[i] = 0; this.found[i] = this.world.C[i].layer === 0 ? 1 : 0;
    for (let q = this.bs[i]; q < this.bs[i + 1]; q++) { const j = this.bt[q]; const h = this.cl[j] === ANCHOR ? 1 : 0; this.bh[q] = h; this.bh[this.br[q]] = h; }
    this.moved = true;
  }
}
