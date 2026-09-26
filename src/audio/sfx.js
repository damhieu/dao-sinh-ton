// Procedural sound synthesis for ĐẢO SINH TỒN.
//
// Every sound is rendered once at init from plain sample math into Float32Arrays, then copied into
// mono AudioBuffers. The only thing needed from the caller is a ctx-like object exposing `sampleRate`
// and `createBuffer(channels, length, sampleRate)`, so this module runs unchanged in Node for tests.
//
// Conventions: times are in seconds, frequencies in Hz, `sr` is the sample rate of the buffer being
// rendered. Layers are peak-normalised to their `gain` before mixing so the balance between layers is
// predictable, and every finished buffer is normalised to -1 dBFS.
//
// Loops are synthesised to be exactly periodic: oscillators and LFOs complete whole cycles per loop,
// events wrap around the end, and filters are primed with the loop's own tail before running. The
// buffer therefore joins its head seamlessly with no crossfade dip or phasing.

const TAU = Math.PI * 2;
const PEAK = 0.891; // -1 dBFS
const LP = 0;
const BP = 1;
const HP = 2;

// -------------------------------------------------------------------------------------------------
// Basic helpers
// -------------------------------------------------------------------------------------------------

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const rr = (rng, a, b) => a + (b - a) * rng();
const vary = (rng, x, amt) => x * (1 + (rng() * 2 - 1) * amt);
const ns = (sr, s) => Math.max(1, Math.round(sr * s));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Fast rational tanh approximation (exact saturation at ±3). */
function ftanh(x) {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function noise(n, rng) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1;
  return a;
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] < 0 ? -x[i] : x[i];
    if (v > p) p = v;
  }
  return p;
}

function scaleTo(x, peak) {
  const p = peakOf(x);
  if (p > 1e-12) {
    const k = peak / p;
    for (let i = 0; i < x.length; i++) x[i] *= k;
  }
  return x;
}

/** Adds `src` into `dst` starting at time `t`. */
function mix(dst, src, sr, t, gain = 1) {
  const at = Math.round(t * sr);
  const i0 = Math.max(0, -at);
  const i1 = Math.min(src.length, dst.length - at);
  for (let i = i0; i < i1; i++) dst[at + i] += src[i] * gain;
}

/** Adds `src` into a loop buffer at sample offset `at`, wrapping around the end. */
function mixWrap(dst, src, at, gain = 1) {
  const n = dst.length;
  let j = ((at % n) + n) % n;
  for (let i = 0; i < src.length; i++) {
    dst[j] += src[i] * gain;
    if (++j === n) j = 0;
  }
}

/** Saturates a buffer whose peak is ~1 (drive ≈ 1 gentle, 3 heavy); output peak stays ≤ 1. */
function softClip(x, drive) {
  const k = 1 / ftanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = ftanh(x[i] * drive) * k;
  return x;
}

// -------------------------------------------------------------------------------------------------
// Filters
// -------------------------------------------------------------------------------------------------

/** RBJ-cookbook biquad ("lp", "hp", "bp" with 0 dB peak, "pk" peaking EQ), transposed direct form II. */
class Biquad {
  constructor(type, f, q, sr, db = 0) {
    const w = (TAU * clamp(f, 10, sr * 0.45)) / sr;
    const cw = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === "lp") {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + al;
      a1 = -2 * cw;
      a2 = 1 - al;
    } else if (type === "hp") {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + al;
      a1 = -2 * cw;
      a2 = 1 - al;
    } else if (type === "bp") {
      b0 = al;
      b1 = 0;
      b2 = -al;
      a0 = 1 + al;
      a1 = -2 * cw;
      a2 = 1 - al;
    } else {
      const A = Math.pow(10, db / 40);
      b0 = 1 + al * A;
      b1 = -2 * cw;
      b2 = 1 - al * A;
      a0 = 1 + al / A;
      a1 = -2 * cw;
      a2 = 1 - al / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    this.z1 = 0;
    this.z2 = 0;
  }

  run(x) {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
    return x;
  }
}

/** In-place biquad on a one-shot buffer. */
const filt = (x, type, f, q, sr, db) => new Biquad(type, f, q, sr, db).run(x);

/** In-place biquad on a loop buffer: the filter state is primed with the loop's own tail first. */
function filtLoop(x, type, f, q, sr, db) {
  const b = new Biquad(type, f, q, sr, db);
  b.run(x.slice(Math.max(0, x.length - ns(sr, 0.3))));
  return b.run(x);
}

/**
 * Time-varying state-variable filter (TPT form, stable under fast modulation), in place.
 * `fc(t)` returns the cutoff in Hz at time t and is evaluated every 32 samples. BP output has 0 dB peak.
 */
function svf(x, sr, mode, q, fc) {
  const k = 1 / q;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) {
      const g = Math.tan((Math.PI * clamp(fc(i / sr), 20, sr * 0.45)) / sr);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    x[i] = mode === LP ? v2 : mode === BP ? k * v1 : v0 - k * v1 - v2;
  }
  return x;
}

// -------------------------------------------------------------------------------------------------
// Envelopes and control curves
// -------------------------------------------------------------------------------------------------

/**
 * Multiplies x by (1 - e^(-t/att)) * ((1 - slow) e^(-t/tau) + slow e^(-t/tau2)).
 * att = 0 gives an instant attack; `slow` adds a second, longer decay stage for "body".
 */
function envelope(x, sr, att, tau, slow = 0, tau2 = 1) {
  const ka = att > 0 ? Math.exp(-1 / (att * sr)) : 0;
  const kd = Math.exp(-1 / (tau * sr));
  const ks = Math.exp(-1 / (tau2 * sr));
  let a = att > 0 ? 1 : 0;
  let d = 1 - slow;
  let s = slow;
  for (let i = 0; i < x.length; i++) {
    x[i] *= (1 - a) * (d + s);
    a *= ka;
    d *= kd;
    s *= ks;
  }
  return x;
}

/** Smoothly interpolated random curve in [0, 1] with about `hz` new random values per second. */
function wobble(n, sr, rng, hz) {
  const step = Math.max(2, Math.round(sr / hz));
  const out = new Float32Array(n);
  let a = rng();
  let b = rng();
  for (let i = 0; i < n; i++) {
    const r = i % step;
    if (i > 0 && r === 0) {
      a = b;
      b = rng();
    }
    const u = r / step;
    out[i] = a + (b - a) * u * u * (3 - 2 * u);
  }
  return out;
}

/**
 * Smooth periodic random curve in [-1, 1] for loops: a sum of sines with integer cycle counts over
 * the buffer, evaluated at control rate and linearly interpolated.
 */
function lfo(n, rng, cycles, amps) {
  const step = 64;
  const m = Math.ceil(n / step) + 2;
  const ctl = new Float64Array(m);
  const ph = cycles.map(() => rng() * TAU);
  let norm = 0;
  for (const a of amps) norm += a;
  for (let j = 0; j < m; j++) {
    const u = (j * step) / n;
    let v = 0;
    for (let k = 0; k < cycles.length; k++) v += amps[k] * Math.sin(TAU * cycles[k] * u + ph[k]);
    ctl[j] = v / norm;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / step;
    const j = p | 0;
    out[i] = ctl[j] + (ctl[j + 1] - ctl[j]) * (p - j);
  }
  return out;
}

/** Final pass for one-shots: DC block, trim the silent tail (< -70 dB), short fade-out, normalise. */
function finish(x, sr) {
  const a = Math.exp((-TAU * 18) / sr);
  let px = 0;
  let py = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    py = a * (py + v - px);
    px = v;
    x[i] = py;
  }
  const p = peakOf(x);
  if (!(p > 1e-9)) return x;
  const th = p * 3e-4;
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < th) end--;
  end = Math.min(x.length, end + ns(sr, 0.01));
  const y = end < x.length ? x.slice(0, end) : x;
  const f = Math.min(y.length, ns(sr, 0.015));
  for (let i = 0; i < f; i++) y[y.length - 1 - i] *= i / f;
  return scaleTo(y, PEAK);
}

/** Final pass for loops: circular DC block and normalise (length is kept exact). */
function finishLoop(x, sr) {
  filtLoop(x, "hp", 20, 0.7, sr);
  return scaleTo(x, PEAK);
}

// -------------------------------------------------------------------------------------------------
// Synthesis primitives. All of them mix into `out` at time `t` (seconds).
// -------------------------------------------------------------------------------------------------

/**
 * Enveloped, filtered noise burst, peak-normalised to `gain`.
 * o: { t, dur, att, tau, slow, tau2, gain, f: [[type, freq, q, db], ...],
 *      sv: [mode, fromHz, toHz, sweepTau, q] (exponential cutoff sweep), fc: t => Hz, mode, q }
 */
function burst(out, sr, rng, o) {
  const at = Math.round((o.t || 0) * sr);
  const n = Math.min(ns(sr, o.dur), out.length - at);
  if (n <= 0) return;
  const s = noise(n, rng);
  envelope(s, sr, o.att ?? 0.0005, o.tau, o.slow || 0, o.tau2 || 1);
  if (o.f) for (const f of o.f) filt(s, f[0], f[1], f[2], sr, f[3]);
  if (o.sv) {
    const [mode, f0, f1, st, q] = o.sv;
    svf(s, sr, mode, q, (tt) => f1 + (f0 - f1) * Math.exp(-tt / st));
  }
  if (o.fc) svf(s, sr, o.mode ?? LP, o.q ?? 0.7, o.fc);
  scaleTo(s, o.gain ?? 1);
  for (let i = 0; i < n; i++) out[at + i] += s[i];
}

/** Pitch-swept sine "thump" (f0 → f1 exponentially), optionally saturated for punch. Peak ≈ gain. */
function thump(out, sr, o) {
  const at = Math.round((o.t || 0) * sr);
  const n = Math.min(ns(sr, o.tau * 9 + 0.01), out.length - at);
  if (n <= 0) return;
  const ka = Math.exp(-1 / ((o.att || 0.001) * sr));
  const kd = Math.exp(-1 / (o.tau * sr));
  const ks = Math.exp(-1 / (o.sweep * sr));
  const drive = o.drive || 0;
  const dn = drive > 0 ? 1 / ftanh(drive) : 1;
  const g = o.gain ?? 1;
  const w = TAU / sr;
  let ph = 0;
  let fd = o.f0 - o.f1;
  let a = 1;
  let d = 1;
  for (let i = 0; i < n; i++) {
    ph += w * (o.f1 + fd);
    fd *= ks;
    let v = Math.sin(ph) * (1 - a) * d;
    if (drive > 0) v = ftanh(v * drive) * dn;
    out[at + i] += v * g;
    a *= ka;
    d *= kd;
  }
}

/**
 * Modal synthesis: a bank of exponentially decaying sinusoids ([freq, amp, tau] per mode) struck at
 * time t, as for metal, wood or glass. The sum is peak-normalised to `gain`.
 */
function modal(out, sr, t, modes, gain, att = 0) {
  const at = Math.round(t * sr);
  let len = 0;
  for (const m of modes) len = Math.max(len, m[2]);
  const n = Math.min(ns(sr, len * 7), out.length - at);
  if (n <= 0) return;
  const s = new Float32Array(n);
  for (const [f, amp, tau] of modes) {
    if (f >= sr * 0.45 || f <= 0) continue;
    const w = (TAU * f) / sr;
    const c = Math.cos(w);
    const sn = Math.sin(w);
    const k = Math.exp(-1 / (tau * sr));
    const m = Math.min(n, ns(sr, tau * 7));
    let re = amp;
    let im = 0;
    for (let i = 0; i < m; i++) {
      s[i] += im;
      const r = (re * c - im * sn) * k;
      im = (re * sn + im * c) * k;
      re = r;
    }
  }
  if (att > 0) envelope(s, sr, att, 1e6);
  scaleTo(s, gain);
  for (let i = 0; i < n; i++) out[at + i] += s[i];
}

/** Acoustic shock "N-wave" (muzzle blast / supersonic crack): a sharp linear ramp from +g to -g. */
function nwave(out, sr, t, dur, gain) {
  const at = Math.round(t * sr);
  const n = Math.max(2, Math.round(dur * sr));
  for (let i = 0; i < n && at + i < out.length; i++) out[at + i] += gain * (1 - (2 * i) / (n - 1));
}

/**
 * Scatter of tiny noise grains (debris, crunch, gravel, rattle) between t and t + span.
 * o: { t, span, count, len (grain length), gain, skew (1 uniform, >1 front-loaded), f: filters }
 */
function grains(out, sr, rng, o) {
  const { t = 0, span, count, len = 0.002, gain = 1, skew = 1, f } = o;
  const n = ns(sr, span + len * 4);
  const s = new Float32Array(n);
  for (let k = 0; k < count; k++) {
    const u = Math.pow(rng(), skew);
    const at = Math.round(u * span * sr);
    const gl = ns(sr, len * rr(rng, 0.5, 1.5));
    const kd = Math.exp(-4 / gl);
    let e = (0.25 + 0.75 * rng()) * (1 - 0.6 * u);
    for (let i = 0; i < gl && at + i < n; i++) {
      s[at + i] += (rng() * 2 - 1) * e;
      e *= kd;
    }
  }
  if (f) for (const q of f) filt(s, q[0], q[1], q[2], sr, q[3]);
  scaleTo(s, gain);
  mix(out, s, sr, t);
}

/** Water bubble: a short sine chirp rising in pitch (resonance of a bubble released under water). */
function bubble(out, sr, t, f0, rise, tau, gain) {
  const at = Math.round(t * sr);
  const n = Math.min(ns(sr, tau * 6), out.length - at);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    ph += (TAU * f0 * (1 + rise * tt)) / sr;
    out[at + i] += Math.sin(ph) * (1 - Math.exp(-tt / 0.0006)) * Math.exp(-tt / tau) * gain;
  }
}

/** Small mechanical click: a noise tick plus a few inharmonic metallic modes around f. */
function click(out, sr, rng, t, f, gain, tau = 0.01) {
  const r = () => rr(rng, 0.95, 1.05);
  modal(
    out,
    sr,
    t,
    [
      [f * r(), 1, tau],
      [f * 1.51 * r(), 0.7, tau * 0.7],
      [f * 2.37 * r(), 0.5, tau * 0.5],
      [f * 3.3 * r(), 0.3, tau * 0.35],
    ],
    gain,
  );
  burst(out, sr, rng, { t, dur: 0.008, att: 0, tau: 0.0008, gain: gain * 0.7, f: [["hp", 2000, 0.7]] });
}

