// Procedural meshes. Forward is +x, up is +y unless noted.
import * as THREE from 'three';
import { rng } from './util.js';

export class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.s = []; this.l = []; this.ix = []; this.spin = 0; this.limb = 0; }
  get count() { return this.p.length / 3; }
  // add a welded patch: verts [[x,y,z]], tris [[a,b,c]], smooth normals
  patch(v, t, col, mat = 0) {
    const o = this.count, nn = v.map(() => [0, 0, 0]);
    for (const [a, b, c] of t) {
      const A = v[a], B = v[b], C = v[c], ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      const x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx;
      for (const k of [a, b, c]) { nn[k][0] += x; nn[k][1] += y; nn[k][2] += z; }
    }
    v.forEach((q, i) => {
      if (Math.hypot(...nn[i]) < 1e-12) { const k = t.find((y) => y.includes(i)); if (k) { const [A, B, C] = k.map((y) => v[y]); const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2]; nn[i] = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; if (Math.hypot(...nn[i]) < 1e-12) nn[i] = [0, 1, 0]; } }
      const l = Math.hypot(...nn[i]) || 1; this.p.push(...q); this.n.push(nn[i][0] / l, nn[i][1] / l, nn[i][2] / l);
      const cc = typeof col === 'function' ? col(q) : col; this.c.push(cc[0], cc[1], cc[2], cc.length > 3 ? cc[3] : mat); this.s.push(this.spin); this.l.push(this.limb);
    });
    for (const q of t) this.ix.push(q[0] + o, q[1] + o, q[2] + o);
    return this;
  }
  box(x, y, z, sx, sy, sz, col, mat = 0, taper = 1) {
    const X = sx / 2, Y = sy / 2, Z = sz / 2, f = (a, b, c, d) => this.patch([a, b, c, d], [[0, 1, 2], [0, 2, 3]], col, mat);
    const k = taper, v = (i, j, q) => [x + i * X * (j > 0 ? k : 1), y + j * Y, z + q * Z * (j > 0 ? k : 1)];
    f(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)); f(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1));
    f(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); f(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
    f(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); f(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1));
    return this;
  }
  // sections: {x,y,z,ry,rz,pw} along axis 'x' or 'y'; superellipse rings
  loft(sec, N, col, mat = 0, axis = 'x', caps = true) {
    const v = [], t = [];
    for (const s of sec) for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (s.ph || 0), pw = s.pw || 1, ca = Math.cos(a), sa = Math.sin(a);
      const u = Math.sign(ca) * Math.pow(Math.abs(ca), pw) * s.rz, w = Math.sign(sa) * Math.pow(Math.abs(sa), pw) * s.ry;
      if (axis === 'x') v.push([s.x, (s.y || 0) + w, (s.z || 0) + u]); else v.push([(s.x || 0) + u, s.y, (s.z || 0) + w]);
    }
    for (let k = 0; k < sec.length - 1; k++) for (let i = 0; i < N; i++) {
      const a = k * N + i, b = k * N + ((i + 1) % N), c = a + N, d = b + N;
      if (axis === 'x') { t.push([a, c, b], [b, c, d]); } else { t.push([a, b, c], [b, d, c]); }
    }
    // orientation fix by checking first triangle against centre
    if (caps) {
      const s0 = sec[0], s1 = sec[sec.length - 1], c0 = v.length; v.push(axis === 'x' ? [s0.x, s0.y || 0, s0.z || 0] : [s0.x || 0, s0.y, s0.z || 0]); const c1 = v.length; v.push(axis === 'x' ? [s1.x, s1.y || 0, s1.z || 0] : [s1.x || 0, s1.y, s1.z || 0]);
      const L = (sec.length - 1) * N;
      for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (axis === 'x') { t.push([c0, i, j], [c1, L + j, L + i]); } else { t.push([c0, j, i], [c1, L + i, L + j]); } }
    }
    let vol = 0; for (const [a, b, c] of t) { const A = v[a], B = v[b], C = v[c]; vol += A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]); }
    if (vol < 0) for (const q of t) { const k = q[1]; q[1] = q[2]; q[2] = k; }
    return this.patch(v, t, col, mat);
  }
  cyl(x, y, z, r, h, axis, col, mat = 0, N = 10, r2 = r) {
    const s = axis === 'y' ? [{ x, z, y: y - h / 2, rz: r, ry: r }, { x, z, y: y + h / 2, rz: r2, ry: r2 }] : null;
    if (s) return this.loft(s, N, col, mat, 'y');
    if (axis === 'x') return this.loft([{ x: x - h / 2, y, z, rz: r, ry: r }, { x: x + h / 2, y, z, rz: r2, ry: r2 }], N, col, mat, 'x');
    // z axis
    const v = [], t = [];
    for (const k of [-1, 1]) for (let i = 0; i < N; i++) { const a = (i / N) * 6.28319; v.push([x + Math.cos(a) * r, y + Math.sin(a) * r, z + (k * h) / 2]); }
    const c0 = v.length; v.push([x, y, z - h / 2], [x, y, z + h / 2]);
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; t.push([i, j, i + N], [j, j + N, i + N], [c0, j, i], [c0 + 1, i + N, j + N]); }
    return this.patch(v, t, col, mat);
  }
  sphere(x, y, z, rx, ry, rz, col, mat = 0, N = 8) {
    const s = []; for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI; s.push({ x, z, y: y - Math.cos(a) * ry, rz: Math.sin(a) * rx + 1e-4, ry: Math.sin(a) * rz + 1e-4 }); }
    return this.loft(s, N + 2, col, mat, 'y', false);
  }
  tri(a, b, c, col, mat = 0) { return this.patch([a, b, c], [[0, 1, 2]], col, mat); }
  tri2(a, b, c, col, mat = 0) { return this.tri(a, b, c, col, mat).tri(a, c, b, col, mat); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 4)); g.setAttribute('aSpin', new THREE.Float32BufferAttribute(this.s, 1)); g.setAttribute('aLimb', new THREE.Float32BufferAttribute(this.l, 1));
    g.setIndex(this.ix); return g;
  }
}
const W = [1, 1, 1], BLK = [0.02, 0.02, 0.022], CHR = [0.85, 0.86, 0.88];

