// Storm energy, wind field, tornado, lightning, flood, time of day, and the water plane.
import { clamp, lerp, sat, smooth, damp, vnoise } from './util.js';
import { LAND, SEA, RI } from './world.js';

export class Weather {
  constructor(world) {
    this.w = world; this.t = 0; this.rt = 0;
    this.tod = 0.80; this.S = 0.26; this.energy = 0; this.amb = 0.26; this.rain = 0.45; this.wet = 1; this.cover = 0.5; this.spin = 0; this.flood = 0;
    this.T = 0; this.tx = 3; this.tz = -3; this.tdrop = 5; this.tTime = 0; this.tPath = [0, 0]; this.tActive = false;
    this.wn = [0, 1, 0]; this.wv = [0, 0, 0]; this.waveT = 0; this.flash = [0, 5, 0, 0]; this.bolts = []; this.nextBolt = 4; this.onStrike = null; this.onTouchdown = null;
    this.g = [0, -1.1, 0]; this.flow = [0, 0, 0]; this.storming = false; this.hold = 0; this.peak = 0; this.gust = 1;
  }
  get night() { return this._night; }
  update(dt, rdt, g, shake) {
    this.t += dt; this.rt += rdt; this.g = g;
    // ---- storm energy from shaking
    if (shake > 0.75) this.energy = Math.min(1.25, this.energy + (shake - 0.75) * rdt * 0.62);
    if (this.energy > 0.5 && !this.storming) { this.storming = true; this.hold = 0; }
    if (this.storming) { this.hold += dt; if (shake > 1.5) this.hold = Math.min(this.hold, 6); if (this.hold > 34) { this.energy = Math.max(0, this.energy - dt * 0.085); if (this.energy < 0.08) { this.storming = false; } } }
    else this.energy = Math.max(0, this.energy - dt * 0.09);
    // natural weather drifts between mist and a passing thunderstorm
    this.amb = 0.14 + 0.24 * smooth(0.35, 0.75, vnoise(this.rt * 0.013 + 3.3, 1.7));
    const target = Math.max(this.amb, this.storming ? clamp(this.energy, 0, 1) : this.energy * 0.6);
    this.S = damp(this.S, target, target > this.S ? 0.42 : 0.2, dt);
    this.rain = damp(this.rain, smooth(0.15, 0.75, this.S) * 1.0 + 0.15 * smooth(0.16, 0.2, this.S), 0.5, dt);
    this.wet = damp(this.wet, sat(this.rain * 4 + 0.15), this.rain > 0.05 ? 0.4 : 0.02, dt);
    this.cover = damp(this.cover, 0.34 + this.S * 0.75, 0.3, dt);
    this.spin += dt * (0.012 + 0.2 * smooth(0.4, 1, this.S));
    const fl = this.S > 0.72 ? smooth(0.72, 1, this.S) * 0.43 : 0; this.flood = damp(this.flood, fl, fl > this.flood ? 0.2 : 0.16, dt);
    this.gust = 0.75 + 0.5 * vnoise(this.t * 0.9, 4.2) + 0.25 * vnoise(this.t * 2.7, 9.1);
    // ---- tornado
    const want = this.S > 0.8 && this.storming && this.hold < 33;
    if (want && !this.tActive) { this.tActive = true; this.tTime = 0; const a = Math.random() * 6.28; this.tx = Math.cos(a) * 6; this.tz = Math.sin(a) * 6; this.tPath = [Math.random() * 10, Math.random() * 10]; this.touched = false; }
    if (this.tActive) {
      this.tTime += dt;
      this.T = damp(this.T, want ? 1 : 0, want ? 0.55 : 0.5, dt);
      const tt = this.tTime * 0.16;
      const gx = 4.6 * Math.sin(tt * 1.13 + this.tPath[0]) * Math.cos(tt * 0.41), gz = 4.0 * Math.sin(tt * 0.87 + this.tPath[1]) - 0.8;
      this.tx = damp(this.tx, gx, 0.35, dt); this.tz = damp(this.tz, gz, 0.35, dt);
      this.tdrop = damp(this.tdrop, want ? -0.2 : 5.4, 0.55, dt);
      if (this.tdrop < 0.5 && !this.touched) { this.touched = true; this.onTouchdown && this.onTouchdown(); }
      if (!want && this.T < 0.02) { this.tActive = false; this.T = 0; this.tdrop = 5.4; }
    }
    // ---- lightning
    this.flash[3] *= Math.exp(-dt * 7.5);
    for (const b of this.bolts) { b.age += dt; if (b.age < b.life && Math.random() < 0.22) this.flash[3] = Math.max(this.flash[3], b.k * (0.35 + Math.random() * 0.7) * (1 - b.age / b.life)); }
    this.bolts = this.bolts.filter((b) => b.age < b.life + 0.05);
    const rate = this.S < 0.2 ? 0.03 : 0.06 + Math.pow(this.S, 2.2) * 2.4;
    this.nextBolt -= dt * rate; if (this.nextBolt <= 0) { this.nextBolt = 0.3 + Math.random() * 1.2; this.strike(); }
    // ---- water plane: damped spring towards the plane normal to effective gravity
    const gl = Math.hypot(...g) || 1, tn = [-g[0] / gl, -g[1] / gl, -g[2] / gl], n = this.wn, v = this.wv, k = 16 * Math.min(1.6, gl / 1.1), c = 1.7;
    const steps = Math.max(1, Math.ceil(dt / 0.012)), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      const dot = n[0] * tn[0] + n[1] * tn[1] + n[2] * tn[2]; let ax = tn[0] - n[0] * dot, ay = tn[1] - n[1] * dot, az = tn[2] - n[2] * dot;
      if (dot < -0.97 && Math.hypot(ax, ay, az) < 0.25) { ax += 0.25; }
      for (let i = 0; i < 3; i++) { v[i] += ([ax, ay, az][i] * k - v[i] * c) * h; }
      const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]; for (let i = 0; i < 3; i++) { v[i] -= n[i] * d; n[i] += v[i] * h; }
      const l = Math.hypot(...n); for (let i = 0; i < 3; i++) n[i] /= l;
    }
    this.flow = [v[0] * 0.6 - n[2] * 0, 0, v[2] * 0.6];
    this.waveT += dt * (1 + 0.5 * this.S);
    // ---- time of day (a full day takes about four minutes, nights are longer)
    this.tod = (this.tod + rdt * (this.slow ? 0.2 : 1) / (this.sunY() > 0 ? 200 : 290)) % 1;
    const sy = this.sunY(); this._night = smooth(0.14, -0.12, sy);
  }
  sunY() { return Math.sin((this.tod - 0.25) * 6.28318); }
  sunDir() { const a = (this.tod - 0.25) * 6.28318, x = Math.cos(a), y = Math.sin(a), l = Math.hypot(x, y, 0.42); return [x / l, y / l, 0.42 / l]; }
  strike(tx, tz, hitBuilding = true) {
    const w = this.w, S = this.S; let x, z, y = null, part = -1;
    if (tx !== undefined) { x = tx; z = tz; }
    else if (this.T > 0.4 && Math.random() < 0.3) { x = this.tx + (Math.random() - 0.5) * 1.6; z = this.tz + (Math.random() - 0.5) * 1.6; }
    else if (S > 0.35 && Math.random() < 0.72) { const b = w.B[(Math.random() * w.B.length) | 0], tall = w.B[(Math.random() * w.B.length) | 0], q = tall.H > b.H ? tall : b; x = q.x; z = q.z; part = q; }
    else { const a = Math.random() * 6.28, r = 2 + Math.random() * 6.6; x = Math.cos(a) * r; z = Math.sin(a) * r; }
    y = part && part !== -1 ? LAND + part.H : Math.max(w.height(x, z), SEA);
    const top = [x + (Math.random() - 0.5) * 2.4, lerp(5.2, 4.6, S) + Math.random(), z + (Math.random() - 0.5) * 2.4], segs = [];
    const frac = (a, b, d, wd, br) => {
      if (d === 0) { segs.push([a, b, wd]); return; }
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), m = [0, 1, 2].map((i) => (a[i] + b[i]) / 2 + (Math.random() - 0.5) * L * 0.27);
      frac(a, m, d - 1, wd, br); frac(m, b, d - 1, wd, br);
      if (br > 0 && Math.random() < 0.34) { const e = [0, 1, 2].map((i) => m[i] + (b[i] - a[i]) * 0.55 + (Math.random() - 0.5) * L * 0.8); frac(m, e, Math.max(1, d - 1), wd * 0.42, br - 1); }
    };
    frac(top, [x, y, z], 5, 1, 2);
    const k = 0.55 + Math.random() * 0.6 + S * 0.35;
    this.bolts.push({ segs, age: 0, life: 0.16 + Math.random() * 0.22, k });
    this.flash = [(x + top[0]) / 2, (y + top[1]) / 2 + 0.6, (z + top[2]) / 2, k];
    this.onStrike && this.onStrike(x, y, z, part && part !== -1 ? part : null, S);
  }
  windAt(x, y, z, o) {
    const S = this.S, h = y - LAND; let wx = 0.14 * (0.5 + S * 2), wy = 0, wz = 0.06 * (0.5 + S * 2);
    if (S > 0.35) {
      const r = Math.sqrt(x * x + z * z) + 1e-4, V = Math.pow(smooth(0.35, 1, S), 1.3) * 2.6 * this.gust, f = r < 1.1 ? r / 1.1 : Math.pow(1.1 / r, 0.18), k = V * f * (0.45 + 0.55 * sat(h * 0.9 + 0.2)) / r;
      wx += -z * k - x * k * 0.28; wz += x * k - z * k * 0.28; wy += V * 0.12 * Math.sin(x * 3.1 + this.t * 5) * Math.cos(z * 2.7 + this.t * 4.1);
      wx += Math.sin(z * 2.3 + this.t * 3.7) * V * 0.2; wz += Math.cos(x * 2.1 - this.t * 4.3) * V * 0.2;
    }
    if (this.T > 0.02 && h > -0.6) {
      const hh = Math.max(h, 0), ax = this.tx + Math.sin(y * 1.1 + this.t * 1.3) * 0.11 * hh, az = this.tz + Math.cos(y * 0.9 + this.t * 1.05) * 0.11 * hh;
      const dx = x - ax, dz = z - az, r = Math.sqrt(dx * dx + dz * dz) + 1e-3, core = 0.42 + 0.13 * hh, T = this.T * sat(1 - this.tdrop * 0.4);
      if (r < 4) {
        const vt = T * 6.6 * (r < core ? r / core : core / r) * smooth(4, 2.4, r), top = smooth(5.2, 3.2, h), inn = T * (2.6 * Math.exp(-hh * 0.5) * smooth(0, core, r) * Math.min(1, core * 2.2 / r) - 2.2 * (1 - top)) * smooth(4, 2, r);
        wx += (-dz / r) * vt - (dx / r) * inn; wz += (dx / r) * vt - (dz / r) * inn; wy += T * 4.9 * Math.exp(-((r / (core * 1.25)) ** 2)) * top;
      }
    }
    o[0] = wx; o[1] = wy; o[2] = wz; return o;
  }
  level() { const up = smooth(0.8, 1, this.wn[1]); return SEA + this.flood * up; }
  // CPU twin of the GLSL wave field (calm part + swell)
  wave(px, pz, shallow = 1) {
    let h = 0, a = 1, f = 2.6, s = 0, ang = 0.4, qx = px, qz = pz; const t = this.waveT, A = this.waveA(), Bq = this.waveB();
    for (let i = 0; i < 4; i++) { const dx = Math.cos(ang), dz = Math.sin(ang), x = (dx * qx + dz * qz) * f + t * (1.1 + 0.28 * i), w = Math.exp(Math.sin(x) - 1), k = w * Math.cos(x) * a * 0.05; h += w * a; qx -= dx * k; qz -= dz * k; s += a; a *= 0.66; f *= 1.55; ang += 2.13; }
    let r = (h / s - 0.46) * A;
    if (Bq > 0.002) { let H = 0; a = 1; f = 0.85; s = 0; ang = 1.9; qx = px; qz = pz; for (let i = 0; i < 5; i++) { const dx = Math.cos(ang), dz = Math.sin(ang), x = (dx * qx + dz * qz) * f + t * (1.5 + 0.35 * i), w = Math.exp(Math.sin(x) - 1), k = w * Math.cos(x) * a * 0.16; H += w * a; qx -= dx * k; qz -= dz * k; s += a; a *= 0.7; f *= 1.42; ang += 1.47; } r += (H / s - 0.42) * Bq; }
    return r * shallow;
  }
  slosh() { return Math.hypot(...this.wv); }
  waveA() { return 0.085 + 0.05 * this.S; }
  waveB() { return smooth(0.3, 1, this.S) * 0.62 + Math.min(0.5, this.slosh() * 0.25); }
}