/** Low mechanical body ("thunk") for heavier parts: magazines, bolts, doors. */
function thunk(out, sr, rng, t, f, gain, tau = 0.025) {
  modal(
    out,
    sr,
    t,
    [
      [vary(rng, f, 0.04), 1, tau],
      [vary(rng, f * 1.72, 0.04), 0.55, tau * 0.6],
      [vary(rng, f * 2.9, 0.04), 0.3, tau * 0.4],
    ],
    gain,
  );
}

/** Sliding contact (metal/plastic scrape): band-passed noise with a rough, jittery amplitude. */
function scrape(out, sr, rng, t, dur, f, q, gain, rough = 0.6) {
  const n = ns(sr, dur);
  const s = noise(n, rng);
  let g = 1;
  let target = 1;
  for (let i = 0; i < n; i++) {
    if (i % 48 === 0) target = 1 - rough * rng();
    g += (target - g) * 0.08;
    s[i] *= g * Math.pow(Math.sin((Math.PI * i) / n), 0.7);
  }
  filt(s, "bp", f, q, sr);
  filt(s, "hp", 300, 0.7, sr);
  scaleTo(s, gain);
  mix(out, s, sr, t);
}

/** Cloth / gear rustle: band-passed noise shaped by a few random soft bumps plus sparse crackle. */
function rustle(out, sr, rng, t, dur, gain, fc = 2200, bumps = 5) {
  const n = ns(sr, dur);
  const env = new Float32Array(n);
  for (let b = 0; b < bumps; b++) {
    const w = Math.min(ns(sr, rr(rng, 0.02, 0.07)), Math.floor(n / 2) - 1);
    if (w < 2) break;
    const c = w + rng() * (n - 2 * w);
    const a = rr(rng, 0.35, 1);
    const i0 = Math.max(0, Math.floor(c - w));
    const i1 = Math.min(n, Math.ceil(c + w));
    for (let i = i0; i < i1; i++) env[i] += a * 0.5 * (1 + Math.cos((Math.PI * (i - c)) / w));
  }
  const s = noise(n, rng);
  for (let i = 0; i < n; i++) s[i] *= env[i] * (rng() < 0.004 ? 3 : 1);
  filt(s, "bp", fc, 0.6, sr);
  filt(s, "hp", 600, 0.7, sr);
  scaleTo(s, gain);
  mix(out, s, sr, t);
}

/**
 * Friction creak (hinges, floorboards, harness): a jittery stick-slip pulse train at fFn(u) Hz
 * (u = 0..1 over the sound) exciting narrow resonances res = [[freq, q, amp], ...].
 */
function creak(out, sr, rng, t, dur, fFn, gain, res) {
  const n = ns(sr, dur);
  const p = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    ph += (fFn(u) * (1 + (rng() - 0.5) * 0.3)) / sr;
    if (ph >= 1) {
      ph -= 1;
      p[i] = rr(rng, 0.5, 1) * Math.sqrt(Math.sin(Math.PI * u));
    }
  }
  const s = new Float32Array(n);
  for (const [f, q, a] of res) {
    const c = filt(p.slice(), "bp", f, q, sr);
    for (let i = 0; i < n; i++) s[i] += c[i] * a;
  }
  scaleTo(s, gain);
  mix(out, s, sr, t);
}

/** Zipper: a train of tiny tooth clicks whose rate goes from r0 to r1 per second. */
function zipper(out, sr, rng, t, dur, r0, r1, gain) {
  const n = ns(sr, dur);
  const s = noise(n, rng);
  for (let i = 0; i < n; i++) s[i] *= 0.06;
  let ph = 0;
  for (let i = 0; i < n - 1; i++) {
    ph += (r0 + (r1 - r0) * (i / n)) / sr;
    if (ph >= 1) {
      ph -= 1;
      const a = rr(rng, 0.4, 1);
      s[i] += a;
      s[i + 1] -= a * 0.6;
    }
  }
  for (let i = 0; i < n; i++) s[i] *= Math.pow(Math.sin((Math.PI * i) / n), 0.3);
  filt(s, "bp", 3000, 1.1, sr);
  filt(s, "hp", 1200, 0.7, sr);
  scaleTo(s, gain);
  mix(out, s, sr, t);
}

/** Tonal glide: sine following fFn(u) (u = 0..1 over the note) with a bell-shaped envelope. */
function chirp(out, sr, t, dur, fFn, gain, h2 = 0.12, shape = 0.8) {
  const at = Math.round(t * sr);
  const n = Math.min(ns(sr, dur), out.length - at);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    ph += (TAU * fFn(u)) / sr;
    const e = Math.pow(Math.sin(Math.PI * u), shape);
    out[at + i] += (Math.sin(ph) + h2 * Math.sin(2 * ph)) * e * gain;
  }
}

/** Ricochet whine: a descending sine with vibrato and a fast attack / exponential decay. */
function whine(out, sr, rng, t, dur, f0, f1, gain) {
  const at = Math.round(t * sr);
  const n = Math.min(ns(sr, dur), out.length - at);
  const vib = rr(rng, 25, 45);
  const ratio = f1 / f0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const f = f0 * Math.pow(ratio, i / n) * (1 + 0.012 * Math.sin(TAU * vib * tt));
    ph += (TAU * f) / sr;
    out[at + i] += Math.sin(ph) * (1 - Math.exp(-tt / 0.004)) * Math.exp(-tt / (dur * 0.35)) * gain;
  }
}

/** PolyBLEP residual for band-limited saw/square oscillators. */
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/**
 * Synth voice: two detuned band-limited saws (optionally plus a square) through a low-pass whose
 * cutoff follows the amplitude envelope, giving a brassy opening attack.
 * o: { t, dur, f, gain, att, rel, detune, sq, bright, vib, glide: tt => pitch mult, cut: tt => Hz }
 */
function synth(out, sr, o) {
  const { t, dur, f, gain = 1, att = 0.02, rel = 0.1, detune = 0.004, sq = 0, bright = 5, vib = 0 } = o;
  const at = Math.round(t * sr);
  const n = Math.min(ns(sr, dur + rel * 4), out.length - at);
  if (n <= 0) return;
  const s = new Float32Array(n);
  const env = new Float32Array(n);
  const sus = 0.78 + 0.22 * Math.exp(-Math.max(0, dur - att) / 0.12);
  let p1 = 0;
  let p2 = 0.5;
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const e =
      tt < att
        ? tt / att
        : tt < dur
          ? 0.78 + 0.22 * Math.exp(-(tt - att) / 0.12)
          : sus * Math.exp(-(tt - dur) / rel);
    env[i] = e;
    let fr = o.glide ? f * o.glide(tt) : f;
    if (vib > 0 && tt > 0.12) fr *= 1 + vib * Math.min(1, (tt - 0.12) / 0.2) * Math.sin(TAU * 5.3 * tt);
    const d1 = (fr * (1 + detune)) / sr;
    const d2 = (fr * (1 - detune)) / sr;
    p1 += d1;
    if (p1 >= 1) p1 -= 1;
    p2 += d2;
    if (p2 >= 1) p2 -= 1;
    let v = 2 * p1 - 1 - blep(p1, d1) + (2 * p2 - 1 - blep(p2, d2));
    if (sq > 0) v += sq * 2 * ((p1 < 0.5 ? 1 : -1) + blep(p1, d1) - blep((p1 + 0.5) % 1, d1));
    s[i] = v * e;
  }
  const cut = o.cut || ((tt) => f * (1.1 + bright * env[Math.min(n - 1, Math.round(tt * sr))]));
  svf(s, sr, LP, 0.9, cut);
  const g = gain * 0.4;
  for (let i = 0; i < n; i++) out[at + i] += s[i] * g;
}

/** Multiplies a buffer by a tremolo of the given rate and depth. */
function tremolo(x, sr, hz, depth) {
  for (let i = 0; i < x.length; i++) x[i] *= 1 - depth * (0.5 + 0.5 * Math.sin((TAU * hz * i) / sr));
}

/** Adds delayed, low-passed copies of the first `srcDur` seconds of x (discrete echoes). */
function echoes(x, sr, srcDur, taps) {
  const src = x.slice(0, Math.min(x.length, ns(sr, srcDur)));
  for (const [d, g, lp] of taps) {
    const e = filt(src.slice(), "lp", lp, 0.7, sr);
    mix(x, e, sr, d, g);
  }
}

// -------------------------------------------------------------------------------------------------
// Weapons
// -------------------------------------------------------------------------------------------------

// Per-weapon character. bf/bq/bt: blast band centre, Q and decay; ck/ct: crack level and decay;
// f0/f1/tt/tg: thump sweep, decay and level; mech/mf: action rattle level and pitch; tl/tlt/tlp: diffuse
// tail level, decay and initial low-pass; drive: saturation; slaps: [delay, gain] terrain echoes.
const GUNS = {
  ar: {
    len: 1.0,
    bf: 1150,
    bq: 0.9,
    bt: 0.016,
    ck: 0.85,
    ct: 0.0045,
    f0: 145,
    f1: 50,
    tt: 0.05,
    tg: 0.85,
    mech: 0.22,
    mf: 3200,
    tl: 0.3,
    tlt: 0.22,
    tlp: 3000,
    drive: 1.7,
    slaps: [
      [0.085, 0.22],
      [0.23, 0.12],
    ],
  },
  akm: {
    len: 1.1,
    bf: 780,
    bq: 0.8,
    bt: 0.021,
    ck: 0.8,
    ct: 0.005,
    f0: 125,
    f1: 44,
    tt: 0.068,
    tg: 1.1,
    mech: 0.26,
    mf: 2400,
    tl: 0.36,
    tlt: 0.26,
    tlp: 2500,
    drive: 2.0,
    slaps: [
      [0.09, 0.26],
      [0.26, 0.14],
    ],
  },
  smg: {
    len: 0.7,
    bf: 1650,
    bq: 1.0,
    bt: 0.011,
    ck: 0.8,
    ct: 0.0035,
    f0: 165,
    f1: 64,
    tt: 0.032,
    tg: 0.55,
    mech: 0.3,
    mf: 3700,
    tl: 0.22,
    tlt: 0.15,
    tlp: 3500,
    drive: 1.5,
    slaps: [[0.07, 0.16]],
  },
  pistol: {
    len: 0.7,
    bf: 1850,
    bq: 1.1,
    bt: 0.009,
    ck: 0.7,
    ct: 0.003,
    f0: 170,
    f1: 70,
    tt: 0.03,
    tg: 0.45,
    mech: 0.12,
    mf: 4000,
    tl: 0.2,
    tlt: 0.14,
    tlp: 3200,
    drive: 1.3,
    slaps: [[0.06, 0.15]],
  },
  dmr: {
    len: 1.5,
    bf: 950,
    bq: 0.8,
    bt: 0.022,
    ck: 1.0,
    ct: 0.005,
    f0: 130,
    f1: 42,
    tt: 0.075,
    tg: 1.15,
    mech: 0.1,
    mf: 2900,
    tl: 0.42,
    tlt: 0.42,
    tlp: 2600,
    drive: 2.1,
    slaps: [
      [0.14, 0.28],
      [0.38, 0.2],
      [0.75, 0.1],
    ],
  },
  sniper: {
    len: 2.0,
    bf: 880,
    bq: 0.75,
    bt: 0.026,
    ck: 1.1,
    ct: 0.0055,
    f0: 118,
    f1: 36,
    tt: 0.095,
    tg: 1.3,
    mech: 0,
    mf: 0,
    tl: 0.46,
    tlt: 0.6,
    tlp: 2300,
    drive: 2.3,
    slaps: [
      [0.19, 0.32],
      [0.52, 0.24],
      [0.95, 0.15],
      [1.4, 0.08],
    ],
  },
  shotgun: {
    len: 1.4,
    bf: 560,
    bq: 0.6,
    bt: 0.035,
    ck: 0.55,
    ct: 0.006,
    f0: 100,
    f1: 38,
    tt: 0.11,
    tg: 1.35,
    mech: 0,
    mf: 0,
    tl: 0.45,
    tlt: 0.38,
    tlp: 2000,
    drive: 2.2,
    slaps: [
      [0.12, 0.27],
      [0.34, 0.15],
    ],
  },
};

/** Near gunshot: shock front + crack, blast body, thump, action rattle, terrain slaps, diffuse tail. */
function gunshot(rng, sr, g) {
  const out = new Float32Array(ns(sr, g.len));
  const dry = new Float32Array(ns(sr, Math.max(0.45, g.tt * 9 + 0.05)));
  const t0 = 0.0015;
  const bodyDur = Math.max(0.3, g.bt * 3.5 * 8);
  // Muzzle shock front and supersonic crack: the sharp leading edge.
  nwave(dry, sr, t0, vary(rng, 0.0007, 0.25), 0.9 * g.ck);
  burst(dry, sr, rng, {
    t: t0,
    dur: 0.04,
    att: 0.00005,
    tau: vary(rng, g.ct, 0.15),
    gain: 0.75 * g.ck,
    f: [
      ["hp", 2200, 0.7],
      ["pk", 5000, 1, 4],
    ],
  });
  // Blast body: band-limited noise with a fast decay plus a slower "boom" stage.
  burst(dry, sr, rng, {
    t: t0,
    dur: bodyDur,
    att: 0.0003,
    tau: vary(rng, g.bt, 0.12),
    slow: 0.22,
    tau2: g.bt * 3.5,
    gain: 1,
    f: [
      ["bp", vary(rng, g.bf, 0.08), g.bq],
      ["lp", g.bf * 4, 0.7],
    ],
  });
  // Low-mid weight and the chest thump.
  burst(dry, sr, rng, {
    t: t0,
    dur: bodyDur,
    att: 0.001,
    tau: g.bt * 2.5,
    gain: 0.55 * g.tg,
    f: [["lp", 380, 0.8]],
  });
  thump(dry, sr, {
    t: t0,
    f0: vary(rng, g.f0, 0.06),
    f1: g.f1,
    sweep: g.tt * 0.45,
    att: 0.0012,
    tau: vary(rng, g.tt, 0.1),
    gain: 0.9 * g.tg,
    drive: 2,
  });
  mix(out, dry, sr, 0);
  // Ground reflection a few ms later (the slight comb colouring of real recordings).
  mix(out, filt(dry.slice(), "lp", 5000, 0.7, sr), sr, rr(rng, 0.003, 0.006), 0.28);
  // Action: bolt carrier slamming back and returning.
  if (g.mech > 0) {
    click(out, sr, rng, rr(rng, 0.012, 0.02), vary(rng, g.mf, 0.06), g.mech, 0.012);
    thunk(out, sr, rng, rr(rng, 0.014, 0.022), g.mf * 0.3, g.mech * 0.6, 0.015);
    click(out, sr, rng, rr(rng, 0.05, 0.07), vary(rng, g.mf * 0.8, 0.06), g.mech * 0.7, 0.01);
  }
  // Slapback echoes from terrain and buildings: progressively duller copies of the report.
  for (const [d, gn] of g.slaps) {
    const e = filt(dry.slice(), "lp", 2200 / (1 + d * 3), 0.7, sr);
    filt(e, "hp", 90, 0.7, sr);
    mix(out, e, sr, vary(rng, d, 0.12), gn * rr(rng, 0.8, 1.1));
  }
  // Diffuse tail whose low-pass closes over time (air absorbs the highs first).
  burst(out, sr, rng, {
    t: 0.004,
    dur: g.len - 0.004,
    att: 0.012,
    tau: vary(rng, g.tlt, 0.1),
    gain: g.tl,
    sv: [LP, g.tlp, 280, g.tlt * 1.4, 0.6],
  });
  scaleTo(out, 1);
  return softClip(out, g.drive);
}

