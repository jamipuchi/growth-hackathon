// Space Party sound effects: every sound is synthesized with plain DSP and played through WebAudio.
// No audio files, no dependencies, no build step. ES module for the phone and the big screen.
//
//   import { createSfx, SOUNDS, renderSound } from "./sfx.js";
//   const sfx = createSfx();                            // makes the AudioContext, pre-renders the game sounds in idle time
//   sfx.play("laser", { pan: -0.3, volume: 0.8 });      // false until the first tap / click / key unlocked audio
//   const drill = sfx.loop("drill"); /* ... */ drill.stop();   // held actions: drill, dig, tractor, boost, shield; TV lobby: ambience
//
// renderSound() is pure and deterministic (seeded noise), so Node can test every sound without WebAudio.
// Design rules for every sound: 4 ms soft attack, smooth fade-out (no clicks), peak 0.88, and almost nothing above
// 8 kHz: buffers are 24 kHz and the browser resamples them, bright content would come back as harsh images. Phone
// speakers have almost no bass, so low thumps are saturated: the harmonics are what you actually hear.

export const SOUNDS = [
  "laser", "explosion", "boost", "shield", "drill", "dig", "land", "takeoff", "chest", "kill", "emp", "ink",
  "tractor", "mine", "ui-tap", "hint", "countdown", "win",
  // extras: explosion sizes, the final GO beep, and sounds for the other fx kinds of the game
  "explosion-small", "explosion-medium", "explosion-large", "countdown-go",
  "hit", "crack", "scan", "flare", "death", "respawn",
  // v1.3: the steal sting (chest points or the boss's last hit snatched) and the hit-confirm tick when MY shot lands
  "steal", "hitmark",
  // v1.5: the TV's lobby hangar, the results podium and the lobby ambience loop (TV only: built on first play)
  "card-pop", "podium", "fanfare", "star", "ambience",
];

// Sounds with a seamless loop variant: the held actions, and the TV lobby's ambience. loop() on any other name repeats its
// one-shot.
export const LOOPS = ["drill", "dig", "tractor", "boost", "shield", "ambience"];

// ---------------------------------------------------------------------------------------------------------- DSP

const PI = Math.PI;
const TAU = PI * 2;
const { sin, cos, exp, abs, floor, round, min, max, pow, sqrt, tanh } = Math;

const smooth01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const tri = (ph) => 4 * abs(ph - floor(ph + 0.5)) - 1; // phase in cycles -> triangle -1..1

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// White noise in [-1, 1), seeded from the sound's name: mulberry32.
function noise(name) {
  let a = hash(name);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

// State-variable filter (trapezoidal, safe to retune every few samples). run(x) returns the low-pass and sets
// .lp, .bp (unity gain at the centre) and .hp.
function svf(sr) {
  let s1 = 0, s2 = 0, a1 = 0, a2 = 0, a3 = 0, k = 1;
  const f = {
    lp: 0, bp: 0, hp: 0,
    set(fc, q) {
      const g = Math.tan((PI * min(fc, sr * 0.45)) / sr);
      k = 1 / q;
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
      return f;
    },
    run(x) {
      const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
      s1 = 2 * v1 - s1;
      s2 = 2 * v2 - s2;
      f.bp = v1 * k;
      f.hp = x - k * v1 - v2;
      return (f.lp = v2);
    },
  };
  return f.set(1000, 0.7);
}

function blep(t, dt) { // polyBLEP correction: removes the aliasing of naive saw / pulse edges
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

function sawOsc(sr) {
  let ph = 0;
  return (f) => {
    const dt = f / sr;
    const y = 2 * ph - 1 - blep(ph, dt);
    ph += dt;
    if (ph >= 1) ph -= 1;
    return y;
  };
}

function pulseOsc(sr) {
  let ph = 0;
  return (f, w = 0.5) => {
    const dt = f / sr;
    let t2 = ph - w;
    if (t2 < 0) t2 += 1;
    const y = (ph < w ? 1 : -1) + blep(ph, dt) - blep(t2, dt);
    ph += dt;
    if (ph >= 1) ph -= 1;
    return y;
  };
}

// Small Schroeder reverb (4 damped combs, 2 all-passes) mixed into buf in place. Callers leave room for the tail.
function reverb(buf, sr, mix, rt60 = 0.6, damp = 0.3) {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => ({
    b: new Float32Array(round(d * sr)), i: 0, g: pow(10, (-3 * d) / rt60), lp: 0,
  }));
  const aps = [0.005, 0.0017].map((d) => ({ b: new Float32Array(round(d * sr)), i: 0 }));
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.b[c.i];
      c.lp += (1 - damp) * (o - c.lp);
      c.b[c.i] = x + c.lp * c.g;
      if (++c.i === c.b.length) c.i = 0;
      y += o;
    }
    for (const a of aps) {
      const bo = a.b[a.i];
      a.b[a.i] = y + bo * 0.5;
      y = bo - y;
      if (++a.i === a.b.length) a.i = 0;
    }
    buf[n] += y * mix;
  }
}

// Additive bell voice mixed into out at t0 seconds: [ratio, level, decay scale] per partial.
const BELL = [[1, 1, 1], [2, 0.32, 0.55], [3.01, 0.16, 0.35], [4.2, 0.06, 0.25]];
const SOFT_BELL = [[1, 1, 1], [2, 0.18, 0.5], [3, 0.05, 0.3]];
function bell(out, sr, t0, f, amp, decay, parts = BELL) {
  const s0 = round(t0 * sr), atk = round(sr * 0.003);
  for (const [r, a, dk] of parts) {
    const fr = f * r;
    if (fr > sr * 0.4) continue;
    const len = min(out.length - s0, round(sr * decay * dk * 5)); // 5 time constants: under 1 % left
    const w = (TAU * fr) / sr, k = exp(-1 / (sr * decay * dk)), c = 2 * cos(w);
    let e = amp * a, y = 0, ym = -sin(w); // y = sin(w i), by recurrence: no sin() per sample
    for (let i = 0; i < len; i++, e *= k) {
      out[s0 + i] += e * y * (i < atk ? (i / atk) * (i / atk) : 1);
      const yn = c * y - ym;
      ym = y;
      y = yn;
    }
  }
}

// Brassy synth voice (two detuned saws through a low-pass that opens on the attack) mixed into out at t0.
function brass(out, sr, t0, dur, f, amp, rel) {
  const s0 = round(t0 * sr), n = min(out.length - s0, round((dur + rel) * sr)), iDur = round(dur * sr);
  const a = sawOsc(sr), b = sawOsc(sr), lp = svf(sr);
  const kS = exp(-1 / (sr * 0.14)), kR = exp(-1 / (sr * rel * 0.3)); // envelopes by recurrence
  let fv = f, se = 1, sd = 0.62 + 0.38 * exp(-dur / 0.14), re = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 3) === 0) {
      fv = f * (1 + 0.004 * sin(TAU * 5.5 * t) * min(1, t / 0.3));
      lp.set(min(4800, fv * (1.5 + 3.2 * exp(-t / 0.1))), 0.9);
    }
    const env = min(1, t / 0.01) * (i < iDur ? 0.62 + 0.38 * se : sd * re);
    se *= kS;
    if (i >= iDur) re *= kR;
    out[s0 + i] += lp.run(0.5 * a(fv) + 0.5 * b(fv * 1.006)) * env * amp;
  }
}

