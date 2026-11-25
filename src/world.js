// Procedural island, street grid, buildings (as bonded chunks) and dressing.
import { rng, clamp, lerp, sat, smooth, smin, fbm2, vnoise } from './util.js';

export const RI = 9.55, RO = 10.0, SEA = -2.0, LAND = -1.72;
export const HN = 512, HS = 20;            // heightfield resolution and extent
export const ROAD = 0.13, WALK = 0.185;    // half widths
export const HWY = 0.64, HWYW = 0.15;      // coastal highway iso-distance and half width
export const GN = 8;                       // street nodes run -GN..GN
export const FLOOR = 0.085, LH = FLOOR * 3;

// >0 on land, roughly a distance in units
export function islandD(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  let d = 7.15 + 0.24 * Math.sin(a * 3 + 0.8) + 0.16 * Math.sin(a * 5 + 2.2) + 0.08 * Math.sin(a * 9 + 4.0) - r;
  const lx = x / 2.75, lz = (z - 4.75) / 2.3;
  const lag = (Math.hypot(lx, lz) - 1) * 2.4;
  d = smin(d, lag, 0.5);
  const ch = Math.max(Math.abs(x + 0.2) - 1.7 - 0.1 * Math.sin(z * 2), 5.2 - z);
  d = smin(d, ch, 0.4);
  const isl = 0.62 - Math.hypot(x - 5.55, z - 6.25) + 0.12 * Math.sin(a * 23);
  return Math.max(d, isl);
}

export function buildHeight() {
  const H = new Float32Array(HN * HN), D = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const x = ((i + 0.5) / HN - 0.5) * HS, z = ((j + 0.5) / HN - 0.5) * HS;
    const d = islandD(x, z);
    let y;
    if (d > 0) y = lerp(SEA, LAND, smooth(0, 0.42, d));
    else {
      const n = fbm2(x * 0.9 + 40, z * 0.9 + 11, 4) - 0.5;
      const shelf = SEA + d * 0.5 - 0.02;
      const deep = -5.45 + n * 1.3 + 0.35 * (fbm2(x * 3.1, z * 3.1, 3) - 0.5);
      const k = smooth(0.15, 1.5, -d + n * 0.5);
      y = Math.min(lerp(shelf, deep, k), SEA - 0.02);
      y += (vnoise(x * 6, z * 6) - 0.5) * 0.12 * smooth(0.3, 1, -d);
    }
    // lighthouse rock
    const ir = Math.hypot(x - 5.55, z - 6.25);
    if (ir < 0.75) y = Math.max(y, SEA + 0.36 * smooth(0.72, 0.15, ir) - 0.05 + 0.08 * (vnoise(x * 9, z * 9) - 0.5));
    H[j * HN + i] = y; D[j * HN + i] = d;
  }
  return { H, D };
}