export function person() {
  const g = new GB(), q = [1, 1, 1], S = (a) => g.loft(a, 8, q, 0, 'y');
  g.limb = 0; S([{ y: 0.46, rz: 0.075, ry: 0.052 }, { y: 0.52, rz: 0.082, ry: 0.058 }, { y: 0.6, rz: 0.068, ry: 0.048 }, { y: 0.7, rz: 0.088, ry: 0.058 }, { y: 0.78, rz: 0.1, ry: 0.056 }, { y: 0.83, rz: 0.07, ry: 0.045 }, { y: 0.86, rz: 0.028, ry: 0.028 }]);
  g.limb = 1; S([{ y: 0.83, rz: 0.026, ry: 0.026 }, { y: 0.865, rz: 0.03, ry: 0.034, z: 0.004 }, { y: 0.89, rz: 0.042, ry: 0.05, z: 0.004 }, { y: 0.925, rz: 0.048, ry: 0.056 }, { y: 0.96, rz: 0.045, ry: 0.052, z: -0.003 }, { y: 0.988, rz: 0.026, ry: 0.032, z: -0.004 }]);
  g.limb = 10; S([{ y: 0.9, rz: 0.046, ry: 0.04, z: -0.022 }, { y: 0.94, rz: 0.052, ry: 0.05, z: -0.012 }, { y: 0.975, rz: 0.048, ry: 0.054, z: -0.004 }, { y: 1.0, rz: 0.026, ry: 0.034, z: -0.004 }]);
  for (const s of [1, -1]) {
    g.limb = s > 0 ? 2 : 4; S([{ y: 0.82, x: s * 0.1, rz: 0.03, ry: 0.034 }, { y: 0.78, x: s * 0.112, rz: 0.032, ry: 0.034 }, { y: 0.62, x: s * 0.125, rz: 0.023, ry: 0.025 }].reverse());
    g.limb = s > 0 ? 3 : 5; S([{ y: 0.625, x: s * 0.125, rz: 0.023, ry: 0.025 }, { y: 0.48, x: s * 0.132, rz: 0.016, ry: 0.017 }, { y: 0.44, x: s * 0.134, rz: 0.015, ry: 0.024 }, { y: 0.41, x: s * 0.134, rz: 0.009, ry: 0.014 }].reverse());
    g.limb = s > 0 ? 6 : 8; S([{ y: 0.52, x: s * 0.045, rz: 0.044, ry: 0.052 }, { y: 0.4, x: s * 0.05, rz: 0.042, ry: 0.046 }, { y: 0.27, x: s * 0.052, rz: 0.03, ry: 0.034 }].reverse());
    g.limb = s > 0 ? 7 : 9; S([{ y: 0.28, x: s * 0.052, rz: 0.03, ry: 0.034 }, { y: 0.2, x: s * 0.053, rz: 0.03, ry: 0.036, z: -0.006 }, { y: 0.07, x: s * 0.054, rz: 0.019, ry: 0.022 }, { y: 0.045, x: s * 0.054, rz: 0.022, ry: 0.04, z: 0.014 }, { y: 0.0, x: s * 0.055, rz: 0.026, ry: 0.056, z: 0.026 }].reverse());
  }
  const r = g.build(); // facing +z
  return r;
}