/** Suppressed shot: muffled gas "thwip" where the mechanical action becomes the dominant sound. */
function suppressedShot(rng, sr) {
  const out = new Float32Array(ns(sr, 0.5));
  const t0 = 0.001;
  burst(out, sr, rng, {
    t: t0,
    dur: 0.15,
    att: 0.0004,
    tau: vary(rng, 0.007, 0.15),
    slow: 0.15,
    tau2: 0.025,
    gain: 1,
    f: [
      ["bp", vary(rng, 1500, 0.1), 1.3],
      ["hp", 500, 0.7],
    ],
  });
  burst(out, sr, rng, { t: t0, dur: 0.2, att: 0.001, tau: 0.016, gain: 0.55, f: [["lp", 520, 0.9]] });
  burst(out, sr, rng, {
    t: t0 + 0.001,
    dur: 0.08,
    att: 0.002,
    tau: 0.012,
    gain: 0.3,
    sv: [BP, 5200, 1800, 0.02, 2],
  });
  thump(out, sr, { t: t0, f0: 120, f1: 62, sweep: 0.012, att: 0.001, tau: 0.02, gain: 0.35, drive: 1.5 });
  click(out, sr, rng, rr(rng, 0.011, 0.016), vary(rng, 2900, 0.06), 0.6, 0.012);
  thunk(out, sr, rng, rr(rng, 0.012, 0.017), 720, 0.45, 0.018);
  click(out, sr, rng, rr(rng, 0.055, 0.07), vary(rng, 3400, 0.06), 0.4, 0.01);
  burst(out, sr, rng, { t: 0.005, dur: 0.4, att: 0.01, tau: 0.06, gain: 0.12, f: [["lp", 1400, 0.7]] });
  scaleTo(out, 1);
  return softClip(out, 1.3);
}

/** Generic far-away report: dull thud, terrain echoes and a thunder-like rolling rumble. */
function distantShot(rng, sr) {
  const out = new Float32Array(ns(sr, 2.3));
  const hit = new Float32Array(ns(sr, 0.6));
  burst(hit, sr, rng, {
    t: 0.002,
    dur: 0.5,
    att: 0.0015,
    tau: 0.02,
    slow: 0.3,
    tau2: 0.07,
    gain: 1,
    f: [
      ["lp", vary(rng, 900, 0.1), 0.8],
      ["hp", 60, 0.7],
    ],
  });
  thump(hit, sr, {
    t: 0.002,
    f0: vary(rng, 85, 0.08),
    f1: 38,
    sweep: 0.03,
    att: 0.003,
    tau: 0.09,
    gain: 0.8,
    drive: 1.5,
  });
  mix(out, hit, sr, 0);
  let d = 0;
  for (let k = 0; k < 5; k++) {
    d += rr(rng, 0.12, 0.35);
    const e = filt(hit.slice(), "lp", 700 / (1 + k * 0.35), 0.7, sr);
    mix(out, e, sr, d, 0.55 * Math.pow(0.68, k) * rr(rng, 0.7, 1.1));
  }
  const n = out.length;
  const rum = noise(n, rng);
  envelope(rum, sr, 0.05, vary(rng, 0.6, 0.15));
  const wob = wobble(n, sr, rng, 7);
  for (let i = 0; i < n; i++) rum[i] *= 0.45 + 0.55 * wob[i];
  filt(rum, "lp", 420, 0.7, sr);
  filt(rum, "lp", 700, 0.7, sr);
  filt(rum, "hp", 35, 0.7, sr);
  mix(out, scaleTo(rum, 0.5), sr, 0.01);
  return out;
}

function reloadOut(rng, sr) {
  const out = new Float32Array(ns(sr, 0.45));
  click(out, sr, rng, 0.004, vary(rng, 2600, 0.05), 0.55, 0.01); // release button
  scrape(out, sr, rng, 0.025, 0.09, vary(rng, 1900, 0.08), 1.5, 0.35, 0.6); // magazine sliding out
  modal(
    out,
    sr,
    0.115,
    [
      [vary(rng, 1150, 0.05), 1, 0.03],
      [2480, 0.6, 0.02],
      [3900, 0.3, 0.012],
    ],
    0.4,
  );
  burst(out, sr, rng, { t: 0.12, dur: 0.12, att: 0.002, tau: 0.02, gain: 0.25, f: [["bp", 600, 1]] });
  return out;
}

function reloadIn(rng, sr) {
  const out = new Float32Array(ns(sr, 0.55));
  scrape(out, sr, rng, 0, 0.075, vary(rng, 1700, 0.08), 1.4, 0.3, 0.6); // magazine entering the well
  click(out, sr, rng, 0.075, vary(rng, 2100, 0.05), 0.9, 0.016); // catch locks
  thunk(out, sr, rng, 0.075, 420, 0.7, 0.03);
  thump(out, sr, { t: 0.074, f0: 170, f1: 90, sweep: 0.01, tau: 0.02, gain: 0.45 }); // palm slap
  burst(out, sr, rng, { t: 0.074, dur: 0.08, att: 0.0003, tau: 0.008, gain: 0.45, f: [["bp", 900, 0.8]] });
  click(out, sr, rng, 0.115, vary(rng, 3600, 0.08), 0.15, 0.006);
  return out;
}

function boltCycle(rng, sr) {
  const out = new Float32Array(ns(sr, 1.1));
  click(out, sr, rng, 0.005, vary(rng, 2400, 0.05), 0.55, 0.012); // handle up
  thunk(out, sr, rng, 0.006, 650, 0.3, 0.02);
  scrape(out, sr, rng, 0.1, 0.13, vary(rng, 2200, 0.06), 2, 0.4, 0.5); // bolt back
  click(out, sr, rng, 0.23, vary(rng, 1800, 0.05), 0.7, 0.014);
  thunk(out, sr, rng, 0.23, 560, 0.45, 0.025);
  modal(
    out,
    sr,
    0.27,
    [
      [vary(rng, 4700, 0.08), 1, 0.06],
      [vary(rng, 7300, 0.08), 0.5, 0.04],
    ],
    0.12,
  ); // case out
  scrape(out, sr, rng, 0.42, 0.09, vary(rng, 2000, 0.06), 2, 0.35, 0.5); // bolt forward
  click(out, sr, rng, 0.51, vary(rng, 2000, 0.05), 0.8, 0.014);
  thunk(out, sr, rng, 0.51, 700, 0.5, 0.025);
  click(out, sr, rng, 0.62, vary(rng, 2600, 0.05), 0.75, 0.012); // handle down, locked
  thunk(out, sr, rng, 0.62, 900, 0.4, 0.02);
  modal(
    out,
    sr,
    0.8,
    [
      [vary(rng, 5200, 0.1), 1, 0.04],
      [vary(rng, 8100, 0.1), 0.5, 0.025],
    ],
    0.1,
  ); // case lands
  modal(out, sr, 0.87, [[vary(rng, 5600, 0.1), 1, 0.03]], 0.06);
  return out;
}

function pumpAction(rng, sr) {
  const out = new Float32Array(ns(sr, 0.5));
  scrape(out, sr, rng, 0, 0.07, vary(rng, 1400, 0.06), 1.3, 0.45, 0.7); // fore-end back
  click(out, sr, rng, 0.065, vary(rng, 1900, 0.05), 0.7, 0.014);
  thunk(out, sr, rng, 0.065, 500, 0.6, 0.03);
  scrape(out, sr, rng, 0.2, 0.06, vary(rng, 1500, 0.06), 1.3, 0.4, 0.7); // and forward
  click(out, sr, rng, 0.26, vary(rng, 2100, 0.05), 0.85, 0.014);
  thunk(out, sr, rng, 0.26, 450, 0.75, 0.035);
  return out;
}

function dryClick(rng, sr) {
  const out = new Float32Array(ns(sr, 0.15));
  click(out, sr, rng, 0.002, vary(rng, 3300, 0.05), 1, 0.008);
  thunk(out, sr, rng, 0.002, 900, 0.35, 0.008);
  return out;
}

function switchMode(rng, sr) {
  const out = new Float32Array(ns(sr, 0.12));
  click(out, sr, rng, 0.002, vary(rng, 4200, 0.05), 0.7, 0.004);
  click(out, sr, rng, 0.03, vary(rng, 3800, 0.05), 0.5, 0.004);
  return out;
}

function equip(rng, sr) {
  const out = new Float32Array(ns(sr, 0.65));
  rustle(out, sr, rng, 0, 0.3, 0.45, 2400, 3); // sling and cloth
  for (let i = 0; i < 3; i++) {
    click(out, sr, rng, rr(rng, 0.1, 0.28), rr(rng, 2800, 4500), rr(rng, 0.12, 0.25), 0.006);
  }
  click(out, sr, rng, 0.31, vary(rng, 1900, 0.05), 0.6, 0.012); // weapon settles in the hands
  thunk(out, sr, rng, 0.31, 520, 0.5, 0.025);
  return out;
}

// -------------------------------------------------------------------------------------------------
// Bullets
// -------------------------------------------------------------------------------------------------

function impactDirt(rng, sr) {
  const out = new Float32Array(ns(sr, 0.5));
  thump(out, sr, {
    t: 0.001,
    f0: vary(rng, 140, 0.1),
    f1: 70,
    sweep: 0.01,
    att: 0.0008,
    tau: 0.025,
    gain: 0.7,
    drive: 1.5,
  });
  burst(out, sr, rng, { t: 0.001, dur: 0.15, att: 0.0005, tau: 0.02, gain: 0.6, f: [["lp", 500, 0.8]] });
  burst(out, sr, rng, {
    t: 0.001,
    dur: 0.2,
    att: 0.001,
    tau: 0.03,
    gain: 0.5,
    f: [["bp", vary(rng, 1800, 0.15), 0.7]],
  });
  grains(out, sr, rng, {
    t: 0.004,
    span: 0.16,
    count: 40,
    len: 0.003,
    gain: 0.35,
    skew: 1.8,
    f: [["bp", 2600, 0.6]],
  });
  grains(out, sr, rng, {
    t: 0.08,
    span: 0.28,
    count: 25,
    len: 0.002,
    gain: 0.12,
    skew: 1.2,
    f: [["hp", 3000, 0.7]],
  });
  return out;
}

function impactConcrete(rng, sr, v) {
  const out = new Float32Array(ns(sr, v === 2 ? 0.6 : 0.45));
  nwave(out, sr, 0.001, 0.0003, 0.6);
  burst(out, sr, rng, { t: 0.001, dur: 0.03, att: 0, tau: 0.003, gain: 0.8, f: [["hp", 2500, 0.7]] });
  burst(out, sr, rng, {
    t: 0.001,
    dur: 0.1,
    att: 0.0003,
    tau: 0.012,
    gain: 0.7,
    f: [["bp", vary(rng, 2300, 0.12), 1.4]],
  });
  burst(out, sr, rng, { t: 0.001, dur: 0.12, att: 0.0005, tau: 0.015, gain: 0.45, f: [["bp", 700, 1]] });
  modal(
    out,
    sr,
    0.001,
    [
      [vary(rng, 1900, 0.1), 1, 0.012],
      [vary(rng, 3100, 0.1), 0.7, 0.008],
      [vary(rng, 4700, 0.1), 0.5, 0.006],
    ],
    0.35,
  );
  grains(out, sr, rng, {
    t: 0.003,
    span: 0.22,
    count: 30,
    len: 0.0015,
    gain: 0.3,
    skew: 1.6,
    f: [["bp", 4000, 0.7]],
  });
  if (v === 2) whine(out, sr, rng, 0.012, 0.45, vary(rng, 3400, 0.1), vary(rng, 1100, 0.1), 0.4); // ricochet
  return out;
}

function impactMetal(rng, sr, v) {
  const out = new Float32Array(ns(sr, 0.9));
  const f = vary(rng, [1250, 1700, 2200][v % 3], 0.05);
  nwave(out, sr, 0.001, 0.0002, 0.5);
  burst(out, sr, rng, { t: 0.001, dur: 0.02, att: 0, tau: 0.002, gain: 0.7, f: [["hp", 3000, 0.7]] });
  const ratios = [1, 1.58, 2.24, 2.92, 3.87, 4.6];
  const amps = [1, 0.7, 0.55, 0.4, 0.3, 0.2];
  const taus = [0.35, 0.25, 0.18, 0.12, 0.08, 0.06];
  const modes = ratios.map((r, i) => [f * r * rr(rng, 0.98, 1.02), amps[i], taus[i] * rr(rng, 0.8, 1.2)]);
  modal(out, sr, 0.001, modes, 0.9);
  modal(
    out,
    sr,
    0.001,
    [
      [vary(rng, 420, 0.1), 1, 0.05],
      [vary(rng, 780, 0.1), 0.6, 0.035],
    ],
    0.4,
  );
  return out;
}

function impactWood(rng, sr) {
  const out = new Float32Array(ns(sr, 0.4));
  modal(
    out,
    sr,
    0.001,
    [
      [vary(rng, 260, 0.1), 1, 0.03],
      [vary(rng, 540, 0.1), 0.7, 0.022],
      [vary(rng, 980, 0.1), 0.5, 0.014],
      [vary(rng, 1650, 0.1), 0.35, 0.009],
    ],
    0.8,
  );
  burst(out, sr, rng, { t: 0.001, dur: 0.03, att: 0, tau: 0.003, gain: 0.6, f: [["hp", 1800, 0.7]] });
  burst(out, sr, rng, { t: 0.001, dur: 0.1, att: 0.0005, tau: 0.012, gain: 0.4, f: [["lp", 600, 0.8]] });
  grains(out, sr, rng, {
    t: 0.004,
    span: 0.12,
    count: 22,
    len: 0.002,
    gain: 0.3,
    skew: 1.5,
    f: [["bp", 3000, 0.8]],
  });
  return out;
}