// Last stage of every one-shot: DC block, soft top end, S-curve attack and release (the first and last 2 ms stay
// well under 0.05, so there are no clicks), peak normalisation, NaN guard.
function finish(out, sr, o = {}) {
  const n = out.length, hpa = exp((-TAU * 15) / sr), lpa = 1 - exp((-TAU * (o.lp || 8000)) / sr);
  let px = 0, py = 0, ly = 0;
  for (let i = 0; i < n; i++) {
    let x = out[i];
    if (!(x > -1e6 && x < 1e6)) x = 0;
    py = x - px + hpa * py;
    px = x;
    ly += lpa * (py - ly);
    out[i] = ly;
  }
  const A = min(n >> 1, round(sr * (o.attack === undefined ? 0.004 : o.attack)));
  const R = min(n >> 1, round(sr * (o.release === undefined ? 0.03 : o.release)));
  for (let i = 0; i < A; i++) { const u = i / A; out[i] *= 0.5 - 0.5 * cos(PI * u * u * u); }
  for (let i = 0; i < R; i++) { const u = i / R; out[n - 1 - i] *= 0.5 - 0.5 * cos(PI * u * u * u); }
  let pk = 0;
  for (let i = 0; i < n; i++) { const a = abs(out[i]); if (a > pk) pk = a; }
  const g = (o.peak || 0.88) / (pk || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// ------------------------------------------------------------------------------------------- one-shot recipes
// Each recipe returns the finished Float32Array. t is seconds from the start, u is progress 0..1.

function laser(sr) {
  // fast downward zap: saw + pulse through a closing low-pass, FM bite that mellows, octave-down body, tiny tick
  const n = round(sr * 0.16), out = new Float32Array(n), nz = noise("laser");
  const saw = sawOsc(sr), sq = pulseOsc(sr), lp = svf(sr);
  let cph = 0, mph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 300 + 1100 * exp(-t / 0.045); // 1400 -> 300 Hz
    cph += f / sr;
    mph += (f * 2.01) / sr;
    const fm = sin(TAU * cph + 2.6 * exp(-t / 0.03) * sin(TAU * mph));
    if ((i & 3) === 0) lp.set(900 + 3600 * exp(-t / 0.045), 0.8);
    const edge = lp.run(0.6 * saw(f) + 0.35 * sq(f * 1.007, 0.4));
    out[i] = (edge + 0.8 * fm + 0.5 * sin(PI * cph) + 0.35 * nz() * exp(-t / 0.002)) * (0.12 + 0.88 * exp(-t / 0.06));
  }
  return finish(out, sr, { release: 0.04 });
}

// thump: pitch-dropping sine (sub-bass for big speakers), punch: the same idea an octave up, saturated so a phone
// speaker has something to play; roar: noise through a closing low-pass; crack: 5 ms bright noise; rumble: slow low
// noise tail; debris: sparse clicks ringing in a band-pass
const EXPLOSIONS = {
  small: { len: 0.35, f0: 200, f1: 70, tf: 0.04, ta: 0.07, th: 0.5, pk: 0.8, c0: 7000, c1: 700, tc: 0.05, tr: 0.09, rum: 0, tm: 0.1, deb: 90, rv: 0 },
  medium: { len: 0.8, f0: 150, f1: 45, tf: 0.07, ta: 0.16, th: 0.55, pk: 0.65, c0: 6000, c1: 320, tc: 0.12, tr: 0.22, rum: 0.55, tm: 0.3, deb: 70, rv: 0.1 },
  large: { len: 1.6, f0: 110, f1: 30, tf: 0.12, ta: 0.32, th: 0.6, pk: 0.55, c0: 5200, c1: 170, tc: 0.25, tr: 0.45, rum: 0.9, tm: 0.7, deb: 50, rv: 0.2 },
};
function explosion(sr, size) {
  const P = EXPLOSIONS[size] || EXPLOSIONS.medium;
  const n = round(sr * P.len), out = new Float32Array(n), nz = noise("explosion-" + size);
  const roar = svf(sr), rum = svf(sr).set(110, 0.7), deb = svf(sr).set(1700, 1.2);
  const k = (tau) => exp(-1 / (sr * tau)); // per-sample decay factor: envelopes by recurrence, no exp() per sample
  const kF = k(P.tf), kP = k(0.025), kA = k(P.ta), kPe = k(0.06), kR = k(P.tr), kC = k(0.005), kRi = k(0.04), kM = k(P.tm), kD = k(P.tr * 1.6);
  let ph = 0, pph = 0, eF = 1, eP = 1, eA = 1, ePe = 1, eR = 1, eC = 1, eRi = 1, eM = 1, eD = 1, wob = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (P.f1 + (P.f0 - P.f1) * eF) / sr;
    pph += (110 + 230 * eP) / sr;
    const thump = tanh(2.6 * sin(TAU * ph)) * eA * P.th;
    const punch = ePe > 0.002 ? tanh(2 * sin(TAU * pph)) * ePe * P.pk : 0;
    if ((i & 3) === 0) roar.set(P.c1 + (P.c0 - P.c1) * exp(-t / P.tc), 0.8);
    if ((i & 7) === 0) wob = 0.75 + 0.25 * sin(TAU * 7 * t);
    const body = roar.run(nz()) * eR * 2;
    const crack = eC > 0.002 ? nz() * eC * 0.9 : 0;
    const rumble = rum.run(nz()) * P.rum * 6 * (1 - eRi) * eM * wob;
    deb.run(nz() > 1 - (2 * P.deb * eD) / sr ? nz() : 0);
    out[i] = tanh(0.85 * (thump + punch + body + crack + rumble + deb.bp * 0.9));
    eF *= kF; eP *= kP; eA *= kA; ePe *= kPe; eR *= kR; eC *= kC; eRi *= kRi; eM *= kM; eD *= kD;
  }
  if (P.rv) reverb(out, sr, P.rv, 0.5);
  return finish(out, sr, { release: min(0.2, P.len * 0.3) });
}

function boost(sr) {
  // rising whoosh: band-passed noise sweeping up, a rising saw whine, flame hiss; swells to 70 % then lets go
  const T = 0.8, n = round(sr * T), out = new Float32Array(n), nz = noise("boost");
  const bp = svf(sr), hiss = svf(sr), tone = svf(sr), saw = sawOsc(sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / T;
    const env = u < 0.7 ? pow(sin((PI / 2) * (u / 0.7)), 2) : pow(cos((PI / 2) * ((u - 0.7) / 0.3)), 2);
    if ((i & 3) === 0) {
      bp.set(250 + 2600 * pow(u, 1.5), 2.2);
      hiss.set(1400 + 2600 * u, 0.7);
      tone.set(500 + 1700 * u, 0.8);
    }
    const x = nz();
    bp.run(x);
    hiss.run(x);
    const whine = tone.run(saw(80 + 300 * pow(u, 1.4)));
    out[i] = (bp.bp * 1.5 + hiss.lp * 0.45 + whine * 0.4) * env;
  }
  return finish(out, sr, { release: 0.06 });
}

function shield(sr) {
  // shimmering "bwom": a stack of slightly inharmonic sines gliding up into place, tremolo, sub thump, sparkle sweep
  const T = 0.7, n = round(sr * T), out = new Float32Array(n);
  let ph = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (300 * (1 + 0.55 * (1 - exp(-t / 0.07)))) / sr;
    const tr = 0.65 + 0.35 * sin(TAU * 11 * t), tr2 = 0.65 + 0.35 * sin(TAU * 13 * t + 1.3);
    const body = sin(TAU * ph) + 0.5 * sin(TAU * ph * 2.003) * tr + 0.28 * sin(TAU * ph * 3.01) * tr2 + 0.14 * sin(TAU * ph * 5.02) * tr;
    sw += (700 + 2200 * pow(min(1, t / 0.25), 1.5)) / sr;
    const sub = 0.8 * sin(PI * ph) * exp(-t / 0.12);
    const spark = 0.16 * sin(TAU * sw) * exp(-t / 0.2);
    out[i] = (body * 0.55 + sub + spark) * (0.35 + 0.65 * exp(-t / 0.3));
  }
  reverb(out, sr, 0.15, 0.4);
  return finish(out, sr, { release: 0.15 });
}

function drill(sr) {
  // grinding: buzzy saw with 30 Hz AM + band-passed gritty noise + a metal clink; spins up, then winds down
  const T = 0.8, n = round(sr * T), out = new Float32Array(n), nz = noise("drill");
  const saw = sawOsc(sr), saw2 = sawOsc(sr), lp = svf(sr), bp = svf(sr);
  let amph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const r = (0.5 + 0.5 * smooth01(t / 0.14)) * (1 - 0.4 * smooth01((t - (T - 0.22)) / 0.22));
    amph += (30 * r) / sr;
    if ((i & 3) === 0) { lp.set(800 + 1300 * r, 0.9); bp.set(300 + 900 * r, 2); }
    const buzz = lp.run(0.6 * saw(128 * r) + 0.5 * saw2(193 * r)) * (0.6 + 0.4 * sin(TAU * amph));
    bp.run(nz());
    const grit = bp.bp * (0.55 + 0.45 * sin(TAU * amph + 0.7));
    const clink = 0.3 * sin(TAU * 1850 * t) * exp(-t / 0.02);
    out[i] = (buzz * 0.9 + grit * 1.1 + clink) * (0.4 + 0.6 * smooth01(t / 0.08));
  }
  return finish(out, sr, { release: 0.12, lp: 6500 });
}

// dig: two crunchy shovel scrapes (noise through a falling band-pass, gated into gravel) and a dull thud after each
function digScrape(out, sr, nz, t0, len, lvl, fa, fb) {
  const s0 = round(t0 * sr), m = round(len * sr), bp = svf(sr), lp = svf(sr).set(3200, 0.7), ga = 1 - exp((-TAU * 1800) / sr);
  let gr = 0;
  for (let k = 0; k < m && s0 + k < out.length; k++) {
    const u = k / m;
    const env = (1 - exp(-u * 18)) * pow(1 - u, 1.4);
    if ((k & 3) === 0) bp.set(fa + (fb - fa) * u, 1.8);
    bp.run(nz());
    gr += ga * ((nz() > 0.3 ? 1 : 0.15) - gr);
    out[s0 + k] += lp.run(bp.bp * (0.35 + 0.9 * gr)) * env * lvl;
  }
}
function thud(out, sr, t0, lvl, f0 = 150, f1 = 55) {
  const s0 = round(t0 * sr), m = round(sr * 0.12);
  let ph = 0;
  for (let k = 0; k < m && s0 + k < out.length; k++) {
    const t = k / sr;
    ph += (f1 + (f0 - f1) * exp(-t / 0.02)) / sr;
    out[s0 + k] += tanh(1.6 * sin(TAU * ph)) * exp(-t / 0.035) * lvl * min(1, t / 0.003);
  }
}
function dig(sr, total = 0.62) {
  const out = new Float32Array(round(sr * total)), nz = noise("dig");
  digScrape(out, sr, nz, 0.0, 0.22, 1.6, 1800, 800);
  thud(out, sr, 0.19, 0.55);
  digScrape(out, sr, nz, 0.3, 0.22, 1.5, 1600, 750);
  thud(out, sr, 0.49, 0.5);
  return finish(out, sr, { release: 0.04, lp: 5000 });
}

