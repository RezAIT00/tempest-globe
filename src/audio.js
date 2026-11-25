// Everything here is synthesised. Positions are in globe space; panners give direction, gains give distance.
import { clamp, lerp, sat, smooth, damp } from './util.js';

const BPM = 126;
export class Sound {
  constructor(world) { this.w = world; this.ctx = null; this.phase = 0; this.beat = 0; this.next = 0; this.rate = 1; this.cam = [0, 0, 48]; this.shots = 0; this.lastHit = 0; this.inside = 0; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = (this.ctx = new (window.AudioContext || window.webkitAudioContext)()); if (C.state === 'suspended') C.resume().catch(() => {});
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master = C.createGain(); this.master.gain.value = 0.0; this.master.gain.linearRampToValueAtTime(0.85, C.currentTime + 2.5); this.lp = C.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.connect(this.master); this.master.connect(comp); comp.connect(C.destination);
    this.dry = C.createGain(); this.dry.connect(this.master); // sounds in the room, not muffled by the crystal
    // reverb
    const len = C.sampleRate * 2.6, ir = C.createBuffer(2, len, C.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    this.rev = C.createConvolver(); this.rev.buffer = ir; this.revG = C.createGain(); this.revG.gain.value = 0.3; this.rev.connect(this.revG); this.revG.connect(this.lp);
    const mk = (n, f) => { const b = C.createBuffer(1, C.sampleRate * n, C.sampleRate), d = b.getChannelData(0); f(d); return b; };
    this.white = mk(3, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk(4, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.4; } const n = 4000; for (let i = 0; i < n; i++) { const k = i / n; d[i] = d[i] * k + d[d.length - n + i] * (1 - k); } });
    const loop = (buf, type, f, q = 0.7) => { const s = C.createBufferSource(); s.buffer = buf; s.loop = true; const b = C.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = C.createGain(); g.gain.value = 0; s.connect(b); b.connect(g); g.connect(this.lp); s.start(0, Math.random() * 2); return { s, b, g }; };
    this.L = { wind: loop(this.brown, 'bandpass', 320, 0.6), howl: loop(this.white, 'bandpass', 620, 9), rain: loop(this.white, 'highpass', 2600, 0.4), sea: loop(this.brown, 'lowpass', 520), city: loop(this.brown, 'lowpass', 240), rumble: loop(this.brown, 'lowpass', 90), crowd: loop(this.white, 'bandpass', 720, 1.6), fire: loop(this.white, 'bandpass', 1300, 0.8) };
    // panned point sources: sirens and rotors
    this.src = []; for (let i = 0; i < 5; i++) { const p = this.pan(); const g = C.createGain(); g.gain.value = 0; g.connect(p); p.connect(this.lp); p.connect(this.rev); if (i < 3) { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 600; const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.2; o.connect(f); f.connect(g); o.start(); this.src.push({ kind: 'siren', o, g, p, ph: i * 0.37 }); } else { const s = C.createBufferSource(); s.buffer = this.brown; s.loop = true; const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const am = C.createGain(); am.gain.value = 0.5; const l = C.createOscillator(); l.type = 'square'; l.frequency.value = 13; const lg = C.createGain(); lg.gain.value = 0.5; l.connect(lg); lg.connect(am.gain); s.connect(f); f.connect(am); am.connect(g); s.start(); l.start(); this.src.push({ kind: 'heli', g, p, s, l }); } }
    // club systems
    this.clubs = this.w.clubs.map((c, i) => { const g = C.createGain(); g.gain.value = 0; const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; const p = this.pan(); g.connect(f); f.connect(p); p.connect(this.lp); const d = C.createDelay(1); d.delayTime.value = (60 / BPM) * 0.75; const fb = C.createGain(); fb.gain.value = 0.36; const dg = C.createGain(); dg.gain.value = 0.3; d.connect(fb); fb.connect(d); d.connect(dg); dg.connect(g); return { c, g, f, p, d, i }; });
    this.t0 = C.currentTime; this.next = this.phase;
  }
  pan() { const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.rolloffFactor = 0; p.distanceModel = 'linear'; return p; }
  put(p, x, y, z) { if (p.positionX) { const t = this.ctx.currentTime; p.positionX.setTargetAtTime(x, t, 0.03); p.positionY.setTargetAtTime(y, t, 0.03); p.positionZ.setTargetAtTime(z, t, 0.03); } else p.setPosition(x, y, z); }
  dist(x, y, z) { return Math.hypot(x - this.cam[0], y - this.cam[1], z - this.cam[2]); }
  att(d, r) { return 1 / (1 + Math.pow(d / r, 1.5)); }
  shot(x, y, z, r, k, fn, rev = 0.4, dry = false) {
    if (!this.ctx || this.shots > 34) return; const a = this.att(this.dist(x, y, z), r) * k; if (a < 0.006) return; const C = this.ctx, p = this.pan(), g = C.createGain(); g.gain.value = a; g.connect(p); p.connect(dry ? this.dry : this.lp); if (rev) { const rg = C.createGain(); rg.gain.value = rev; p.connect(rg); rg.connect(this.rev); } p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; this.shots++; const dur = fn(C, g, C.currentTime); setTimeout(() => { this.shots--; g.disconnect(); p.disconnect(); }, dur * 1000 + 300);
  }
  noise(C, out, t, buf, type, f0, f1, a, d, q = 0.8, rate = 1) { const s = C.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate * this.rate; const b = C.createBiquadFilter(); b.type = type; b.Q.value = q; b.frequency.setValueAtTime(f0, t); b.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d); const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + d); s.connect(b); b.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + d + 0.05); }
  tone(C, out, t, type, f0, f1, a, d, at = 0.004) { const o = C.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0 * this.rate, t); o.frequency.exponentialRampToValueAtTime(Math.max(12, f1 * this.rate), t + d); const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + at); g.gain.exponentialRampToValueAtTime(0.0006, t + d); o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.03); }
  thunder(x, y, z, S) { const d = this.dist(x, y, z), dl = Math.min(2.2, d * 0.05); this.shot(x, y, z, 26, 0.9 + S * 0.5, (C, g, t) => { t += dl; this.noise(C, g, t, this.white, 'bandpass', 2400, 300, d < 8 ? 0.9 : 0.3, 0.35, 0.7); this.noise(C, g, t + 0.04, this.brown, 'lowpass', 420, 40, 1.7, 3.4, 0.5, 0.8); this.noise(C, g, t + 0.5, this.brown, 'lowpass', 160, 34, 1.2, 4.2, 0.5, 0.55); return 5.4; }, 0.8); }
  collapse(x, y, z, k) { this.shot(x, y, z, 11, 0.8 + k * 0.7, (C, g, t) => { this.tone(C, g, t, 'sine', 70, 24, 0.9, 1.6); this.noise(C, g, t, this.brown, 'lowpass', 900, 60, 1.6, 2.6 + k * 2, 0.6, 0.8); this.noise(C, g, t + 0.1, this.white, 'bandpass', 1500, 350, 0.32, 1.7, 0.8); for (let i = 0; i < 7; i++) this.noise(C, g, t + 0.1 + Math.random() * 1.8, this.white, 'bandpass', 500 + Math.random() * 2500, 200, 0.25, 0.12 + Math.random() * 0.2, 2); return 5; }, 0.5); }
  hit(x, y, z, e, kind) { const now = performance.now(); if (now - this.lastHit < 22) return; this.lastHit = now; this.shot(x, y, z, 3.4, Math.min(1, e) * 0.8, (C, g, t) => { if (kind === 1) { this.noise(C, g, t, this.white, 'lowpass', 2600, 300, 0.7, 0.5); } else if (kind === 2) { this.tone(C, g, t, 'triangle', 900 + Math.random() * 900, 500, 0.2, 0.12); } else { this.noise(C, g, t, this.brown, 'lowpass', 700 + Math.random() * 900, 80, 1.5, 0.35 + e * 0.4); if (Math.random() < 0.3) this.noise(C, g, t, this.white, 'highpass', 4200, 2600, 0.2, 0.3, 1); if (Math.random() < 0.3) this.tone(C, g, t, 'square', 180 + Math.random() * 400, 90, 0.1, 0.18); } return 1; }, 0.25); }
  clink(k) { if (!this.ctx) return; const C = this.ctx, t = C.currentTime, g = C.createGain(); g.gain.value = Math.min(0.5, k * 0.4); g.connect(this.dry); for (const f of [1830, 2913, 4377, 6120]) this.tone(C, g, t, 'sine', f, f * 0.998, 0.16, 0.7 + Math.random() * 0.6, 0.001); this.tone(C, g, t, 'sine', 120, 60, 0.9, 0.22); this.noise(C, g, t, this.brown, 'lowpass', 500, 90, 1, 0.25); }
  powerDown() { if (!this.ctx) return; this.shot(this.cam[0], -1, this.cam[2], 40, 0.5, (C, g, t) => { this.tone(C, g, t, 'sawtooth', 120, 18, 0.22, 1.8); this.tone(C, g, t, 'sine', 60, 16, 0.5, 2.2); return 2.4; }, 0.6); }
  powerUp() { if (!this.ctx) return; this.shot(this.cam[0], -1, this.cam[2], 40, 0.4, (C, g, t) => { this.tone(C, g, t, 'sawtooth', 30, 120, 0.16, 1.4, 0.5); this.tone(C, g, t, 'sine', 40, 120, 0.4, 1.6, 0.5); return 2; }, 0.6); }
  rebuildStart() { if (!this.ctx) return; this.shot(0, -1.5, 8, 30, 0.35, (C, g, t) => { for (const [f, a] of [[98, 0.3], [147, 0.22], [196, 0.14]]) this.tone(C, g, t, 'sawtooth', f, f * 0.99, a, 2.4, 0.25); return 2.8; }, 1.2); }
  touchdown(x, z) { this.shot(x, -1, z, 22, 1, (C, g, t) => { this.noise(C, g, t, this.brown, 'lowpass', 60, 260, 1.8, 4, 0.7, 0.5); this.tone(C, g, t, 'sine', 30, 55, 0.8, 3.5, 1); return 4.2; }, 0.8); }

  // ---- club music: four-on-the-floor, original progressions per room
  note(club, t, f, type, a, d, cut) { const C = this.ctx, o = C.createOscillator(); o.type = type; o.frequency.value = f * this.rate; const b = C.createBiquadFilter(); b.type = 'lowpass'; b.Q.value = 6; b.frequency.setValueAtTime(cut, t); b.frequency.exponentialRampToValueAtTime(Math.max(80, cut * 0.25), t + d); const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + d); o.connect(b); b.connect(g); g.connect(club.g); if (type === 'square') g.connect(club.d); o.start(t); o.stop(t + d + 0.02); }
  step(n, t) {
    const C = this.ctx, s = n % 16, bar = Math.floor(n / 16);
    const K = [{ roots: [45, 41, 48, 43], arp: [0, 7, 12, 15, 12, 7, 3, 7] }, { roots: [38, 38, 45, 43], arp: [0, 12, 3, 10, 7, 12, 5, 10] }, { roots: [40, 47, 43, 45], arp: [0, 4, 7, 11, 14, 11, 7, 4] }];
    for (const cl of this.clubs) {
      if (cl.lvl < 0.012) continue; const k = K[cl.i % 3], root = k.roots[bar % 4], hz = (m) => 440 * Math.pow(2, (m - 69) / 12), g = cl.g;
      if (s % 4 === 0) { this.tone(C, g, t, 'sine', 165, 44, 1.0, 0.28, 0.002); this.noise(C, g, t, this.white, 'highpass', 5000, 3000, 0.12, 0.02); }
      if (s % 8 === 4) this.noise(C, g, t, this.white, 'bandpass', 1800, 1200, 0.5, 0.16, 0.9);
      if (s % 4 === 2) this.noise(C, g, t, this.white, 'highpass', 8000, 7000, 0.28, 0.07);
      if (cl.i !== 1 ? s % 2 === 0 : (s * 5) % 3 === 0) this.noise(C, g, t, this.white, 'highpass', 9500, 9000, 0.1, 0.03);
      if (s % 4 !== 0 && (cl.i === 0 ? s % 2 === 0 || s === 7 : cl.i === 1 ? true : s % 4 === 2)) this.note(cl, t, hz(root - 12 + (cl.i === 1 && s % 8 > 5 ? 12 : 0)), 'sawtooth', 0.34, 0.16, 520 + 260 * Math.sin(n * 0.05));
      if (bar % 8 > 1 && (s + cl.i) % 2 === 0) this.note(cl, t, hz(root + 12 + k.arp[(n >> 1) % 8]), 'square', 0.075, 0.17, 1700 + 1300 * Math.sin(n * 0.021 + cl.i));
      if (s === 0 || s === (cl.i === 2 ? 6 : 10)) for (const iv of cl.i === 2 ? [0, 4, 7, 11] : [0, 3, 7, 10]) this.note(cl, t, hz(root + 12 + iv), 'sawtooth', 0.055, 0.5, 1500);
    }
  }
  update(rdt, o) {
    // o: cam, fwd, up, D, S, rain, T, rate, storm energy, life, weather, fires, clubsOpen
    this.rate = o.rate; this.phase += rdt * o.rate * (BPM / 60) * 4; const bt = (this.phase / 4) % 1; this.beat = Math.pow(1 - bt, 2.2);
    if (!this.ctx) return; const C = this.ctx, t = C.currentTime; if (C.state !== 'running') return; this.cam = o.cam; const L = C.listener;
    if (L.positionX) { L.positionX.value = o.cam[0]; L.positionY.value = o.cam[1]; L.positionZ.value = o.cam[2]; L.forwardX.value = o.fwd[0]; L.forwardY.value = o.fwd[1]; L.forwardZ.value = o.fwd[2]; L.upX.value = o.up[0]; L.upY.value = o.up[1]; L.upZ.value = o.up[2]; } else { L.setPosition(...o.cam); L.setOrientation(...o.fwd, ...o.up); }
    const r = Math.hypot(...o.cam), ins = smooth(13, 8.5, r); this.inside = ins; const near = smooth(9, 0.6, o.D); const set = (p, v, k = 0.12) => p.setTargetAtTime(v, t, k);
    set(this.lp.frequency, lerp(650, 19000, Math.pow(ins, 2)) * lerp(0.25, 1, sat((o.rate - 0.12) / 0.6)), 0.1);
    const out = lerp(0.35, 1, ins), w = this.L, gust = 0.8 + 0.4 * Math.sin(t * 0.9) * Math.sin(t * 0.37);
    set(w.wind.g.gain, (0.05 + 0.85 * Math.pow(o.S, 1.6)) * gust * out); set(w.wind.b.frequency, 220 + 520 * o.S * gust); set(w.howl.g.gain, 0.34 * smooth(0.6, 1, o.S) * gust * out); set(w.howl.b.frequency, 420 + 420 * gust * o.S); set(w.rain.g.gain, 0.16 * o.rain * out * (0.5 + 0.5 * near)); set(w.sea.g.gain, (0.2 + 0.5 * o.S) * out * this.att(Math.abs(r - 7.5), 3.5)); set(w.city.g.gain, 0.36 * out * (1 - 0.7 * o.S) * o.power); let td = 1e9; if (o.T > 0.05) td = Math.hypot(o.cam[0] - o.wx.tx, o.cam[2] - o.wx.tz); set(w.rumble.g.gain, 1.5 * o.T * (td < 1e8 ? this.att(td, 6) + 0.15 : 0) * out + 0.6 * smooth(0.75, 1, o.S) * out + 0.5 * o.shake);
    let fi = 0; for (const f of o.fires) fi += this.att(this.dist(o.ph.P[f.i * 3], o.ph.P[f.i * 3 + 1], o.ph.P[f.i * 3 + 2]), 0.8); set(w.fire.g.gain, Math.min(0.3, fi * 0.1));
    for (const k in w) set(w[k].s.playbackRate, lerp(0.45, 1, sat(o.rate)), 0.1);
    let cr = 0; for (const c of this.clubs) { const d = this.dist(c.c.x, c.c.y + 0.1, c.c.z), a = this.att(d, 0.55) * o.power * (o.S > 0.7 ? 0.25 : 1), op = Math.max(c.c.open, smooth(0.7, 0.25, d)); c.lvl = a * 0.75; set(c.g.gain, c.lvl, 0.08); set(c.f.frequency, lerp(240, 16000, op * op), 0.1); this.put(c.p, c.c.x, c.c.y + 0.1, c.c.z); cr += a * op; } set(w.crowd.g.gain, (0.05 * near + 0.22 * Math.min(1, cr)) * (1 + 0.3 * Math.sin(t * 2.3)) * o.power);
    const cops = o.life.cops, hel = o.life.helis; let si = 0, he = 0; for (const s of this.src) { if (s.kind === 'siren') { const em = o.phase === 'aftermath' || o.phase === 'rebuild', c = em ? o.life.fleet[si * 3] : cops[si * 2]; si++; if (!c) continue; const d = this.dist(c.x, c.y, c.z); s.ph += rdt * o.rate * (si === 2 ? 2.4 : 0.42); const f = si === 2 ? (Math.sin(s.ph * 6.28) > 0 ? 960 : 720) : 640 + 620 * (0.5 - 0.5 * Math.cos(s.ph * 6.28)); set(s.o.frequency, f * o.rate, 0.02); set(s.g.gain, 0.16 * this.att(d, 1.6) * (c.state === 0 ? 1 : 0.2)); this.put(s.p, c.x, c.y, c.z); } else { const h = hel[he++]; const d = this.dist(h.x, h.y, h.z); set(s.g.gain, 0.9 * this.att(d, 0.9)); set(s.l.frequency, 13 * o.rate); this.put(s.p, h.x, h.y, h.z); } }
    const ahead = 0.13, perS = o.rate * (BPM / 60) * 4; if (this.next < this.phase) this.next = Math.ceil(this.phase); while ((this.next - this.phase) / perS < ahead) { this.step(this.next, t + Math.max(0.001, (this.next - this.phase) / perS)); this.next++; }
  }
}