function impactFlesh(rng, sr) {
  const out = new Float32Array(ns(sr, 0.3));
  thump(out, sr, {
    t: 0.001,
    f0: vary(rng, 170, 0.1),
    f1: 85,
    sweep: 0.008,
    att: 0.0006,
    tau: 0.03,
    gain: 0.9,
    drive: 2,
  });
  burst(out, sr, rng, {
    t: 0.001,
    dur: 0.1,
    att: 0.0003,
    tau: 0.014,
    gain: 0.6,
    f: [["bp", vary(rng, 900, 0.12), 0.9]],
  });
  burst(out, sr, rng, { t: 0.001, dur: 0.05, att: 0, tau: 0.006, gain: 0.3, f: [["bp", 2400, 1.2]] });
  burst(out, sr, rng, { t: 0.004, dur: 0.2, att: 0.004, tau: 0.04, gain: 0.3, f: [["lp", 1200, 0.7]] });
  for (let i = 0; i < 3; i++) {
    bubble(out, sr, rr(rng, 0.01, 0.08), rr(rng, 300, 600), 15, rr(rng, 0.01, 0.02), 0.08);
  }
  return out;
}

function impactWater(rng, sr) {
  const out = new Float32Array(ns(sr, 0.65));
  bubble(out, sr, 0.003, vary(rng, 500, 0.15), 25, 0.03, 0.6); // plop
  burst(out, sr, rng, {
    t: 0.001,
    dur: 0.4,
    att: 0.004,
    tau: 0.06,
    gain: 0.7,
    f: [
      ["hp", 1200, 0.7],
      ["pk", 3500, 1, 3],
    ],
  });
  grains(out, sr, rng, {
    t: 0.01,
    span: 0.3,
    count: 30,
    len: 0.003,
    gain: 0.25,
    skew: 1.4,
    f: [["hp", 2500, 0.7]],
  });
  const k = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < k; i++) {
    bubble(
      out,
      sr,
      rr(rng, 0.08, 0.45),
      rr(rng, 900, 2600),
      rr(rng, 10, 40),
      rr(rng, 0.008, 0.015),
      rr(rng, 0.1, 0.25),
    );
  }
  return out;
}

function impactGlass(rng, sr) {
  const out = new Float32Array(ns(sr, 0.9));
  nwave(out, sr, 0.001, 0.0003, 0.6);
  burst(out, sr, rng, { t: 0.001, dur: 0.05, att: 0, tau: 0.004, gain: 0.8, f: [["hp", 3500, 0.7]] });
  const k = 18 + Math.floor(rng() * 10);
  for (let i = 0; i < k; i++) {
    const t = 0.002 + Math.pow(rng(), 1.8) * 0.4;
    const f = rr(rng, 2500, 9000);
    const modes = [
      [f, 1, rr(rng, 0.02, 0.08)],
      [f * rr(rng, 1.3, 2.1), 0.5, rr(rng, 0.01, 0.04)],
    ];
    modal(out, sr, t, modes, rr(rng, 0.08, 0.3) * (1 - t));
  }
  grains(out, sr, rng, {
    t: 0.002,
    span: 0.5,
    count: 40,
    len: 0.0015,
    gain: 0.25,
    skew: 1.6,
    f: [["hp", 4000, 0.7]],
  });
  return out;
}

/** Bright ding of a round glancing off a steel helmet (beating partial pair gives the shimmer). */
function helmetDing(rng, sr) {
  const out = new Float32Array(ns(sr, 1.0));
  const f = vary(rng, 2900, 0.05);
  const partials = [
    [1, 1, 0.45],
    [1.004, 0.6, 0.4],
    [2.05, 0.5, 0.3],
    [2.76, 0.6, 0.25],
    [3.9, 0.3, 0.15],
    [5.2, 0.2, 0.1],
  ];
  modal(
    out,
    sr,
    0.001,
    partials.map(([r, a, tau]) => [f * r, a, tau * rr(rng, 0.85, 1.15)]),
    1,
  );
  modal(
    out,
    sr,
    0.001,
    [
      [vary(rng, 720, 0.08), 1, 0.05],
      [vary(rng, 1300, 0.08), 0.6, 0.03],
    ],
    0.45,
  );
  burst(out, sr, rng, { t: 0.001, dur: 0.02, att: 0, tau: 0.002, gain: 0.6, f: [["hp", 3000, 0.7]] });
  thump(out, sr, { t: 0.001, f0: 200, f1: 110, sweep: 0.008, tau: 0.02, gain: 0.3 });
  return out;
}

/** Bullet passing close by: supersonic crack followed by a Doppler-swept whizz. */
function whiz(rng, sr) {
  const out = new Float32Array(ns(sr, 0.4));
  const tc = 0.012;
  nwave(out, sr, tc, vary(rng, 0.0004, 0.2), 0.9);
  burst(out, sr, rng, { t: tc, dur: 0.02, att: 0, tau: 0.0015, gain: 0.5, f: [["hp", 3000, 0.7]] });
  const f0 = vary(rng, 4200, 0.12);
  const f1 = vary(rng, 1300, 0.15);
  burst(out, sr, rng, {
    t: 0,
    dur: 0.38,
    att: 0.025,
    tau: vary(rng, 0.06, 0.2),
    gain: 0.8,
    sv: [BP, f0, f1, vary(rng, 0.08, 0.2), 3],
  });
  const g0 = vary(rng, 2800, 0.1);
  chirp(out, sr, 0.005, vary(rng, 0.18, 0.15), (u) => g0 * (1 - 0.48 * u), 0.22, 0.05, 1.4);
  return out;
}

/** Supersonic snap of a bullet (heard downrange), with ground reflection and short slaps. */
function crack(rng, sr) {
  const out = new Float32Array(ns(sr, 0.45));
  const dry = new Float32Array(ns(sr, 0.06));
  nwave(dry, sr, 0.002, vary(rng, 0.0005, 0.2), 1);
  burst(dry, sr, rng, { t: 0.002, dur: 0.02, att: 0, tau: 0.002, gain: 0.5, f: [["hp", 2500, 0.7]] });
  burst(dry, sr, rng, {
    t: 0.002,
    dur: 0.05,
    att: 0,
    tau: 0.01,
    gain: 0.25,
    f: [["bp", vary(rng, 3000, 0.1), 2]],
  });
  mix(out, dry, sr, 0);
  mix(out, filt(dry.slice(), "lp", 4000, 0.7, sr), sr, rr(rng, 0.006, 0.012), 0.4);
  mix(out, filt(dry.slice(), "lp", 2000, 0.7, sr), sr, rr(rng, 0.05, 0.09), 0.2);
  mix(out, filt(dry.slice(), "lp", 1200, 0.7, sr), sr, rr(rng, 0.16, 0.22), 0.1);
  burst(out, sr, rng, { t: 0.004, dur: 0.4, att: 0.01, tau: 0.08, gain: 0.08, f: [["lp", 2500, 0.7]] });
  return out;
}

// -------------------------------------------------------------------------------------------------
// Footsteps (heel strike + toe roll, randomised per variant)
// -------------------------------------------------------------------------------------------------

function stepGrass(rng, sr) {
  const out = new Float32Array(ns(sr, 0.32));
  const heel = 0.004;
  const toe = heel + rr(rng, 0.045, 0.075);
  thump(out, sr, { t: heel, f0: vary(rng, 85, 0.1), f1: 55, sweep: 0.012, att: 0.002, tau: 0.02, gain: 0.4 });
  burst(out, sr, rng, { t: heel, dur: 0.1, att: 0.001, tau: 0.015, gain: 0.3, f: [["lp", 800, 0.7]] });
  grains(out, sr, rng, {
    t: heel,
    span: 0.13,
    count: 55,
    len: 0.003,
    gain: 0.55,
    skew: 1.3,
    f: [
      ["bp", vary(rng, 3500, 0.15), 0.7],
      ["hp", 1200, 0.7],
    ],
  });
  burst(out, sr, rng, {
    t: heel,
    dur: 0.2,
    att: 0.012,
    tau: 0.045,
    gain: 0.3,
    f: [["bp", vary(rng, 2500, 0.15), 0.6]],
  });
  burst(out, sr, rng, {
    t: toe,
    dur: 0.15,
    att: 0.006,
    tau: 0.03,
    gain: 0.25,
    f: [["bp", vary(rng, 3000, 0.15), 0.7]],
  });
  return out;
}

function stepHard(rng, sr) {
  const out = new Float32Array(ns(sr, 0.3));
  const heel = 0.003;
  const toe = heel + rr(rng, 0.05, 0.08);
  thump(out, sr, {
    t: heel,
    f0: vary(rng, 95, 0.1),
    f1: 60,
    sweep: 0.01,
    att: 0.0008,
    tau: 0.018,
    gain: 0.5,
  });
  burst(out, sr, rng, {
    t: heel,
    dur: 0.03,
    att: 0,
    tau: 0.003,
    gain: 0.5,
    f: [
      ["hp", 1800, 0.7],
      ["pk", 3500, 1.2, 4],
    ],
  });
  burst(out, sr, rng, {
    t: heel,
    dur: 0.1,
    att: 0.0005,
    tau: 0.012,
    gain: 0.6,
    f: [["bp", vary(rng, 450, 0.12), 1]],
  });
  burst(out, sr, rng, {
    t: toe,
    dur: 0.12,
    att: 0.006,
    tau: 0.02,
    gain: 0.35,
    f: [["bp", vary(rng, 1800, 0.15), 0.8]],
  });
  grains(out, sr, rng, {
    t: toe - 0.01,
    span: 0.06,
    count: 12,
    len: 0.001,
    gain: 0.15,
    f: [["hp", 3000, 0.7]],
  });
  return out;
}

function stepWood(rng, sr, v) {
  const out = new Float32Array(ns(sr, v === 3 ? 0.5 : 0.36));
  const heel = 0.003;
  const toe = heel + rr(rng, 0.055, 0.08);
  const board = [
    [vary(rng, 150, 0.1), 1, 0.045],
    [vary(rng, 310, 0.1), 0.5, 0.03],
    [vary(rng, 620, 0.1), 0.3, 0.018],
    [vary(rng, 1180, 0.1), 0.15, 0.01],
  ];
  modal(out, sr, heel, board, 0.8);
  burst(out, sr, rng, { t: heel, dur: 0.02, att: 0, tau: 0.002, gain: 0.3, f: [["hp", 2000, 0.7]] });
  modal(
    out,
    sr,
    toe,
    board.map(([f, a, tau]) => [f * 1.06, a, tau * 0.7]),
    0.45,
  );
  burst(out, sr, rng, { t: toe, dur: 0.08, att: 0.004, tau: 0.015, gain: 0.2, f: [["bp", 1500, 0.8]] });
  if (v === 3) {
    const res = [
      [vary(rng, 750, 0.1), 9, 1],
      [vary(rng, 1500, 0.1), 10, 0.6],
    ];
    creak(out, sr, rng, 0.12, 0.3, (u) => 90 + 50 * u, 0.12, res); // loose floorboard
  }
  return out;
}

function stepWater(rng, sr) {
  const out = new Float32Array(ns(sr, 0.5));
  burst(out, sr, rng, {
    t: 0.002,
    dur: 0.45,
    att: 0.025,
    tau: 0.09,
    gain: 0.6,
    f: [
      ["lp", 2000, 0.7],
      ["bp", vary(rng, 700, 0.15), 0.5],
    ],
  });
  burst(out, sr, rng, { t: 0.002, dur: 0.25, att: 0.003, tau: 0.04, gain: 0.4, f: [["hp", 1500, 0.7]] });
  const k = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < k; i++) {
    bubble(
      out,
      sr,
      rr(rng, 0.02, 0.2),
      rr(rng, 600, 1600),
      rr(rng, 10, 30),
      rr(rng, 0.01, 0.02),
      rr(rng, 0.15, 0.3),
    );
  }
  const m = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < m; i++) {
    bubble(out, sr, rr(rng, 0.15, 0.4), rr(rng, 2000, 4000), 20, rr(rng, 0.004, 0.008), rr(rng, 0.05, 0.12));
  }
  return out;
}

function stepSand(rng, sr) {
  const out = new Float32Array(ns(sr, 0.3));
  const heel = 0.003;
  grains(out, sr, rng, {
    t: heel,
    span: 0.1,
    count: 120,
    len: 0.0012,
    gain: 0.6,
    skew: 1.2,
    f: [
      ["hp", 2000, 0.7],
      ["bp", vary(rng, 4500, 0.15), 0.5],
    ],
  });
  burst(out, sr, rng, { t: heel, dur: 0.12, att: 0.002, tau: 0.02, gain: 0.35, f: [["lp", 400, 0.8]] });
  burst(out, sr, rng, {
    t: heel + 0.01,
    dur: 0.15,
    att: 0.01,
    tau: 0.03,
    gain: 0.1,
    f: [["bp", vary(rng, 1200, 0.1), 3]],
  });
  grains(out, sr, rng, {
    t: heel + rr(rng, 0.05, 0.07),
    span: 0.07,
    count: 50,
    len: 0.001,
    gain: 0.3,
    f: [["hp", 2500, 0.7]],
  });
  return out;
}

// -------------------------------------------------------------------------------------------------
// Movement foley
// -------------------------------------------------------------------------------------------------

function jump(rng, sr) {
  const out = new Float32Array(ns(sr, 0.45));
  burst(out, sr, rng, { t: 0.003, dur: 0.15, att: 0.004, tau: 0.03, gain: 0.4, f: [["bp", 1200, 0.8]] }); // push-off
  thump(out, sr, { t: 0.003, f0: 110, f1: 70, sweep: 0.01, tau: 0.02, gain: 0.35 });
  burst(out, sr, rng, { t: 0.02, dur: 0.35, att: 0.04, tau: 0.08, gain: 0.35, f: [["bp", 1400, 0.6]] }); // cloth
  for (let i = 0; i < 3; i++) {
    click(out, sr, rng, rr(rng, 0.03, 0.15), rr(rng, 2800, 4500), rr(rng, 0.12, 0.2), 0.006); // gear
  }
  return out;
}