function land(sr) {
  // soft thud + a knock + dust hiss + two tiny leg clanks
  const T = 0.6, n = round(sr * T), out = new Float32Array(n), nz = noise("land");
  const hp = svf(sr).set(700, 0.7), lp = svf(sr).set(4200, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (55 + 120 * exp(-t / 0.03)) / sr;
    const thump = tanh(1.8 * sin(TAU * ph)) * exp(-t / 0.11);
    const knock = 0.6 * tanh(1.6 * tri(210 * t + 0.25)) * exp(-t / 0.03);
    hp.run(nz());
    lp.run(hp.hp);
    const dust = lp.lp * 1.7 * smooth01(t / 0.03) * exp(-t / 0.17) * (0.6 + 0.4 * nz());
    const clank = 0.2 * (sin(TAU * 910 * t) * exp(-t / 0.03) + 0.8 * sin(TAU * 1330 * (t - 0.09)) * exp(-(t - 0.09) / 0.03) * (t > 0.09 ? 1 : 0));
    out[i] = thump * 0.75 + knock + dust + clank;
  }
  return finish(out, sr, { release: 0.1 });
}

function takeoff(sr) {
  // engine roar rising for ~1 s: noise through an opening low-pass, a rising saw turbine, deep rumble, then away
  const T = 1.3, n = round(sr * T), out = new Float32Array(n), nz = noise("takeoff");
  const roar = svf(sr), rum = svf(sr).set(90, 0.7), tone = svf(sr), saw = sawOsc(sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / T;
    const env = u < 0.78 ? pow(sin((PI / 2) * (u / 0.78)), 1.6) : pow(cos((PI / 2) * ((u - 0.78) / 0.22)), 2);
    if ((i & 3) === 0) { roar.set(150 + 3300 * pow(u, 2.2), 0.8); tone.set(300 + 1700 * u, 0.8); }
    const crackle = 0.75 + 0.25 * nz();
    const r = roar.run(nz()) * (0.25 + 0.75 * pow(u, 1.2)) * crackle;
    const w = tone.run(saw(45 + 200 * pow(u, 1.6))) * 0.5;
    out[i] = (r * 1.6 + w + rum.run(nz()) * 6 * (1 - 0.5 * u)) * env;
  }
  return finish(out, sr, { release: 0.15 });
}

function chest(sr) {
  // C major arpeggio of bells, a chord that blooms, scattered sparkle pings, reverb: the "you got it" sound
  const n = round(sr * 1.05), out = new Float32Array(n), nz = noise("chest");
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5;
  [[C5, 0], [E5, 0.075], [G5, 0.15], [C6, 0.225], [E6, 0.3]].forEach(([f, t], k) => {
    bell(out, sr, t, f, 0.5 + 0.08 * k, 0.16);
    bell(out, sr, t, f * 1.004, 0.2, 0.2);
  });
  [[C5, 0.38, 0.45], [G5, 0.385, 0.4], [C6, 0.39, 0.4], [E6, 0.395, 0.34]].forEach(([f, t, a]) => bell(out, sr, t, f, a, 0.34));
  const pings = [2093, 2637, 3136, 3520, 4186];
  for (let k = 0; k < 16; k++) {
    const t = 0.06 + 0.8 * ((k * 0.618) % 1) + 0.02 * nz();
    const pf = pings[k % pings.length];
    bell(out, sr, t, pf, 0.09 + 0.05 * (nz() + 1), 0.05 + 0.03 * (nz() + 1), pf < 3300 ? [[1, 1, 1], [2.02, 0.2, 0.5]] : [[1, 1, 1]]);
  }
  reverb(out, sr, 0.3, 0.7);
  return finish(out, sr, { release: 0.2, lp: 9500 });
}

function kill(sr) {
  // "da-DUM" sting: G5 then a fifth-ish drop to C5 with a scoop, a bright crack on each hit, kick on the second
  const T = 0.5, n = round(sr * T), out = new Float32Array(n), nz = noise("kill");
  const saw1 = sawOsc(sr), sq1 = pulseOsc(sr), saw2 = sawOsc(sr), sq2 = pulseOsc(sr);
  const lp1 = svf(sr), lp2 = svf(sr), bp = svf(sr).set(2800, 1.5);
  let kph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, t2 = t - 0.1;
    const f1 = 784 * (1 - 0.03 * min(1, t / 0.1));
    const e1 = min(1, t / 0.005) * (t < 0.1 ? 1 : exp(-t2 / 0.012));
    if ((i & 3) === 0) { lp1.set(3000, 0.8); lp2.set(1400 + 2400 * exp(-Math.max(0, t2) / 0.06), 0.8); }
    const v1 = (lp1.run(0.5 * saw1(f1) + 0.4 * sq1(f1, 0.35)) + 0.4 * sin(PI * f1 * t)) * e1;
    let v2 = 0;
    const f2 = 523 * (1 + 0.06 * exp(-max(0, t2) / 0.03)) * (1 + 0.006 * sin(TAU * 6 * max(0, t2)));
    const s2 = saw2(f2), p2 = sq2(f2, 0.35); // keep the oscillators running so the switch is phase-clean
    if (t2 >= 0) v2 = (lp2.run(0.5 * s2 + 0.4 * p2) + 0.5 * sin(PI * f2 * t2)) * min(1, t2 / 0.004) * exp(-t2 / 0.17);
    kph += (60 + 110 * exp(-max(0, t2) / 0.03)) / sr;
    const kick = t2 >= 0 ? tanh(1.8 * sin(TAU * kph)) * exp(-t2 / 0.06) * 0.8 : 0;
    bp.run(nz());
    out[i] = v1 + v2 * 1.1 + kick + bp.bp * (exp(-t / 0.012) * 0.9 + (t2 >= 0 ? exp(-t2 / 0.01) * 0.6 : 0));
  }
  return finish(out, sr, { release: 0.1 });
}

function emp(sr) {
  // electric zap: falling square, random crackle bursts, 50 Hz buzz, then bit-crushed (sample-and-hold, coarse steps)
  const T = 0.5, n = round(sr * T), out = new Float32Array(n), nz = noise("emp");
  const sq = pulseOsc(sr), bp = svf(sr).set(2400, 2), lp = svf(sr).set(4200, 0.7), buzz = sawOsc(sr);
  let gate = 0, held = 0;
  const burst = round(sr * 0.006);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / T;
    if (i % burst === 0) gate = nz() > -0.25 ? 1 : 0;
    const env = exp(-t / 0.2);
    const zap = sq(110 + 1400 * exp(-t / 0.07), 0.5) * 0.7 * exp(-t / 0.11);
    bp.run(nz());
    const crackle = bp.bp * gate * (0.55 + 0.45 * (1 - u));
    const hum = buzz(50) * 0.35 * exp(-t / 0.25);
    const x = (zap + crackle * 1.2 + hum) * env * 1.6;
    if (i % 3 === 0) held = round(x * 7) / 7; // ~8 kHz sample rate, 15 levels: gritty digital feel
    out[i] = lp.run(held);
  }
  return finish(out, sr, { release: 0.12 });
}

function ink(sr) {
  // wet "blop" splat (sine 400 -> 100 Hz + low-passed noise) and a few bubbly droplets rising in pitch
  const T = 0.55, n = round(sr * T), out = new Float32Array(n), nz = noise("ink");
  const lp = svf(sr);
  let ph = 0;
  const drops = [[0.17, 620], [0.27, 900], [0.36, 760], [0.46, 1050]];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (100 + 300 * exp(-t / 0.045)) / sr;
    const blop = sin(TAU * ph) * (1 - exp(-t / 0.004)) * exp(-t / 0.11);
    if ((i & 3) === 0) lp.set(400 + 1900 * exp(-t / 0.04), 0.9);
    const splat = lp.run(nz()) * exp(-t / 0.05) * 1.6;
    let d = 0;
    for (const [t0, f] of drops) {
      const s = t - t0;
      if (s > 0 && s < 0.12) d += sin(TAU * f * (s + 0.016 * (1 - exp(-s / 0.012)))) * (1 - exp(-s / 0.003)) * exp(-s / 0.03) * 0.45;
    }
    out[i] = blop * 1.1 + splat + d;
  }
  return finish(out, sr, { release: 0.08 });
}

