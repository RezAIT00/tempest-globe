// Render pipeline: shadow, top depth, light volume, G-buffer, resolve, volumetrics, sprites, composite, TAA, lens.
import * as THREE from 'three';
import { HN, HS, RI, RO, LAND, SEA } from './world.js';
import { rng, fbm2 } from './util.js';
import * as M from './models.js';
import * as CITY from './glsl_city.js';
import * as LIFE from './glsl_life.js';
import * as POST from './glsl_post.js';
import { HEAD } from './glsl_common.js';
import { instGeo, dyn } from './fx.js';

const V2 = THREE.Vector2, V3 = THREE.Vector3, V4 = THREE.Vector4, M4 = THREE.Matrix4;

function noise2() {
  const n = 256, d = new Uint8Array(n * n * 4);
  const layer = (per, seed) => { const R = rng(seed), g = new Float32Array(per * per); for (let i = 0; i < g.length; i++) g[i] = R(); return (x, y) => { const fx = x * per, fy = y * per, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), q = (p, r) => g[(((r % per) + per) % per) * per + (((p % per) + per) % per)]; return (q(i, j) * (1 - a) + q(i + 1, j) * a) * (1 - b) + (q(i, j + 1) * (1 - a) + q(i + 1, j + 1) * a) * b; }; };
  const L1 = [4, 8, 16, 32, 64].map((p, i) => layer(p, 11 + i)), L2 = [16, 32, 64, 128].map((p, i) => layer(p, 41 + i)), L3 = [3, 6, 12, 24].map((p, i) => layer(p, 71 + i));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n; let a = 0, b = 0, c = 0, w = 0.5, s = 0; for (const l of L1) { a += l(u, v) * w; s += w; w *= 0.55; } a /= s; w = 0.5; s = 0; for (const l of L2) { b += l(u, v) * w; s += w; w *= 0.65; } b /= s; w = 0.5; s = 0; for (const l of L3) { c += l(u, v) * w; s += w; w *= 0.6; } c /= s;
    const k = (y * n + x) * 4, st = (q, g) => Math.max(0, Math.min(255, ((q - 0.5) * g + 0.5) * 255)); d[k] = st(a, 1.75); d[k + 1] = st(b, 1.6); d[k + 2] = st(c, 1.6); d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; return t;
}
function noise3() {
  const n = 48, d = new Uint8Array(n * n * n * 4), R = rng(123);
  const val = (per) => { const g = new Float32Array(per ** 3); for (let i = 0; i < g.length; i++) g[i] = R(); return (x, y, z) => { const X = x * per, Y = y * per, Z = z * per, i = X | 0, j = Y | 0, k = Z | 0, u = X - i, v = Y - j, w = Z - k, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), c = w * w * (3 - 2 * w), q = (p, r, t) => g[((t % per) * per + (r % per)) * per + (p % per)], l = (A, B, T) => A + (B - A) * T; return l(l(l(q(i, j, k), q(i + 1, j, k), a), l(q(i, j + 1, k), q(i + 1, j + 1, k), a), b), l(l(q(i, j, k + 1), q(i + 1, j, k + 1), a), l(q(i, j + 1, k + 1), q(i + 1, j + 1, k + 1), a), b), c); }; };
  const wor = (per) => { const g = new Float32Array(per ** 3 * 3); for (let i = 0; i < g.length; i++) g[i] = R(); return (x, y, z) => { const X = x * per, Y = y * per, Z = z * per, i = X | 0, j = Y | 0, k = Z | 0; let m = 9; for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const q = ((((k + c + per) % per) * per + ((j + b + per) % per)) * per + ((i + a + per) % per)) * 3, dx = i + a + g[q] - X, dy = j + b + g[q + 1] - Y, dz = k + c + g[q + 2] - Z, s = dx * dx + dy * dy + dz * dz; if (s < m) m = s; } return 1 - Math.min(1, Math.sqrt(m)); }; };
  const v1 = val(5), v2 = val(10), v3 = val(20), w1 = wor(5), w2 = wor(11), w3 = wor(16);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = x / n, b = y / n, c = z / n, p = v1(a, b, c) * 0.55 + v2(a, b, c) * 0.3 + v3(a, b, c) * 0.15, w = w1(a, b, c), W = w2(a, b, c) * 0.62 + w3(a, b, c) * 0.38, k = ((z * n + y) * n + x) * 4; d[k] = Math.max(0, Math.min(255, (p * 0.62 + w * 0.5 - 0.06) * 255)); d[k + 1] = Math.max(0, Math.min(255, W * 1.15 * 255)); d[k + 2] = p * 255; d[k + 3] = 255; }
  const t = new THREE.Data3DTexture(d, n, n, n); t.format = THREE.RGBAFormat; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}