function land(rng, sr) {
  const out = new Float32Array(ns(sr, 0.55));
  thump(out, sr, {
    t: 0.002,
    f0: vary(rng, 90, 0.1),
    f1: 45,
    sweep: 0.02,
    att: 0.001,
    tau: 0.06,
    gain: 1,
    drive: 2.5,
  });
  burst(out, sr, rng, { t: 0.002, dur: 0.25, att: 0.0008, tau: 0.03, gain: 0.7, f: [["lp", 900, 0.8]] });
  burst(out, sr, rng, { t: 0.002, dur: 0.1, att: 0.0005, tau: 0.012, gain: 0.35, f: [["bp", 1800, 0.8]] });
  for (let i = 0; i < 4; i++) {
    click(out, sr, rng, rr(rng, 0.02, 0.12), rr(rng, 2500, 4200), rr(rng, 0.15, 0.25), 0.007);
  }
  rustle(out, sr, rng, 0, 0.25, 0.2, 2000, 3);
  grains(out, sr, rng, {
    t: 0.005,
    span: 0.15,
    count: 20,
    len: 0.002,
    gain: 0.18,
    skew: 1.5,
    f: [["bp", 2500, 0.7]],
  });
  return out;
}

function prone(rng, sr) {
  const out = new Float32Array(ns(sr, 0.9));
  rustle(out, sr, rng, 0, 0.75, 0.8, 1800, 7);
  thump(out, sr, { t: 0.35, f0: 100, f1: 60, sweep: 0.015, att: 0.004, tau: 0.05, gain: 0.4 });
  burst(out, sr, rng, { t: 0.35, dur: 0.3, att: 0.004, tau: 0.04, gain: 0.35, f: [["lp", 600, 0.8]] });
  for (let i = 0; i < 2; i++) click(out, sr, rng, rr(rng, 0.3, 0.5), rr(rng, 2500, 4000), 0.12, 0.006);
  return out;
}

function swim(rng, sr) {
  const out = new Float32Array(ns(sr, 0.95));
  burst(out, sr, rng, {
    t: 0.01,
    dur: 0.9,
    att: 0.12,
    tau: 0.18,
    gain: 0.8,
    f: [
      ["lp", 1800, 0.7],
      ["bp", vary(rng, 600, 0.15), 0.5],
    ],
  });
  burst(out, sr, rng, { t: 0.05, dur: 0.3, att: 0.01, tau: 0.05, gain: 0.35, f: [["hp", 1500, 0.7]] });
  const k = 8 + Math.floor(rng() * 7);
  for (let i = 0; i < k; i++) {
    bubble(
      out,
      sr,
      rr(rng, 0.1, 0.6),
      rr(rng, 300, 1400),
      rr(rng, 10, 40),
      rr(rng, 0.01, 0.03),
      rr(rng, 0.1, 0.3),
    );
  }
  for (let i = 0; i < 5; i++) {
    bubble(out, sr, rr(rng, 0.4, 0.8), rr(rng, 1500, 3000), 20, rr(rng, 0.004, 0.008), rr(rng, 0.06, 0.12));
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Interactions
// -------------------------------------------------------------------------------------------------

function pickup(rng, sr) {
  const out = new Float32Array(ns(sr, 0.35));
  rustle(out, sr, rng, 0, 0.18, 0.6, 2500, 3);
  click(out, sr, rng, rr(rng, 0.08, 0.11), vary(rng, 2100, 0.08), 0.35, 0.008);
  thunk(out, sr, rng, 0.1, 600, 0.3, 0.015);
  click(out, sr, rng, rr(rng, 0.13, 0.17), vary(rng, 3800, 0.08), 0.15, 0.005);
  return out;
}

function doorOpen(rng, sr) {
  const out = new Float32Array(ns(sr, 1.05));
  click(out, sr, rng, 0.005, vary(rng, 2300, 0.05), 0.6, 0.012); // handle
  click(out, sr, rng, 0.05, vary(rng, 1700, 0.05), 0.4, 0.01); // latch released
  thunk(out, sr, rng, 0.05, 300, 0.35, 0.03);
  const a = vary(rng, 75, 0.1);
  const b = vary(rng, 170, 0.1);
  const c = vary(rng, 110, 0.1);
  const res = [
    [vary(rng, 560, 0.08), 10, 1],
    [vary(rng, 1250, 0.08), 12, 0.6],
    [vary(rng, 2300, 0.08), 9, 0.3],
  ];
  creak(
    out,
    sr,
    rng,
    0.09,
    0.75,
    (u) => (u < 0.5 ? a + (b - a) * 2 * u : b + (c - b) * (2 * u - 1)),
    0.5,
    res,
  );
  burst(out, sr, rng, { t: 0.1, dur: 0.8, att: 0.2, tau: 0.25, gain: 0.15, f: [["lp", 500, 0.7]] }); // swing air
  return out;
}

function doorClose(rng, sr) {
  const out = new Float32Array(ns(sr, 0.75));
  burst(out, sr, rng, { t: 0, dur: 0.2, att: 0.05, tau: 0.08, gain: 0.25, f: [["bp", 500, 0.7]] });
  const t = 0.14;
  modal(
    out,
    sr,
    t,
    [
      [vary(rng, 95, 0.08), 1, 0.08],
      [vary(rng, 190, 0.08), 0.7, 0.05],
      [vary(rng, 410, 0.08), 0.5, 0.03],
      [vary(rng, 870, 0.08), 0.3, 0.018],
    ],
    0.9,
  );
  burst(out, sr, rng, { t, dur: 0.1, att: 0.0005, tau: 0.01, gain: 0.6, f: [["lp", 1500, 0.8]] });
  thump(out, sr, { t, f0: 110, f1: 60, sweep: 0.015, att: 0.001, tau: 0.05, gain: 0.6, drive: 1.5 });
  click(out, sr, rng, t + 0.015, vary(rng, 2600, 0.05), 0.45, 0.012); // latch catches
  click(out, sr, rng, t + 0.06, vary(rng, 3300, 0.05), 0.15, 0.006);
  return out;
}

/** Adhesive tape ripping: dense, irregular stick-slip crackle. */
function tapeRip(out, sr, rng, t, dur, gain) {
  const n = ns(sr, dur);
  const s = new Float32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (i >= next) {
      s[i] = (rng() * 2 - 1) * rr(rng, 0.4, 1);
      next = i + Math.max(1, Math.round(sr / rr(rng, 400, 1400)));
    }
    s[i] += (rng() * 2 - 1) * 0.15;
    s[i] *= Math.min(1, u * 12) * Math.min(1, (1 - u) * 5);
  }
  filt(s, "bp", vary(rng, 2600, 0.1), 0.7, sr);
  filt(s, "hp", 900, 0.7, sr);
  scaleTo(s, gain);
  mix(out, s, sr, t);
}

function bandage(rng, sr) {
  const out = new Float32Array(ns(sr, 1.25));
  tapeRip(out, sr, rng, 0.02, 0.35, 1);
  rustle(out, sr, rng, 0.4, 0.4, 0.35, 2000, 4);
  tapeRip(out, sr, rng, 0.85, 0.25, 0.8);
  return out;
}

function drink(rng, sr) {
  const out = new Float32Array(ns(sr, 1.65));
  click(out, sr, rng, 0.01, vary(rng, 2400, 0.05), 0.4, 0.01); // tab lifted
  burst(out, sr, rng, { t: 0.06, dur: 0.03, att: 0, tau: 0.004, gain: 0.6, f: [["hp", 1500, 0.7]] }); // pop
  burst(out, sr, rng, {
    t: 0.062,
    dur: 0.6,
    att: 0.003,
    tau: 0.13,
    gain: 0.55,
    f: [
      ["hp", 3000, 0.7],
      ["pk", 6000, 1, 4],
    ],
  }); // pressure hiss
  for (let k = 0; k < 3; k++) {
    const t = 0.5 + k * rr(rng, 0.32, 0.38); // gulps
    thump(out, sr, { t, f0: vary(rng, 200, 0.1), f1: 110, sweep: 0.03, att: 0.006, tau: 0.05, gain: 0.35 });
    bubble(out, sr, t + 0.01, vary(rng, 180, 0.15), 20, 0.04, 0.3);
    burst(out, sr, rng, { t, dur: 0.25, att: 0.01, tau: 0.04, gain: 0.2, f: [["lp", 700, 0.8]] });
  }
  return out;
}

function pills(rng, sr) {
  const out = new Float32Array(ns(sr, 0.9));
  for (let s = 0; s < 3; s++) {
    const t0 = 0.01 + s * 0.18; // three shakes of the bottle
    const k = 8 + Math.floor(rng() * 7);
    for (let i = 0; i < k; i++) {
      const f = rr(rng, 2500, 5000);
      modal(
        out,
        sr,
        t0 + rng() * 0.07,
        [
          [f, 1, 0.004],
          [f * 1.7, 0.5, 0.003],
        ],
        rr(rng, 0.1, 0.3),
      );
    }
    modal(out, sr, t0 + 0.03, [[vary(rng, 900, 0.1), 1, 0.01]], 0.15);
  }
  click(out, sr, rng, 0.62, vary(rng, 1800, 0.05), 0.45, 0.01); // cap
  burst(out, sr, rng, { t: 0.62, dur: 0.04, att: 0, tau: 0.006, gain: 0.3, f: [["lp", 2000, 0.7]] });
  return out;
}

/** Soft bell-like chime tone. */
function chime(out, sr, t, f, gain) {
  const modes = [
    [f, 1, 0.5],
    [f * 2, 0.25, 0.3],
    [f * 3.01, 0.12, 0.18],
    [f * 4.2, 0.06, 0.1],
  ];
  modal(out, sr, t, modes, gain, 0.003);
}

function healDone(rng, sr) {
  const out = new Float32Array(ns(sr, 1.3));
  chime(out, sr, 0.005, 880, 0.7);
  chime(out, sr, 0.125, 1318.5, 0.8);
  return out;
}

function inventoryOpen(rng, sr) {
  const out = new Float32Array(ns(sr, 0.45));
  zipper(out, sr, rng, 0, 0.3, 90, 200, 0.7);
  rustle(out, sr, rng, 0.05, 0.35, 0.35, 2000, 3);
  return out;
}

function inventoryClose(rng, sr) {
  const out = new Float32Array(ns(sr, 0.45));
  rustle(out, sr, rng, 0, 0.2, 0.35, 2000, 3);
  zipper(out, sr, rng, 0.05, 0.25, 200, 110, 0.6);
  burst(out, sr, rng, { t: 0.3, dur: 0.12, att: 0.002, tau: 0.02, gain: 0.3, f: [["lp", 400, 0.8]] });
  return out;
}

// -------------------------------------------------------------------------------------------------
// World loops. Loop length L is a whole number of seconds and every oscillator / LFO frequency is a
// multiple of 1/L, so each buffer is exactly periodic.
// -------------------------------------------------------------------------------------------------

/** Loop-safe filtered noise band, peak-normalised to 1. */
function band(n, rng, sr, filters) {
  const s = noise(n, rng);
  for (const f of filters) filtLoop(s, f[0], f[1], f[2], sr, f[3]);
  return scaleTo(s, 1);
}

/** One-period wavetable (with a guard sample) from harmonic amplitudes with random phases. */
function wavetable(rng, size, amps) {
  const tab = new Float32Array(size + 1);
  for (let h = 1; h <= amps.length; h++) {
    const a = amps[h - 1];
    const p = rng() * TAU;
    for (let i = 0; i <= size; i++) tab[i] += a * Math.sin((TAU * h * i) / size + p);
  }
  return scaleTo(tab, 1);
}

/** Adds a wavetable oscillator at frequency f with a start phase in [0, 1). */
function addTable(out, sr, tab, f, gain, phase = 0) {
  const size = tab.length - 1;
  const inc = (f * size) / sr;
  let ph = phase * size;
  for (let i = 0; i < out.length; i++) {
    const j = ph | 0;
    out[i] += gain * (tab[j] + (tab[j + 1] - tab[j]) * (ph - j));
    ph += inc;
    if (ph >= size) ph -= size;
  }
}

/** Turboprop drone: four slightly detuned blade-pass tones beating, rumble, air rush, turbine whine. */
function planeLoop(rng, sr) {
  const L = 4;
  const n = ns(sr, L);
  const drone = new Float32Array(n);
  const amps = [];
  for (let h = 1; h <= 26; h++) amps.push(Math.pow(h, -1.05) * (h % 2 ? 1 : 0.8) * (h % 4 === 0 ? 1.3 : 1));
  const tab = wavetable(rng, 4096, amps);
  for (const d of [0, 0.25, -0.5, 0.75]) addTable(drone, sr, tab, 68 + d, rr(rng, 0.8, 1), rng());
  const swell = lfo(n, rng, [1, 2, 3], [1, 0.5, 0.3]);
  for (let i = 0; i < n; i++) drone[i] *= 0.85 + 0.1 * Math.sin((TAU * 17 * i) / sr) + 0.08 * swell[i];
  scaleTo(drone, 1);
  const rumble = band(n, rng, sr, [["lp", 180, 0.7]]);
  const air = band(n, rng, sr, [["bp", 1200, 0.5]]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const whine = 0.03 * Math.sin(TAU * 3100 * t) + 0.018 * Math.sin(TAU * 4650.25 * t);
    out[i] = drone[i] + 0.6 * rumble[i] + 0.22 * air[i] + whine;
  }
  return out;
}

/**
 * Car engine at ~1800 rpm (60 Hz firing): uneven combustion pulses through exhaust resonances, a low
 * "putt" and intake noise locked to the firing rhythm. The game scales pitch with playbackRate.
 */
function engineLoop(rng, sr) {
  const L = 2;
  const n = ns(sr, L);
  const fire = 60;
  const pulses = new Float32Array(n);
  const cyl = [1, 0.82, 0.93, 0.78].map((a) => a * rr(rng, 0.95, 1.05));
  const pw = ns(sr, 0.0045);
  const shape = new Float32Array(pw);
  for (let j = 0; j < pw; j++) shape[j] = Math.sin((Math.PI * j) / pw);
  const nt = ns(sr, 0.0015);
  for (let k = 0; k < fire * L; k++) {
    const at = Math.round((k / fire + (rng() - 0.5) * 0.0004) * sr);
    const a = cyl[k % 4] * rr(rng, 0.88, 1.08);
    mixWrap(pulses, shape, at, a);
    for (let j = 0; j < nt; j++) pulses[(at + j + n) % n] += a * 0.5 * (rng() * 2 - 1) * (1 - j / nt);
  }
  const exhaust = new Float32Array(n);
  const res = [
    [85, 1.4, 1],
    [170, 2.2, 0.7],
    [330, 3, 0.45],
    [640, 2.5, 0.25],
    [1250, 2, 0.12],
  ];
  for (const [f, q, g] of res) {
    const c = filtLoop(pulses.slice(), "bp", vary(rng, f, 0.05), q, sr);
    for (let i = 0; i < n; i++) exhaust[i] += c[i] * g;
  }
  scaleTo(exhaust, 1);
  const putt = filtLoop(pulses.slice(), "lp", 220, 0.7, sr);
  scaleTo(filtLoop(putt, "hp", 30, 0.7, sr), 0.8);
  const intake = band(n, rng, sr, [["bp", 2400, 0.9]]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const s = Math.sin(Math.PI * fire * t);
    const lope = 1 + 0.05 * Math.sin(TAU * 0.5 * t);
    out[i] = (exhaust[i] + putt[i] + 0.12 * intake[i] * (0.6 + 0.4 * s * s)) * lope;
  }
  scaleTo(out, 1);
  return softClip(out, 1.6);
}

/** Airy wind: noise bands with slow periodic gusts, plus faint narrow-band whistles on strong gusts. */
function windLoop(rng, sr) {
  const n = ns(sr, 8);
  const gust = lfo(n, rng, [1, 2, 3, 5, 7], [1, 0.7, 0.5, 0.35, 0.2]);
  const shift = lfo(n, rng, [1, 3, 4], [1, 0.6, 0.4]);
  const low = band(n, rng, sr, [["lp", 320, 0.6]]);
  const mid = band(n, rng, sr, [["bp", 700, 0.8]]);
  const high = band(n, rng, sr, [["bp", 1900, 1.2]]);
  const wh1 = band(n, rng, sr, [["bp", 1150, 22]]);
  const wh2 = band(n, rng, sr, [["bp", 1720, 25]]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = 0.5 + 0.5 * gust[i];
    const g2 = g * g;
    const w = 0.5 + 0.5 * shift[i];
    out[i] =
      0.55 * low[i] * (0.5 + 0.5 * g) +
      0.5 * mid[i] * g +
      0.28 * high[i] * g2 +
      0.12 * g2 * g * (wh1[i] * w + wh2[i] * (1 - w));
  }
  return out;
}

/** Skydiving: strong broadband rush with fast turbulence, low buffeting and clothing flap. */
function freefallLoop(rng, sr) {
  const n = ns(sr, 3);
  const turb = lfo(n, rng, [5, 7, 11, 13, 17, 23], [1, 0.8, 0.7, 0.5, 0.4, 0.3]);
  const slow = lfo(n, rng, [1, 2], [1, 0.5]);
  const rush = band(n, rng, sr, [["bp", 850, 0.45]]);
  const hiss = band(n, rng, sr, [["hp", 2500, 0.7]]);
  const rumble = band(n, rng, sr, [["lp", 150, 0.7]]);
  const flap = band(n, rng, sr, [["bp", 420, 1.4]]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 0.5 + 0.5 * Math.sin(TAU * 21 * t + 2 * Math.sin(TAU * 2 * t));
    out[i] =
      rush[i] * (0.8 + 0.2 * turb[i]) +
      0.5 * hiss[i] * (0.7 + 0.3 * turb[i]) +
      0.9 * rumble[i] * (0.6 + 0.4 * slow[i]) +
      0.45 * flap[i] * f * f * f * (0.6 + 0.4 * turb[i]);
  }
  return out;
}

/** Surf: three waves per loop, each swelling, breaking and washing out with fizz, over a low bed. */
function oceanLoop(rng, sr) {
  const L = 10;
  const n = ns(sr, L);
  const step = 64;
  const m = Math.ceil(n / step) + 2;
  const swell = new Float32Array(m);
  const crash = new Float32Array(m);
  const wash = new Float32Array(m);
  const up = 1.6;
  for (const [ts0, s0] of [
    [0.3, 1],
    [3.6, 0.8],
    [6.8, 0.92],
  ]) {
    const ts = ts0 + rr(rng, -0.25, 0.25);
    const s = s0 * rr(rng, 0.85, 1.1);
    for (let j = 0; j < m; j++) {
      const dt = ((((j * step) / sr - ts) % L) + L) % L;
      if (dt < up) {
        const u = dt / up;
        swell[j] += s * u * u * (3 - 2 * u);
        crash[j] += s * Math.exp((dt - up) / 0.12);
      } else {
        const d = dt - up;
        swell[j] += s * Math.exp(-d / 1.2);
        crash[j] += s * Math.exp(-d / 0.35);
        wash[j] += s * (1 - Math.exp(-d / 0.15)) * Math.exp(-d / 1.6);
      }
    }
  }
  const bed = band(n, rng, sr, [["lp", 280, 0.7]]);
  const body = band(n, rng, sr, [["bp", 650, 0.55]]);
  const fizz = band(n, rng, sr, [["hp", 2800, 0.7]]);
  const far = band(n, rng, sr, [["bp", 450, 0.4]]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / step;
    const j = p | 0;
    const f = p - j;
    const sw = swell[j] + (swell[j + 1] - swell[j]) * f;
    const cr = crash[j] + (crash[j + 1] - crash[j]) * f;
    const wa = wash[j] + (wash[j + 1] - wash[j]) * f;
    const pop = rng() < 0.03 ? 1.8 : 1;
    out[i] =
      bed[i] * (0.3 + 0.6 * sw) +
      body[i] * (0.8 * cr + 0.25 * sw) +
      fizz[i] * (0.45 * wa + 0.25 * cr) * pop +
      0.2 * far[i];
  }
  return out;
}

/** Smoke grenade: pressurised hiss with fluttering intensity and small sputters. */
function smokeHiss(rng, sr) {
  const n = ns(sr, 2);
  const hiss = band(n, rng, sr, [
    ["hp", 1600, 0.7],
    ["pk", 4200, 0.8, 6],
  ]);
  const low = band(n, rng, sr, [["bp", 500, 0.7]]);
  const mod = lfo(n, rng, [5, 9, 14, 21], [1, 0.8, 0.6, 0.4]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = hiss[i] * (0.82 + 0.18 * mod[i]) + 0.3 * low[i] * (0.7 + 0.3 * mod[i]);
  const pop = new Float32Array(ns(sr, 0.004));
  for (let k = 0; k < 30; k++) {
    for (let j = 0; j < pop.length; j++) pop[j] = (rng() * 2 - 1) * Math.exp(-j / (pop.length / 5));
    filt(pop, "hp", 3000, 0.7, sr);
    mixWrap(out, pop, Math.floor(rng() * n), rr(rng, 0.2, 0.5));
  }
  return out;
}

/** Parachute canopy in flight: fabric flutter, air and occasional ruffles. */
function chuteLoop(rng, sr) {
  const n = ns(sr, 3);
  const canopy = band(n, rng, sr, [["bp", 380, 1.1]]);
  const air = band(n, rng, sr, [["bp", 1300, 0.5]]);
  const rumble = band(n, rng, sr, [["lp", 120, 0.7]]);
  const gust = lfo(n, rng, [1, 2, 5], [1, 0.6, 0.4]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const a = 0.5 + 0.5 * Math.sin(TAU * 11 * t + 1.5 * Math.sin(TAU * t));
    const b = 0.5 + 0.5 * Math.sin(TAU * 17 * t);
    const g = 0.7 + 0.3 * gust[i];
    out[i] = canopy[i] * (0.6 * a * a + 0.4 * b * b) * g + 0.35 * air[i] * g + 0.4 * rumble[i];
  }
  for (let k = 0; k < 6; k++) {
    const r = new Float32Array(ns(sr, rr(rng, 0.06, 0.12)));
    for (let j = 0; j < r.length; j++) r[j] = (rng() * 2 - 1) * Math.sin((Math.PI * j) / r.length);
    filt(r, "bp", rr(rng, 600, 1100), 0.9, sr);
    mixWrap(out, r, Math.floor(rng() * n), rr(rng, 0.3, 0.6));
  }
  return out;
}

/**
 * Electric buzz for standing outside the zone: saturated 100 Hz pulse/saw hum with crackle, pulsing
 * twice per second. The pulse envelope is zero at both ends, so it works as a loop or a one-shot.
 */
function zoneTick(rng, sr) {
  const n = ns(sr, 1);
  const buzz = new Float32Array(n);
  const d1 = 100 / sr;
  const d2 = 150 / sr;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const pulse = (p1 < 0.25 ? 1 : 0) - 0.25 + 0.5 * (blep(p1, d1) - blep((p1 + 0.75) % 1, d1));
    buzz[i] = pulse + 0.35 * (2 * p2 - 1 - blep(p2, d2));
    p1 += d1;
    if (p1 >= 1) p1 -= 1;
    p2 += d2;
    if (p2 >= 1) p2 -= 1;
  }
  filtLoop(buzz, "bp", 1100, 0.7, sr);
  filtLoop(buzz, "pk", 2400, 1, sr, 5);
  softClip(scaleTo(buzz, 1), 2.5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const s = Math.sin(TAU * t);
    out[i] = (buzz[i] + 0.3 * Math.sin(TAU * 100 * t)) * s * s;
  }
  const cr = new Float32Array(ns(sr, 0.002));
  for (let k = 0; k < 40; k++) {
    for (let j = 0; j < cr.length; j++) cr[j] = (rng() * 2 - 1) * Math.exp(-j / (cr.length / 4));
    filt(cr, "hp", 2500, 0.7, sr);
    const at = Math.floor(rng() * n);
    const s = Math.sin((TAU * at) / n);
    mixWrap(out, cr, at, rr(rng, 0.2, 0.6) * s * s);
  }
  return out;
}

/** Birdsong: four distinct calls (two-note whistle, trill, warble, rising tweets). */
function bird(rng, sr, v) {
  const out = new Float32Array(ns(sr, 1.2));
  if (v === 0) {
    const f1 = vary(rng, 3300, 0.08);
    const f2 = f1 * rr(rng, 0.72, 0.8);
    chirp(out, sr, 0.02, 0.22, (u) => f1 * (1 + 0.04 * u), 0.8, 0.1, 0.6);
    chirp(out, sr, 0.3, 0.3, (u) => f2 * (1 - 0.03 * u) * (1 + 0.012 * Math.sin(TAU * 7 * u)), 0.7, 0.1, 0.6);
  } else if (v === 1) {
    const k = 7 + Math.floor(rng() * 5);
    const f = vary(rng, 5200, 0.1);
    const gap = rr(rng, 0.055, 0.075);
    for (let i = 0; i < k; i++) {
      const g = 0.5 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / k);
      chirp(out, sr, 0.02 + i * gap, 0.04, (u) => f * (1 - 0.35 * u), g, 0.15, 1);
    }
  } else if (v === 2) {
    const fc = vary(rng, 3000, 0.1);
    const rate = rr(rng, 18, 26);
    const dur = rr(rng, 0.5, 0.75);
    chirp(
      out,
      sr,
      0.02,
      dur,
      (u) => fc * (1 + 0.15 * Math.sin(TAU * rate * u * dur)) * (1 + 0.1 * u),
      0.8,
      0.08,
      0.5,
    );
  } else {
    const f = vary(rng, 2500, 0.1);
    let t = 0.02;
    for (let i = 0; i < 3; i++) {
      chirp(out, sr, t, 0.07, (u) => f * (1 + 0.7 * u * u), 0.7, 0.12, 0.8);
      t += rr(rng, 0.14, 0.18);
    }
  }
  return out;
}