function tractor(sr) {
  // wobbling sci-fi beam: triangle + fifth + octave with 6 Hz vibrato and AM, pitch rising; a little shimmer noise
  const T = 0.75, n = round(sr * T), out = new Float32Array(n), nz = noise("tractor");
  const bp = svf(sr);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / T;
    const f = 190 + 360 * smooth01(u);
    const v = sin(TAU * 6 * t);
    p1 += (f * (1 + 0.045 * v)) / sr;
    p2 += (f * 1.5 * (1 - 0.04 * v)) / sr;
    p3 += (f * 2 * (1 + 0.03 * v)) / sr;
    if ((i & 3) === 0) bp.set(1500 + 1800 * u, 3);
    const am = 0.78 + 0.22 * sin(TAU * 6 * t + 1);
    const env = min(1, t / 0.05) * (u < 0.7 ? 1 : pow(cos((PI / 2) * ((u - 0.7) / 0.3)), 2));
    bp.run(nz());
    out[i] = (0.9 * tri(p1) + 0.5 * sin(TAU * p2) + 0.25 * sin(TAU * p3) + bp.bp * 0.14) * am * env;
  }
  return finish(out, sr, { release: 0.1 });
}

function mine(sr) {
  // warning "bip-bip" then a round boom
  const T = 0.75, n = round(sr * T), out = new Float32Array(n), nz = noise("mine");
  const body = svf(sr), rum = svf(sr).set(100, 0.7);
  let ph = 0, pph = 0;
  const T0 = 0.24;
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = t - T0;
    let blip = 0;
    for (const b0 of [0, 0.095]) {
      const q = t - b0;
      if (q >= 0 && q < 0.055) blip += (sin(TAU * 1250 * q) + 0.3 * tri(1250 * q)) * min(1, q / 0.004) * min(1, (0.055 - q) / 0.012) * 0.5;
    }
    let boom = 0;
    if (s >= 0) {
      ph += (45 + 90 * exp(-s / 0.06)) / sr;
      pph += (110 + 220 * exp(-s / 0.025)) / sr;
      if ((i & 3) === 0) body.set(200 + 3600 * exp(-s / 0.09), 0.8);
      boom = tanh(2.4 * sin(TAU * ph)) * exp(-s / 0.15) * 0.55 + tanh(2 * sin(TAU * pph)) * exp(-s / 0.06) * 0.7
        + body.run(nz()) * exp(-s / 0.14) * 2 + nz() * exp(-s / 0.005) * 0.6 + rum.run(nz()) * 4 * (1 - exp(-s / 0.03)) * exp(-s / 0.25);
      boom = tanh(boom * 0.8);
    }
    out[i] = blip + boom;
  }
  return finish(out, sr, { release: 0.12 });
}

function uiTap(sr) {
  // tiny soft "pop": a short pitch-dropping sine with a hint of second harmonic and a whisper of noise
  const n = round(sr * 0.04), out = new Float32Array(n), nz = noise("ui-tap");
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (620 + 780 * exp(-t / 0.012)) / sr;
    out[i] = (sin(TAU * ph) + 0.25 * sin(TAU * ph * 2.02)) * exp(-t / 0.011) + nz() * exp(-t / 0.003) * 0.2;
  }
  return finish(out, sr, { attack: 0.004, release: 0.014 });
}

function hint(sr) {
  // gentle two-note chime: A5 then E6, glassy sines with a soft tail
  const out = new Float32Array(round(sr * 0.65));
  bell(out, sr, 0, 880, 0.8, 0.16, SOFT_BELL);
  bell(out, sr, 0.15, 1318.5, 0.7, 0.2, SOFT_BELL);
  reverb(out, sr, 0.25, 0.5);
  return finish(out, sr, { release: 0.1 });
}

function countdown(sr) {
  // clean beep: A5 sine with a little triangle for presence
  const n = round(sr * 0.12), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (sin(TAU * 880 * t) + 0.3 * tri(880 * t)) * (1 - 0.15 * (t / 0.12));
  }
  return finish(out, sr, { attack: 0.005, release: 0.03 });
}

function countdownGo(sr) {
  // the higher, longer GO beep: E6 with a quick upward chirp, octave + fifth for brightness, little shimmer tail
  const n = round(sr * 0.35), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (1318.5 * (1 - 0.18 * exp(-t / 0.03))) / sr;
    const body = sin(TAU * ph) + 0.28 * tri(ph) + 0.35 * sin(TAU * ph * 1.5) + 0.3 * sin(PI * ph);
    out[i] = body * (t < 0.17 ? 1 : exp(-(t - 0.17) / 0.07));
  }
  reverb(out, sr, 0.12, 0.3);
  return finish(out, sr, { attack: 0.005, release: 0.08 });
}

function win(sr) {
  // fanfare: C-E-G-C brass arpeggio into a held, vibrato chord (C5 G5 C6 E6 + bass), bell sparkle, airy shimmer
  const n = round(sr * 1.8), out = new Float32Array(n), nz = noise("win");
  const C4 = 261.63, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1568;
  [[C5, 0], [E5, 0.1], [G5, 0.2], [C6, 0.3]].forEach(([f, t]) => brass(out, sr, t, 0.1, f, 0.55, 0.1));
  const T = 0.44, dur = 1.0;
  [C5, G5, C6, E6].forEach((f, k) => brass(out, sr, T + k * 0.012, dur, f, 0.5 - k * 0.05, 0.4));
  brass(out, sr, T, dur, C4, 0.6, 0.4);
  bell(out, sr, T, G6, 0.2, 0.5);
  bell(out, sr, T + 0.12, C6 * 2, 0.14, 0.4);
  bell(out, sr, T + 0.24, E6 * 2, 0.1, 0.35);
  const hp = svf(sr).set(2800, 0.7), lp = svf(sr).set(7000, 0.7); // airy shimmer, kept gentle
  for (let i = round(T * sr); i < n; i++) {
    const t = i / sr - T;
    hp.run(nz());
    out[i] += lp.run(hp.hp) * 0.16 * smooth01(t / 0.03) * exp(-t / 0.45);
  }
  reverb(out, sr, 0.2, 0.9);
  return finish(out, sr, { release: 0.3, lp: 9000 });
}

function hit(sr) {
  // bullet impact: a dry tick of band-passed noise on a short pitch-dropping pop
  const n = round(sr * 0.14), out = new Float32Array(n), nz = noise("hit");
  const bp = svf(sr).set(1900, 1.2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (150 + 200 * exp(-t / 0.02)) / sr;
    bp.run(nz());
    out[i] = 0.6 * tanh(1.5 * sin(TAU * ph)) * exp(-t / 0.035) + bp.bp * exp(-t / 0.018) * 1.3 + 0.25 * sin(TAU * 2400 * t) * exp(-t / 0.012);
  }
  return finish(out, sr, { release: 0.05 });
}

function crack(sr) {
  // stone cracking: three sharp snaps (band-passed noise), a dull knock and a trailing rattle of pebbles
  const n = round(sr * 0.5), out = new Float32Array(n), nz = noise("crack");
  const bp = svf(sr), rat = svf(sr).set(1500, 1.6);
  const snaps = [[0, 1700, 1], [0.09, 2300, 0.8], [0.17, 1400, 0.9]].map(([t, f, a]) => ({ i: round(t * sr), f, a }));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let e = 0;
    for (const s of snaps) {
      if (i === s.i) bp.set(s.f, 1.4);
      if (i >= s.i) e += s.a * exp(-(i - s.i) / sr / 0.012);
    }
    bp.run(nz());
    const knock = 0.45 * tanh(1.5 * sin(TAU * 140 * t)) * exp(-t / 0.05);
    const pebble = t > 0.15 && nz() > 1 - 90 / sr ? 1.6 * nz() : 0;
    rat.run(pebble);
    out[i] = bp.bp * e * 2.2 + knock + rat.bp * 1.6 * exp(-max(0, t - 0.15) / 0.12);
  }
  return finish(out, sr, { release: 0.1 });
}

function scan(sr) {
  // sonar: one oscillator that chirps up 500 -> 1500 Hz and rings out as the ping, then a quieter echo returning
  const n = round(sr * 0.9), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (t < 0.1 ? 500 + 1000 * smooth01(t / 0.1) : 1500) / sr;
    const env = t < 0.1 ? 0.9 * smooth01(t / 0.06) : 0.9 * exp(-(t - 0.1) / 0.14);
    out[i] = (sin(TAU * ph) + 0.12 * sin(TAU * 2 * ph)) * env;
  }
  bell(out, sr, 0.5, 1500, 0.28, 0.1, [[1, 1, 1], [2, 0.1, 0.4]]);
  reverb(out, sr, 0.2, 0.5);
  return finish(out, sr, { release: 0.15 });
}

function flare(sr) {
  // flare launch: rising airy swoosh, a soft pop, then glittering embers fading
  const n = round(sr * 0.55), out = new Float32Array(n), nz = noise("flare");
  const bp = svf(sr), hp = svf(sr).set(1600, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 3) === 0) bp.set(500 + 1900 * smooth01(t / 0.2), 1.6);
    const x = nz();
    bp.run(x);
    const sw = bp.bp * (t < 0.2 ? smooth01(t / 0.2) : exp(-(t - 0.2) / 0.03)) * 1.3;
    let pop = 0;
    if (t >= 0.2) {
      const s = t - 0.2;
      ph += (1700 - 800 * smooth01(s / 0.08)) / sr;
      pop = sin(TAU * ph) * exp(-s / 0.03) * 0.7 * min(1, s / 0.003);
    }
    hp.run(x);
    const ember = t >= 0.2 ? (nz() > 0.55 ? hp.hp : 0) * 0.35 * exp(-(t - 0.2) / 0.12) : 0;
    out[i] = sw + pop + ember;
  }
  return finish(out, sr, { release: 0.12, lp: 5000 });
}