function atlas(clubNames) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 2048, 1024);
  const words = ['HOTEL', 'BAR', 'CINEMA', 'JAZZ', 'OYSTERS', 'LIDO', 'BALLROOM', 'GRAND', 'DINER', 'PALACE', 'TROPIC', 'SIROCCO', 'LOUNGE', 'CABARET', 'PEARL', 'BILLIARDS', ...clubNames];
  const font = (s) => `600 ${s}px "Century Gothic","Futura","Avenir Next","Trebuchet MS",sans-serif`;
  const neon = (t, cx, cy, s) => { x.font = font(s); x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.globalCompositeOperation = 'lighter'; x.shadowColor = 'rgba(255,0,0,.9)'; x.shadowBlur = s * 0.22; x.strokeStyle = 'rgb(225,0,0)'; x.lineWidth = s * 0.1; x.strokeText(t, cx, cy); x.shadowBlur = 0; x.strokeStyle = 'rgb(255,255,0)'; x.lineWidth = s * 0.045; x.strokeText(t, cx, cy); x.globalCompositeOperation = 'source-over'; };
  words.forEach((w, i) => {
    const W = 2048 / 20, X = i * W; x.fillStyle = 'rgb(0,0,26)'; x.fillRect(X + 4, 4, W - 8, 504); x.globalCompositeOperation = 'lighter'; x.strokeStyle = 'rgb(140,60,120)'; x.lineWidth = 4; x.strokeRect(X + 9, 9, W - 18, 494); x.globalCompositeOperation = 'source-over';
    const n = w.length, st = Math.min(84, 470 / n); for (let k = 0; k < n; k++) neon(w[k], X + W / 2, 256 + (k - (n - 1) / 2) * st, Math.min(72, st * 0.92));
    const cx = ((i % 4) + 0.5) * 512, cy = 512 + (Math.floor(i / 4) + 0.5) * 102.4; x.fillStyle = 'rgb(0,0,22)'; x.fillRect(cx - 250, cy - 48, 500, 96); x.globalCompositeOperation = 'lighter'; x.strokeStyle = 'rgb(120,50,110)'; x.lineWidth = 4; x.strokeRect(cx - 246, cy - 44, 492, 88); x.globalCompositeOperation = 'source-over'; x.save(); x.translate(cx, cy); const tw = (x.font = font(74), x.measureText(w).width); const k = Math.min(1, 450 / tw); x.scale(k, 1); neon(w, 0, 3, 74); x.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; return t;
}

export class Renderer {
  constructor(canvas, world, life, chaos, parts, beams, lights, lightsDyn, cones, glitter) {
    this.world = world; this.life = life; this.chaos = chaos;
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, depth: false, stencil: false, preserveDrawingBuffer: !!window.__KEEP })); r.autoClear = false; r.setPixelRatio(1); r.info.autoReset = false; r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.debug.checkShaderErrors = !!window.__DBG;
    this.cam = new THREE.Camera(); this.scale = 1; this.frame = 0; this.kx = 0; this.reset = 1;
    const T = (t) => ({ value: t });
    const hd = new Float32Array(HN * HN * 4); for (let i = 0; i < HN * HN; i++) { hd[i * 4] = world.H[i]; hd[i * 4 + 1] = world.D[i]; hd[i * 4 + 3] = 1; }
    const ht = new THREE.DataTexture(hd, HN, HN, THREE.RGBAFormat, THREE.FloatType); ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    const rt = new THREE.DataTexture(world.roadTex, 17, 17, THREE.RGBAFormat); rt.needsUpdate = true;
    this.bodyTex = new THREE.DataTexture(chaos.body, 256, chaos.body.length / 1024, THREE.RGBAFormat, THREE.FloatType); this.bodyTex.needsUpdate = true;
    const nb = world.B.length; this.bld = new Float32Array(4 * nb * 4); world.B.forEach((b, i) => this.bld.set([b.x, b.z, b.w, b.d, b.style, b.seed, b.H, 1, b.col[0], b.col[1], b.col[2], 0, b.neon[0], b.neon[1], b.neon[2], b.club], i * 16)); this.bldTex = new THREE.DataTexture(this.bld, 4, nb, THREE.RGBAFormat, THREE.FloatType); this.bldTex.needsUpdate = true;
    this.U = { uVP: T(new M4()), uPVP: T(new M4()), uIVP: T(new M4()), uShadowVP: T(new M4()), uCam: T(new V3()), uCamF: T(new V3()), uRes: T(new V4()), uTime: T(0), uRT: T(0), uFrame: T(0), uD: T(48), uNear: T(1), uFar: T(100), uSunDir: T(new V3(0, 1, 0)), uSunCol: T(new V3()), uAmbS: T(new V3()), uAmbG: T(new V3()), uHorizon: T(new V3()), uZenith: T(new V3()), uNight: T(1), uWet: T(1), uStorm: T(0), uRain: T(0), uFire: T(0), uCover: T(0.4), uSpin: T(0), uBeat: T(0), uPower: T(1), uShadowTexel: T(0.01), uFloodLvl: T(0), uGlitter: T(0), uWater: T(new V4(0, 1, 0, SEA)), uFlash: T(new V4()), uFlashC: T(new V3(0.62, 0.72, 1.0)), uGrav: T(new V3(0, -1.1, 0)), uWind: T(new V3()), uTor: T(new V4()), uTor2: T(new V4()), uWave: T(new V4()), uClubOpen: T(new V3()), uClubP: { value: [new V4(), new V4(), new V4()] }, uLight: T(null), uHeight: T(ht), uRoad: T(rt), uN2: T(noise2()), uN3: T(noise3()), uShadow: T(null), uTopD: T(null), uBody: T(this.bodyTex), uBld: T(this.bldTex), uAtlas: T(atlas(world.clubs.map((c) => c.name))), uWX: T(new V3(1, 0, 0)), uWZ: T(new V3(0, 0, 1)), uCol: T(null), uNrm: T(null), uDepth: T(null), uAOr: T(0.2), uHalf: T(new V2()), uG2W: T(new M4()), uW2G: T(new M4()), uCamW: T(new V3()), uIVPW: T(new M4()), uVPW: T(new M4()), uGlow: T(null), uGlowAvg: T(new V3(0.05, 0.06, 0.08)), uOpq: T(null), uClouds: T(null), uFx: T(null), uLens: T(0), uCur: T(null), uHist: T(null), uAux: T(null), uPVPW: T(new M4()), uPVPWi: T(new M4()), uIVPW2: T(new M4()), uJit: T(new V2()), uReset: T(1), uFocus: T(48), uApert: T(1), uCoc: T(null), uMaxR: T(0.012), uSrc: T(null), uBase: T(null), uTx: T(new V2()), uFirst: T(0), uMix: T(0.6), uSharp: T(null), uDofT: T(null), uBloom: T(null), uExpo: T(1), uBloomK: T(0.08), uSlow: T(0), uFadeIn: T(0), uOut: T(new V2(1, 1)), uOff: T(new V3()), uVel: T(new V3(0, -3, 0)), uCen: T(new V3()), uBox: T(19), uShut: T(0.012), uAlpha: T(1), uDrop: T(0.01) };
    this.sMain = new THREE.Scene(); this.sShadow = new THREE.Scene(); this.sLight = new THREE.Scene(); this.sFx = new THREE.Scene(); for (const s of [this.sMain, this.sShadow, this.sLight, this.sFx]) s.matrixAutoUpdate = false;
    this.buildScene(parts, beams, lights, lightsDyn, cones, glitter); this.buildPost(); this.statics();
  }
  mat(vs, fs, opt = {}, defs = {}) {
    const used = {}; for (const k in this.U) if (new RegExp('\\b' + k + '\\b').test(vs + fs)) used[k] = this.U[k]; if (opt.extra) for (const k in opt.extra) used[k] = opt.extra[k]; delete opt.extra;
    return new THREE.RawShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: used, glslVersion: THREE.GLSL3, defines: defs, side: THREE.DoubleSide, ...opt });
  }
  add(scene, geo, mat) { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.matrixAutoUpdate = false; scene.add(m); return m; }
  instOf(geo, I) { const g = new THREE.InstancedBufferGeometry(); for (const k of ['position', 'normal', 'color', 'aSpin', 'aLimb']) if (geo.attributes[k]) g.setAttribute(k, geo.attributes[k]); g.setIndex(geo.index); if (I) { g.setAttribute('iPos', I.pa); g.setAttribute('iQuat', I.qa); g.setAttribute('iCol', I.ca); g.instanceCount = I.n; } return g; }
  buildScene(parts, beams, lights, lightsDyn, cones, glitter) {
    const w = this.world, life = this.life, ch = this.chaos, SH = { SHADOW: 1 }, dfs = CITY.DEPTH_FS, dopt = { colorWrite: false };
    const pair = (geo, vs, fs, o = {}, d = {}) => { const { noShadow, ...oo } = o; const m = this.add(this.sMain, geo, this.mat(vs, fs, oo, d)); if (!noShadow) m.userData.sh = this.add(this.sShadow, geo, this.mat(vs, dfs, { ...dopt }, { ...d, ...SH })); return m; };
    // terrain
    { const n = 420, p = new Float32Array((n + 1) * (n + 1) * 3), ix = new Uint32Array(n * n * 6); let k = 0; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { p[k++] = (i / n - 0.5) * 19.2; p[k++] = 0; p[k++] = (j / n - 0.5) * 19.2; } k = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; ix[k++] = a; ix[k++] = a + n + 1; ix[k++] = a + 1; ix[k++] = a + 1; ix[k++] = a + n + 1; ix[k++] = a + n + 2; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setIndex(new THREE.BufferAttribute(ix, 1)); pair(g, CITY.TERR_VS, CITY.TERR_FS); }
    // chunks
    const chunk = (list, geo, d) => { const n = list.length; if (!n) return; const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', geo.attributes.position); g.setAttribute('normal', geo.attributes.normal); g.setIndex(geo.index); const H = new Float32Array(n * 3), E = new Float32Array(n * 3), I = new Float32Array(n * 4), D = new Float32Array(n); list.forEach((c, k) => { const q = w.C[c]; H.set([q.x, q.y, q.z], k * 3); E.set([q.hx, q.hy, q.hz], k * 3); I.set([q.b, q.mask, q.layer, q.kind], k * 4); D[k] = c; }); g.setAttribute('iHome', new THREE.InstancedBufferAttribute(H, 3)); g.setAttribute('iHalf', new THREE.InstancedBufferAttribute(E, 3)); g.setAttribute('iInfo', new THREE.InstancedBufferAttribute(I, 4)); g.setAttribute('iId', new THREE.InstancedBufferAttribute(D, 1)); g.instanceCount = n; pair(g, CITY.CHUNK_VS, CITY.CHUNK_FS, {}, d); };
    const box2 = new THREE.BoxGeometry(2, 2, 2); const boxes = [], rounds = []; w.C.forEach((c, i) => (c.kind > 0 && c.kind < 10 ? rounds : boxes).push(i)); chunk(boxes, box2, {});
    { const g = new M.GB(), prof = [[-1, -1], [0.2, -1]]; for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); prof.push([0.2 - 0.0 + 0.8 * Math.cos(a) * 1 - 0.0, 0.2 + 0.8 * Math.sin(a) - 0.4 + 0.4]); } prof.length = 2; for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push([-0.4 + 1.4 * Math.cos(a), -0.4 + 1.4 * Math.sin(a)]); } prof.splice(1, 1, [1, -1]); prof.push([-1, 1]); const N = prof.length;
      for (let i = 0; i < N; i++) { const A = prof[i], B = prof[(i + 1) % N]; g.patch([[A[0], -1, A[1]], [B[0], -1, B[1]], [B[0], 1, B[1]], [A[0], 1, A[1]]], [[0, 2, 1], [0, 3, 2]], [1, 1, 1]); const L = g.count - 4; if (i >= 2 && i < N - 2) { for (const [q, P] of [[0, A], [3, A], [1, B], [2, B]]) { const nx = P[0] + 0.4, nz = P[1] + 0.4, l = Math.hypot(nx, nz); g.n[(L + q) * 3] = nx / l; g.n[(L + q) * 3 + 1] = 0; g.n[(L + q) * 3 + 2] = nz / l; } } }
      for (const y of [-1, 1]) for (let i = 1; i < N - 1; i++) g.patch([[prof[0][0], y, prof[0][1]], [prof[i][0], y, prof[i][1]], [prof[i + 1][0], y, prof[i + 1][1]]], [y > 0 ? [0, 2, 1] : [0, 1, 2]], [1, 1, 1]); for (let q = 0; q < g.count; q++) { const k = q * 3, y = g.n[k + 1]; const d = Math.abs(y) > 0.5 ? y * g.p[k + 1] : g.n[k] * (g.p[k] + 0.2) + g.n[k + 2] * (g.p[k + 2] + 0.2); if (d < 0) { g.n[k] *= -1; g.n[k + 1] *= -1; g.n[k + 2] *= -1; } } chunk(rounds, g.build(), { ROUND: 1 }); }
    // attachments
    const unit = [new THREE.BoxGeometry(1, 1, 1), new THREE.CylinderGeometry(0.5, 0.5, 1, 14), new THREE.ConeGeometry(0.5, 1, 10), new THREE.SphereGeometry(0.5, 12, 8), new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1).translate(0, -0.5, 0)];
    const attGeo = (list, base) => { const n = list.length, P = new Float32Array(n * 4), S = new Float32Array(n * 4), C = new Float32Array(n * 4), R = new Float32Array(n * 3), B = new Float32Array(n); list.forEach((a, k) => { const c = a.parent >= 0 ? w.C[a.parent] : null; P.set([a.x - (c ? c.x : 0), a.y - (c ? c.y : 0), a.z - (c ? c.z : 0), a.parent], k * 4); S.set([a.sx, a.sy, a.sz, a.mat], k * 4); const dm = a.dim ?? 1; C.set([a.r * dm, a.g * dm, a.b * dm, a.seed], k * 4); R.set([a.ry || 0, a.rz || 0, 0], k * 3); B[k] = c ? c.b : -1; }); const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal); g.setIndex(base.index); g.setAttribute('iPos', new THREE.InstancedBufferAttribute(P, 4)); g.setAttribute('iScl', new THREE.InstancedBufferAttribute(S, 4)); g.setAttribute('iCol', new THREE.InstancedBufferAttribute(C, 4)); g.setAttribute('iRot', new THREE.InstancedBufferAttribute(R, 3)); g.setAttribute('iBld', new THREE.InstancedBufferAttribute(B, 1)); g.instanceCount = n; return g; };
    unit.forEach((base, k) => { const l = w.A.filter((a) => a.geo === k); if (l.length) pair(attGeo(l, base), CITY.ATT_VS, CITY.ATT_FS); });
    pair(attGeo(w.signs.map((s) => ({ x: s.x, y: s.y, z: s.z, sx: s.w, sy: s.h, sz: 0.016, ry: s.ry, parent: s.parent, mat: s.word + (s.vert ? 100 : 0), r: s.c[0], g: s.c[1], b: s.c[2], seed: Math.random() })), unit[0]), CITY.ATT_VS, CITY.SIGN_FS);
    // vehicles and machines
    const mesh = (geo, I, o = {}) => { const m = pair(this.instOf(geo, I), LIFE.MESH_VS, LIFE.MESH_FS, o); return m; };
    life.carInst.forEach((I, t) => mesh(M.carGeo(t), I)); mesh(M.heliGeo(), life.heliInst); life.boatInst.forEach((I, t) => mesh(M.yachtGeo(t), I)); mesh(M.airshipGeo(), life.shipInst); mesh(M.wheelGeo(), life.wheelInst); mesh(M.gondolaGeo(), life.gondInst); mesh(M.lampGeo(), ch.lampI); mesh(M.sharkGeo(), life.sharkInst, { noShadow: true }); mesh(M.dolphinGeo(), life.dolphInst, { noShadow: true });
    // tower cranes
    { const n = 40; this.crP = new Float32Array(n * 4); this.crQ = new Float32Array(n * 4); this.crC = new Float32Array(n * 4); const I = { pa: dyn(this.crP, 4), qa: dyn(this.crQ, 4), ca: dyn(this.crC, 4), n }; this.crI = I; pair(this.instOf(M.craneGeo(), I), LIFE.MESH_VS, LIFE.MESH_FS, {}, { CRANE: 1 }); }
    // people, two levels of detail sharing one set of instance buffers
    const ped = (geo) => { const g = new THREE.InstancedBufferGeometry(); for (const k of ['position', 'normal', 'aLimb']) g.setAttribute(k, geo.attributes[k]); g.setIndex(geo.index); g.setAttribute('iPos', life.pI.pa); g.setAttribute('iQuat', life.pI.qa); g.setAttribute('iAnim', life.pAnimA); g.setAttribute('iLook', life.pLookA); g.instanceCount = life.people.length; return pair(g, LIFE.PERSON_VS, LIFE.PERSON_FS); };
    this.pedHi = ped(M.person());
    // foliage
    this.add; [M.palmGeo(), M.treeGeo()].forEach((geo, k) => pair(this.instOf(geo, ch.treeI[k]), LIFE.FOL_VS, LIFE.FOL_FS));
    this.buildSea();
    // light volume
    const lm = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, depthTest: false, depthWrite: false, transparent: true };
    this.add(this.sLight, lights.geo, this.mat(POST.LIGHT_VS, POST.LIGHT_FS, { ...lm })); this.add(this.sLight, lightsDyn.geo, this.mat(POST.LIGHT_VS, POST.LIGHT_FS, { ...lm })); this.add(this.sLight, cones.geo, this.mat(POST.CONE_VS, POST.CONE_FS, { ...lm }));
    // sprites (premultiplied)
    const fm = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation, depthTest: false, depthWrite: false, transparent: true };
    const occl = (fs) => fs.replace('void main(){', 'uniform sampler2D uDepth; void main(){if(gl_FragCoord.z>texelFetch(uDepth,ivec2(gl_FragCoord.xy),0).r)discard;'), occl2 = (fs) => fs.replace('void main(){', 'void main(){if(gl_FragCoord.z>texelFetch(uDepth,ivec2(gl_FragCoord.xy),0).r)discard;');
    this.mPart = this.add(this.sFx, parts.geo, this.mat(POST.PART_VS, occl2(POST.PART_FS), { ...fm })); this.mBeam = this.add(this.sFx, beams.geo, this.mat(POST.BEAM_VS, POST.BEAM_FS, { ...fm })); this.mGlit = this.add(this.sFx, glitter.geo, this.mat(POST.GLIT_VS, occl(POST.GLIT_FS), { ...fm }));
    this.rain = []; for (let k = 0; k < 3; k++) { const n = 13000, s = new Float32Array(n * 4), R = rng(77 + k); for (let i = 0; i < n * 4; i++) s[i] = R(); const g = instGeo(n); g.setAttribute('iS', new THREE.InstancedBufferAttribute(s, 4)); const ex = { uOff: { value: new V3() }, uBox: { value: 19 }, uCen: { value: new V3() }, uAlpha: { value: 1 }, uDrop: { value: 0.01 } }; const m = this.add(this.sFx, g, this.mat(POST.RAIN_VS, occl(POST.RAIN_FS), { ...fm, extra: ex })); m.userData = ex; this.rain.push(m); }
  }
  buildSea() {
    const R = rng(404), w = this.world; const fish = (geo, list) => { const n = list.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4); list.forEach((f, i) => { A.set(f.slice(0, 4), i * 4); B.set(f.slice(4), i * 4); }); const g = this.instOf(geo, null); g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4)); g.instanceCount = n; this.add(this.sMain, g, this.mat(LIFE.FISH_VS, LIFE.FISH_FS, {})); };
    const tint = (geo, c, c2) => { const g = geo.clone(), a = g.attributes.color; for (let i = 0; i < a.count; i++) { const k = a.getY(i) > 0.7; a.setXYZ(i, (k ? c2 : c)[0], (k ? c2 : c)[1], (k ? c2 : c)[2]); } return g; };
    const cols = [[[0.95, 0.55, 0.05], [1, 0.9, 0.8]], [[0.1, 0.35, 0.95], [0.95, 0.85, 0.1]], [[0.75, 0.78, 0.82], [0.9, 0.92, 0.95]], [[0.95, 0.15, 0.25], [1, 0.7, 0.5]], [[0.2, 0.8, 0.6], [0.9, 0.95, 0.6]]];
    for (let k = 0; k < 5; k++) { const l = []; for (let s = 0; s < 8; s++) { const ph = R(), r = 7.75 + R() * 1.0, d = 0.5 + R() * 2.4, sp = (R() < 0.5 ? -1 : 1) * (0.035 + R() * 0.05), n = 34 + (R() * 30 | 0); for (let i = 0; i < n; i++) { const a = R() * 6.28, q = Math.sqrt(R()) * 0.34; l.push([ph, r, d, sp, Math.cos(a) * q, (R() - 0.5) * 0.34, Math.sin(a) * q * 1.5, k === 2 ? 0.05 + R() * 0.03 : 0.065 + R() * 0.05]); } } fish(tint(M.fishGeo(), cols[k][0], cols[k][1]), l); }
    const some = (n, s0, s1, d0, d1, v, r0 = 7.8, r1 = 8.7) => Array.from({ length: n }, () => [R(), r0 + R() * (r1 - r0), d0 + R() * (d1 - d0), (R() < 0.5 ? -1 : 1) * v * (0.7 + R() * 0.6), 0, 0, 0, s0 + R() * (s1 - s0)]);
    fish(M.rayGeo(), some(9, 0.28, 0.46, 1.2, 3.1, 0.02)); fish(M.turtleGeo(), some(9, 0.16, 0.24, 0.5, 2.4, 0.013)); fish(M.jellyGeo(), some(46, 0.14, 0.34, 0.5, 3.1, 0.004)); fish(M.whaleGeo(), [[0.1, 8.15, 1.9, 0.013, 0, 0, 0, 1.7], [0.14, 8.0, 2.3, 0.013, 0.2, 0, 0, 0.95]]); fish(M.sharkGeo(), some(7, 0.4, 0.62, 0.9, 2.7, 0.024));
    // reef
    const kinds = [0, 1, 2, 3].map((k) => ({ geo: M.coralGeo(k), P: [], Q: [], C: [] })), RC = [[0.95, 0.35, 0.4], [0.95, 0.6, 0.2], [0.6, 0.3, 0.85], [0.95, 0.85, 0.5], [0.3, 0.8, 0.75], [0.9, 0.3, 0.65]];
    for (let i = 0; i < 2600; i++) { const a = R() * 6.28, r = 6.4 + R() * 2.7, x = Math.cos(a) * r, z = Math.sin(a) * r, y = w.height(x, z); if (y > SEA - 0.35 || x * x + y * y + z * z > 86) continue; const k = R() < 0.3 ? 2 : R() < 0.4 ? 0 : R() < 0.55 ? 1 : 3, K = kinds[k], s = (k === 2 ? 0.45 + R() * 0.55 : 0.16 + R() * 0.3); const ya = R() * 6.28; K.P.push(x, y - 0.03 - (k === 2 ? 0.14 : 0.03) * s, z, s); K.Q.push(0, Math.sin(ya / 2), 0, Math.cos(ya / 2)); const c = k === 2 ? [0.12 + R() * 0.1, 0.34 + R() * 0.12, 0.1] : RC[(R() * 6) | 0]; K.C.push(...c, 1); }
    for (const K of kinds) { const n = K.P.length / 4; if (!n) continue; const g = this.instOf(K.geo, null); g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(K.P), 4)); g.setAttribute('iQuat', new THREE.InstancedBufferAttribute(new Float32Array(K.Q), 4)); g.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(K.C), 4)); g.instanceCount = n; this.add(this.sMain, g, this.mat(LIFE.CORAL_VS, LIFE.CORAL_FS, {})); }
  }
  buildPost() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); this.fsq = new THREE.Mesh(g, null); this.fsq.frustumCulled = false; this.fsS = new THREE.Scene(); this.fsS.add(this.fsq);
    const p = (fs, o = {}) => this.mat(POST.FS_VS.replace('precision highp float;', 'precision highp float;'), fs, { depthTest: false, depthWrite: false, side: THREE.FrontSide, blending: THREE.NoBlending, ...o });
    this.P = { res: p(POST.RESOLVE_FS), cloud: p(POST.CLOUD_FS), comp: p(POST.COMP_FS), taa: p(POST.TAA_FS), coc: p(POST.COC_FS), dof: p(POST.DOF_FS), down: p(POST.DOWN_FS), up: p(POST.UP_FS), fin: p(POST.FINAL_FS) };
  }
  rt(w, h, o = {}) { return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace, ...o }); }
  statics() {
    const depthRT = (s) => { const dt = new THREE.DepthTexture(s, s, THREE.FloatType); dt.format = THREE.DepthFormat; dt.minFilter = dt.magFilter = THREE.NearestFilter; return new THREE.WebGLRenderTarget(s, s, { depthTexture: dt, depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); };
    this.rtSh = depthRT(2048); this.rtTop = depthRT(512); this.rtLi = this.rt(2048, 1024, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }); this.U.uShadow.value = this.rtSh.depthTexture; this.U.uTopD.value = this.rtTop.depthTexture; this.U.uLight.value = this.rtLi.texture;
    this.topVP = new M4().set(0.1, 0, 0, 0, 0, 0, 0.1, 0, 0, -1 / 9.6, 0, 0, 0, 0, 0, 1);
  }
  resize(W, H, scale) {
    this.W = W; this.H = H; this.scale = scale; const w = Math.max(64, Math.round(W * scale)), h = Math.max(64, Math.round(H * scale)); this.w = w; this.h = h; this.r.setSize(W, H, false); const D = this.D || {}; for (const k in D) { const x = D[k]; (Array.isArray(x) ? x : [x]).forEach((t) => { t.depthTexture && t.depthTexture.dispose(); t.dispose(); }); }
    const dt = new THREE.DepthTexture(w, h, THREE.FloatType); dt.format = THREE.DepthFormat; dt.minFilter = dt.magFilter = THREE.NearestFilter;
    const opq = new THREE.WebGLRenderTarget(w, h, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, depthTexture: dt, stencilBuffer: false, colorSpace: THREE.NoColorSpace }); opq.textures[1].minFilter = opq.textures[1].magFilter = THREE.NearestFilter;
    const comp = new THREE.WebGLRenderTarget(w, h, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace }); comp.textures[1].type = THREE.HalfFloatType; comp.textures[1].minFilter = comp.textures[1].magFilter = THREE.NearestFilter;
    const hw = w >> 1, hh = h >> 1, bl = [], up = []; let bw = hw, bh = hh; for (let i = 0; i < 6; i++) { bl.push(this.rt(Math.max(2, bw), Math.max(2, bh))); up.push(this.rt(Math.max(2, bw), Math.max(2, bh))); bw >>= 1; bh >>= 1; }
    this.D = { opq, comp, res: this.rt(w, h), cloud: this.rt(hw, hh), fx: this.rt(w, h), hist: [this.rt(w, h), this.rt(w, h)], coc: this.rt(hw, hh), dof: this.rt(hw, hh), bl, up };
    const U = this.U; U.uRes.value.set(w, h, 1 / w, 1 / h); U.uHalf.value.set(hw, hh); U.uOut.value.set(W, H); U.uCol.value = opq.textures[0]; U.uNrm.value = opq.textures[1]; U.uDepth.value = dt; U.uOpq.value = this.D.res.texture; U.uClouds.value = this.D.cloud.texture; U.uFx.value = this.D.fx.texture; U.uAux.value = comp.textures[1]; U.uGlow.value = bl[3].texture; this.reset = 1;
  }
  pass(mat, rt) { this.fsq.material = mat; this.r.setRenderTarget(rt); this.r.render(this.fsS, this.cam); }
  // c: camera description in world space
  render(c, time) {
    const { r, U, D, P } = this; this.frame++; r.info.reset(); const HALT = [[0, 0]]; void HALT;
    const hal = (i, b) => { let f = 1, q = 0; while (i > 0) { f /= b; q += f * (i % b); i = Math.floor(i / b); } return q; }; const j = (this.frame % 16) + 1, jx = hal(j, 2) - 0.5, jy = hal(j, 3) - 0.5;
    const asp = this.W / this.H, t = Math.tan((c.fov * Math.PI) / 360), n = c.near, f = c.far; const mkP = (ox, oy) => new M4().set(1 / (t * asp), 0, ox, 0, 0, 1 / t, oy, 0, 0, 0, -(f + n) / (f - n), (-2 * f * n) / (f - n), 0, 0, -1, 0);
    const Pj = mkP((jx * 2) / this.w, (jy * 2) / this.h), P0 = mkP(0, 0), V = new M4().copy(c.matrixWorld).invert(), G = c.G, Gi = new M4().copy(G).invert();
    const VL = new M4().multiplyMatrices(V, G), VPW0 = new M4().multiplyMatrices(P0, V), VPW = new M4().multiplyMatrices(Pj, V);
    U.uVP.value.multiplyMatrices(Pj, VL); U.uIVP.value.copy(U.uVP.value).invert(); U.uVPW.value.copy(VPW); U.uIVPW.value.copy(VPW).invert(); U.uIVPW2.value.copy(VPW0).invert(); U.uG2W.value.copy(G); U.uW2G.value.copy(Gi); U.uCamW.value.copy(c.pos); U.uCam.value.copy(c.pos).applyMatrix4(Gi); const fw = new V3(0, 0, -1).transformDirection(c.matrixWorld); U.uCamF.value.copy(fw).transformDirection(Gi); U.uNear.value = n; U.uFar.value = f; U.uFrame.value = this.frame % 1024; U.uJit.value.set(jx, jy); U.uReset.value = this.reset;
    if (this.pVPW) { U.uPVPW.value.copy(this.pVPW); U.uPVPWi.value.copy(this.pVPW).multiply(this.pG).multiply(Gi); } else { U.uPVPW.value.copy(VPW0); U.uPVPWi.value.copy(VPW0); }
    // shadows
    { const d = U.uSunDir.value, rad = c.shR, ctr = new V3().copy(c.shC), up = Math.abs(d.y) > 0.95 ? new V3(1, 0, 0) : new V3(0, 1, 0), z = d.clone(), x = new V3().crossVectors(up, z).normalize(), y = new V3().crossVectors(z, x), tx = (rad * 2) / 2048; const sx = Math.round(ctr.dot(x) / tx) * tx, sy = Math.round(ctr.dot(y) / tx) * tx, sz = ctr.dot(z), dz = 11; U.uShadowTexel.value = tx;
      const S = new M4().set(x.x / rad, x.y / rad, x.z / rad, -sx / rad, y.x / rad, y.y / rad, y.z / rad, -sy / rad, -z.x / dz, -z.y / dz, -z.z / dz, sz / dz, 0, 0, 0, 1); U.uShadowVP.value.copy(S); r.setRenderTarget(this.rtSh); r.clear(true, true, false); r.render(this.sShadow, this.cam);
      if (this.frame % 6 === 1) { U.uShadowVP.value.copy(this.topVP); r.setRenderTarget(this.rtTop); r.clear(true, true, false); r.render(this.sShadow, this.cam); U.uShadowVP.value.copy(S); } }
    r.setClearColor(0x000000, 0); r.setRenderTarget(this.rtLi); r.clear(true, false, false); r.render(this.sLight, this.cam);
    r.setRenderTarget(D.opq); r.clear(true, true, false); r.render(this.sMain, this.cam);
    this.pass(P.res, D.res); this.pass(P.cloud, D.cloud);
    r.setRenderTarget(D.fx); r.clear(true, false, false); r.render(this.sFx, this.cam);
    this.pass(P.comp, D.comp);
    const a = this.frame & 1, H = D.hist; U.uCur.value = D.comp.textures[0]; U.uHist.value = H[1 - a].texture; this.pass(P.taa, H[a]); const cur = H[a].texture;
    U.uCur.value = cur; this.pass(P.coc, D.coc); U.uCoc.value = D.coc.texture; this.pass(P.dof, D.dof);
    for (let i = 0; i < 6; i++) { U.uSrc.value = i ? D.bl[i - 1].texture : cur; const s = i ? D.bl[i - 1] : H[a]; U.uTx.value.set(1 / s.width, 1 / s.height); U.uFirst.value = i ? 0 : 1; this.pass(P.down, D.bl[i]); }
    for (let i = 4; i >= 0; i--) { const src = i === 4 ? D.bl[5] : D.up[i + 1]; U.uSrc.value = src.texture; U.uBase.value = D.bl[i].texture; U.uTx.value.set(1 / src.width, 1 / src.height); U.uMix.value = 0.82; this.pass(P.up, D.up[i]); }
    U.uBloom.value = D.up[0].texture; U.uSharp.value = cur; U.uDofT.value = D.dof.texture; this.pass(P.fin, null);
    if (this.frame % 12 === 0 && !this.reading) { const s = D.bl[5], bw = Math.max(1, s.width >> 1), bh = Math.max(1, s.height >> 1), buf = new Uint16Array(bw * bh * 4); this.reading = true; r.readRenderTargetPixelsAsync(s, (s.width - bw) >> 1, (s.height - bh) >> 1, bw, bh, buf).then(() => { let R = 0, Gg = 0, B = 0; const k = bw * bh, h2 = THREE.DataUtils.fromHalfFloat; for (let i = 0; i < k; i++) { R += h2(buf[i * 4]); Gg += h2(buf[i * 4 + 1]); B += h2(buf[i * 4 + 2]); } if (isFinite(R + Gg + B)) this.glow = [R / k, Gg / k, B / k]; this.reading = false; }).catch(() => { this.reading = false; }); }
    this.pVPW = VPW0; this.pG = G.clone(); this.reset = 0;
  }
}