function carBody(g, o) {
  const { L = 1, w = 0.205, hb = 0.16, nose = 0.6, tail = 0.8, roof = 0.3, c0 = -0.28, c1 = 0.2, paint = W, gl = 1 } = o;
  const y0 = 0.06;
  const sec = [[-0.5, 0.62 * tail, 0.8], [-0.46, 0.9 * tail, 0.92], [-0.36, 1.0 * tail + 0.05, 1.0], [-0.1, 1.0, 1.0], [0.2, 0.98, 1.0], [0.36, 0.5 + 0.5 * nose, 0.97], [0.46, 0.3 + 0.55 * nose, 0.88], [0.5, 0.15 + 0.5 * nose, 0.74]];
  g.loft(sec.map(([x, h, k]) => ({ x: x * L, y: y0 + (hb * h) / 2, ry: (hb * h) / 2, rz: w * k, pw: 0.42 })), 14, paint, 0);
  // cabin: glass band with painted roof
  const hh = roof - hb - y0 + 0.02;
  g.loft([[c0 - 0.11, 0.05, 0.8], [c0, 0.78, 0.84], [c0 + 0.1, 1, 0.82], [c1 - 0.14, 1, 0.82], [c1, 0.42, 0.86], [c1 + 0.08, 0.03, 0.86]].map(([x, h, k]) => ({ x: x * L, y: y0 + hb - 0.02 + (hh * h) / 2, ry: (hh * h) / 2 + 0.002, rz: w * k, pw: 0.5 })), 12, BLK, gl);
  g.loft([[c0 + 0.0, 0.3], [c0 + 0.06, 1], [c1 - 0.15, 1], [c1 - 0.08, 0.4]].map(([x, k]) => ({ x: x * L, y: roof, ry: 0.012, rz: w * 0.76 * (0.8 + 0.2 * k), pw: 0.5 })), 10, paint, 0);
  for (const sx of [-0.31, 0.31]) for (const sz of [-1, 1]) { g.cyl(sx * L, 0.072, sz * (w - 0.012), 0.072, 0.05, 'z', BLK, 2, 12); g.cyl(sx * L, 0.072, sz * (w + 0.0145), 0.042, 0.006, 'z', CHR, 3, 8); }
  for (const s of [-1, 1]) { g.sphere(0.485 * L, y0 + hb * (0.32 + 0.3 * nose), s * w * 0.62, 0.016, 0.02, 0.028, W, 4, 5); g.box(-0.492 * L, y0 + hb * 0.5 * tail + 0.02, s * w * 0.58, 0.014, 0.022, 0.07, [1, 0, 0], 5); }
  g.box(0.5 * L, y0 + 0.035, 0, 0.02, 0.022, w * 1.6, CHR, 3); g.box(-0.5 * L, y0 + 0.035, 0, 0.02, 0.022, w * 1.6, CHR, 3);
  for (const s of [-1, 1]) g.box(-0.02, y0 + hb * 0.66, s * (w * 1.0 - 0.002), 0.6 * L, 0.006, 0.008, CHR, 3);
}
export function carGeo(type) {
  const g = new GB();
  if (type === 0) carBody(g, { nose: 0.75 });                                             // saloon
  else if (type === 1) carBody(g, { hb: 0.125, roof: 0.225, nose: 0.45, tail: 0.85, w: 0.215, c0: -0.3, c1: 0.1 }); // sports
  else if (type === 2) { carBody(g, { nose: 0.8 }); g.box(0, 0.335, 0, 0.12, 0.05, 0.16, [1, 0.8, 0.1], 8); }       // taxi
  else if (type === 3) { // police
    carBody(g, { nose: 0.75, paint: W }); g.box(0.0, 0.318, -0.075, 0.07, 0.04, 0.13, [1, 0, 0], 6); g.box(0.0, 0.318, 0.075, 0.07, 0.04, 0.13, [0, 0, 1], 7);
    for (const s of [-1, 1]) g.box(-0.02, 0.155, s * 0.2055, 0.34, 0.1, 0.006, [0.9, 0.9, 0.9], 2);
  } else if (type === 4) { // bus
    g.loft([[-0.95, 0.8], [-0.9, 1], [0.9, 1], [0.95, 0.85]].map(([x, k]) => ({ x, y: 0.27, ry: 0.2 * k, rz: 0.21 * k, pw: 0.3 })), 14, W, 0); g.box(0, 0.34, 0, 1.75, 0.11, 0.424, BLK, 1); g.box(0.951, 0.32, 0, 0.01, 0.17, 0.34, BLK, 1);
    for (const x of [-0.6, 0.6]) for (const s of [-1, 1]) g.cyl(x, 0.085, s * 0.19, 0.085, 0.06, 'z', BLK, 2, 12);
    for (const s of [-1, 1]) { g.box(0.955, 0.14, s * 0.14, 0.012, 0.03, 0.05, W, 4); g.box(-0.955, 0.16, s * 0.14, 0.012, 0.04, 0.04, [1, 0, 0], 5); }
    g.box(0, 0.475, 0, 1.5, 0.012, 0.02, [0.1, 0.9, 0.7], 8);
  } else if (type === 5) { // fire engine
    g.box(0.05, 0.25, 0, 1.15, 0.28, 0.4, W, 0); g.box(0.68, 0.22, 0, 0.16, 0.24, 0.39, W, 0); g.box(0.73, 0.29, 0, 0.08, 0.1, 0.395, BLK, 1); g.box(-0.1, 0.41, 0, 0.95, 0.03, 0.12, CHR, 3); g.box(-0.2, 0.2, 0, 0.5, 0.1, 0.405, CHR, 3);
    for (let i = 0; i < 8; i++) g.box(-0.5 + i * 0.12, 0.43, 0, 0.012, 0.012, 0.12, CHR, 3);
    g.box(0.6, 0.42, -0.09, 0.1, 0.045, 0.14, [1, 0, 0], 6); g.box(0.6, 0.42, 0.09, 0.1, 0.045, 0.14, [0, 0, 1], 7);
    for (const x of [-0.36, 0.5]) for (const s of [-1, 1]) g.cyl(x, 0.085, s * 0.18, 0.085, 0.06, 'z', BLK, 2, 12);
    for (const s of [-1, 1]) g.box(0.765, 0.16, s * 0.13, 0.012, 0.035, 0.06, W, 4);
  } else if (type === 6) { // ambulance / van
    g.box(-0.12, 0.25, 0, 0.75, 0.3, 0.39, W, 0); g.loft([[0.25, 1], [0.4, 0.85], [0.5, 0.45]].map(([x, k]) => ({ x, y: 0.1 + 0.13 * k, ry: 0.13 * k, rz: 0.19, pw: 0.35 })), 12, W, 0); g.box(0.33, 0.3, 0, 0.12, 0.1, 0.36, BLK, 1);
    g.box(0.12, 0.425, -0.08, 0.08, 0.04, 0.13, [1, 0, 0], 6); g.box(0.12, 0.425, 0.08, 0.08, 0.04, 0.13, [0, 0, 1], 7); g.box(-0.1, 0.24, 0, 0.6, 0.035, 0.395, [0.9, 0.15, 0.1], 2);
    for (const x of [-0.3, 0.32]) for (const s of [-1, 1]) g.cyl(x, 0.08, s * 0.175, 0.08, 0.06, 'z', BLK, 2, 12);
    for (const s of [-1, 1]) { g.box(0.5, 0.16, s * 0.12, 0.012, 0.03, 0.05, W, 4); g.box(-0.5, 0.16, s * 0.14, 0.012, 0.05, 0.03, [1, 0, 0], 5); }
  }
  return g.build();
}
export function heliGeo() {
  const g = new GB();
  g.loft([[-0.18, 0.3], [-0.1, 0.75], [0.05, 1], [0.22, 0.95], [0.34, 0.65], [0.4, 0.2]].map(([x, k]) => ({ x, y: 0.0, ry: 0.13 * k, rz: 0.12 * k })), 14, W, 0);
  g.loft([[0.16, 0.6], [0.26, 0.92], [0.36, 0.62], [0.412, 0.18]].map(([x, k]) => ({ x, y: 0.015, ry: 0.125 * k, rz: 0.122 * k })), 12, BLK, 1);
  g.loft([[-0.66, 0.35], [-0.4, 0.55], [-0.12, 1]].map(([x, k]) => ({ x, y: 0.04 + 0.04 * (1 - k), ry: 0.05 * k, rz: 0.045 * k })), 8, W, 0);
  g.box(-0.64, 0.15, 0, 0.07, 0.17, 0.014, W, 0); g.box(-0.58, 0.09, 0, 0.06, 0.01, 0.2, W, 0); g.cyl(0.05, 0.16, 0, 0.022, 0.09, 'y', CHR, 3, 8);
  for (const s of [-1, 1]) { g.cyl(0.06, -0.17, s * 0.11, 0.009, 0.5, 'x', BLK, 2, 6); g.box(-0.04, -0.13, s * 0.09, 0.012, 0.09, 0.012, BLK, 2); g.box(0.16, -0.13, s * 0.09, 0.012, 0.09, 0.012, BLK, 2); }
  g.sphere(-0.02, -0.13, 0, 0.015, 0.015, 0.015, [1, 0, 0], 6, 5); g.sphere(-0.66, 0.24, 0, 0.012, 0.012, 0.012, [0, 0, 1], 7, 5);
  g.spin = 1; for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a); const p = (r, o) => [0.05 * 0 + c * r - s * o, 0.212, s * r + c * o]; g.patch([p(0.02, -0.016), p(0.62, -0.02), p(0.62, 0.02), p(0.02, 0.016)], [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], BLK, 2); }
  g.spin = 2; for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; g.patch([[-0.625, 0.1, 0.03], [-0.615, 0.1, 0.03], [-0.615, 0.1 + s * 0.12, 0.03], [-0.625, 0.1 + s * 0.12, 0.03]], [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], BLK, 2); }
  return g.build();
}
export function yachtGeo(kind) {
  const g = new GB();
  const hull = (L, wd, h, bow, c) => {
    const sec = [[-0.5, 0.82, 0.0], [-0.3, 1, 0], [0.0, 1, 0.0], [0.22, 0.84, 0.02], [0.38, 0.5, 0.06], [0.5, 0.06, 0.11]], v = [], t = [], N = 5;
    for (const [x, k, up] of sec) { const w = wd * k; v.push([x * L, h + up * bow, w], [x * L, h * 0.35, w * 0.9], [x * L, -h * 0.45 + up * 0.5, 0], [x * L, h * 0.35, -w * 0.9], [x * L, h + up * bow, -w]); }
    for (let i = 0; i < sec.length - 1; i++) for (let j = 0; j < N - 1; j++) { const a = i * N + j, b = a + 1, q = a + N, d = q + 1; t.push([a, b, q], [b, d, q]); }
    t.push([0, 4, 1], [1, 4, 3], [1, 3, 2]);
    g.patch(v, t, (p) => (p[1] < h * 0.2 ? [0.25, 0.04, 0.03] : c), 11);
    const dv = [], dt = []; for (const [x, k, up] of sec) { const w = wd * k * 0.97; dv.push([x * L, h + up * bow - 0.004, w], [x * L, h + up * bow - 0.004, -w]); }
    for (let i = 0; i < sec.length - 1; i++) dt.push([i * 2, i * 2 + 2, i * 2 + 1], [i * 2 + 1, i * 2 + 2, i * 2 + 3]);
    g.patch(dv, dt, [0.5, 0.36, 0.2], 2);
  };
  if (kind === 0) { // superyacht
    hull(2.4, 0.27, 0.16, 1.2, [0.9, 0.9, 0.92]);
    const deck = (x0, x1, y, h, w) => { g.loft([[x0, 0.9], [x0 + 0.06, 1], [x1 - 0.22, 1], [x1, 0.55]].map(([x, k]) => ({ x, y: y + h / 2, ry: h / 2, rz: w * k, pw: 0.35 })), 12, [0.95, 0.95, 0.96], 2); g.loft([[x0 + 0.04, 1], [x1 - 0.22, 1], [x1 - 0.02, 0.62]].map(([x, k]) => ({ x, y: y + h * 0.56, ry: h * 0.2, rz: w * k * 1.008, pw: 0.35 })), 12, BLK, 1); };
    deck(-0.85, 0.62, 0.16, 0.13, 0.225); deck(-0.6, 0.46, 0.29, 0.12, 0.19); deck(-0.35, 0.28, 0.41, 0.1, 0.15);
    g.box(-0.1, 0.56, 0, 0.12, 0.1, 0.16, W, 2, 0.6); g.cyl(-0.1, 0.68, 0, 0.007, 0.18, 'y', CHR, 3, 6); g.sphere(-0.02, 0.63, 0, 0.035, 0.03, 0.035, W, 2, 6);
    for (const s of [-1, 1]) { g.box(-0.1, 0.275, s * 0.222, 1.3, 0.008, 0.008, [0.1, 0.75, 1], 8); g.box(-0.1, 0.4, s * 0.188, 0.9, 0.008, 0.008, [0.1, 0.75, 1], 8); g.box(-0.05, 0.14, s * 0.262, 2.0, 0.006, 0.006, [1, 0.75, 0.4], 8); }
    g.box(-1.0, 0.162, 0, 0.26, 0.006, 0.2, [0.1, 0.7, 0.9], 8);
  } else if (kind === 1) { // speedboat
    hull(0.62, 0.1, 0.07, 0.6, [0.8, 0.12, 0.1]); g.box(0.04, 0.095, 0, 0.1, 0.04, 0.13, BLK, 1, 0.8); g.box(-0.1, 0.085, 0, 0.1, 0.03, 0.12, [0.8, 0.75, 0.65], 2); g.box(-0.3, 0.07, 0, 0.05, 0.08, 0.06, BLK, 2); g.sphere(0.28, 0.1, 0, 0.012, 0.012, 0.012, W, 4, 5);
  } else if (kind === 2) { // sloop
    hull(0.95, 0.13, 0.09, 0.7, [0.92, 0.9, 0.84]); g.box(0.02, 0.12, 0, 0.36, 0.05, 0.15, [0.9, 0.88, 0.82], 2, 0.85); g.cyl(0.06, 0.6, 0, 0.009, 1.05, 'y', CHR, 3, 6);
    const sail = (a, b, c, bul) => { const v = [], t = [], n = 6; for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, w = j / n, k = 1 - u - w; v.push([a[0] * k + b[0] * u + c[0] * w, a[1] * k + b[1] * u + c[1] * w, a[2] * k + b[2] * u + c[2] * w + bul * 27 * u * w * k * 0.35 + bul * u * w * 0.8]); } const id = (i, j) => { let q = 0; for (let k = 0; k < i; k++) q += n - k + 1; return q + j; }; for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { t.push([id(i, j), id(i + 1, j), id(i, j + 1)]); if (j < n - i - 1) t.push([id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]); } g.patch(v, t, [0.95, 0.92, 0.85], 11); };
    sail([0.05, 1.1, 0], [0.04, 0.2, 0], [-0.4, 0.2, 0], 0.1); sail([0.07, 1.0, 0], [0.09, 0.18, 0], [0.46, 0.17, 0], 0.08);
  } else { // ferry / freighter bringing supplies
    hull(2.0, 0.26, 0.2, 0.8, [0.12, 0.2, 0.24]); g.box(-0.7, 0.36, 0, 0.36, 0.34, 0.38, [0.9, 0.9, 0.88], 2); g.box(-0.6, 0.47, 0, 0.2, 0.06, 0.39, BLK, 1); g.cyl(-0.78, 0.6, 0, 0.06, 0.2, 'y', [0.85, 0.3, 0.1], 2, 10);
    const cols = [[0.7, 0.2, 0.12], [0.1, 0.35, 0.5], [0.8, 0.6, 0.15], [0.2, 0.45, 0.3], [0.6, 0.6, 0.6]]; let k = 0; for (let i = 0; i < 5; i++) for (let j = -1; j <= 1; j++) for (let q = 0; q < 1 + ((i * 7 + j * 3 + 5) % 3); q++) g.box(-0.38 + i * 0.24, 0.26 + q * 0.1, j * 0.145, 0.22, 0.095, 0.135, cols[k++ % 5], 2);
  }
  return g.build();
}
export function airshipGeo() {
  const g = new GB(), sec = []; for (let i = 0; i <= 16; i++) { const u = i / 16, x = -1 + u * 2, r = 0.27 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.62); sec.push({ x, y: 0, ry: r + 0.004, rz: r + 0.004 }); }
  g.loft(sec, 20, (p) => { const a = Math.atan2(p[1], p[2]); return Math.abs(Math.sin(a * 5)) < 0.3 ? [0.62, 0.5, 0.28, 3] : [0.82, 0.83, 0.86, 3]; }, 3);
  for (const s of [-1, 1]) g.box(0.0, 0, s * 0.268, 0.9, 0.16, 0.01, W, 10);
  g.loft([[-0.26, 0.6], [-0.18, 1], [0.18, 1], [0.28, 0.5]].map(([x, k]) => ({ x, y: -0.32, ry: 0.055 * k, rz: 0.06 * k, pw: 0.5 })), 10, [0.15, 0.15, 0.17], 2); g.box(0, -0.31, 0, 0.36, 0.03, 0.124, [1, 0.8, 0.5], 8);
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a); g.patch([[-0.66, c * 0.16, s * 0.16], [-0.98, c * 0.05, s * 0.05], [-1.05, c * 0.34, s * 0.34], [-0.86, c * 0.36, s * 0.36]], [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], [0.55, 0.14, 0.1], 2); }
  for (const s of [-1, 1]) { g.cyl(-0.12, -0.28, s * 0.2, 0.03, 0.14, 'x', [0.2, 0.2, 0.2], 2, 8); g.box(-0.12, -0.24, s * 0.16, 0.02, 0.02, 0.1, CHR, 3); }
  g.sphere(1.0, 0, 0, 0.015, 0.015, 0.015, [1, 0, 0], 6, 5);
  return g.build();
}
export function wheelGeo() { // ferris wheel, axis z, radius 1
  const g = new GB(), n = 20, neon = (i) => [[1, 0.35, 0.1], [0.1, 0.85, 1], [0.2, 1, 0.55]][i % 3];
  for (const z of [-0.09, 0.09]) for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * 6.28319, b = ((i + 1) / (n * 2)) * 6.28319; for (const r of [1, 0.9]) { const p = (t, q) => [Math.cos(t) * q, Math.sin(t) * q, z]; const A = p(a, r - 0.012), B = p(b, r - 0.012), C = p(b, r + 0.012), D = p(a, r + 0.012); g.patch([A, B, C, D], [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], r === 1 ? neon((i / 2) | 0).map((q) => q * 0.34) : [0.8, 0.8, 0.82], r === 1 ? 8 : 2); } }
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.28319, c = Math.cos(a), s = Math.sin(a); for (const z of [-0.09, 0.09]) { const o = 0.008; g.patch([[c * 0.06 - s * o, s * 0.06 + c * o, z], [c * 0.06 + s * o, s * 0.06 - c * o, z], [c * 0.98 + s * o, s * 0.98 - c * o, z], [c * 0.98 - s * o, s * 0.98 + c * o, z]], [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], i % 2 ? [0.8, 0.8, 0.82] : neon(i).map((q) => q * 0.22), i % 2 ? 2 : 8); } g.box(c, s, 0, 0.02, 0.02, 0.2, [0.8, 0.8, 0.82], 2); }
  return g.build();
}
export function gondolaGeo() { const g = new GB(); g.box(0, -0.085, 0, 0.1, 0.05, 0.12, W, 0); g.box(0, -0.05, 0, 0.098, 0.03, 0.118, BLK, 1); g.loft([{ y: -0.035, rz: 0.06, ry: 0.07 }, { y: -0.01, rz: 0.015, ry: 0.02 }], 8, W, 0, 'y'); g.box(0, 0, 0, 0.01, 0.03, 0.14, CHR, 3); return g.build(); }
export function lampGeo() { const g = new GB(); g.cyl(0, 0.08, 0, 0.0036, 0.16, 'y', [0.06, 0.09, 0.08], 2, 6, 0.0024); g.cyl(0, 0.008, 0, 0.008, 0.016, 'y', [0.06, 0.09, 0.08], 2, 8, 0.005); g.box(0.022, 0.16, 0, 0.05, 0.003, 0.003, [0.06, 0.09, 0.08], 2); g.box(0.046, 0.157, 0, 0.02, 0.005, 0.009, [0.06, 0.09, 0.08], 2); g.box(0.046, 0.1535, 0, 0.016, 0.002, 0.007, W, 4); return g.build(); }
export function palmGeo() {
  const g = new GB(), R = rng(5), bend = 0.06, H = 0.3, sec = [];
  for (let i = 0; i <= 7; i++) { const u = i / 7; sec.push({ x: bend * u * u, y: u * H, rz: 0.0105 - 0.0052 * u + (i === 0 ? 0.005 : 0), ry: 0.0105 - 0.0052 * u + (i === 0 ? 0.005 : 0) }); }
  g.loft(sec, 7, (p) => [0.33 + 0.1 * Math.sin(p[1] * 300), 0.25, 0.17, (p[1] / H) * 0.5], 0, 'y');
  for (let f = 0; f < 15; f++) {
    const a = (f / 15) * 6.28 + R() * 0.4, L = 0.13 + R() * 0.045, n = 10, cx = Math.cos(a), cz = Math.sin(a); let px = bend, py = H, pz = 0, ang = 0.95 - 1.2 * (((f * 7) % 15) / 15) + R() * 0.15; const sh = 0.75 + R() * 0.5; const pts = [];
    for (let i = 0; i <= n; i++) { pts.push([px, py, pz, ang]); const ds = L / n; px += cx * Math.cos(ang) * ds; pz += cz * Math.cos(ang) * ds; py += Math.sin(ang) * ds; ang -= 0.17; }
    const col = (p) => { const d = Math.min(1, Math.hypot(p[0] - bend, p[2]) / L); return [(0.062 + 0.075 * d) * sh, (0.125 + 0.04 * d) * sh, 0.042 * sh, 0.5 + 0.5 * d]; };
    for (let i = 0; i < n; i++) { const A = pts[i], B = pts[i + 1], w = 0.0022 * (1 - i / n) + 0.0006; g.patch([[A[0] - cz * w, A[1], A[2] + cx * w], [A[0] + cz * w, A[1], A[2] - cx * w], [B[0], B[1], B[2]]], [[0, 1, 2]], col); }
    for (let i = 1; i <= n; i++) for (const s of [-1, 1]) for (const hh of [0, 0.5]) {
      const P = pts[i], Pm = pts[i - 1], bx = P[0] + (Pm[0] - P[0]) * hh, by = P[1] + (Pm[1] - P[1]) * hh, bz = P[2] + (Pm[2] - P[2]) * hh, u = (i - hh) / n, len = (0.012 + 0.036 * Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.12))) * (0.85 + R() * 0.3), fw = 0.75, dr = 0.42 + R() * 0.25;
      const tx = bx + (-cz * s * 0.8 + cx * fw * Math.cos(P[3])) * len, tz = bz + (cx * s * 0.8 + cz * fw * Math.cos(P[3])) * len, ty = by + (Math.sin(P[3]) * fw - dr) * len, w = 0.0048;
      g.patch([[bx - cx * w, by, bz - cz * w], [bx + cx * w, by + 0.001, bz + cz * w], [tx, ty, tz]], [[0, 1, 2]], col); const k = g.count - 3; for (let q = 0; q < 3; q++) { const nx = -cz * s * 0.25, nz = cx * s * 0.25, l = Math.hypot(nx, 0.93, nz); g.n[(k + q) * 3] = nx / l; g.n[(k + q) * 3 + 1] = 0.93 / l; g.n[(k + q) * 3 + 2] = nz / l; }
    }
  }
  for (let i = 0; i < 4; i++) g.sphere(bend + Math.cos(i * 1.6) * 0.011, H - 0.008, Math.sin(i * 1.6) * 0.011, 0.007, 0.007, 0.007, [0.3, 0.2, 0.08, 0.5], 0, 4);
  return g.build();
}
export function treeGeo() {
  const g = new GB(), R = rng(9);
  g.loft([{ y: 0, rz: 0.011, ry: 0.011 }, { y: 0.05, rz: 0.007, ry: 0.007 }, { y: 0.11, rz: 0.005, ry: 0.005 }], 6, [0.2, 0.14, 0.09, 0.05], 0, 'y');
  for (let i = 0; i < 130; i++) { // leaf cards on a lumpy crown
    const u = R() * 2 - 1, a = R() * 6.28, k = Math.sqrt(1 - u * u), r = 0.052 * (0.72 + 0.35 * R()), n = [k * Math.cos(a), u * 0.85, k * Math.sin(a)];
    const cx = n[0] * r, cy = 0.145 + n[1] * r, cz = n[2] * r, s = 0.013 + R() * 0.008, t1 = [Math.sin(a) + R() - 0.5, R() - 0.5, -Math.cos(a) + R() - 0.5], l = Math.hypot(...t1), A = t1.map((q) => (q / l) * s), B = [n[1] * A[2] - n[2] * A[1], n[2] * A[0] - n[0] * A[2], n[0] * A[1] - n[1] * A[0]];
    const sh = 0.55 + 0.45 * (n[1] * 0.5 + 0.5) + R() * 0.25, c = [0.08 * sh, 0.145 * sh, 0.045 * sh, 0.25 + 0.2 * R()], o = g.count;
    g.patch([[cx + A[0], cy + A[1], cz + A[2]], [cx + B[0], cy + B[1], cz + B[2]], [cx - A[0], cy - A[1], cz - A[2]], [cx - B[0], cy - B[1], cz - B[2]]], [[0, 1, 2], [0, 2, 3]], c);
    for (let q = o; q < g.count; q++) { g.n[q * 3] = n[0]; g.n[q * 3 + 1] = n[1]; g.n[q * 3 + 2] = n[2]; }
  }
  return g.build();
}
const fishBody = (g, L, prof, belly, back, N = 10) => g.loft(prof.map(([x, h, w, y]) => ({ x: x * L, y: (y || 0) * L, ry: h * L, rz: w * L })), N, (p) => (p[1] > 0 ? back : belly), 0);
export function fishGeo() { const g = new GB(); fishBody(g, 1, [[0.5, 0.01, 0.01], [0.38, 0.1, 0.06], [0.15, 0.17, 0.085], [-0.15, 0.14, 0.07], [-0.36, 0.05, 0.03], [-0.42, 0.03, 0.015]], [0.8, 0.82, 0.85], [0.25, 0.5, 0.7], 8); g.tri2([-0.38, 0, 0], [-0.62, 0.17, 0], [-0.54, 0, 0], [0.3, 0.55, 0.75]); g.tri2([-0.38, 0, 0], [-0.54, 0, 0], [-0.62, -0.17, 0], [0.3, 0.55, 0.75]); g.tri2([0.2, 0.15, 0], [-0.2, 0.12, 0], [-0.15, 0.26, 0], [0.3, 0.55, 0.75]); return g.build(); }
export function sharkGeo() {
  const g = new GB(), b = [0.78, 0.79, 0.8], k = [0.2, 0.24, 0.28];
  fishBody(g, 1, [[0.52, 0.012, 0.02, 0.01], [0.46, 0.045, 0.055, 0.005], [0.32, 0.09, 0.092], [0.12, 0.115, 0.105], [-0.1, 0.1, 0.09], [-0.3, 0.06, 0.05], [-0.42, 0.034, 0.026], [-0.47, 0.026, 0.016]], b, k, 14);
  const f = (a, q, c) => g.tri2(a, q, c, k);
  f([0.12, 0.1, 0], [-0.06, 0.09, 0], [-0.07, 0.25, 0]); f([-0.28, 0.05, 0], [-0.35, 0.04, 0], [-0.37, 0.09, 0]); f([-0.44, 0.0, 0], [-0.52, 0.0, 0], [-0.64, 0.23, 0]); f([-0.44, 0.0, 0], [-0.58, -0.13, 0], [-0.52, 0.0, 0]);
  for (const s of [-1, 1]) { f([0.2, -0.04, s * 0.085], [0.04, -0.05, s * 0.085], [-0.02, -0.1, s * 0.28]); f([-0.18, -0.06, s * 0.04], [-0.26, -0.05, s * 0.03], [-0.27, -0.09, s * 0.1]); g.sphere(0.41, 0.03, s * 0.068, 0.009, 0.009, 0.006, [0, 0, 0], 2, 5); }
  g.box(0.4, -0.055, 0, 0.06, 0.006, 0.07, [0.9, 0.9, 0.88], 2);
  return g.build();
}
export function dolphinGeo() { const g = new GB(), b = [0.72, 0.76, 0.8], k = [0.3, 0.38, 0.46]; fishBody(g, 1, [[0.54, 0.012, 0.014, -0.02], [0.44, 0.028, 0.026, -0.015], [0.38, 0.068, 0.062], [0.2, 0.095, 0.085], [-0.05, 0.095, 0.08], [-0.3, 0.05, 0.04], [-0.46, 0.02, 0.016]], b, k, 12); g.tri2([0.04, 0.09, 0], [-0.1, 0.08, 0], [-0.12, 0.18, 0], k); for (const s of [-1, 1]) { g.tri2([-0.43, 0, 0], [-0.5, 0, 0], [-0.58, 0.01, s * 0.15], k); g.tri2([0.2, -0.05, s * 0.06], [0.1, -0.06, s * 0.06], [0.04, -0.12, s * 0.16], k); } return g.build(); }
export function rayGeo() { const g = new GB(), v = [], t = [], n = 10; for (let i = 0; i <= n; i++) { const u = i / n, x = 0.42 - u * 0.7, w = 0.62 * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.06)) * (1 - 0.2 * u), th = 0.06 * Math.sin(Math.PI * u) + 0.005; v.push([x, th, 0], [x - 0.02, th * 0.6, w * 0.45], [x - 0.12, 0, w], [x - 0.02, -th * 0.4, w * 0.45], [x, -th, 0], [x - 0.02, -th * 0.4, -w * 0.45], [x - 0.12, 0, -w], [x - 0.02, th * 0.6, -w * 0.45]); } for (let i = 0; i < n; i++) for (let j = 0; j < 8; j++) { const a = i * 8 + j, b = i * 8 + ((j + 1) % 8); t.push([a, a + 8, b], [b, a + 8, b + 8]); } g.patch(v, t, (p) => (p[1] >= 0 ? [0.1, 0.13, 0.18] : [0.8, 0.8, 0.8])); g.tri2([-0.28, 0.01, 0.012], [-0.28, 0.01, -0.012], [-0.8, 0, 0], [0.1, 0.13, 0.18]); return g.build(); }
export function jellyGeo() { const g = new GB(), c = [0.9, 0.55, 0.95]; g.loft([{ y: -0.02, rz: 0.22, ry: 0.22 }, { y: 0.06, rz: 0.24, ry: 0.24 }, { y: 0.16, rz: 0.19, ry: 0.19 }, { y: 0.22, rz: 0.09, ry: 0.09 }, { y: 0.235, rz: 0.01, ry: 0.01 }], 12, c, 0, 'y'); for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28, x = Math.cos(a) * 0.15, z = Math.sin(a) * 0.15; g.tri2([x - 0.012, 0, z], [x + 0.012, 0, z], [x * 0.6, -0.65 - (i % 3) * 0.15, z * 0.6], c); } return g.build(); }
export function whaleGeo() { const g = new GB(), b = [0.5, 0.55, 0.6], k = [0.12, 0.17, 0.23]; fishBody(g, 1, [[0.5, 0.05, 0.05, -0.01], [0.44, 0.085, 0.085], [0.25, 0.115, 0.11], [0.0, 0.115, 0.1], [-0.2, 0.075, 0.065], [-0.38, 0.035, 0.03], [-0.46, 0.018, 0.018]], b, k, 14); for (const s of [-1, 1]) { g.tri2([-0.42, 0, 0], [-0.5, 0, 0], [-0.56, 0.01, s * 0.17], k); g.tri2([0.22, -0.05, s * 0.09], [0.12, -0.07, s * 0.09], [-0.02, -0.16, s * 0.28], k); } g.tri2([-0.12, 0.08, 0], [-0.2, 0.07, 0], [-0.21, 0.12, 0], k); return g.build(); }
export function turtleGeo() { const g = new GB(); g.sphere(0, 0.02, 0, 0.28, 0.1, 0.22, [0.28, 0.24, 0.1], 0, 7); g.sphere(0.34, 0.02, 0, 0.09, 0.06, 0.06, [0.35, 0.42, 0.2], 0, 5); for (const s of [-1, 1]) { g.tri2([0.16, 0, s * 0.16], [0.04, 0, s * 0.19], [0.0, -0.02, s * 0.48], [0.3, 0.4, 0.2]); g.tri2([-0.18, 0, s * 0.12], [-0.24, 0, s * 0.08], [-0.36, 0, s * 0.24], [0.3, 0.4, 0.2]); } return g.build(); }
export function coralGeo(kind) {
  const g = new GB(), R = rng(31 + kind);
  if (kind === 0) { // branching
    const br = (x, y, z, dx, dy, dz, r, d) => { const L = 0.16 * (0.8 + R() * 0.5), ex = x + dx * L, ey = y + dy * L, ez = z + dz * L; const v = [], t = []; for (const [px, py, pz, q] of [[x, y, z, r], [ex, ey, ez, r * 0.72]]) for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28; v.push([px + Math.cos(a) * q, py, pz + Math.sin(a) * q]); } for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; t.push([i, i + 5, j], [j, i + 5, j + 5]); } g.patch(v, t, [1, 1, 1, 0]); if (d > 0) for (let i = 0; i < 3; i++) { const nx = dx + (R() - 0.5) * 1.5, ny = Math.max(0.25, dy + (R() - 0.5) * 0.8), nz = dz + (R() - 0.5) * 1.5, l = Math.hypot(nx, ny, nz); br(ex, ey, ez, nx / l, ny / l, nz / l, r * 0.72, d - 1); } };
    br(0, 0, 0, 0, 1, 0, 0.045, 3);
  } else if (kind === 1) { for (let i = 0; i < 9; i++) g.sphere((R() - 0.5) * 0.5, 0.08 + R() * 0.1, (R() - 0.5) * 0.5, 0.12 + R() * 0.12, 0.1 + R() * 0.08, 0.12 + R() * 0.12, [1, 1, 1, 0], 0, 6); }
  else if (kind === 2) { for (let k = 0; k < 5; k++) { const x = (R() - 0.5) * 0.07, z = (R() - 0.5) * 0.07, H = 1.0 + R() * 1.1, a = R() * 3, v = [], t = [], n = 9; for (let i = 0; i <= n; i++) { const u = i / n, w = 0.05 * (1 - u * 0.7) * (0.7 + 0.5 * (i % 2)); v.push([x - Math.cos(a) * w, u * H, z - Math.sin(a) * w], [x + Math.cos(a) * w, u * H, z + Math.sin(a) * w]); if (i < n) t.push([i * 2, i * 2 + 1, i * 2 + 2], [i * 2 + 1, i * 2 + 3, i * 2 + 2]); } g.patch(v, t, [1, 1, 1, 1]); } }
  else { const v = [], t = [], n = 7; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { const a = (i / n - 0.5) * 2.4, r = 0.1 + (j / n) * 0.55; v.push([Math.sin(a) * r, Math.cos(a) * r * 0.9, Math.sin(i * 1.7 + j) * 0.02]); if (i < n && j < n && (i * 3 + j * 5) % 7 !== 0) { const o = i * (n + 1) + j; t.push([o, o + 1, o + n + 1], [o + 1, o + n + 2, o + n + 1]); } } g.patch(v, t, [1, 1, 1, 0.5]); }
  return g.build();
}
export function craneGeo() { // tower crane: mast height 1 (scaled), drawn as unit boxes in CPU instead
  const g = new GB(), y = [1.0, 0.72, 0.08];
  g.box(0, 0.5, 0, 0.034, 1, 0.034, y, 2); g.box(0.29, 1.02, 0, 0.94, 0.026, 0.026, y, 2); g.box(-0.16, 1.0, 0, 0.05, 0.05, 0.036, [0.3, 0.3, 0.3], 9); g.box(0, 1.06, 0, 0.012, 0.1, 0.012, y, 9); g.box(0.026, 0.985, 0.016, 0.03, 0.034, 0.026, BLK, 1); g.sphere(0, 1.115, 0, 0.006, 0.006, 0.006, [1, 0, 0], 6, 5);
  return g.build();
}
export function dozerGeo() { const g = new GB(), y = [1, 0.7, 0.06]; g.box(0, 0.17, 0, 0.5, 0.16, 0.22, y, 2); g.box(-0.08, 0.32, 0, 0.2, 0.16, 0.18, y, 2); g.box(-0.06, 0.32, 0, 0.21, 0.09, 0.185, BLK, 1); for (const s of [-1, 1]) g.box(0, 0.07, s * 0.16, 0.56, 0.13, 0.07, BLK, 2); g.box(0.36, 0.13, 0, 0.05, 0.2, 0.46, [0.5, 0.5, 0.5], 2); g.sphere(-0.08, 0.42, 0, 0.02, 0.02, 0.02, [1, 0.6, 0], 6, 5); return g.build(); }