/** "The zone is shrinking" warning: two rising siren whoops with an octave-down layer and tremolo. */
function zoneAlarm(rng, sr) {
  const out = new Float32Array(ns(sr, 2.0));
  const top = 1 + 0.85 * (1 - Math.exp(-0.5 / 0.14));
  const glide = (tt) =>
    tt < 0.5 ? 1 + 0.85 * (1 - Math.exp(-tt / 0.14)) : top - 0.6 * Math.min(1, (tt - 0.5) / 0.25);
  for (let k = 0; k < 2; k++) {
    const t = 0.02 + k * 0.9;
    synth(out, sr, {
      t,
      dur: 0.72,
      f: 520,
      gain: 0.8,
      att: 0.03,
      rel: 0.1,
      sq: 0.5,
      bright: 4,
      detune: 0.003,
      glide,
    });
    synth(out, sr, { t, dur: 0.72, f: 260, gain: 0.35, att: 0.03, rel: 0.1, bright: 2, glide });
  }
  tremolo(out, sr, 16, 0.2);
  return out;
}

/** Raised-cosine fade over the last `sec` seconds (for long ringing sounds cut by their buffer). */
function fadeOut(x, sr, sec) {
  const f = Math.min(x.length, ns(sr, sec));
  for (let i = 0; i < f; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
  return x;
}

// -------------------------------------------------------------------------------------------------
// Explosives
// -------------------------------------------------------------------------------------------------

function pin(rng, sr) {
  const out = new Float32Array(ns(sr, 0.5));
  scrape(out, sr, rng, 0, 0.05, vary(rng, 4200, 0.08), 2, 0.35, 0.5); // ring drawn through the hole
  const spring = [
    [vary(rng, 4600, 0.06), 1, 0.12],
    [vary(rng, 6900, 0.06), 0.5, 0.08],
    [vary(rng, 2900, 0.06), 0.4, 0.05],
  ];
  modal(out, sr, 0.05, spring, 0.6); // pin springs free
  click(out, sr, rng, 0.055, vary(rng, 2500, 0.05), 0.5, 0.01); // spoon lever
  return fadeOut(out, sr, 0.1);
}

function bounce(rng, sr) {
  const out = new Float32Array(ns(sr, 0.35));
  modal(
    out,
    sr,
    0.001,
    [
      [vary(rng, 330, 0.1), 1, 0.035],
      [vary(rng, 780, 0.1), 0.7, 0.025],
      [vary(rng, 1450, 0.1), 0.5, 0.015],
      [vary(rng, 2600, 0.1), 0.3, 0.008],
    ],
    0.8,
  );
  thump(out, sr, { t: 0.001, f0: 150, f1: 80, sweep: 0.008, tau: 0.02, gain: 0.5 });
  burst(out, sr, rng, { t: 0.001, dur: 0.06, att: 0.0003, tau: 0.008, gain: 0.5, f: [["lp", 900, 0.8]] });
  grains(out, sr, rng, {
    t: 0.003,
    span: 0.08,
    count: 10,
    len: 0.0015,
    gain: 0.12,
    skew: 1.5,
    f: [["bp", 3000, 0.8]],
  });
  return out;
}

/** Grenade / vehicle explosion: shock front, blast, deep boom, debris rain, rolling tail, echoes. */
function explosion(rng, sr) {
  const out = new Float32Array(ns(sr, 4.2));
  const blast = new Float32Array(ns(sr, 0.8));
  nwave(blast, sr, 0.002, vary(rng, 0.003, 0.15), 1);
  burst(blast, sr, rng, {
    t: 0.002,
    dur: 0.75,
    att: 0.0005,
    tau: 0.035,
    slow: 0.35,
    tau2: 0.16,
    gain: 1,
    f: [["lp", 3500, 0.7]],
  });
  burst(blast, sr, rng, {
    t: 0.002,
    dur: 0.75,
    att: 0.002,
    tau: 0.12,
    gain: 0.6,
    f: [["bp", vary(rng, 450, 0.1), 0.7]],
  });
  mix(out, blast, sr, 0);
  thump(out, sr, {
    t: 0.002,
    f0: vary(rng, 75, 0.1),
    f1: 28,
    sweep: 0.08,
    att: 0.003,
    tau: 0.42,
    gain: 1.2,
    drive: 3,
  });
  burst(out, sr, rng, { t: 0.005, dur: 4.1, att: 0.02, tau: 0.9, gain: 0.7, f: [["lp", 120, 0.7]] }); // sub rumble
  grains(out, sr, rng, {
    t: 0.15,
    span: 1.6,
    count: 90,
    len: 0.006,
    gain: 0.25,
    skew: 1.6,
    f: [["bp", 1800, 0.5]],
  });
  const n = out.length;
  const tail = noise(n, rng);
  envelope(tail, sr, 0.1, vary(rng, 1.1, 0.1));
  const wob = wobble(n, sr, rng, 3);
  for (let i = 0; i < n; i++) tail[i] *= 0.4 + 0.6 * wob[i];
  svf(tail, sr, LP, 0.6, (t) => 180 + 720 * Math.exp(-t / 1.5));
  mix(out, scaleTo(tail, 0.55), sr, 0);
  mix(out, filt(blast.slice(), "lp", 900, 0.7, sr), sr, vary(rng, 0.35, 0.15), 0.35);
  mix(out, filt(blast.slice(), "lp", 600, 0.7, sr), sr, vary(rng, 0.8, 0.15), 0.22);
  mix(out, filt(blast.slice(), "lp", 400, 0.7, sr), sr, vary(rng, 1.4, 0.15), 0.12);
  scaleTo(out, 1);
  softClip(out, 2.5);
  return fadeOut(out, sr, 0.4);
}

// -------------------------------------------------------------------------------------------------
// Parachute
// -------------------------------------------------------------------------------------------------

function chuteOpen(rng, sr) {
  const out = new Float32Array(ns(sr, 1.4));
  const t = 0.22;
  burst(out, sr, rng, {
    t: 0,
    dur: 0.3,
    att: 0.12,
    tau: 1,
    gain: 0.5,
    mode: BP,
    q: 1.2,
    fc: (tt) => 500 + 6000 * tt,
  }); // canopy unfurling
  thump(out, sr, {
    t,
    f0: vary(rng, 95, 0.08),
    f1: 45,
    sweep: 0.03,
    att: 0.002,
    tau: 0.09,
    gain: 1,
    drive: 2.5,
  });
  burst(out, sr, rng, {
    t,
    dur: 0.4,
    att: 0.001,
    tau: 0.05,
    gain: 0.9,
    f: [["bp", vary(rng, 700, 0.1), 0.7]],
  });
  burst(out, sr, rng, { t, dur: 0.06, att: 0, tau: 0.01, gain: 0.4, f: [["hp", 2000, 0.7]] });
  click(out, sr, rng, t + 0.01, vary(rng, 1600, 0.05), 0.3, 0.012); // lines snap taut
  click(out, sr, rng, t + 0.03, vary(rng, 2200, 0.05), 0.25, 0.01);
  const n = ns(sr, 1.1);
  const flap = noise(n, rng);
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    const s = 0.5 + 0.5 * Math.sin(TAU * 16 * tt);
    flap[i] *= Math.exp(-tt / 0.35) * (0.3 + 0.7 * s * s * s);
  }
  filt(flap, "bp", 450, 1, sr);
  mix(out, scaleTo(flap, 0.45), sr, t + 0.03);
  const res = [
    [vary(rng, 900, 0.1), 8, 1],
    [vary(rng, 1900, 0.1), 9, 0.5],
  ];
  creak(out, sr, rng, t + 0.08, 0.12, (u) => 120 + 60 * u, 0.15, res); // harness
  return out;
}