function death(sr) {
  // you were destroyed: a falling, wobbling saw groan under a crunch and a low thump
  const T = 0.8, n = round(sr * T), out = new Float32Array(n), nz = noise("death");
  const saw = sawOsc(sr), sq = pulseOsc(sr), lp = svf(sr), bp = svf(sr).set(1500, 1);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = (60 + 540 * exp(-t * 2.2)) * (1 + 0.03 * sin(TAU * 7 * t));
    if ((i & 3) === 0) lp.set(250 + 2800 * exp(-t / 0.3), 0.9);
    const groan = lp.run(0.6 * saw(f) + 0.4 * sq(f * 0.5, 0.4)) * exp(-t / 0.5);
    ph += (50 + 90 * exp(-t / 0.05)) / sr;
    const thump = tanh(1.8 * sin(TAU * ph)) * exp(-t / 0.12);
    bp.run(nz());
    out[i] = groan * 1.2 + thump * 0.5 + bp.bp * exp(-t / 0.05) * 1.2;
  }
  return finish(out, sr, { release: 0.2 });
}

function respawn(sr) {
  // back in the game: a swoosh rising into a bright up-arpeggio (G4 D5 G5 B5) and a soft bloom
  const n = round(sr * 0.75), out = new Float32Array(n), nz = noise("respawn");
  const bp = svf(sr);
  for (let i = 0; i < round(sr * 0.3); i++) {
    const t = i / sr;
    if ((i & 3) === 0) bp.set(400 + 2800 * smooth01(t / 0.3), 1.6);
    bp.run(nz());
    out[i] += bp.bp * 0.9 * pow(t / 0.3, 1.5) * (t > 0.26 ? (0.3 - t) / 0.04 : 1);
  }
  [[392, 0.12], [587.3, 0.2], [784, 0.28], [987.8, 0.36]].forEach(([f, t], k) => {
    bell(out, sr, t, f, 0.55 + 0.1 * k, 0.12, SOFT_BELL);
    bell(out, sr, t, f * 1.005, 0.2, 0.16, SOFT_BELL);
  });
  reverb(out, sr, 0.3, 0.6);
  return finish(out, sr, { release: 0.18 });
}

function steal(sr) {
  // the sneaky grab: a quick upward swipe of noise, three coin pings snatched away, then a cheeky falling "bwoop"
  const n = round(sr * 0.62), out = new Float32Array(n), nz = noise("steal");
  const bp = svf(sr);
  const sw = round(sr * 0.16);
  for (let i = 0; i < sw; i++) {
    const t = i / sr;
    if ((i & 3) === 0) bp.set(900 + 3800 * (t / 0.16), 1.3);
    bp.run(nz());
    out[i] += bp.bp * 0.55 * smooth01(t / 0.02) * (1 - t / 0.16);
  }
  [[1318.5, 0.1], [1568, 0.15], [2093, 0.2]].forEach(([f, t]) => bell(out, sr, t, f, 0.42, 0.07, SOFT_BELL));
  const s0 = round(sr * 0.28);
  let ph = 0;
  for (let i = s0; i < n; i++) {
    const t = (i - s0) / sr;
    ph += (880 * exp(-t / 0.12) + 260) / sr;
    out[i] += (sin(TAU * ph) + 0.25 * tri(ph)) * 0.5 * min(1, t / 0.006) * exp(-t / 0.13);
  }
  reverb(out, sr, 0.15, 0.4);
  return finish(out, sr, { release: 0.08 });
}

function hitmark(sr) {
  // MY shot landed: a crisp, dry confirm (a bright two-partial ping on a tiny click), short so rapid fire stays clean
  const n = round(sr * 0.12), out = new Float32Array(n), nz = noise("hitmark");
  bell(out, sr, 0, 2637, 0.6, 0.025, [[1, 1, 1], [1.5, 0.35, 0.6]]);
  const bp = svf(sr).set(3200, 1.6), cl = round(sr * 0.02);
  for (let i = 0; i < cl; i++) { bp.run(nz()); out[i] += bp.bp * 0.8 * (1 - i / cl); }
  return finish(out, sr, { attack: 0.002, release: 0.03, lp: 7500 });
}

function cardPop(sr) {
  // a card popping into the lobby hangar: a toy "bloop" (round sine sweeping up 280 -> 880 Hz in 60 ms, a whisper of
  // 2nd harmonic), a small bright ping an octave up at 45 ms, a little room; soft edges so ten in a row stay friendly
  const n = round(sr * 0.36), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (280 + 600 * smooth01(t / 0.06)) / sr;
    out[i] = (sin(TAU * ph) + 0.1 * sin(TAU * 2 * ph)) * (1 - exp(-t / 0.008)) * exp(-t / 0.08);
  }
  bell(out, sr, 0.045, 1760, 0.3, 0.05, [[1, 1, 1], [2, 0.1, 0.5]]);
  reverb(out, sr, 0.12, 0.4);
  return finish(out, sr, { release: 0.08, lp: 6000 });
}

function podium(sr) {
  // a podium block rising: a short whoosh sweeping up, then it locks in place with a punchy saturated thump (the
  // harmonics carry it on small speakers) and a bright wood-and-metal clack
  const n = round(sr * 0.6), out = new Float32Array(n), nz = noise("podium");
  const T0 = 0.25, bp = svf(sr), ck = svf(sr).set(3000, 1.8);
  let ph = 0, pph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = t - T0, u = min(1, t / T0);
    if ((i & 3) === 0) bp.set(300 + 2400 * u * u, 1.4);
    const x = nz();
    bp.run(x);
    ck.run(x);
    let y = bp.bp * 0.8 * u * sqrt(u) * (s < 0 ? 1 : exp(-s / 0.012));
    if (s >= 0) {
      ph += (52 + 140 * exp(-s / 0.03)) / sr;
      pph += (105 + 220 * exp(-s / 0.02)) / sr;
      y += (tanh(2.4 * sin(TAU * ph)) * exp(-s / 0.12) * 0.9 + tanh(2 * sin(TAU * pph)) * exp(-s / 0.045) * 0.45) * min(1, s / 0.003);
      y += ck.bp * exp(-s / 0.008) * 0.7;
    }
    out[i] = y;
  }
  bell(out, sr, T0, 1150, 0.28, 0.04, [[1, 1, 1], [2.72, 0.55, 0.5], [5.2, 0.2, 0.3]]);
  reverb(out, sr, 0.1, 0.4);
  return finish(out, sr, { release: 0.12 });
}

function fanfare(sr) {
  // the winner's reveal, in G so it does not echo win's C: a cymbal swell into a brass "ta-DAAA" (a short D5 pickup, then
  // a held G major chord with vibrato), a saturated timpani G on the downbeat, a bell arpeggio rising out of the hit
  const n = round(sr * 1.9), out = new Float32Array(n), nz = noise("fanfare");
  const TD = 0.34, G2 = 98, G3 = 196, G4 = 392, B4 = 493.88, D5 = 587.33, G5 = 783.99;
  const hp = svf(sr).set(2500, 0.7), lp = svf(sr).set(6500, 0.7), sw = svf(sr), ml = svf(sr).set(900, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = t - TD, u = min(1, t / TD);
    if ((i & 3) === 0 && s < 0) sw.set(1500 + 3500 * u * u, 1.3);
    const x = nz();
    hp.run(x);
    sw.run(x);
    ml.run(x);
    const cym = lp.run(hp.hp) * (s < 0 ? pow(u, 2.5) : 0.65 * exp(-s / 0.4) + 0.35 * exp(-s / 0.04)); // swell, then a crash
    let y = cym * 0.4 + sw.bp * 0.45 * (s < 0 ? u * u * u : exp(-s / 0.02));
    if (s >= 0) { // timpani: G2 dropping in from 128 Hz with a fifth-ish overtone, saturated, and the mallet's thud
      const at = min(1, s / 0.003);
      ph += (G2 + 30 * exp(-s / 0.04)) / sr;
      y += tanh(1.8 * (sin(TAU * ph) + 0.3 * sin(TAU * 1.5 * ph) * exp(-s / 0.15))) * exp(-s / 0.32) * at * 0.55;
      y += ml.lp * exp(-s / 0.012) * at * 0.8;
    }
    out[i] = y;
  }
  brass(out, sr, TD - 0.13, 0.08, D5, 0.5, 0.06); // "ta"
  brass(out, sr, TD - 0.13, 0.08, D5 / 2, 0.28, 0.06);
  [[G4, 0.42], [B4, 0.36], [D5, 0.36], [G5, 0.44]].forEach(([f, a], k) => brass(out, sr, TD + k * 0.01, 0.9, f, a, 0.45)); // "DAAA"
  brass(out, sr, TD, 0.9, G3, 0.5, 0.45);
  [1567.98, 1975.53, 2349.32, 3135.96].forEach((f, k) => bell(out, sr, TD + 0.1 + k * 0.07, f, 0.2 - 0.025 * k, 0.35 - 0.03 * k, [[1, 1, 1], [2, 0.2, 0.5]]));
  reverb(out, sr, 0.22, 1.1);
  return finish(out, sr, { release: 0.3 });
}