export function makeWorld(seed = 7) {
  const R = rng(seed);
  const { H, D } = buildHeight();
  const samp = (A, x, z) => {
    const fx = clamp((x / HS + 0.5) * HN - 0.5, 0, HN - 1.001), fz = clamp((z / HS + 0.5) * HN - 0.5, 0, HN - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * HN + i;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + HN] * (1 - u) + A[k + HN + 1] * u) * v;
  };
  const height = (x, z) => samp(H, x, z);
  const dist = (x, z) => samp(D, x, z);

  // ---- street graph
  const S = GN * 2 + 1, idx = (i, j) => (j + GN) * S + (i + GN);
  const nodeOK = new Uint8Array(S * S), hE = new Uint8Array(S * S), vE = new Uint8Array(S * S), blockT = new Uint8Array(S * S);
  for (let j = -GN; j <= GN; j++) for (let i = -GN; i <= GN; i++) nodeOK[idx(i, j)] = islandD(i, j) > 0.72 && Math.hypot(i - 5.5, j - 6.2) > 1.2 ? 1 : 0;
  const inG = (i, j) => i >= -GN && i <= GN && j >= -GN && j <= GN;
  const ok = (i, j) => inG(i, j) && nodeOK[idx(i, j)] === 1;
  for (let j = -GN; j <= GN; j++) for (let i = -GN; i <= GN; i++) {
    const a = ok(i, j), bx = ok(i + 1, j), bz = ok(i, j + 1);
    hE[idx(i, j)] = a && bx && islandD(i + 0.5, j) > 0.6 ? 255 : (a || bx) ? 128 : 0;
    vE[idx(i, j)] = a && bz && islandD(i, j + 0.5) > 0.6 ? 255 : (a || bz) ? 128 : 0;
  }
  const roadTex = new Uint8Array(S * S * 4);

  // ---- highway contour polyline
  const hwy = [];
  {
    let x = 0, z = -5.8;
    for (let k = 0; k < 200; k++) { const e = islandD(x, z) - HWY; z -= e * 0.5 * -1 * -1; if (Math.abs(e) < 1e-3) break; }
    const G = (x, z) => { const h = 0.01; const gx = islandD(x + h, z) - islandD(x - h, z), gz = islandD(x, z + h) - islandD(x, z - h); const l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; };
    const x0 = x, z0 = z;
    for (let k = 0; k < 1600; k++) {
      hwy.push([x, z]);
      let [gx, gz] = G(x, z);
      x += -gz * 0.05; z += gx * 0.05;
      for (let m = 0; m < 3; m++) { const e = islandD(x, z) - HWY;[gx, gz] = G(x, z); x -= gx * e * 0.8; z -= gz * e * 0.8; }
      if (k > 60 && Math.hypot(x - x0, z - z0) < 0.05) break;
    }
  }
  const hwyLen = hwy.length * 0.05;

  // ---- buildings -> chunks
  const B = [];            // buildings
  const C = [];            // chunks {x,y,z, hx,hy,hz, b, mask, layer, kind}
  const A = [];            // attachments {x,y,z,sx,sy,sz,ry,parent,mat,r,g,b,geo,seed}
  const lights = [];       // static light sources {x,y,z,r,g,b,rad,kind,parent}
  const lamps = [], trees = [], signs = [];
  const STONE = [[0.80, 0.74, 0.62], [0.70, 0.58, 0.43], [0.27, 0.47, 0.41], [0.085, 0.09, 0.1], [0.33, 0.10, 0.08], [0.50, 0.52, 0.55], [0.36, 0.55, 0.52], [0.74, 0.50, 0.37], [0.86, 0.83, 0.78], [0.16, 0.19, 0.27]];
  const NEON = [[0.06, 1.0, 0.58], [1.0, 0.48, 0.06], [0.05, 0.62, 1.0], [1.0, 0.10, 0.10], [0.52, 0.16, 1.0], [1.0, 0.72, 0.38], [0.1, 0.95, 0.95], [1.0, 0.22, 0.45]];

  const att = (o) => { A.push(Object.assign({ ry: 0, parent: -1, mat: 0, r: 0.6, g: 0.6, b: 0.6, geo: 0, seed: R() }, o)); };
  const light = (x, y, z, c, k, rad, parent = -1, kind = 0) => lights.push({ x, y, z, r: c[0] * k, g: c[1] * k, b: c[2] * k, rad, parent, kind });

  function addBuilding(x, z, w, d, tiers, opt) {
    const b = B.length;
    const style = opt.style, col = opt.col, neon = opt.neon;
    const bd = { x, z, y0: LAND, w, d, style, col, neon, seed: R(), first: C.length, count: 0, H: 0, layers: 0, kind: opt.kind || 0, club: opt.club ?? -1, power: 1, tiers: [], name: opt.name || '' };
    B.push(bd);
    let y = LAND, layer = 0;
    for (let ti = 0; ti < tiers.length; ti++) {
      const t = tiers[ti];
      const cw = t.w / t.nx, cd = t.d / t.nz;
      bd.tiers.push({ y0: y, w: t.w, d: t.d });
      for (let l = 0; l < t.layers; l++) {
        const lh = t.lh || LH;
        for (let k = 0; k < t.nz; k++) for (let i = 0; i < t.nx; i++) {
          let m = 0;
          if (i === t.nx - 1) m |= 1; if (i === 0) m |= 2;
          if (k === t.nz - 1) m |= 16; if (k === 0) m |= 32;
          if (l === t.layers - 1) m |= 4;
          const ci = C.length;
          const corner = t.round && ((i === 0 || i === t.nx - 1) && (k === 0 || k === t.nz - 1));
          C.push({ x: x + (i + 0.5) * cw - t.w / 2, y: y + lh / 2, z: z + (k + 0.5) * cd - t.d / 2, hx: cw / 2, hy: lh / 2, hz: cd / 2, b, mask: m, layer, kind: corner ? 1 + (i === 0 ? 1 : 0) + (k === 0 ? 2 : 0) : 0 });
          void ci;
        }
        y += lh; layer++;
      }
    }
    bd.count = C.length - bd.first; bd.H = y - LAND; bd.layers = layer;
    return b;
  }
  const chunkAt = (b, x, y, z) => {
    const bd = B[b]; let best = -1, bs = 1e9;
    for (let c = bd.first; c < bd.first + bd.count; c++) {
      const k = C[c];
      const dx = Math.max(0, Math.abs(x - k.x) - k.hx), dy = Math.max(0, Math.abs(y - k.y) - k.hy), dz = Math.max(0, Math.abs(z - k.z) - k.hz);
      const s = dx * dx + dy * dy + dz * dz;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  };

  function dressTower(b) {
    const bd = B[b], x = bd.x, z = bd.z, nc = bd.neon, col = bd.col;
    let yTop = LAND;
    const trim = bd.style === 1 ? [0.95, 0.66, 0.25] : [col[0] * 0.92 + 0.05, col[1] * 0.92 + 0.05, col[2] * 0.9 + 0.04];
    const tiers = bd.tiers.map((t, i) => ({ ...t, y1: i + 1 < bd.tiers.length ? bd.tiers[i + 1].y0 : LAND + bd.H }));
    tiers.forEach((t, ti) => {
      yTop = t.y1;
      // per-chunk vertical fins and cornices
      for (let c = bd.first; c < bd.first + bd.count; c++) {
        const k = C[c];
        if (k.y < t.y0 || k.y > t.y1) continue;
        const top = k.y + k.hy > t.y1 - 1e-4;
        const faces = [[1, 0, 1], [-1, 0, 2], [0, 1, 16], [0, -1, 32]];
        for (const [nx, nz, bit] of faces) {
          if (!(k.mask & bit)) continue;
          if (k.kind && bd.style === 2) continue;
          const hw = nx ? k.hz : k.hx;
          const px = k.x + nx * k.hx, pz = k.z + nz * k.hz;
          if (bd.style === 0 || bd.style === 1 || bd.style === 3) {
            const n = Math.max(1, Math.round((hw * 2) / 0.085));
            for (let f = 0; f <= n; f++) {
              if (f === n && hw * 2 < 0.2) continue;
              const u = -hw + (f / n) * hw * 2;
              const big = f === 0;
              const dp = big ? 0.016 : 0.009, wd = big ? 0.017 : 0.0085;
              att({ x: px + nx * dp * 0.5 + (nx ? 0 : u), y: k.y, z: pz + nz * dp * 0.5 + (nx ? u : 0), sx: nx ? dp : wd, sy: k.hy * 2.0, sz: nx ? wd : dp, parent: c, mat: 1, r: trim[0], g: trim[1], b: trim[2] });
            }
          }
          if (top) {
            att({ x: px + nx * 0.008, y: t.y1 - 0.012, z: pz + nz * 0.008, sx: nx ? 0.034 : hw * 2 + 0.03, sy: 0.034, sz: nx ? hw * 2 + 0.03 : 0.034, parent: c, mat: 1, r: trim[0], g: trim[1], b: trim[2] });
            if (ti < tiers.length - 1 || bd.style === 2) att({ x: px + nx * 0.026, y: t.y1 + 0.006, z: pz + nz * 0.026, sx: nx ? 0.008 : hw * 2 + 0.03, sy: 0.008, sz: nx ? hw * 2 + 0.03 : 0.008, parent: c, mat: 2, r: nc[0], g: nc[1], b: nc[2] });
          }
          if (bd.style === 2) {
            // streamline eyebrows
            for (let f = 0; f < 3; f++) {
              const yy = k.y - k.hy + (f + 0.86) * FLOOR;
              att({ x: px + nx * 0.012, y: yy, z: pz + nz * 0.012, sx: nx ? 0.028 : hw * 2, sy: 0.010, sz: nx ? hw * 2 : 0.028, parent: c, mat: 1, r: 0.86, g: 0.84, b: 0.78 });
            }
            if (k.layer === 1 || k.layer === bd.layers - 1) att({ x: px + nx * 0.028, y: k.y + k.hy - 0.02, z: pz + nz * 0.028, sx: nx ? 0.006 : hw * 2, sy: 0.006, sz: nx ? hw * 2 : 0.006, parent: c, mat: 2, r: nc[0], g: nc[1], b: nc[2] });
          }
        }
      }
      // corner neon verticals on tall tiers
      if (bd.H > 1.6 && bd.style !== 2 && (ti === tiers.length - 1 || ti === tiers.length - 2)) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const px = x + sx * (t.w / 2 + 0.006), pz = z + sz * (t.d / 2 + 0.006);
          const n = Math.max(1, Math.round((t.y1 - t.y0) / LH));
          for (let q = 0; q < n; q++) {
            const yy = t.y0 + (q + 0.5) * (t.y1 - t.y0) / n;
            att({ x: px, y: yy, z: pz, sx: 0.011, sy: (t.y1 - t.y0) / n, sz: 0.011, parent: chunkAt(b, px, yy, pz), mat: 2, r: nc[0], g: nc[1], b: nc[2] });
          }
        }
        light(x, (t.y0 + t.y1) / 2, z, nc, 0.55, t.w * 0.9 + 0.35, chunkAt(b, x, (t.y0 + t.y1) / 2, z), 1);
      }
    });
    const tt = tiers[tiers.length - 1], pc = chunkAt(b, x, yTop, z);
    // crowns
    if (bd.H > 2.0) {
      const w = Math.min(tt.w, tt.d);
      if (bd.seed < 0.4) {
        for (let q = 0; q < 4; q++) {
          const s = w * (0.8 - q * 0.19);
          att({ x, y: yTop + 0.03 + q * 0.06, z, sx: s, sy: 0.06, sz: s, parent: pc, mat: 1, r: trim[0], g: trim[1], b: trim[2] });
          att({ x, y: yTop + 0.062 + q * 0.06, z, sx: s + 0.012, sy: 0.008, sz: s + 0.012, parent: pc, mat: 2, r: nc[0], g: nc[1], b: nc[2] });
        }
        att({ x, y: yTop + 0.50, z, sx: 0.035, sy: 0.55, sz: 0.035, parent: pc, mat: 3, r: 0.9, g: 0.85, b: 0.75, geo: 2 });
        att({ x, y: yTop + 0.80, z, sx: 0.02, sy: 0.02, sz: 0.02, parent: pc, mat: 5, r: 1, g: 0.08, b: 0.05, geo: 3 });
      } else if (bd.seed < 0.75) {
        att({ x, y: yTop + 0.16, z, sx: w * 0.82, sy: 0.32, sz: w * 0.82, parent: pc, mat: 3, r: 0.35, g: 0.62, b: 0.52, geo: 4 });
        att({ x, y: yTop + 0.42, z, sx: 0.02, sy: 0.3, sz: 0.02, parent: pc, mat: 3, r: 0.95, g: 0.75, b: 0.35, geo: 2 });
        att({ x, y: yTop + 0.57, z, sx: 0.018, sy: 0.018, sz: 0.018, parent: pc, mat: 5, r: 1, g: 0.08, b: 0.05, geo: 3 });
      } else {
        att({ x, y: yTop + 0.1, z, sx: w * 0.9, sy: 0.2, sz: w * 0.9, parent: pc, mat: 4, r: nc[0] * 0.5 + 0.4, g: nc[1] * 0.5 + 0.4, b: nc[2] * 0.5 + 0.4, geo: 1 });
        att({ x, y: yTop + 0.23, z, sx: w * 0.6, sy: 0.1, sz: w * 0.6, parent: pc, mat: 1, r: trim[0], g: trim[1], b: trim[2], geo: 1 });
        att({ x, y: yTop + 0.46, z, sx: 0.03, sy: 0.4, sz: 0.03, parent: pc, mat: 3, r: 0.9, g: 0.85, b: 0.75, geo: 2 });
      }
      light(x, yTop + 0.15, z, nc, 0.8, w + 0.45, pc, 1);
    } else {
      // rooftop plant
      const n = 1 + (R() * 3 | 0);
      for (let q = 0; q < n; q++) {
        const s = 0.04 + R() * 0.05, px = x + (R() - 0.5) * (tt.w - 0.12), pz = z + (R() - 0.5) * (tt.d - 0.12);
        att({ x: px, y: yTop + s * 0.35, z: pz, sx: s * 1.3, sy: s * 0.7, sz: s, parent: chunkAt(b, px, yTop, pz), mat: 1, r: 0.42, g: 0.43, b: 0.45 });
      }
      if (R() < 0.35) {
        const px = x + (R() - 0.5) * tt.w * 0.4, pz = z + (R() - 0.5) * tt.d * 0.4, p = chunkAt(b, px, yTop, pz);
        att({ x: px, y: yTop + 0.1, z: pz, sx: 0.085, sy: 0.085, sz: 0.085, parent: p, mat: 1, r: 0.36, g: 0.22, b: 0.13, geo: 1 });
        att({ x: px, y: yTop + 0.165, z: pz, sx: 0.095, sy: 0.045, sz: 0.095, parent: p, mat: 1, r: 0.25, g: 0.16, b: 0.1, geo: 2 });
        att({ x: px, y: yTop + 0.03, z: pz, sx: 0.06, sy: 0.06, sz: 0.06, parent: p, mat: 1, r: 0.2, g: 0.2, b: 0.2 });
      }
    }
    // street level: marquee canopy, shop glow, blade sign
    const faces = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const t0 = tiers[0];
    const side = (R() * 4) | 0;
    faces.forEach(([nx, nz], fi) => {
      const hw = (nx ? t0.d : t0.w) / 2, px = x + nx * t0.w / 2, pz = z + nz * t0.d / 2;
      const g = NEON[(R() * NEON.length) | 0];
      light(px + nx * 0.05, LAND + 0.05, pz + nz * 0.05, [lerp(g[0], 1, 0.45), lerp(g[1], 0.82, 0.45), lerp(g[2], 0.6, 0.45)], 0.24, hw + 0.16, chunkAt(b, px, LAND + 0.1, pz), 2);
      if (R() < 0.62 || fi === side) {
        const cw = Math.min(hw * 1.1, 0.16), p = chunkAt(b, px, LAND + 0.1, pz);
        att({ x: px + nx * 0.028, y: LAND + 0.083, z: pz + nz * 0.028, sx: nx ? 0.06 : cw * 2, sy: 0.014, sz: nx ? cw * 2 : 0.06, parent: p, mat: 1, r: 0.12, g: 0.11, b: 0.11 });
        att({ x: px + nx * 0.058, y: LAND + 0.083, z: pz + nz * 0.058, sx: nx ? 0.004 : cw * 2, sy: 0.012, sz: nx ? cw * 2 : 0.004, parent: p, mat: 6, r: g[0], g: g[1], b: g[2] });
        att({ x: px + nx * 0.03, y: LAND + 0.0735, z: pz + nz * 0.03, sx: nx ? 0.05 : cw * 1.9, sy: 0.003, sz: nx ? cw * 1.9 : 0.05, parent: p, mat: 4, r: 1, g: 0.8, b: 0.5 });
        light(px + nx * 0.09, LAND + 0.06, pz + nz * 0.09, g, 0.62, 0.3, p, 2);
      }
    });
    // blade sign
    if (bd.H > 0.45 && R() < 0.72) {
      const [nx, nz] = faces[side], px = x + nx * (t0.w / 2 + 0.045), pz = z + nz * (t0.d / 2 + 0.045);
      const off = (R() - 0.5) * 0.3 * (nx ? t0.d : t0.w);
      const sh = Math.min(0.62, 0.2 + t0.y1 - t0.y0 > 0.9 ? 0.62 : 0.34), yy = LAND + 0.16 + sh / 2;
      const sx = px + (nx ? 0 : off), sz = pz + (nx ? off : 0);
      const p = chunkAt(b, sx, yy, sz);
      signs.push({ x: sx, y: yy, z: sz, w: 0.085, h: sh, ry: nx ? 0 : Math.PI / 2, parent: p, vert: 1, c: NEON[(R() * NEON.length) | 0], word: (R() * 16) | 0 });
      light(sx, yy - sh * 0.3, sz, signs[signs.length - 1].c, 1.15, 0.42, p, 1);
    }
    if (bd.H > 0.9 && bd.H < 2.6 && R() < 0.3) {
      const [nx, nz] = faces[(R() * 4) | 0];
      const sx = x + nx * (tt.w / 2 - 0.02), sz = z + nz * (tt.d / 2 - 0.02), yy = yTop + 0.1, p = chunkAt(b, sx, yTop, sz);
      signs.push({ x: sx, y: yy, z: sz, w: Math.min(0.5, (nx ? tt.d : tt.w) * 0.9), h: 0.13, ry: nx ? Math.PI / 2 : 0, parent: p, vert: 0, c: NEON[(R() * NEON.length) | 0], word: (R() * 16) | 0 });
      light(sx + nx * 0.1, yy, sz + nz * 0.1, signs[signs.length - 1].c, 1.3, 0.5, p, 1);
    }
  }

  // ---- clubs: thin wall / roof panels around a hollow interior
  const clubs = [];
  function addClub(x, z, w, d, h, name, hue) {
    const b = B.length, k = clubs.length;
    const bd = { x, z, y0: LAND, w, d, style: 6, col: [0.05, 0.045, 0.06], neon: hue, seed: R(), first: C.length, count: 0, H: h, layers: 2, kind: 3, club: k, power: 1, tiers: [{ y0: LAND, w, d }], name };
    B.push(bd);
    const n = 4, cw = w / n, cd = d / n, th = 0.014;
    for (let i = 0; i < n; i++) {
      for (const s of [-1, 1]) {
        C.push({ x: x + (i + 0.5) * cw - w / 2, y: LAND + h / 2, z: z + s * (d / 2 - th), hx: cw / 2, hy: h / 2, hz: th, b, mask: s > 0 ? 16 : 32, layer: 0, kind: 10 + (s > 0 ? 0 : 1) });
        C.push({ x: x + s * (w / 2 - th), y: LAND + h / 2, z: z + (i + 0.5) * cd - d / 2, hx: th, hy: h / 2, hz: cd / 2, b, mask: s > 0 ? 1 : 2, layer: 0, kind: 12 + (s > 0 ? 0 : 1) });
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C.push({ x: x + (i + 0.5) * cw - w / 2, y: LAND + h + 0.012, z: z + (j + 0.5) * cd - d / 2, hx: cw / 2, hy: 0.012, hz: cd / 2, b, mask: 4, layer: 1, kind: 14 });
    bd.count = C.length - bd.first;
    const st = { x: x, y: LAND, z: z - d / 2 + 0.07 };
    // floor, stage, LED wall, booth, speakers, bar, trusses, mirror ball
    att({ x, y: LAND + 0.004, z, sx: w - 0.04, sy: 0.006, sz: d - 0.04, mat: 1, r: 0.03, g: 0.03, b: 0.035 });
    att({ x, y: LAND + 0.009, z: z + 0.03, sx: w * 0.66, sy: 0.006, sz: d * 0.56, mat: 10, r: k, g: 0, b: 0 });
    att({ x, y: LAND + 0.018, z: st.z, sx: w * 0.62, sy: 0.022, sz: 0.1, mat: 1, r: 0.05, g: 0.05, b: 0.06 });
    att({ x, y: LAND + 0.11, z: z - d / 2 + 0.034, sx: w * 0.78, sy: 0.14, sz: 0.006, mat: 11, r: k, g: 0, b: 0 });
    att({ x, y: LAND + 0.046, z: st.z + 0.012, sx: 0.13, sy: 0.036, sz: 0.028, mat: 11, r: k, g: 1, b: 0 });
    for (const s of [-1, 1]) {
      att({ x: x + s * w * 0.36, y: LAND + 0.07, z: st.z, sx: 0.05, sy: 0.12, sz: 0.05, mat: 12, r: 0.02, g: 0.02, b: 0.02 });
      att({ x: x + s * (w / 2 - 0.055), y: LAND + 0.02, z: z + 0.04, sx: 0.028, sy: 0.034, sz: d * 0.5, mat: 1, r: 0.22, g: 0.11, b: 0.05 });
      att({ x: x + s * (w / 2 - 0.055), y: LAND + 0.0385, z: z + 0.04, sx: 0.034, sy: 0.004, sz: d * 0.51, mat: 4, r: hue[0] * 0.1 + 0.02, g: hue[1] * 0.1 + 0.02, b: hue[2] * 0.1 + 0.02 });
      att({ x: x + s * (w / 2 - 0.031), y: LAND + 0.07, z: z + 0.04, sx: 0.004, sy: 0.07, sz: d * 0.46, mat: 13, r: hue[0], g: hue[1], b: hue[2] });
    }
    for (let q = -1; q <= 1; q++) att({ x, y: LAND + h - 0.012, z: z + q * d * 0.28, sx: w * 0.9, sy: 0.007, sz: 0.007, mat: 1, r: 0.3, g: 0.3, b: 0.32 });
    att({ x, y: LAND + h - 0.045, z: z + 0.03, sx: 0.035, sy: 0.035, sz: 0.035, mat: 14, r: 1, g: 1, b: 1, geo: 3 });
    // exterior neon outline and marquee
    for (const s of [-1, 1]) for (let q = 0; q < 3; q++) {
      const yy = LAND + h * (0.45 + q * 0.25), pz = z + s * (d / 2 + 0.006), px = x + s * (w / 2 + 0.006);
      for (let i = 0; i < n; i++) {
        att({ x: x + (i + 0.5) * cw - w / 2, y: yy, z: pz, sx: cw, sy: 0.007, sz: 0.007, parent: chunkAt(b, x + (i + 0.5) * cw - w / 2, LAND + h / 2, z + s * d / 2), mat: 2, r: hue[0], g: hue[1], b: hue[2] });
        att({ x: px, y: yy, z: z + (i + 0.5) * cd - d / 2, sx: 0.007, sy: 0.007, sz: cd, parent: chunkAt(b, x + s * w / 2, LAND + h / 2, z + (i + 0.5) * cd - d / 2), mat: 2, r: hue[0], g: hue[1], b: hue[2] });
      }
    }
    signs.push({ x, y: LAND + h + 0.1, z: z + d / 2 - 0.02, w: 0.56, h: 0.15, ry: 0, parent: chunkAt(b, x, LAND + h + 0.01, z + d / 2 - 0.05), vert: 0, c: hue, word: 16 + k });
    light(x, LAND + h + 0.1, z + d / 2 + 0.16, hue, 1.1, 0.5, -1, 1);
    for (const s of [-1, 1]) for (const q of [-0.2, 0.2]) { light(x + s * (w / 2 + 0.13), LAND + 0.08, z + q, hue, 0.9, 0.24, -1, 2); light(x + q, LAND + 0.08, z + s * (d / 2 + 0.13), hue, 0.9, 0.24, -1, 2); }
    clubs.push({ x, z, w, d, h, y: LAND, b, hue, name, open: 0 });
    return b;
  }

  // ---- zoning
  const blocks = [];
  for (let j = -GN; j < GN; j++) for (let i = -GN; i < GN; i++) {
    const cx = i + 0.5, cz = j + 0.5;
    const dm = Math.min(islandD(i, j), islandD(i + 1, j), islandD(i, j + 1), islandD(i + 1, j + 1));
    const dc = islandD(cx, cz);
    if (dm > 0.62 && Math.hypot(cx - 5.5, cz - 6.2) > 1.6) blocks.push({ i, j, cx, cz, full: dm > 0.86 });
  }
  // promenade cells too close to the water for buildings become planted plazas
  const plazas = [];
  for (let j = -GN; j < GN; j++) for (let i = -GN; i < GN; i++) { if (blocks.some((b) => b.i === i && b.j === j)) continue; const cx = i + 0.5, cz = j + 0.5; if (islandD(cx, cz) > 0.8 && Math.hypot(cx - 5.5, cz - 6.2) > 1.6) { blockT[idx(i, j)] = 2; plazas.push({ i, j, cx, cz }); } }
  const CLUBS = [[-1.5, 0.5, 'MIRAGE', [0.1, 0.8, 1.0]], [1.5, 0.5, 'ORBIT', [1.0, 0.16, 0.5]], [3.5, 2.5, 'LUMEN', [0.35, 1.0, 0.35]]];
  const isBlk = (a, x, z) => Math.abs(a.cx - x) < 0.1 && Math.abs(a.cz - z) < 0.1;
  let wheel = { x: -3.55, z: 3.6, r: 0.82 };
  const towerBlocks = [];
  for (const bl of blocks) {
    const { cx, cz } = bl;
    const club = CLUBS.findIndex((c) => isBlk(bl, c[0], c[1]));
    if (club >= 0) { addClub(cx, cz, 0.6, 0.6, 0.2, CLUBS[club][2], CLUBS[club][3]); blockT[idx(bl.i, bl.j)] = 4; continue; }
    const dd = Math.hypot(cx * 0.9 - 0.2, cz + 1.4);
    if (isBlk(bl, 0.5, 1.5) || isBlk(bl, -0.5, 1.5) || isBlk(bl, -3.5, 3.5) || isBlk(bl, -4.5, -2.5) || isBlk(bl, 3.5, -3.5)) { blockT[idx(bl.i, bl.j)] = 2; continue; }
    if (!bl.full || islandD(cx, cz) < 0.9) { blockT[idx(bl.i, bl.j)] = 2; continue; }
    blockT[idx(bl.i, bl.j)] = 1;
    const tall = Math.exp(-dd * dd / 7.5);
    const rr = R();
    const style = () => { const q = R(); return q < 0.34 ? 0 : q < 0.5 ? 1 : q < 0.78 ? 2 : 3; };
    const col = (s) => (s === 1 ? STONE[R() < 0.6 ? 3 : 9] : s === 3 ? STONE[[2, 4, 6, 7][(R() * 4) | 0]] : s === 2 ? STONE[[0, 7, 8, 6, 8][(R() * 5) | 0]] : STONE[[0, 1, 5, 8, 0][(R() * 5) | 0]]);
    const nn = () => NEON[(R() * NEON.length) | 0];
    if (tall > 0.28 && rr < 0.78) {
      // skyscraper
      const L = Math.round(clamp(5 + tall * 14 * (0.66 + R() * 0.6), 6, 22));
      const s = R() < 0.55 ? 0 : R() < 0.6 ? 1 : 3;
      const w = 0.6, l1 = Math.max(2, Math.round(L * (0.34 + R() * 0.18))), l2 = Math.max(1, Math.round(L * 0.3)), l3 = Math.max(1, Math.round(L * 0.2)), l4 = Math.max(1, L - l1 - l2 - l3);
      const tiers = [{ w, d: w, nx: 3, nz: 3, layers: l1 }, { w: w * 0.8, d: w * 0.8, nx: 3, nz: 3, layers: l2 }, { w: w * 0.58, d: w * 0.58, nx: 2, nz: 2, layers: l3 }, { w: w * 0.36, d: w * 0.36, nx: 1, nz: 1, layers: l4 }];
      const b = addBuilding(cx, cz, w, w, tiers, { style: s, col: col(s), neon: nn(), kind: 1 });
      towerBlocks.push(b); dressTower(b);
    } else if (rr < 0.5 && tall > 0.06) {
      // twin slabs
      const s = style();
      for (const q of [-1, 1]) {
        const L = Math.round(clamp(3 + tall * 8 * R() + R() * 3, 2, 10));
        const tiers = [{ w: 0.29, d: 0.6, nx: 1, nz: 3, layers: Math.max(1, Math.round(L * 0.75)), round: s === 2 }];
        if (L > 4) tiers.push({ w: 0.22, d: 0.42, nx: 1, nz: 2, layers: Math.max(1, Math.round(L * 0.3)) });
        const st = R() < 0.5 ? s : style();
        dressTower(addBuilding(cx + q * 0.158, cz, 0.29, 0.6, tiers, { style: st, col: col(st), neon: nn() }));
      }
    } else if (rr < 0.82) {
      // four walk-ups / hotels
      for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
        const st = style(), L = 1 + ((R() * (2.2 + tall * 5)) | 0);
        const tiers = [{ w: 0.285, d: 0.285, nx: 2, nz: 2, layers: L, round: st === 2 }];
        dressTower(addBuilding(cx + qx * 0.158, cz + qz * 0.158, 0.285, 0.285, tiers, { style: st, col: col(st), neon: nn() }));
      }
    } else {
      // streamline block hotel
      const L = 3 + ((R() * 4) | 0);
      const tiers = [{ w: 0.6, d: 0.6, nx: 3, nz: 3, layers: L, round: true }];
      if (R() < 0.6) tiers.push({ w: 0.26, d: 0.26, nx: 1, nz: 1, layers: 2 });
      dressTower(addBuilding(cx, cz, 0.6, 0.6, tiers, { style: 2, col: col(2), neon: nn() }));
    }
  }

  // ---- bonds
  const N = C.length;
  const bonds = Array.from({ length: N }, () => []);
  for (const bd of B) {
    for (let a = bd.first; a < bd.first + bd.count; a++) for (let b = a + 1; b < bd.first + bd.count; b++) {
      const p = C[a], q = C[b], e = 0.006;
      const ox = p.hx + q.hx - Math.abs(p.x - q.x), oy = p.hy + q.hy - Math.abs(p.y - q.y), oz = p.hz + q.hz - Math.abs(p.z - q.z);
      if (ox < -e || oy < -e || oz < -e) continue;
      const m = [ox > 0.012, oy > 0.012, oz > 0.012];
      const cnt = m[0] + m[1] + m[2];
      if (cnt < 2 && bd.club < 0) continue;
      const vert = !m[1] ? 1 : 0;
      const area = vert ? Math.max(ox, 0.01) * Math.max(oz, 0.01) : Math.max(oy, 0.01) * Math.max(m[0] ? ox : oz, 0.01);
      bonds[a].push([b, vert, area]); bonds[b].push([a, vert, area]);
    }
  }

  // ---- street lamps along grid roads, palms along highway and in parks
  const lampC = [1.0, 0.74, 0.42];
  for (let j = -GN; j <= GN; j++) for (let i = -GN; i <= GN; i++) {
    if (hE[idx(i, j)] === 255) for (const s of [-1, 1]) { const x = i + 0.3 + (s > 0 ? 0.4 : 0), z = j + s * 0.155; lamps.push({ x, z, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 }); }
    if (vE[idx(i, j)] === 255) for (const s of [-1, 1]) { const z = j + 0.3 + (s > 0 ? 0.4 : 0), x = i + s * 0.155; lamps.push({ x, z, ry: s > 0 ? Math.PI : 0 }); }
  }
  for (let k = 0; k < hwy.length; k += 12) {
    const p = hwy[k], q = hwy[(k + 1) % hwy.length], tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l; // inland normal
    const s = (k / 12) % 2 ? 1 : -1;
    const x = p[0] + nx * s * (HWYW + 0.03), z = p[1] + nz * s * (HWYW + 0.03);
    lamps.push({ x, z, ry: Math.atan2(nz * s, -nx * s) });
  }
  for (const l of lamps) light(l.x + Math.cos(l.ry) * 0.05, LAND + 0.14, l.z - Math.sin(l.ry) * 0.05, lampC, 1.15, 0.52, -2 - lamps.indexOf(l), 3);

  const tree = (x, z, kind, s) => trees.push({ x, z, y: height(x, z), kind, s, ry: R() * 6.28, seed: R() });
  for (let k = 4; k < hwy.length; k += 5) {
    const p = hwy[k], q = hwy[(k + 1) % hwy.length], tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    if (R() < 0.8) tree(p[0] - nx * (HWYW + 0.07 + R() * 0.04), p[1] - nz * (HWYW + 0.07 + R() * 0.04), 0, 0.85 + R() * 0.5);
    if (R() < 0.5) tree(p[0] + nx * (HWYW + 0.07), p[1] + nz * (HWYW + 0.07), 0, 0.75 + R() * 0.4);
  }
  for (const bl of [...blocks, ...plazas]) {
    const t = blockT[idx(bl.i, bl.j)];
    if (t === 2) {
      const n = 14 + (R() * 9 | 0);
      for (let q = 0; q < n; q++) {
        const x = bl.cx + (R() - 0.5) * 0.58, z = bl.cz + (R() - 0.5) * 0.58;
        if (islandD(x, z) < HWY + HWYW + 0.08) continue;
        if (Math.hypot(x - wheel.x, z - wheel.z) < 0.35) continue;
        if (Math.hypot(x - bl.cx, z - bl.cz) < 0.13) continue;
        tree(x, z, R() < 0.35 ? 0 : 1, 0.7 + R() * 0.6);
      }
    } else if (t === 1) {
      for (let q = 0; q < 8; q++) if (R() < 0.42) { const s = q < 4 ? -1 : 1, u = (q % 4) * 0.19 - 0.29; const hor = R() < 0.5; tree(bl.cx + (hor ? u : s * 0.335), bl.cz + (hor ? s * 0.335 : u), R() < 0.6 ? 0 : 1, 0.45 + R() * 0.25); }
    }
  }

  // ---- beach umbrellas, pier, bridge, lighthouse, ferris wheel frame as static attachments
  const props = { wheel };
  for (let k = 0; k < hwy.length; k += 2) {
    const p = hwy[k], q = hwy[(k + 1) % hwy.length], tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    if (R() < 0.55) {
      const o = 0.3 + R() * 0.17, x = p[0] - nx * o, z = p[1] - nz * o, y = height(x, z);
      if (y < SEA + 0.05) continue;
      const c = [[0.85, 0.2, 0.15], [0.95, 0.75, 0.2], [0.1, 0.5, 0.6], [0.9, 0.9, 0.86], [0.2, 0.6, 0.4]][(R() * 5) | 0];
      att({ x, y: y + 0.028, z, sx: 0.0025, sy: 0.056, sz: 0.0025, mat: 1, r: 0.8, g: 0.8, b: 0.8 });
      att({ x, y: y + 0.057, z, sx: 0.058, sy: 0.016, sz: 0.058, mat: 1, r: c[0], g: c[1], b: c[2], geo: 2 });
      for (const s of [-1, 1]) att({ x: x + s * 0.016, y: y + 0.006, z: z + 0.012, sx: 0.012, sy: 0.004, sz: 0.036, ry: R() * 0.4, mat: 1, r: 0.9, g: 0.88, b: 0.82 });
    }
  }
  // bridge across the lagoon mouth
  {
    const bz = 4.95; let x0 = -0.2, x1 = -0.2;
    while (islandD(x0, bz) < HWY - 0.02 && x0 > -5) x0 -= 0.02;
    while (islandD(x1, bz) < HWY - 0.02 && x1 < 5) x1 += 0.02;
    const L = x1 - x0, deckY = (x) => { const u = (x - x0) / L; return LAND + 0.02 + 0.46 * (4 * u * (1 - u)) ** 0.75; };
    props.bridge = { x0, x1, z: bz, deckY };
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = x0 + (i / n) * L, b2 = x0 + ((i + 1) / n) * L, ya = deckY(a), yb = deckY(b2), m = (a + b2) / 2, y = (ya + yb) / 2, ang = Math.atan2(yb - ya, b2 - a), len = Math.hypot(b2 - a, yb - ya) * 1.04;
      att({ x: m, y: y - 0.012, z: bz, sx: len, sy: 0.022, sz: 0.24, rz: ang, mat: 7, r: 0.05, g: 0.05, b: 0.055 });
      for (const s of [-1, 1]) { att({ x: m, y: y + 0.012, z: bz + s * 0.118, sx: len, sy: 0.012, sz: 0.005, rz: ang, mat: 1, r: 0.55, g: 0.2, b: 0.12 }); if (i % 2 === 0) { att({ x: m, y: y + 0.02, z: bz + s * 0.121, sx: len * 0.9, sy: 0.004, sz: 0.004, rz: ang, mat: 2, r: 0.1, g: 0.85, b: 1.0 }); light(m, y, bz + s * 0.13, [0.1, 0.8, 1], 0.35, 0.3, -1, 1); } }
    }
    const t1 = x0 + L * 0.27, t2 = x0 + L * 0.73, topY = LAND + 1.45;
    for (const t of [t1, t2]) {
      for (const s of [-1, 1]) {
        att({ x: t, y: (topY - 4.2) / 2 + 0.6, z: bz + s * 0.135, sx: 0.05, sy: topY + 3.0, sz: 0.04, mat: 1, r: 0.62, g: 0.2, b: 0.11 });
        att({ x: t, y: topY - 0.1, z: bz + s * 0.158, sx: 0.03, sy: 0.8, sz: 0.006, mat: 2, r: 1, g: 0.45, b: 0.08 });
        att({ x: t, y: topY + 0.02, z: bz + s * 0.135, sx: 0.07, sy: 0.04, sz: 0.06, mat: 1, r: 0.62, g: 0.2, b: 0.11 });
        light(t, topY - 0.2, bz + s * 0.2, [1, 0.45, 0.1], 0.9, 0.5, -1, 1);
      }
      for (let q = 0; q < 3; q++) att({ x: t, y: deckY(t) + 0.28 + q * 0.28, z: bz, sx: 0.035, sy: 0.035, sz: 0.25, mat: 1, r: 0.62, g: 0.2, b: 0.11 });
    }
    const cable = (x) => {
      if (x < t1) { const u = (x - x0) / (t1 - x0); return lerp(deckY(x0) + 0.05, topY, u * u * 0.6 + u * 0.4); }
      if (x > t2) { const u = (x1 - x) / (x1 - t2); return lerp(deckY(x1) + 0.05, topY, u * u * 0.6 + u * 0.4); }
      const u = (x - t1) / (t2 - t1) * 2 - 1; return lerp(deckY((t1 + t2) / 2) + 0.09, topY, u * u);
    };
    const m = 64;
    for (let i = 0; i < m; i++) {
      const a = x0 + (i / m) * L, b2 = x0 + ((i + 1) / m) * L, ya = cable(a), yb = cable(b2), ang = Math.atan2(yb - ya, b2 - a), len = Math.hypot(b2 - a, yb - ya) * 1.03;
      for (const s of [-1, 1]) {
        att({ x: (a + b2) / 2, y: (ya + yb) / 2, z: bz + s * 0.135, sx: len, sy: 0.012, sz: 0.012, rz: ang, mat: 2, r: 1, g: 0.72, b: 0.38, dim: 0.07 });
        const dy = deckY(a); if (i % 2 && ya - dy > 0.04) att({ x: a, y: (ya + dy) / 2, z: bz + s * 0.128, sx: 0.0035, sy: ya - dy, sz: 0.0035, mat: 1, r: 0.5, g: 0.5, b: 0.5 });
      }
    }
  }
  // lighthouse
  {
    const x = 5.55, z = 6.25, y = height(x, z) - 0.03;
    for (let q = 0; q < 9; q++) { const s = 0.2 - q * 0.011; att({ x, y: y + 0.06 + q * 0.11, z, sx: s, sy: 0.112, sz: s, mat: 1, r: q % 2 ? 0.75 : 0.9, g: q % 2 ? 0.12 : 0.88, b: q % 2 ? 0.1 : 0.82, geo: 1 }); }
    att({ x, y: y + 1.02, z, sx: 0.17, sy: 0.02, sz: 0.17, mat: 1, r: 0.1, g: 0.1, b: 0.1, geo: 1 });
    att({ x, y: y + 1.08, z, sx: 0.085, sy: 0.1, sz: 0.085, mat: 4, r: 1, g: 0.9, b: 0.7, geo: 1 });
    att({ x, y: y + 1.17, z, sx: 0.13, sy: 0.08, sz: 0.13, mat: 1, r: 0.6, g: 0.1, b: 0.08, geo: 2 });
    props.lighthouse = { x, y: y + 1.08, z };
    light(x, y + 1.08, z, [1, 0.88, 0.6], 2, 0.6, -1, 1);
  }
  // ferris wheel legs
  {
    const w = wheel; w.y = LAND + w.r + 0.14;
    for (const s of [-1, 1]) for (const q of [-1, 1]) { const len = Math.hypot(w.y - LAND, 0.42); att({ x: w.x + q * 0.21, y: (w.y + LAND) / 2, z: w.z + s * 0.1, sx: 0.028, sy: len, sz: 0.028, rz: q * Math.atan2(0.42, w.y - LAND), mat: 1, r: 0.8, g: 0.8, b: 0.82 }); }
    att({ x: w.x, y: w.y, z: w.z, sx: 0.06, sy: 0.06, sz: 0.28, mat: 3, r: 0.9, g: 0.75, b: 0.4 });
    att({ x: w.x, y: LAND + 0.02, z: w.z, sx: 0.5, sy: 0.04, sz: 0.3, mat: 1, r: 0.25, g: 0.25, b: 0.28 });
    light(w.x, w.y, w.z, [1, 0.5, 0.2], 1.0, 1.0, -1, 1); light(w.x, LAND + 0.1, w.z, [1, 0.5, 0.2], 1.0, 0.5, -1, 1);
  }
  // marina pontoons in lagoon
  for (let q = 0; q < 5; q++) {
    const x = -1.5 + q * 0.75, z = 2.95;
    if (islandD(x, z + 0.3) > 0.1) continue;
    att({ x, y: SEA + 0.05, z: z + 0.05, sx: 0.06, sy: 0.02, sz: 0.9, mat: 1, r: 0.34, g: 0.24, b: 0.15 });
    for (let t = 0; t < 4; t++) { att({ x: x - 0.028, y: SEA + 0.02, z: z - 0.35 + t * 0.27, sx: 0.012, sy: 0.2, sz: 0.012, mat: 1, r: 0.2, g: 0.15, b: 0.1 }); light(x, SEA + 0.1, z - 0.35 + t * 0.27, [1, 0.7, 0.4], 0.5, 0.22, -1, 3); }
  }
  // plaza fountain
  for (const px of [0.5, -0.5]) {
    att({ x: px, y: LAND + 0.012, z: 1.5, sx: 0.2, sy: 0.024, sz: 0.2, mat: 1, r: 0.6, g: 0.58, b: 0.54, geo: 1 });
    att({ x: px, y: LAND + 0.026, z: 1.5, sx: 0.18, sy: 0.004, sz: 0.18, mat: 4, r: 0.05, g: 0.5, b: 0.7, geo: 1, dim: 0.4 });
    att({ x: px, y: LAND + 0.05, z: 1.5, sx: 0.05, sy: 0.07, sz: 0.05, mat: 3, r: 0.9, g: 0.7, b: 0.35, geo: 2 });
    light(px, LAND + 0.06, 1.5, [0.1, 0.7, 1], 1.4, 0.4, -1, 2);
  }

  for (let j = -GN; j <= GN; j++) for (let i = -GN; i <= GN; i++) { const k = idx(i, j); roadTex[k * 4] = hE[k]; roadTex[k * 4 + 1] = vE[k]; roadTex[k * 4 + 2] = nodeOK[k] * 255; roadTex[k * 4 + 3] = blockT[k] * 50; }

  return { H, D, height, dist, idx, S, nodeOK, hE, vE, blockT, roadTex, hwy, hwyLen, B, C, A, bonds, lights, lamps, trees, signs, clubs, blocks, plazas, props, NEON, R };
}