// -------------------------------------------------------------------------------------------------
// Vehicles
// -------------------------------------------------------------------------------------------------

function carHorn(rng, sr) {
  const out = new Float32Array(ns(sr, 0.8));
  const glide = (tt) => 1 - 0.03 * Math.exp(-tt / 0.02);
  for (const [f, g] of [
    [410, 1],
    [512, 0.85],
  ]) {
    synth(out, sr, {
      t: 0.005,
      dur: 0.62,
      f,
      gain: g,
      att: 0.012,
      rel: 0.03,
      sq: 0.8,
      bright: 8,
      detune: 0.0015,
      glide,
    });
  }
  filt(out, "pk", 1600, 0.8, sr, 9);
  filt(out, "pk", 3200, 1.5, sr, 5);
  filt(out, "hp", 250, 0.7, sr);
  scaleTo(out, 1);
  return softClip(out, 2);
}

function carCrash(rng, sr) {
  const out = new Float32Array(ns(sr, 1.6));
  thump(out, sr, {
    t: 0.002,
    f0: vary(rng, 80, 0.1),
    f1: 40,
    sweep: 0.03,
    att: 0.002,
    tau: 0.08,
    gain: 1,
    drive: 3,
  });
  burst(out, sr, rng, { t: 0.002, dur: 0.3, att: 0.001, tau: 0.04, gain: 0.8, f: [["lp", 800, 0.8]] });
  grains(out, sr, rng, {
    t: 0.002,
    span: 0.35,
    count: 60,
    len: 0.008,
    gain: 0.7,
    skew: 1.5,
    f: [["bp", 1200, 0.6]],
  });
  for (let k = 0; k < 6; k++) {
    const f = rr(rng, 300, 1800); // body panels ringing
    const modes = [
      [f, 1, rr(rng, 0.05, 0.2)],
      [f * 1.6, 0.6, rr(rng, 0.04, 0.12)],
      [f * 2.3, 0.4, rr(rng, 0.03, 0.08)],
      [f * 3.1, 0.25, 0.03],
    ];
    modal(out, sr, rr(rng, 0, 0.3), modes, rr(rng, 0.2, 0.5));
  }
  scrape(out, sr, rng, 0.1, 0.5, vary(rng, 2200, 0.1), 1.2, 0.25, 0.8);
  for (let k = 0; k < 12; k++) {
    const f = rr(rng, 3000, 8000); // glass
    modal(
      out,
      sr,
      rr(rng, 0.05, 0.6),
      [
        [f, 1, rr(rng, 0.02, 0.06)],
        [f * 1.7, 0.5, 0.02],
      ],
      rr(rng, 0.1, 0.2),
    );
  }
  grains(out, sr, rng, {
    t: 0.2,
    span: 1.0,
    count: 30,
    len: 0.003,
    gain: 0.12,
    skew: 1.3,
    f: [["hp", 1500, 0.7]],
  });
  scaleTo(out, 1);
  return softClip(out, 2.2);
}

function carDoor(rng, sr) {
  const out = new Float32Array(ns(sr, 0.7));
  click(out, sr, rng, 0, vary(rng, 2200, 0.05), 0.4, 0.01); // handle
  const t = 0.08;
  thump(out, sr, {
    t,
    f0: vary(rng, 95, 0.08),
    f1: 55,
    sweep: 0.015,
    att: 0.001,
    tau: 0.05,
    gain: 0.9,
    drive: 2,
  });
  modal(
    out,
    sr,
    t,
    [
      [vary(rng, 160, 0.08), 1, 0.05],
      [vary(rng, 330, 0.08), 0.7, 0.03],
      [vary(rng, 610, 0.08), 0.5, 0.02],
      [vary(rng, 1130, 0.08), 0.3, 0.012],
    ],
    0.7,
  );
  burst(out, sr, rng, { t, dur: 0.1, att: 0.0005, tau: 0.012, gain: 0.5, f: [["lp", 1500, 0.8]] });
  click(out, sr, rng, t + 0.005, vary(rng, 1900, 0.05), 0.55, 0.012); // latch
  click(out, sr, rng, t + 0.04, vary(rng, 3400, 0.05), 0.12, 0.006);
  modal(out, sr, t + 0.01, [[vary(rng, 2600, 0.05), 1, 0.03]], 0.08); // window rattle
  return out;
}

// -------------------------------------------------------------------------------------------------
// Melee
// -------------------------------------------------------------------------------------------------

function panSwing(rng, sr) {
  const out = new Float32Array(ns(sr, 0.4));
  const d = vary(rng, 0.28, 0.1);
  const n = ns(sr, d);
  const s = noise(n, rng);
  for (let i = 0; i < n; i++) {
    const w = Math.sin((Math.PI * i) / n);
    s[i] *= w * w;
  }
  const low = filt(s.slice(), "lp", 500, 0.7, sr);
  svf(s, sr, BP, 1.8, (t) => 500 + 1600 * Math.sin(Math.PI * Math.min(1, t / d)));
  mix(out, scaleTo(s, 1), sr, 0.01);
  mix(out, scaleTo(low, 0.35), sr, 0.01);
  return out;
}

/** The frying-pan CLANG: cast-iron plate modes with beating twins, a bright strike cluster, a thud. */
function panHit(rng, sr, v) {
  const out = new Float32Array(ns(sr, 3.0));
  const f = vary(rng, v === 0 ? 540 : 610, 0.03);
  const R = [1, 1.53, 2.08, 2.69, 3.37, 4.12, 5.05, 6.2, 7.4];
  const A = [1, 0.85, 0.7, 0.55, 0.5, 0.35, 0.28, 0.18, 0.12];
  const T = [0.6, 0.52, 0.45, 0.38, 0.32, 0.26, 0.2, 0.15, 0.1];
  const modes = [];
  for (let i = 0; i < R.length; i++) {
    const fi = f * R[i] * rr(rng, 0.99, 1.01);
    const tau = T[i] * rr(rng, 0.85, 1.15);
    modes.push([fi, A[i], tau], [fi * rr(rng, 1.002, 1.004), A[i] * 0.6, tau * 0.9]);
  }
  modal(out, sr, 0.001, modes, 1);
  modal(
    out,
    sr,
    0.001,
    [
      [f * 3.7, 1, 0.03],
      [f * 5.9, 0.8, 0.025],
      [f * 8.3, 0.6, 0.02],
    ],
    0.45,
  );
  burst(out, sr, rng, { t: 0.001, dur: 0.03, att: 0, tau: 0.004, gain: 0.6, f: [["hp", 1500, 0.7]] });
  thump(out, sr, { t: 0.001, f0: 180, f1: 90, sweep: 0.01, tau: 0.03, gain: 0.5, drive: 1.5 });
  burst(out, sr, rng, { t: 0.001, dur: 0.15, att: 0.0003, tau: 0.02, gain: 0.4, f: [["bp", 900, 0.8]] });
  scaleTo(out, 1);
  softClip(out, 1.5);
  return fadeOut(out, sr, 0.6);
}

// -------------------------------------------------------------------------------------------------
// UI / meta
// -------------------------------------------------------------------------------------------------

function uiClick(rng, sr) {
  const out = new Float32Array(ns(sr, 0.06));
  burst(out, sr, rng, { t: 0.001, dur: 0.01, att: 0, tau: 0.0008, gain: 0.6, f: [["hp", 2500, 0.7]] });
  modal(
    out,
    sr,
    0.001,
    [
      [2000, 1, 0.006],
      [3150, 0.4, 0.004],
    ],
    0.6,
  );
  modal(out, sr, 0.001, [[420, 1, 0.008]], 0.25);
  return out;
}

function uiHover(rng, sr) {
  const out = new Float32Array(ns(sr, 0.05));
  modal(
    out,
    sr,
    0.001,
    [
      [1500, 1, 0.005],
      [2300, 0.3, 0.003],
    ],
    1,
    0.0005,
  );
  return out;
}

function uiAlert(rng, sr) {
  const out = new Float32Array(ns(sr, 0.9));
  const ping = (t, f, tau) =>
    modal(
      out,
      sr,
      t,
      [
        [f, 1, tau],
        [f * 2, 0.25, tau * 0.6],
        [f * 3, 0.08, tau * 0.4],
      ],
      0.8,
      0.002,
    );
  ping(0.005, 987.8, 0.12);
  ping(0.145, 1318.5, 0.2);
  return out;
}

function killConfirm(rng, sr) {
  const out = new Float32Array(ns(sr, 0.3));
  burst(out, sr, rng, { t: 0.001, dur: 0.01, att: 0, tau: 0.0007, gain: 0.6, f: [["hp", 3500, 0.7]] });
  modal(
    out,
    sr,
    0.001,
    [
      [2350, 1, 0.02],
      [3700, 0.35, 0.012],
    ],
    0.55,
  );
  modal(out, sr, 0.001, [[180, 1, 0.02]], 0.35);
  modal(
    out,
    sr,
    0.046,
    [
      [3150, 1, 0.03],
      [4800, 0.3, 0.015],
    ],
    0.4,
  );
  return out;
}