function star(sr) {
  // the winner's star flying into the leaderboard: a glittery whoosh sweeping up while soft bell sparkles climb a G major
  // pentatonic for ~0.9 s, then a bright "ding" as it lands at 0.96 s (G6, a fifth above, a shimmering twin)
  const n = round(sr * 1.45), out = new Float32Array(n), nz = noise("star");
  const TL = 0.96, bp = svf(sr), gl = svf(sr).set(4300, 2.5), lp = svf(sr).set(6500, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = t - TL, u = min(1, t / TL);
    if ((i & 3) === 0) bp.set(450 * pow(9, u), 1.8); // 450 -> 4050 Hz
    bp.run(nz());
    gl.run(nz() > 1 - (2 * (40 + 200 * u)) / sr ? nz() : 0); // glitter: sparse ticks ringing high, denser as it flies
    out[i] = lp.run(bp.bp * 0.4 + gl.bp * 0.5) * smooth01(t / 0.3) * (s < 0 ? 0.6 + 0.4 * u : exp(-s / 0.05));
  }
  [1174.66, 1318.51, 1567.98, 1760, 1975.53, 2349.32, 2637.02, 3135.96].forEach((f, k) =>
    bell(out, sr, 0.08 + 0.11 * k, f, 0.12 + 0.014 * k, 0.12, [[1, 1, 1], [2.02, 0.15, 0.5]]));
  bell(out, sr, TL, 1567.98, 0.6, 0.25);
  bell(out, sr, TL, 1567.98 * 1.004, 0.2, 0.35, SOFT_BELL);
  bell(out, sr, TL + 0.004, 2349.32, 0.24, 0.2, [[1, 1, 1], [2, 0.12, 0.5]]);
  reverb(out, sr, 0.2, 0.7);
  return finish(out, sr, { release: 0.35, lp: 7500 });
}

const RECIPES = {
  laser, boost, shield, drill, dig, land, takeoff, chest, kill, emp, ink, tractor, mine, hint, countdown, win,
  hit, crack, scan, flare, death, respawn, steal, hitmark, podium, fanfare, star,
  "ui-tap": uiTap, "countdown-go": countdownGo, "card-pop": cardPop,
  ambience: (sr) => finish(ambienceLoop(sr), sr, { attack: 0.8, release: 1.5 }), // the loop below, faded in and out
  explosion: (sr) => explosion(sr, "medium"),
  "explosion-small": (sr) => explosion(sr, "small"),
  "explosion-medium": (sr) => explosion(sr, "medium"),
  "explosion-large": (sr) => explosion(sr, "large"),
};

// ------------------------------------------------------------------------------------------- loop variants
// A seamless loop: tonal parts are periodic in `len` (integer cycles), noise parts are cross-faded tail into head
// with equal power. Both run through a pre-roll first so filters are settled when the loop starts.

