// CPU side of sprites, beams, glitter and the dynamic light list.
import * as THREE from 'three';
import { RI, LAND, SEA } from './world.js';

const quad = () => new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3);
export const instGeo = (n) => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', quad()); g.setIndex([0, 1, 2, 0, 2, 3]); g.instanceCount = n; return g; };
export const dyn = (a, k) => { const t = new THREE.InstancedBufferAttribute(a, k); t.setUsage(THREE.DynamicDrawUsage); return t; };

export class Particles {
  constructor(max = 14000) {
    this.max = max; this.h = 0; this.A = new Float32Array(max * 4); this.B = new Float32Array(max * 4); this.C = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) this.A[i * 4 + 3] = -1e4;
    const g = (this.geo = instGeo(max)); this.a = dyn(this.A, 4); this.b = dyn(this.B, 4); this.c = dyn(this.C, 4); g.setAttribute('iA', this.a); g.setAttribute('iB', this.b); g.setAttribute('iC', this.c);
    this.lo = max; this.hi = 0; this.time = 0;
  }
  spawn(type, x, y, z, vx, vy, vz, life, size, heat = 0) {
    const i = this.h; this.h = (this.h + 1) % this.max; const k = i * 4;
    this.A[k] = x; this.A[k + 1] = y; this.A[k + 2] = z; this.A[k + 3] = this.time;
    this.B[k] = vx; this.B[k + 1] = vy; this.B[k + 2] = vz; this.B[k + 3] = life;
    this.C[k] = type; this.C[k + 1] = size; this.C[k + 2] = Math.random(); this.C[k + 3] = heat;
    if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i;
  }
  burst(type, n, x, y, z, sp, up, life, size, heat = 0, r = 0.03) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, u = Math.random() * 2 - 1, k = Math.sqrt(1 - u * u), s = sp * (0.3 + Math.random()); this.spawn(type, x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, z + (Math.random() - 0.5) * r, Math.cos(a) * k * s, u * s * 0.6 + up * (0.4 + Math.random()), Math.sin(a) * k * s, life * (0.6 + Math.random() * 0.8), size * (0.6 + Math.random() * 0.8), heat); } }
  flush() { if (this.hi < this.lo) return; const s = this.lo * 4, n = (this.hi - this.lo + 1) * 4; for (const a of [this.a, this.b, this.c]) { a.clearUpdateRanges(); a.addUpdateRange(s, n); a.needsUpdate = true; } this.lo = this.max; this.hi = 0; }
}

export class Beams {
  constructor(max = 2600) { this.max = max; this.n = 0; this.A = new Float32Array(max * 4); this.B = new Float32Array(max * 4); this.C = new Float32Array(max * 4); const g = (this.geo = instGeo(0)); this.at = [dyn(this.A, 4), dyn(this.B, 4), dyn(this.C, 4)]; g.setAttribute('iA', this.at[0]); g.setAttribute('iB', this.at[1]); g.setAttribute('iC', this.at[2]); }
  begin() { this.n = 0; }
  add(ax, ay, az, w0, bx, by, bz, w1, r, g, b, kind) { if (this.n >= this.max) return; const k = this.n++ * 4; this.A[k] = ax; this.A[k + 1] = ay; this.A[k + 2] = az; this.A[k + 3] = w0; this.B[k] = bx; this.B[k + 1] = by; this.B[k + 2] = bz; this.B[k + 3] = w1; this.C[k] = r; this.C[k + 1] = g; this.C[k + 2] = b; this.C[k + 3] = kind; }
  end() { this.geo.instanceCount = this.n; for (const a of this.at) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; } }
}