/** Short brass fanfare in C: pickup triplet, rising line, timpani roll into a held final chord. */
function victory(rng, sr) {
  const out = new Float32Array(ns(sr, 4.5));
  const lead = [
    [0, 0.09, 67],
    [0.1, 0.09, 67],
    [0.2, 0.09, 67],
    [0.3, 0.4, 72],
    [0.72, 0.18, 76],
    [0.93, 0.18, 74],
    [1.14, 0.18, 76],
    [1.35, 0.85, 79],
    [2.3, 1.0, 84],
  ];
  for (const [t, d, m] of lead) {
    const long = d > 0.5;
    synth(out, sr, {
      t,
      dur: d,
      f: midi(m),
      gain: 0.9,
      att: 0.015,
      rel: long ? 0.25 : 0.08,
      bright: 7,
      vib: long ? 0.005 : 0,
    });
  }
  const chords = [
    [0.3, 0.4, [60, 64, 67]],
    [0.72, 0.6, [65, 69, 72]],
    [1.35, 0.85, [67, 71, 74]],
    [2.3, 1.0, [72, 76, 79]],
  ];
  for (const [t, d, notes] of chords) {
    for (const m of notes)
      synth(out, sr, { t, dur: d, f: midi(m), gain: 0.4, att: 0.03, rel: 0.25, bright: 4, detune: 0.006 });
  }
  for (const [t, d, m] of [
    [0.3, 1.0, 48],
    [1.35, 0.9, 43],
    [2.3, 1.0, 36],
  ]) {
    synth(out, sr, { t, dur: d, f: midi(m), gain: 0.6, att: 0.02, rel: 0.25, bright: 2.5 });
  }
  const timp = (t, m, g) => {
    thump(out, sr, {
      t,
      f0: midi(m) * 1.15,
      f1: midi(m),
      sweep: 0.04,
      att: 0.002,
      tau: 0.35,
      gain: g,
      drive: 1.2,
    });
    burst(out, sr, rng, { t, dur: 0.08, att: 0, tau: 0.01, gain: g * 0.4, f: [["lp", 700, 0.8]] });
  };
  timp(0.3, 36, 0.5);
  timp(1.35, 43, 0.5);
  for (let k = 0; k < 7; k++) timp(1.95 + k * 0.05, 36, 0.12 + k * 0.04);
  timp(2.3, 36, 0.75);
  burst(out, sr, rng, {
    t: 2.29,
    dur: 2.1,
    att: 0.004,
    tau: 0.7,
    gain: 0.3,
    f: [
      ["hp", 4000, 0.7],
      ["pk", 7000, 1, 4],
    ],
  }); // cymbal
  echoes(out, sr, 4.5, [
    [0.11, 0.18, 3000],
    [0.23, 0.1, 2000],
  ]);
  return fadeOut(out, sr, 0.5);
}

/** Death: a darkening minor triad sliding down an octave over a sub drop. */
function death(rng, sr) {
  const out = new Float32Array(ns(sr, 2.8));
  const glide = (tt) => Math.pow(2, -tt / 2);
  const cut = (tt) => 1400 * Math.exp(-tt / 0.8) + 150;
  for (const m of [57, 60, 64]) {
    synth(out, sr, {
      t: 0.01,
      dur: 1.9,
      f: midi(m),
      gain: 0.55,
      att: 0.04,
      rel: 0.4,
      detune: 0.005,
      glide,
      cut,
    });
  }
  thump(out, sr, { t: 0.01, f0: 80, f1: 40, sweep: 0.05, att: 0.003, tau: 0.15, gain: 0.6, drive: 1.5 });
  thump(out, sr, { t: 0.01, f0: 55, f1: 27.5, sweep: 1.0, att: 0.05, tau: 0.8, gain: 0.5 });
  burst(out, sr, rng, { t: 0.01, dur: 0.6, att: 0.002, tau: 0.1, gain: 0.3, f: [["lp", 300, 0.8]] });
  return fadeOut(out, sr, 0.6);
}

// -------------------------------------------------------------------------------------------------
// Registry
// -------------------------------------------------------------------------------------------------

// Mixing / spatial defaults per category. gain: level multiplier (every buffer peaks at -1 dBFS);
// ref/roll/max: PannerNode refDistance, rolloffFactor ("inverse" model) and audible range in metres;
// send/send2d: reverb send for spatial / non-spatial playback; jitter: default ± playbackRate variation.
const GUN = { gain: 0.9, ref: 20, roll: 0.5, max: 700, send: 0.35, send2d: 0.18, jitter: 0.04 };
const MECH = { gain: 0.55, ref: 2.5, roll: 1.2, max: 40, send: 0.08, send2d: 0.05, jitter: 0.04 };
const IMP = { gain: 0.6, ref: 4, roll: 1, max: 150, send: 0.15, send2d: 0.08, jitter: 0.06 };
const STEP = { gain: 0.45, ref: 2, roll: 1.2, max: 45, send: 0.06, send2d: 0.03, jitter: 0.05 };
const FOLEY = { gain: 0.5, ref: 2.5, roll: 1, max: 40, send: 0.08, send2d: 0.04, jitter: 0.04 };
const WORLD = { gain: 0.6, ref: 10, roll: 1, max: 400, send: 0.2, send2d: 0.1, jitter: 0.04 };
const LOOP = { gain: 0.5, ref: 10, roll: 1, max: 1e4, send: 0.08, send2d: 0.04, jitter: 0, loop: true };
const UI = { gain: 0.4, ref: 5, roll: 1, max: 100, send: 0, send2d: 0, jitter: 0 };

/** Sound definition: category defaults + variant count `n` + renderer `make(rng, sr, variant)`. */
const def = (base, n, make, extra) => ({ ...base, n, make, lo: false, ...extra });

export const SOUND_DEFS = {
  // Weapons
  gun_ar: def(GUN, 3, (r, sr) => gunshot(r, sr, GUNS.ar)),
  gun_akm: def(GUN, 3, (r, sr) => gunshot(r, sr, GUNS.akm), { gain: 1, max: 750 }),
  gun_smg: def(GUN, 3, (r, sr) => gunshot(r, sr, GUNS.smg), { gain: 0.8, max: 450 }),
  gun_pistol: def(GUN, 3, (r, sr) => gunshot(r, sr, GUNS.pistol), { gain: 0.7, ref: 15, max: 400 }),
  gun_dmr: def(GUN, 3, (r, sr) => gunshot(r, sr, GUNS.dmr), { gain: 1, ref: 25, max: 850, send: 0.45 }),
  gun_sniper: def(GUN, 2, (r, sr) => gunshot(r, sr, GUNS.sniper), {
    gain: 1,
    ref: 30,
    roll: 0.45,
    max: 900,
    send: 0.5,
  }),
  gun_shotgun: def(GUN, 2, (r, sr) => gunshot(r, sr, GUNS.shotgun), {
    gain: 1,
    ref: 22,
    max: 500,
    send: 0.4,
  }),
  gun_suppressed: def(GUN, 3, suppressedShot, {
    gain: 0.55,
    ref: 6,
    roll: 1,
    max: 120,
    send: 0.12,
    send2d: 0.08,
  }),
  gun_distant: def(GUN, 3, distantShot, { lo: true, max: 950, send: 0.6 }),
  reload_out: def(MECH, 1, reloadOut),
  reload_in: def(MECH, 1, reloadIn),
  bolt: def(MECH, 1, boltCycle),
  pump: def(MECH, 1, pumpAction),
  dry: def(MECH, 1, dryClick),
  switch_mode: def(MECH, 1, switchMode, { gain: 0.45 }),
  equip: def(MECH, 1, equip),
  // Bullets
  impact_dirt: def(IMP, 3, impactDirt),
  impact_concrete: def(IMP, 3, impactConcrete),
  impact_metal: def(IMP, 3, impactMetal, { gain: 0.55 }),
  impact_wood: def(IMP, 3, impactWood),
  impact_flesh: def(IMP, 3, impactFlesh, { gain: 0.8 }),
  impact_water: def(IMP, 3, impactWater),
  impact_glass: def(IMP, 2, impactGlass, { gain: 0.55 }),
  helmet_ding: def(IMP, 2, helmetDing, { gain: 0.8 }),
  whiz: def(IMP, 3, whiz, { gain: 0.8, ref: 1.5, max: 60, send: 0.05, jitter: 0.1 }),
  crack: def(IMP, 2, crack, { gain: 0.9, ref: 3, max: 400, send: 0.25 }),
  // Movement
  step_grass: def(STEP, 4, stepGrass),
  step_hard: def(STEP, 4, stepHard),
  step_wood: def(STEP, 4, stepWood),
  step_water: def(STEP, 4, stepWater, { gain: 0.5 }),
  step_sand: def(STEP, 4, stepSand),
  jump: def(FOLEY, 1, jump, { gain: 0.4 }),
  land: def(FOLEY, 2, land, { gain: 0.6 }),
  prone: def(FOLEY, 1, prone, { gain: 0.4 }),
  swim: def(FOLEY, 2, swim, { lo: true }),
  // Interactions
  pickup: def(FOLEY, 2, pickup, { gain: 0.45 }),
  door_open: def(FOLEY, 1, doorOpen, { gain: 0.6, max: 60 }),
  door_close: def(FOLEY, 1, doorClose, { gain: 0.65, max: 70 }),
  bandage: def(FOLEY, 1, bandage),
  drink: def(FOLEY, 1, drink),
  pills: def(FOLEY, 1, pills),
  heal_done: def(UI, 1, healDone, { gain: 0.35 }),
  inventory_open: def(FOLEY, 1, inventoryOpen, { gain: 0.4 }),
  inventory_close: def(FOLEY, 1, inventoryClose, { gain: 0.4 }),
  // World / loops
  plane_loop: def(LOOP, 1, planeLoop, { lo: true, gain: 0.7, ref: 80, roll: 0.6 }),
  engine_loop: def(LOOP, 1, engineLoop, { lo: true, gain: 0.6, ref: 5 }),
  wind_loop: def(LOOP, 1, windLoop, { lo: true, gain: 0.35 }),
  freefall_loop: def(LOOP, 1, freefallLoop, { lo: true, gain: 0.6 }),
  ocean_loop: def(LOOP, 1, oceanLoop, { lo: true, ref: 25 }),
  bird: def(WORLD, 4, bird, { gain: 0.35, ref: 8, max: 150, jitter: 0.06 }),
  zone_alarm: def(UI, 1, zoneAlarm, { lo: true, gain: 0.5, send2d: 0.1 }),
  zone_tick: def(LOOP, 1, zoneTick, { gain: 0.35 }),
  // Explosives
  pin: def(MECH, 1, pin),
  bounce: def(IMP, 3, bounce, { max: 80 }),
  explosion: def(WORLD, 2, explosion, {
    lo: true,
    gain: 1,
    ref: 30,
    roll: 0.5,
    max: 1500,
    send: 0.5,
    send2d: 0.35,
  }),
  smoke_hiss: def(LOOP, 1, smokeHiss, { gain: 0.45, ref: 4 }),
  // Parachute
  chute_open: def(WORLD, 1, chuteOpen, { gain: 0.7, ref: 8, max: 300 }),
  chute_loop: def(LOOP, 1, chuteLoop, { lo: true, gain: 0.45 }),
  // Vehicles
  car_horn: def(WORLD, 1, carHorn, { jitter: 0 }),
  car_crash: def(WORLD, 2, carCrash, { gain: 0.9 }),
  car_door: def(WORLD, 1, carDoor, { ref: 4, max: 80 }),
  // Melee
  pan_swing: def(FOLEY, 2, panSwing),
  pan_hit: def(IMP, 2, panHit, { gain: 1, ref: 6, max: 200, send: 0.2 }),
  // UI / meta
  click: def(UI, 1, uiClick, { gain: 0.3 }),
  hover: def(UI, 1, uiHover, { gain: 0.15 }),
  alert: def(UI, 1, uiAlert, { gain: 0.45 }),
  kill_confirm: def(UI, 1, killConfirm, { gain: 0.5 }),
  victory: def(UI, 1, victory, { gain: 0.6, send2d: 0.15 }),
  death: def(UI, 1, death, { lo: true, gain: 0.55, send2d: 0.15 }),
};

export const SOUND_NAMES = Object.keys(SOUND_DEFS);
export const LOOP_NAMES = SOUND_NAMES.filter((k) => SOUND_DEFS[k].loop);

/** Generation rates: "hi" is the context rate capped at 48 kHz, "lo" half of it for dull sounds. */
function rates(ctx) {
  const hi = Math.min(Math.round(ctx.sampleRate) || 48000, 48000);
  return { hi, lo: hi >= 44100 ? hi / 2 : hi };
}

/** Renders every variant of one sound into mono AudioBuffers (deterministic per name). */
export function renderSound(ctx, name) {
  const d = SOUND_DEFS[name];
  if (!d) return [];
  const { hi, lo } = rates(ctx);
  const sr = d.lo ? lo : hi;
  const seed = hashStr(name);
  const out = [];
  for (let v = 0; v < d.n; v++) {
    const rng = makeRng(seed + v * 0x9e3779b1);
    const raw = d.make(rng, sr, v);
    const x = d.loop ? finishLoop(raw, sr) : finish(raw, sr);
    const b = ctx.createBuffer(1, x.length, sr);
    b.getChannelData(0).set(x);
    out.push(b);
  }
  return out;
}

/**
 * Stereo reverb impulse response: sparse early reflections (ground, walls, trees), a few late terrain
 * slaps, and a decorrelated exponentially decaying tail whose highs die faster than its lows.
 * Rendered at the context rate because a ConvolverNode requires it.
 */
export function buildReverbIR(ctx, seconds = 2.2) {
  const sr = ctx.sampleRate;
  const n = ns(sr, seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const tau = (seconds * 0.9) / 6.91;
  for (let ch = 0; ch < 2; ch++) {
    const rng = makeRng(0x5eed + ch * 7919);
    const x = new Float32Array(n);
    for (let k = 0; k < 14; k++) {
      const t = 0.006 + Math.pow(rng(), 1.6) * 0.12;
      const a = (1 - t * 5) * rr(rng, 0.4, 1) * (rng() < 0.5 ? -1 : 1);
      const at = ns(sr, t);
      for (let j = 0; j < 40 && at + j < n; j++) x[at + j] += a * Math.exp(-j / 6) * (rng() * 2 - 1);
    }
    for (let k = 0; k < 3; k++) {
      const at = ns(sr, 0.25 + k * 0.28 + rng() * 0.08);
      const a = 0.3 * Math.pow(0.6, k);
      for (let j = 0; j < 200 && at + j < n; j++) x[at + j] += a * Math.exp(-j / 40) * (rng() * 2 - 1);
    }
    const ka = Math.exp(-1 / (0.03 * sr));
    const kd = Math.exp(-1 / (tau * sr));
    let a = 1;
    let d = 0.5;
    for (let i = 0; i < n; i++) {
      x[i] += (rng() * 2 - 1) * (1 - a) * d;
      a *= ka;
      d *= kd;
    }
    svf(x, sr, LP, 0.6, (t) => 1200 + 7800 * Math.exp(-t / 0.5));
    filt(x, "hp", 80, 0.7, sr);
    fadeOut(x, sr, 0.1);
    buf.getChannelData(ch).set(x);
  }
  return buf;
}