function loopBuild(sr, len, build) {
  const N = round(len * sr), X = round(0.1 * sr), P = round(0.12 * sr);
  const tone = new Float32Array(N), nse = new Float32Array(N + X), step = build(sr, len), acc = { tone: 0, noise: 0 };
  for (let i = -P; i < N + X; i++) {
    step(i / sr, acc);
    if (i >= 0) {
      if (i < N) tone[i] = acc.tone;
      nse[i] = acc.noise;
    }
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = tone[i] + nse[i];
  for (let i = 0; i < X; i++) out[i] = tone[i] + nse[i] * sin((PI / 2) * (i / X)) + nse[N + i] * cos((PI / 2) * (i / X));
  let pk = 0;
  for (let i = 0; i < N; i++) { const a = abs(out[i]); if (a > pk) pk = a; }
  const g = 0.88 / (pk || 1);
  for (let i = 0; i < N; i++) out[i] *= g;
  return out;
}

// frequency snapped to whole cycles per loop so the tone is periodic
const cyc = (f, len) => max(1, round(f * len)) / len;

// The TV lobby's ambience, a quiet 8 s loop until START: a warm pad drifting Cmaj9 -> Am9 -> Cmaj9 once per loop
// (equal-power cosine crossfade), sines with slightly detuned triangle twins (slow chorus) through a gentle low-pass that
// breathes, a very soft filtered-noise air, a few quiet high bell twinkles. Every frequency and LFO is snapped with cyc();
// the twinkles are rendered past the loop end and their tails folded into the head.
const AMBIENCE = [ // [Hz, level, chord: 0 both / 1 Cmaj9 / 2 Am9, wave: 0 sine / 1 triangle]
  [130.81, 0.5, 1, 0], [131.4, 0.15, 1, 1], [196, 0.34, 1, 0], [587.33, 0.13, 1, 0],
  [220, 0.42, 2, 0], [219.1, 0.13, 2, 1], [261.63, 0.3, 2, 0], [392, 0.2, 2, 0],
  [329.63, 0.3, 0, 0], [330.8, 0.08, 0, 1], [493.88, 0.18, 0, 0], [492.5, 0.05, 0, 1],
];
// [s, Hz, level]: Cmaj9 tones near the loop ends, Am9 tones mid-loop, the shared E and B in between
const TWINKLES = [[0.6, 1975.53, 0.05], [1.95, 1318.51, 0.04], [3.2, 1760, 0.045], [4.1, 2093, 0.035], [4.25, 2637.02, 0.03], [5.75, 1975.53, 0.04], [7.3, 2349.32, 0.045]];
function ambienceLoop(sr) {
  const out = loopBuild(sr, 8, (sr2, len) => {
    const nz = noise("loop-ambience"), lp = svf(sr2), hp = svf(sr2).set(1100, 0.7), air = svf(sr2).set(4200, 0.7);
    const vs = AMBIENCE.map(([f, a, ch, w], k) => { // sines by recurrence (no sin() per sample), start phases spread
      const fr = cyc(f, len), dw = (TAU * fr) / sr2, p0 = (0.37 * k) % 1;
      return { a, ch, w, g: 0, ph: p0, dph: fr / sr2, c: 2 * cos(dw), y: sin(TAU * p0), ym: sin(TAU * p0 - dw) };
    });
    const fx = cyc(1 / len, len), fl = cyc(0.25, len), fa = cyc(0.375, len);
    let k = 0, ag = 0;
    return (t, a) => {
      if ((k++ & 7) === 0) { // slow controls every 8 samples (the loop length is a multiple of 8): crossfade, low-pass, air
        const x = 0.5 - 0.5 * cos(TAU * fx * t), gA = cos((PI / 2) * x), gB = sin((PI / 2) * x);
        for (const v of vs) v.g = v.a * (v.ch === 1 ? gA : v.ch === 2 ? gB : 1);
        lp.set(1550 + 400 * sin(TAU * fl * t), 0.6);
        ag = 0.08 * (0.6 + 0.4 * sin(TAU * fa * t + 1));
      }
      let s = 0;
      for (const v of vs) {
        if (v.w) {
          s += tri(v.ph) * v.g;
          v.ph += v.dph;
          if (v.ph >= 1) v.ph -= 1;
        } else {
          s += v.y * v.g;
          const yn = v.c * v.y - v.ym;
          v.ym = v.y;
          v.y = yn;
        }
      }
      a.tone = lp.run(s);
      hp.run(nz());
      a.noise = air.run(hp.hp) * ag;
    };
  });
  const N = out.length, W = round(sr * 3), tw = new Float32Array(N + W), parts = [[1, 1, 1], [2, 0.12, 0.45]];
  for (const [t0, f, a] of TWINKLES) {
    bell(tw, sr, t0, f, a, 0.45, parts);
    bell(tw, sr, t0, f * 1.003, a * 0.4, 0.55, parts);
  }
  let pk = 0;
  for (let i = 0; i < N; i++) {
    out[i] += tw[i] + (i < W ? tw[N + i] : 0); // the overhang folded into the head: the tails wrap around the seam
    const v = abs(out[i]);
    if (v > pk) pk = v;
  }
  const g = 0.88 / (pk || 1);
  for (let i = 0; i < N; i++) out[i] *= g;
  return out;
}

const LOOP_RECIPES = {
  drill: (sr) => loopBuild(sr, 1, (sr2, len) => {
    const nz = noise("loop-drill"), saw = sawOsc(sr2), saw2 = sawOsc(sr2), lp = svf(sr2), bp = svf(sr2);
    const f0 = cyc(128, len), f1 = cyc(193, len), am = cyc(30, len), wob = cyc(3, len);
    let amph = 0;
    return (t, a) => {
      const v = 1 + 0.02 * sin(TAU * wob * t);
      amph += am / sr2;
      lp.set(1400 + 250 * sin(TAU * wob * t), 0.9);
      bp.set(1100, 2);
      bp.run(nz());
      a.tone = lp.run(0.6 * saw(f0 * v) + 0.5 * saw2(f1 * v)) * (0.6 + 0.4 * sin(TAU * amph)) * 0.9;
      a.noise = bp.bp * (0.55 + 0.45 * sin(TAU * amph + 0.7)) * 1.1;
    };
  }),
  dig: (sr) => dig(sr, 0.72),
  tractor: (sr) => loopBuild(sr, 1, (sr2, len) => {
    const nz = noise("loop-tractor"), bp = svf(sr2), vib = cyc(6, len), slow = cyc(1, len);
    const fa = cyc(300, len), fb = cyc(450, len), fc = cyc(600, len);
    let p1 = 0, p2 = 0, p3 = 0;
    return (t, a) => {
      const v = sin(TAU * vib * t), s = 1 + 0.12 * sin(TAU * slow * t);
      p1 += (fa * s * (1 + 0.045 * v)) / sr2;
      p2 += (fb * s * (1 - 0.04 * v)) / sr2;
      p3 += (fc * s * (1 + 0.03 * v)) / sr2;
      bp.set(2200 + 500 * sin(TAU * slow * t), 3);
      bp.run(nz());
      a.tone = (0.9 * tri(p1) + 0.5 * sin(TAU * p2) + 0.25 * sin(TAU * p3)) * (0.78 + 0.22 * sin(TAU * vib * t + 1));
      a.noise = bp.bp * 0.14;
    };
  }),
  boost: (sr) => loopBuild(sr, 1.6, (sr2, len) => {
    const nz = noise("loop-boost"), bp = svf(sr2), hiss = svf(sr2), tone = svf(sr2), saw = sawOsc(sr2);
    const f0 = cyc(150, len), l1 = cyc(1.25, len), l2 = cyc(7, len);
    return (t, a) => {
      bp.set(900 + 350 * sin(TAU * l1 * t), 1.6);
      hiss.set(3200, 0.7);
      tone.set(1100, 0.8);
      const x = nz();
      bp.run(x);
      hiss.run(x);
      a.tone = tone.run(saw(f0 * (1 + 0.012 * sin(TAU * l1 * t)))) * (0.45 + 0.1 * sin(TAU * l2 * t));
      a.noise = (bp.bp * 1.2 + hiss.lp * 0.4) * (0.85 + 0.15 * sin(TAU * l2 * t + 2));
    };
  }),
  shield: (sr) => loopBuild(sr, 1, (sr2, len) => {
    const f0 = cyc(330, len), t1 = cyc(8, len), t2 = cyc(11, len);
    return (t, a) => {
      const tr = 0.7 + 0.3 * sin(TAU * t1 * t), tr2 = 0.7 + 0.3 * sin(TAU * t2 * t + 1.3);
      a.tone = (sin(TAU * f0 * t) + 0.4 * sin(TAU * f0 * 2 * t + 0.5) * tr + 0.22 * sin(TAU * (f0 * 3 + 1) * t) * tr2 + 0.5 * sin(PI * f0 * t)) * 0.4;
      a.noise = 0;
    };
  }),
  ambience: ambienceLoop,
};

// ---------------------------------------------------------------------------------------------- public render

// Pure: name -> mono Float32Array. opts.size: "small" | "medium" | "large" for "explosion"; opts.loop: seamless
// loop variant (see LOOPS). Unknown names give an empty array.
export function renderSound(name, sampleRate = 24000, opts = {}) {
  const sr = sampleRate;
  if (opts && opts.loop && LOOP_RECIPES[name]) return LOOP_RECIPES[name](sr);
  if (name === "explosion") {
    const size = opts && (opts.size === "small" || opts.size === "large") ? opts.size : "medium";
    return explosion(sr, size);
  }
  const fn = RECIPES[name];
  return fn ? fn(sr) : new Float32Array(0);
}

// ---------------------------------------------------------------------------------------------------- engine

const THROTTLE_MS = 30;
const NO_OPTS = Object.freeze({});
const EXPLOSION_KEY = { small: "explosion-small", medium: "explosion-medium", large: "explosion-large" };
const KNOWN = Object.create(null);
for (const n of SOUNDS) if (n !== "explosion") KNOWN[n] = true;

// Loudness targets: momentary RMS (100 ms) through a rough phone-speaker band, 250 Hz - 6 kHz. Every buffer is
// measured once when it is built and gets the trim that lands on its target, so the mix holds when a recipe changes
// and nothing leans on sub-bass a phone cannot play. Busy sounds sit low (laser), rare big ones high (explosions).
const LEVEL = {
  "explosion-small": 0.22, "explosion-medium": 0.3, "explosion-large": 0.36, win: 0.3, chest: 0.27, kill: 0.26, mine: 0.28,
  death: 0.25, takeoff: 0.24, "countdown-go": 0.28, countdown: 0.2, boost: 0.2, shield: 0.18, land: 0.18, emp: 0.22, ink: 0.19,
  respawn: 0.2, tractor: 0.18, drill: 0.18, dig: 0.19, crack: 0.18, scan: 0.16, flare: 0.17, laser: 0.13, hit: 0.12,
  "ui-tap": 0.09, hint: 0.13, steal: 0.24, hitmark: 0.11, "loop:drill": 0.12, "loop:dig": 0.14, "loop:tractor": 0.12, "loop:boost": 0.15, "loop:shield": 0.08,
  "card-pop": 0.16, podium: 0.2, fanfare: 0.3, star: 0.2, ambience: 0.06, "loop:ambience": 0.06, // v1.5 TV: the ambience sits under everything
};
function loudness(x, sr) {
  const hpa = exp((-TAU * 250) / sr), lpa = 1 - exp((-TAU * 6000) / sr), w = min(x.length, round(sr * 0.1));
  const e = new Float32Array(x.length);
  let px = 0, py = 0, qx = 0, qy = 0, ly = 0, acc = 0, best = 0;
  for (let i = 0; i < x.length; i++) { // two one-pole high-passes and a low-pass, squared
    py = x[i] - px + hpa * py; px = x[i];
    qy = py - qx + hpa * qy; qx = py;
    ly += lpa * (qy - ly);
    e[i] = ly * ly;
    acc += e[i];
    if (i >= w) acc -= e[i - w];
    if (i >= w - 1 && acc > best) best = acc;
  }
  return sqrt(best / w);
}
// Random pitch spread per play (+-) so a burst of the same sound does not phase into a machine-gun comb.
const VARY = { laser: 0.05, hit: 0.06, hitmark: 0.04, "ui-tap": 0.03, dig: 0.05, "explosion-small": 0.05, "explosion-medium": 0.04, "explosion-large": 0.03, land: 0.04, crack: 0.05, "card-pop": 0.04 };
// Loops start with a short spin-up (the playback rate rises) and wind down when stopped.
const SPIN = { drill: 0.7, boost: 0.8, tractor: 0.85, shield: 0.92 };

// Idle-time render order: what the first seconds of a round need comes first. The v1.5 TV-only sounds (card-pop, podium,
// fanfare, star, ambience and its loop) are left out: they are built on first play, so phones never render them.
const ORDER = [
  "ui-tap", "laser", "hit", "hitmark", "explosion-small", "explosion-medium", "countdown", "countdown-go", "boost", "shield", "chest", "kill", "steal",
  "land", "dig", "drill", "takeoff", "emp", "ink", "tractor", "mine", "hint", "win", "explosion-large", "crack", "scan", "flare",
  "death", "respawn",
].concat(LOOPS.filter((n) => n !== "ambience").map((n) => "loop:" + n));

const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const inertLoop = Object.freeze({ stop() {}, setPan() {}, setVolume() {} });

function inertSfx(volume) {
  let vol = clamp01(volume), muted = false;
  return {
    play: () => false,
    loop: () => inertLoop,
    unlock: () => Promise.resolve(),
    setVolume(v) { vol = clamp01(+v || 0); },
    get volume() { return vol; },
    mute(b) { muted = !!b; },
    get muted() { return muted; },
    get unlocked() { return false; },
    get ctx() { return null; },
    ready: Promise.resolve(),
    dispose() {},
  };
}

export function createSfx({ volume = 0.8, voices = 16, sampleRate = 24000, audioSession = "playback" } = {}) {
  const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  let ctx = null;
  try { if (AC) ctx = new AC(); } catch { ctx = null; }
  if (!ctx) return inertSfx(volume);

  let vol = clamp01(volume), muted = false, unlocked = false, dead = false;
  let master, hasPan;
  try {
    master = ctx.createGain();
    master.gain.value = vol;
    const comp = ctx.createDynamicsCompressor(); // gentle limiter: many overlapping sounds must not clip
    comp.threshold.value = -8;
    comp.knee.value = 12;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    hasPan = typeof ctx.createStereoPanner === "function";
  } catch { return inertSfx(volume); }

  function makeChain() {
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = hasPan ? ctx.createStereoPanner() : null;
    if (p) { g.connect(p); p.connect(master); } else g.connect(master);
    return { g, p };
  }

  // ---- buffers: rendered once, in idle chunks; a sound asked for early is rendered on the spot
  const bufs = Object.create(null), lvl = Object.create(null), last = Object.create(null);
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  function build(key) {
    if (bufs[key]) return bufs[key];
    try {
      const loop = key.startsWith("loop:");
      const name = loop ? key.slice(5) : key;
      let data = renderSound(name, sampleRate, { loop });
      let b;
      try { b = ctx.createBuffer(1, data.length, sampleRate); } catch { // engine refuses 24 kHz: render at its rate
        data = renderSound(name, ctx.sampleRate, { loop });
        b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      }
      b.getChannelData(0).set(data);
      let pk = 0;
      for (let i = 0; i < data.length; i++) { const a = abs(data[i]); if (a > pk) pk = a; }
      lvl[key] = min((LEVEL[key] || 0.18) / max(loudness(data, b.sampleRate), 1e-4), 1.2 / (pk || 1)); // never past ~1.2 at the source
      return (bufs[key] = b);
    } catch { return null; }
  }

  const queue = ORDER.slice();
  const idle = typeof window.requestIdleCallback === "function"
    ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(() => cb(null), 6);
  function pump(deadline) {
    if (dead) return resolveReady();
    const t0 = performance.now();
    const budget = deadline && deadline.timeRemaining ? min(12, max(4, deadline.timeRemaining() - 2)) : 6;
    while (queue.length && performance.now() - t0 < budget) build(queue.shift()); // at least one per call: t0 was just taken
    if (queue.length) idle(pump); else resolveReady();
  }
  idle(pump);

  // ---- voice pool: pre-connected gain -> pan -> master chains, round-robin, oldest stolen when all are busy
  const nv = max(1, voices | 0);
  const pool = [];
  for (let i = 0; i < nv; i++) { const c = makeChain(); pool.push({ g: c.g, p: c.p, src: null, t0: 0, end: 0, vol: 0 }); }
  let rr = 0, stolen = false;
  function takeVoice(t) {
    stolen = false;
    for (let k = 0; k < nv; k++) {
      let j = rr + k;
      if (j >= nv) j -= nv;
      if (pool[j].end <= t) { rr = j + 1 === nv ? 0 : j + 1; return pool[j]; }
    }
    let o = pool[0];
    for (let j = 1; j < nv; j++) if (pool[j].t0 < o.t0) o = pool[j];
    stolen = true;
    return o;
  }

  function play(name, o) {
    if (!unlocked || dead || muted || vol <= 0) return false;
    try {
      if (!o) o = NO_OPTS;
      const key = name === "explosion" ? EXPLOSION_KEY[o.size] || "explosion-medium" : name;
      if (!KNOWN[key]) return false;
      const now = performance.now(), l = last[key];
      if (l !== undefined && now - l < THROTTLE_MS) return false;
      const buf = bufs[key] || build(key);
      if (!buf) return false;
      const level = (o.volume === undefined ? 1 : clamp01(o.volume)) * lvl[key];
      const rate = o.rate === undefined ? 1 + (Math.random() * 2 - 1) * (VARY[key] || 0) : o.rate < 0.25 ? 0.25 : o.rate > 4 ? 4 : o.rate;
      const t = ctx.currentTime, v = takeVoice(t), g = v.g.gain;
      let when = 0;
      if (stolen) { // duck the old sound for 4 ms instead of cutting it, then start the new one
        g.cancelScheduledValues(t);
        g.setValueAtTime(v.vol, t);
        g.linearRampToValueAtTime(0, t + 0.004);
        try { v.src.stop(t + 0.004); } catch { /* already ended */ }
        when = t + 0.005;
        g.setValueAtTime(level, when);
      } else g.value = level;
      if (v.p) v.p.pan.value = o.pan > 1 ? 1 : o.pan < -1 ? -1 : o.pan || 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (rate !== 1) src.playbackRate.value = rate;
      src.connect(v.g);
      src.start(when);
      v.src = src;
      v.t0 = t;
      v.end = (when || t) + buf.duration / rate;
      v.vol = level;
      last[key] = now;
      return true;
    } catch { return false; }
  }

  // ---- loops for held actions: own chains (pooled), fade in/out, spin-up, safety stop
  const loopPool = [], active = [];
  function loop(name, o) {
    if (!unlocked || dead) return inertLoop;
    try {
      if (!o) o = NO_OPTS;
      const base = name === "explosion" ? EXPLOSION_KEY[o.size] || "explosion-medium" : name;
      if (!KNOWN[base]) return inertLoop;
      const key = LOOPS.indexOf(base) >= 0 ? "loop:" + base : base;
      const buf = bufs[key] || build(key);
      if (!buf) return inertLoop;
      if (active.length >= 8) active[0].stop(0.05);
      const ch = loopPool.pop() || makeChain();
      let level = (o.volume === undefined ? 1 : clamp01(o.volume)) * lvl[key];
      const rate = o.rate > 0 ? min(4, max(0.25, o.rate)) : 1, spin = SPIN[base] || 1, t = ctx.currentTime;
      ch.g.gain.cancelScheduledValues(0);
      ch.g.gain.setValueAtTime(0, t);
      ch.g.gain.setTargetAtTime(level, t, 0.015);
      if (ch.p) { ch.p.pan.cancelScheduledValues(0); ch.p.pan.setValueAtTime(o.pan > 1 ? 1 : o.pan < -1 ? -1 : o.pan || 0, t); }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.setValueAtTime(rate * spin, t);
      if (spin < 1) src.playbackRate.setTargetAtTime(rate, t, 0.07);
      src.connect(ch.g);
      src.start(0);
      let stopped = false, timer = 0;
      const h = {
        stop(fade = 0.08) {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          const i = active.indexOf(h);
          if (i >= 0) active.splice(i, 1);
          try {
            const now = ctx.currentTime, f = max(0.01, +fade || 0.08);
            ch.g.gain.setTargetAtTime(0, now, f / 5);
            if (spin < 1) src.playbackRate.setTargetAtTime(rate * (0.6 + 0.4 * spin), now, f / 3);
            src.onended = () => { try { src.disconnect(); } catch { /* gone */ } loopPool.push(ch); };
            src.stop(now + f * 1.4 + 0.02);
          } catch { /* context closed */ }
        },
        setPan(p) { try { if (!stopped && ch.p) ch.p.pan.setTargetAtTime(p > 1 ? 1 : p < -1 ? -1 : +p || 0, ctx.currentTime, 0.02); } catch { /* ignore */ } },
        setVolume(v) { try { if (!stopped) { level = clamp01(v) * lvl[key]; ch.g.gain.setTargetAtTime(level, ctx.currentTime, 0.02); } } catch { /* ignore */ } },
      };
      active.push(h);
      timer = setTimeout(() => h.stop(0.3), (o.maxSeconds > 0 ? o.maxSeconds : 30) * 1000); // a missed release must not hum forever
      return h;
    } catch { return inertLoop; }
  }

  // ---- unlock: iOS only starts audio from inside a touchend / click, so resume() runs in the gesture
  const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  let armed = false;
  const onGesture = () => { unlock(); };
  function arm() {
    if (armed || dead) return;
    armed = true;
    for (const e of GESTURES) window.addEventListener(e, onGesture, { capture: true, passive: true });
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    for (const e of GESTURES) window.removeEventListener(e, onGesture, { capture: true });
  }
  function sync() { // the context is the truth: running = unlocked; suspended or interrupted = wait for the next tap
    if (dead) return;
    const run = ctx.state === "running";
    if (run === unlocked) return;
    unlocked = run;
    if (run) disarm(); else arm();
  }
  function setSession() { // iOS 16.4+: "playback" ignores the ringer switch; "ambient" respects it; false leaves it alone
    try { if (audioSession && navigator.audioSession) navigator.audioSession.type = audioSession; } catch { /* unsupported */ }
  }
  // Every gesture calls resume() again, even while an earlier attempt is still pending: on iOS pointerdown does not
  // count as a gesture (resume() just hangs), and the touchend / click right after it must not be swallowed.
  function unlock() {
    if (dead || unlocked) return Promise.resolve();
    try {
      setSession();
      const p = ctx.resume();
      try { // the iOS trick: start a silent one-sample buffer inside the gesture
        const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
      } catch { /* not needed everywhere */ }
      return Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(r, 1200))]).catch(() => {}).then(sync);
    } catch { return Promise.resolve(); }
  }
  ctx.onstatechange = sync;
  const onVisible = () => { if (!document.hidden && !dead && ctx.state !== "running") { try { ctx.resume().catch(() => {}); } catch { /* ignore */ } } };
  document.addEventListener("visibilitychange", onVisible);
  setSession();
  arm();
  sync();

  function applyMaster() {
    try { master.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, 0.015); } catch { /* ignore */ }
  }

  return {
    play,
    loop,
    unlock,
    setVolume(v) { vol = clamp01(+v || 0); applyMaster(); },
    get volume() { return vol; },
    mute(b) { muted = !!b; applyMaster(); },
    get muted() { return muted; },
    get unlocked() { return unlocked; },
    get ctx() { return ctx; },
    ready,
    dispose() {
      if (dead) return;
      dead = true;
      disarm();
      document.removeEventListener("visibilitychange", onVisible);
      for (const h of active.slice()) h.stop(0.02);
      for (const v of pool) { try { if (v.src) v.src.stop(); } catch { /* ended */ } }
      resolveReady();
      try { ctx.onstatechange = null; ctx.close(); } catch { /* ignore */ }
    },
  };
}