const SL = [0.05, 0.4, 1.3, 3.0, -1.4];
export class LightList {
  constructor(max) { this.max = max; this.n = 0; this.A = new Float32Array(max * 4); this.B = new Float32Array(max * 4); const g = (this.geo = instGeo(0)); this.at = [dyn(this.A, 4), dyn(this.B, 4)]; g.setAttribute('iA', this.at[0]); g.setAttribute('iB', this.at[1]); }
  begin() { this.n = 0; }
  add(x, y, z, r, g, b, rad) {
    const h = y - LAND;
    for (let s = 0; s < 5; s++) {
      const d = Math.abs(h - SL[s]), reach = s === 0 ? 0.42 : s === 1 ? 0.62 : s === 2 ? 1.1 : s === 3 ? 1.6 : 1.3;
      if (d > reach + rad * 0.4 || this.n >= this.max) continue;
      const w = s === 4 ? Math.max(0, 1 - d / 1.6) : Math.max(0.0, 1 - Math.max(0, d - 0.12) / (reach + rad * 0.4)), k = this.n++ * 4, R = s >= 2 && s < 4 ? rad * 1.25 : rad;
      this.A[k] = x; this.A[k + 1] = LAND + SL[s] + (h - SL[s]) * 0.35; this.A[k + 2] = z; this.A[k + 3] = R; this.B[k] = r * w; this.B[k + 1] = g * w; this.B[k + 2] = b * w; this.B[k + 3] = s;
    }
  }
  end() { this.geo.instanceCount = this.n; for (const a of this.at) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; } }
}
export class ConeList {
  constructor(max) { this.max = max; this.n = 0; this.A = new Float32Array(max * 4); this.B = new Float32Array(max * 4); const g = (this.geo = instGeo(0)); this.at = [dyn(this.A, 4), dyn(this.B, 4)]; g.setAttribute('iA', this.at[0]); g.setAttribute('iB', this.at[1]); }
  begin() { this.n = 0; }
  add(x, z, dx, dz, r, g, b, L) { if (this.n >= this.max) return; const k = this.n++ * 4; this.A[k] = x; this.A[k + 1] = z; this.A[k + 2] = dx; this.A[k + 3] = dz; this.B[k] = r; this.B[k + 1] = g; this.B[k + 2] = b; this.B[k + 3] = L; }
  end() { this.geo.instanceCount = this.n; for (const a of this.at) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; } }
}

// Snow-globe glitter: swirls when shaken, settles and melts away
export class Glitter {
  constructor(n = 6000) {
    this.n = n; this.P = new Float32Array(n * 4); this.V = new Float32Array(n * 3); const s = new Float32Array(n); this.vis = 0;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 8.5; this.P[i * 4] = Math.cos(a) * r; this.P[i * 4 + 1] = LAND + 0.02; this.P[i * 4 + 2] = Math.sin(a) * r; this.P[i * 4 + 3] = 0.006 + Math.random() * 0.009; s[i] = Math.random(); }
    const g = (this.geo = instGeo(n)); this.at = dyn(this.P, 4); g.setAttribute('iA', this.at); g.setAttribute('iB', new THREE.InstancedBufferAttribute(s, 1));
  }
  update(dt, g, shake, weather, height) {
    this.vis = Math.max(0, Math.min(1, this.vis + (shake > 0.4 ? shake * dt * 2.2 : -dt * 0.045)));
    if (this.vis < 0.01) return; const { P, V, n } = this, o = [0, 0, 0], gm = Math.hypot(...g) || 1, k1 = 1 - Math.exp(-dt * 1.8);
    for (let i = 0; i < n; i++) {
      const p = i * 4, v = i * 3; let x = P[p], y = P[p + 1], z = P[p + 2];
      weather.windAt(x, y, z, o);
      const tx = o[0] * 0.8 + (g[0] / gm) * 0.22, ty = o[1] * 0.8 + (g[1] / gm) * 0.22, tz = o[2] * 0.8 + (g[2] / gm) * 0.22;
      V[v] += (tx - V[v]) * k1 + (Math.abs(g[0]) > 1.3 ? g[0] * dt * 1.5 : 0); V[v + 1] += (ty - V[v + 1]) * k1 + (Math.abs(g[1]) > 1.6 ? g[1] * dt : 0); V[v + 2] += (tz - V[v + 2]) * k1 + (Math.abs(g[2]) > 1.3 ? g[2] * dt * 1.5 : 0);
      if (shake > 0.5) { V[v] += (Math.random() - 0.5) * shake * dt * 14; V[v + 1] += (Math.random() - 0.2) * shake * dt * 12; V[v + 2] += (Math.random() - 0.5) * shake * dt * 14; }
      x += V[v] * dt; y += V[v + 1] * dt; z += V[v + 2] * dt;
      const r = Math.sqrt(x * x + y * y + z * z); if (r > 9.4) { const k = 9.4 / r, d = (V[v] * x + V[v + 1] * y + V[v + 2] * z) / r; x *= k; y *= k; z *= k; if (d > 0) { V[v] -= (1.3 * d * x) / r; V[v + 1] -= (1.3 * d * y) / r; V[v + 2] -= (1.3 * d * z) / r; } }
      const h = Math.max(height(x, z), SEA) + 0.01; if (y < h) { y = h; V[v] *= 0.5; V[v + 1] = Math.abs(V[v + 1]) * 0.2; V[v + 2] *= 0.5; }
      P[p] = x; P[p + 1] = y; P[p + 2] = z;
    }
    this.at.needsUpdate = true;
  }
}
