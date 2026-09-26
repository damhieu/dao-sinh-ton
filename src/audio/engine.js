// Audio engine for ĐẢO SINH TỒN: Web Audio graph, voice management, 3D (HRTF) positioning and distance
// modelling (air absorption, speed-of-sound delay, reverb send), plus the public `audio` API.
//
// Graph:  source → [low-pass] → voice gain → (HRTF panner | direct 2D) → sfx bus → master → compressor → out
//                                          ↘ reverb send → reverb bus (convolver, procedural IR) → sfx bus
//
// Every public method is safe to call at any time: before init(), while the context is suspended or
// with bad arguments it simply does nothing (never throws).

import { SOUND_DEFS, SOUND_NAMES, LOOP_NAMES, renderSound, buildReverbIR } from "./sfx.js";

export { SOUND_NAMES, LOOP_NAMES };

const MAX_VOICES = 48;
const SPEED_OF_SOUND = 343;
const EMPTY = Object.freeze({});
const NOOP_LOOP = Object.freeze({ setPos() {}, setRate() {}, setVol() {}, stop() {} });

// Gunshot kinds: near buffer, audible range (m), panner refDistance, and the pitch / level of the shared
// far-away rumble layer ("gun_distant") that takes over with distance.
const GUNS = {
  ar: { name: "gun_ar", range: 700, ref: 20, distRate: 1, distVol: 1 },
  akm: { name: "gun_akm", range: 750, ref: 22, distRate: 0.9, distVol: 1.15 },
  smg: { name: "gun_smg", range: 450, ref: 16, distRate: 1.12, distVol: 0.7 },
  pistol: { name: "gun_pistol", range: 400, ref: 15, distRate: 1.2, distVol: 0.55 },
  dmr: { name: "gun_dmr", range: 850, ref: 25, distRate: 0.92, distVol: 1.25 },
  sniper: { name: "gun_sniper", range: 900, ref: 30, distRate: 0.85, distVol: 1.35 },
  shotgun: { name: "gun_shotgun", range: 500, ref: 22, distRate: 0.8, distVol: 1.15 },
};
const SUPPRESSED_RANGE = 120;

const IMPACTS = {
  dirt: "impact_dirt",
  concrete: "impact_concrete",
  metal: "impact_metal",
  wood: "impact_wood",
  flesh: "impact_flesh",
  water: "impact_water",
  glass: "impact_glass",
};
const STEPS = {
  grass: "step_grass",
  hard: "step_hard",
  wood: "step_wood",
  water: "step_water",
  sand: "step_sand",
};
const UI_SOUNDS = {
  click: "click",
  hover: "hover",
  pickup: "pickup",
  equip: "equip",
  open: "inventory_open",
  close: "inventory_close",
  alert: "alert",
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x, d) => (isNum(x) ? x : d);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Air absorption for generic spatial one-shots: cut-off falls with distance (≥ 16 kHz = no filter). */
const airLowpass = (d) => (d < 60 ? 20000 : clamp(18000 * Math.pow(60 / d, 1.2), 900, 18000));

/** Heavier absorption used for gunshots: ~4 kHz at 150 m, ~1.1 kHz at 500 m, 750 Hz floor. */
const gunLowpass = (d) => (d < 45 ? 20000 : clamp(14000 * Math.pow(50 / d, 1.1), 750, 16000));

/** Resolves on a later task so long synthesis does not block input / rendering in one piece. */
function nextTask() {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "function") {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });
}

function setPannerPos(p, x, y, z) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.genMs = 0;
    this.buffers = new Map();
    this.voices = [];
    this.lastVariant = new Map();
    this.master = null;
    this.sfx = null;
    this.reverbIn = null;
    this.convolver = null;
    this.listenerParams = null;
    this.pose = new Float64Array([0, 0, 0, 0, 0, -1, 0, 1, 0]); // position, forward, up
    this.lx = 0;
    this.ly = 0;
    this.lz = 0;
    this.masterVol = 1;
    this.sfxVol = 1;
    this.initPromise = null;
    this.warnings = 0;
  }

  warn(err) {
    if (this.warnings++ < 5) console.warn("[audio]", err);
  }

  /** True when one-shots can be scheduled (buffers built and the context actually running). */
  live() {
    return this.ready && this.ctx.state === "running";
  }

  init() {
    if (this.initPromise) {
      this.resume();
      return this.initPromise;
    }
    this.initPromise = this.boot().catch((err) => this.warn(err));
    return this.initPromise;
  }

  async boot() {
    const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : undefined;
    if (!AC) return;
    // Created synchronously inside the caller's user gesture so autoplay policies allow it.
    let ctx;
    try {
      ctx = new AC({ latencyHint: "interactive" });
    } catch {
      ctx = new AC();
    }
    this.ctx = ctx;
    this.resume();
    this.buildGraph(ctx);
    let work = 0;
    let t = performance.now();
    this.convolver.buffer = buildReverbIR(ctx, 2.2);
    let slice = performance.now();
    work += slice - t;
    for (const name of SOUND_NAMES) {
      t = performance.now();
      try {
        this.buffers.set(name, renderSound(ctx, name));
      } catch (err) {
        this.warn(err); // that one sound stays silent; everything else still works
      }
      const end = performance.now();
      work += end - t;
      if (end - slice > 16) {
        await nextTask();
        slice = performance.now();
      }
    }
    this.genMs = Math.round(work);
    this.ready = true;
  }

  buildGraph(ctx) {
    // Safety net against clipping when many loud sounds stack up.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = this.masterVol;
    master.connect(comp);
    const sfx = ctx.createGain();
    sfx.gain.value = this.sfxVol;
    sfx.connect(master);
    // Shared outdoor reverb: band-limited send → convolver → return into the sfx bus.
    const reverbIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;
    hp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6000;
    lp.Q.value = 0.6;
    const convolver = ctx.createConvolver();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.5;
    reverbIn.connect(hp);
    hp.connect(lp);
    lp.connect(convolver);
    convolver.connect(reverbOut);
    reverbOut.connect(sfx);
    this.master = master;
    this.sfx = sfx;
    this.reverbIn = reverbIn;
    this.convolver = convolver;
    const L = ctx.listener;
    this.listenerParams = L.positionX
      ? [L.positionX, L.positionY, L.positionZ, L.forwardX, L.forwardY, L.forwardZ, L.upX, L.upY, L.upZ]
      : null;
    this.applyListener();
  }

  resume() {
    const c = this.ctx;
    if (!c || c.state === "running" || c.state === "closed") return;
    try {
      const p = c.resume();
      if (p && p.catch) p.catch(() => {});
    } catch {
      // ignore: resume is retried on the next user gesture
    }
  }

  // --- Listener and volumes ---------------------------------------------------------------------

  setListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    if (!(isNum(px) && isNum(py) && isNum(pz) && isNum(fx) && isNum(fy) && isNum(fz))) return;
    if (!(isNum(ux) && isNum(uy) && isNum(uz))) return;
    const p = this.pose;
    p[0] = px;
    p[1] = py;
    p[2] = pz;
    // Keep the previous orientation when forward/up are zero or parallel (e.g. looking straight down
    // in freefall with world-up passed as "up"), which would leave the HRTF without a "right" axis.
    const cx = fy * uz - fz * uy;
    const cy = fz * ux - fx * uz;
    const cz = fx * uy - fy * ux;
    if (cx * cx + cy * cy + cz * cz > 1e-10) {
      p[3] = fx;
      p[4] = fy;
      p[5] = fz;
      p[6] = ux;
      p[7] = uy;
      p[8] = uz;
    }
    this.lx = px;
    this.ly = py;
    this.lz = pz;
    if (this.ctx) this.applyListener();
  }

  applyListener() {
    const p = this.pose;
    const lp = this.listenerParams;
    if (lp) {
      for (let i = 0; i < 9; i++) lp[i].value = p[i];
    } else {
      const L = this.ctx.listener;
      L.setPosition(p[0], p[1], p[2]);
      L.setOrientation(p[3], p[4], p[5], p[6], p[7], p[8]);
    }
  }

  setMasterVolume(v) {
    if (!isNum(v)) return;
    this.masterVol = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.02);
  }

  setSfxVolume(v) {
    if (!isNum(v)) return;
    this.sfxVol = clamp(v, 0, 1);
    if (this.sfx) this.sfx.gain.setTargetAtTime(this.sfxVol, this.ctx.currentTime, 0.02);
  }

  // --- Voices -----------------------------------------------------------------------------------

  /**
   * Starts one voice. opts: x,y,z (all finite → spatial), vol, rate, jitter (± rate variation),
   * delay, distanceDelay, lowpass (Hz; ≥ 16 kHz = none), refDistance, maxDistance, send (reverb).
   * Returns the voice, or null when it was skipped (out of range, inaudible, duplicate, no budget).
   */
  start(name, o, loop) {
    const bufs = this.buffers.get(name);
    const m = SOUND_DEFS[name];
    if (!bufs || !bufs.length || !m) return null;
    const ctx = this.ctx;
    const spatial = isNum(o.x) && isNum(o.y) && isNum(o.z);
    const x = spatial ? o.x : 0;
    const y = spatial ? o.y : 0;
    const z = spatial ? o.z : 0;
    let d = 0;
    if (spatial) {
      const dx = x - this.lx;
      const dy = y - this.ly;
      const dz = z - this.lz;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const maxD = o.maxDistance > 0 ? o.maxDistance : m.max;
    if (spatial && !loop && d > maxD) return null;
    const ref = o.refDistance > 0 ? o.refDistance : m.ref;
    const vol = clamp(num(o.vol, 1), 0, 4) * m.gain;
    const dg = spatial ? ref / (ref + m.roll * Math.max(0, d - ref)) : 1; // what the panner will apply
    const prio = vol * dg;
    if (!loop && prio < 1e-4) return null;
    const now = ctx.currentTime;
    const when = now + clamp(num(o.delay, 0), 0, 30) + (spatial && o.distanceDelay ? d / SPEED_OF_SOUND : 0);
    if (!loop && this.isDuplicate(name, when, x, y, z, spatial)) return null;
    if (!this.reserve(prio, now)) return null;

    const buf = this.pickVariant(name, bufs);
    const jitter = isNum(o.jitter) ? o.jitter : m.jitter;
    const rate = clamp(num(o.rate, 1) * (1 + (Math.random() * 2 - 1) * jitter), 0.05, 8);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.loop = loop;
    let head = src;
    let filter = null;
    const lp = isNum(o.lowpass) && o.lowpass > 0 ? o.lowpass : spatial && !loop ? airLowpass(d) : 20000;
    if (lp < 16000) {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.max(40, lp);
      filter.Q.value = 0.5;
      src.connect(filter);
      head = filter;
    }
    const gain = ctx.createGain();
    head.connect(gain);
    let panner = null;
    if (spatial) {
      panner = this.makePanner(x, y, z, ref, m.roll);
      gain.connect(panner);
      panner.connect(this.sfx);
    } else gain.connect(this.sfx);
    // Reverb is taken before the panner, so scale it by hand: it fades more slowly than the direct
    // sound, which makes far sounds progressively "wetter".
    let send = isNum(o.send) ? o.send : spatial ? m.send : m.send2d;
    if (spatial) send *= Math.sqrt(dg) * (1 + 0.8 * smooth(20, 400, d));
    let sendGain = null;
    if (send > 0.002) {
      sendGain = ctx.createGain();
      sendGain.gain.value = Math.min(send, 1.5);
      gain.connect(sendGain);
      sendGain.connect(this.reverbIn);
    }
    if (loop) {
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(vol, now, 0.03); // short fade-in
      src.start(now, Math.random() * buf.duration);
    } else {
      gain.gain.value = vol;
      src.start(when);
    }
    const v = {
      name,
      src,
      gain,
      panner,
      filter,
      sendGain,
      loop,
      spatial,
      x,
      y,
      z,
      ref,
      prio,
      rate,
      vol,
      base: m.gain,
      roll: m.roll,
      t0: when,
      dur: buf.duration / rate,
      dead: false,
    };
    src.onended = () => this.release(v);
    this.voices.push(v);
    return v;
  }

  makePanner(x, y, z, ref, roll) {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 100000; // audibility is handled by the engine; never clamp the curve
    setPannerPos(p, x, y, z);
    return p;
  }

  pickVariant(name, bufs) {
    const n = bufs.length;
    if (n === 1) return bufs[0];
    const last = this.lastVariant.get(name);
    let i = Math.floor(Math.random() * (last === undefined ? n : n - 1));
    if (last !== undefined && i >= last) i++; // never the same variant twice in a row
    this.lastVariant.set(name, i);
    return bufs[i];
  }

  /** Same sound starting within 30 ms at (almost) the same spot, e.g. shotgun pellets on one wall. */
  isDuplicate(name, when, x, y, z, spatial) {
    const vs = this.voices;
    for (let i = vs.length - 1; i >= 0; i--) {
      const v = vs[i];
      if (v.name !== name || v.loop || v.spatial !== spatial || Math.abs(v.t0 - when) > 0.03) continue;
      if (!spatial) return true;
      const dx = v.x - x;
      const dy = v.y - y;
      const dz = v.z - z;
      if (dx * dx + dy * dy + dz * dz < 2.25) return true;
    }
    return false;
  }

  /**
   * Voice budget: when full, steal the quietest one-shot (its level estimate decays with age) if the
   * new sound is louder than it; otherwise skip the new sound. Loops are never stolen.
   */
  reserve(prio, now) {
    const vs = this.voices;
    if (vs.length < MAX_VOICES) return true;
    let worst = null;
    let wp = Infinity;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.loop) continue;
      const age = now - v.t0;
      const p = age > 0 ? v.prio * Math.exp((-5 * age) / v.dur) : v.prio;
      if (p < wp) {
        wp = p;
        worst = v;
      }
    }
    if (!worst || wp >= prio) return false;
    this.kill(worst, 0.03);
    return true;
  }

  /** Fades a voice out and stops it; it leaves the voice list immediately. */
  kill(v, fade) {
    if (v.dead) return;
    v.dead = true;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      const t = this.ctx.currentTime;
      const g = v.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.02);
    } catch {
      this.release(v);
    }
  }

  /** Called when a source ends: drop it from the list and detach its nodes. */
  release(v) {
    if (!v.dead) {
      v.dead = true;
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    }
    try {
      v.src.onended = null;
      v.src.disconnect();
      v.gain.disconnect();
      if (v.filter) v.filter.disconnect();
      if (v.panner) v.panner.disconnect();
      if (v.sendGain) v.sendGain.disconnect();
    } catch {
      // already disconnected
    }
  }

  /** Gives a 2D loop a panner the first time the game positions it. */
  attachPanner(v, x, y, z) {
    const p = this.makePanner(x, y, z, v.ref, v.roll);
    v.gain.disconnect(this.sfx);
    v.gain.connect(p);
    p.connect(this.sfx);
    v.panner = p;
    v.spatial = true;
  }

  loopHandle(v) {
    const eng = this;
    return {
      setPos(x, y, z) {
        if (v.dead || !isNum(x) || !isNum(y) || !isNum(z)) return;
        try {
          v.x = x;
          v.y = y;
          v.z = z;
          if (v.panner) setPannerPos(v.panner, x, y, z);
          else eng.attachPanner(v, x, y, z);
        } catch (err) {
          eng.warn(err);
        }
      },
      setRate(r) {
        if (v.dead || !isNum(r)) return;
        r = clamp(r, 0.05, 8);
        if (Math.abs(r - v.rate) < 1e-3) return;
        v.rate = r;
        try {
          v.src.playbackRate.setTargetAtTime(r, eng.ctx.currentTime, 0.03);
        } catch (err) {
          eng.warn(err);
        }
      },
      setVol(val) {
        if (v.dead || !isNum(val)) return;
        const g = clamp(val, 0, 4) * v.base;
        if (Math.abs(g - v.vol) < 1e-4) return;
        v.vol = g;
        try {
          v.gain.gain.setTargetAtTime(g, eng.ctx.currentTime, 0.04);
        } catch (err) {
          eng.warn(err);
        }
      },
      stop(fadeSec = 0.3) {
        if (!v.dead) eng.kill(v, clamp(num(fadeSec, 0.3), 0.005, 10));
      },
    };
  }

  // --- Public API ---------------------------------------------------------------------------------

  play(name, opts) {
    try {
      if (this.live()) this.start(name, opts || EMPTY, false);
    } catch (err) {
      this.warn(err);
    }
  }

  loop(name, opts) {
    try {
      // Loops may be created while the context is still suspended: they start sounding on resume().
      if (!this.ready || this.ctx.state === "closed") return NOOP_LOOP;
      const v = this.start(name, opts || EMPTY, true);
      return v ? this.loopHandle(v) : NOOP_LOOP;
    } catch (err) {
      this.warn(err);
      return NOOP_LOOP;
    }
  }

  gunshot(kind, x, y, z, opts) {
    try {
      if (!this.live()) return;
      const suppressed = !!(opts && opts.suppressed);
      const g = GUNS[kind] || GUNS.ar;
      const name = suppressed ? "gun_suppressed" : g.name;
      if ((opts && opts.local) || !(isNum(x) && isNum(y) && isNum(z))) {
        // The player's own weapon: non-spatial, full bandwidth, no delay.
        this.start(name, { vol: suppressed ? 0.85 : 1, jitter: 0.03 }, false);
        return;
      }
      const dx = x - this.lx;
      const dy = y - this.ly;
      const dz = z - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = suppressed ? SUPPRESSED_RANGE : g.range;
      if (d > range) return;
      const lp = gunLowpass(d);
      const send = (suppressed ? 0.15 : 0.3) + 0.4 * smooth(30, 350, d);
      this.start(
        name,
        {
          x,
          y,
          z,
          vol: 1 - 0.5 * smooth(60, 450, d),
          lowpass: lp,
          distanceDelay: true,
          send,
          refDistance: suppressed ? 0 : g.ref,
          maxDistance: range,
        },
        false,
      );
      if (!suppressed && d > 40) {
        // Distant rumble layer takes over as the crack is absorbed.
        this.start(
          "gun_distant",
          {
            x,
            y,
            z,
            vol: smooth(40, 260, d) * g.distVol,
            rate: g.distRate,
            jitter: 0.05,
            distanceDelay: true,
            lowpass: clamp(lp * 1.4, 600, 4000),
            send: send * 1.3,
            refDistance: g.ref,
            maxDistance: range + 50,
          },
          false,
        );
      }
    } catch (err) {
      this.warn(err);
    }
  }

  impact(mat, x, y, z) {
    try {
      if (this.live()) this.start(IMPACTS[mat] || "impact_dirt", { x, y, z, distanceDelay: true }, false);
    } catch (err) {
      this.warn(err);
    }
  }

  whiz(x, y, z) {
    try {
      if (this.live()) this.start("whiz", { x, y, z }, false);
    } catch (err) {
      this.warn(err);
    }
  }

  footstep(surface, x, y, z, vol = 1) {
    try {
      if (this.live()) this.start(STEPS[surface] || "step_hard", { x, y, z, vol }, false);
    } catch (err) {
      this.warn(err);
    }
  }

  explosion(x, y, z) {
    try {
      if (!this.live()) return;
      if (!(isNum(x) && isNum(y) && isNum(z))) {
        this.start("explosion", EMPTY, false);
        return;
      }
      const dx = x - this.lx;
      const dy = y - this.ly;
      const dz = z - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 1500) return;
      const lp = d < 60 ? 20000 : clamp(16000 * Math.pow(60 / d, 1.1), 450, 16000);
      this.start(
        "explosion",
        { x, y, z, distanceDelay: true, lowpass: lp, send: 0.5 + 0.5 * smooth(40, 500, d) },
        false,
      );
      if (d > 120) {
        this.start(
          "gun_distant",
          {
            x,
            y,
            z,
            vol: 0.9 * smooth(120, 500, d),
            rate: 0.6,
            jitter: 0.05,
            distanceDelay: true,
            lowpass: 500,
            send: 1,
            refDistance: 35,
            maxDistance: 1600,
          },
          false,
        );
      }
    } catch (err) {
      this.warn(err);
    }
  }

  ui(name) {
    try {
      if (!this.live()) return;
      const n = UI_SOUNDS[name] || (SOUND_DEFS[name] ? name : null);
      if (n) this.start(n, EMPTY, false);
    } catch (err) {
      this.warn(err);
    }
  }
}

const engine = new AudioEngine();

/** Public audio API (bound functions, so methods can be passed around as callbacks). */
export const audio = {
  init: () => engine.init(),
  get ready() {
    return engine.ready;
  },
  /** Debug info: synthesis time of all buffers (ms) and the number of active voices. */
  get genMs() {
    return engine.genMs;
  },
  get activeVoices() {
    return engine.voices.length;
  },
  resume: () => engine.resume(),
  setListener: (px, py, pz, fx, fy, fz, ux, uy, uz) => engine.setListener(px, py, pz, fx, fy, fz, ux, uy, uz),
  setMasterVolume: (v) => engine.setMasterVolume(v),
  setSfxVolume: (v) => engine.setSfxVolume(v),
  play: (name, opts) => engine.play(name, opts),
  loop: (name, opts) => engine.loop(name, opts),
  gunshot: (kind, x, y, z, opts) => engine.gunshot(kind, x, y, z, opts),
  impact: (mat, x, y, z) => engine.impact(mat, x, y, z),
  whiz: (x, y, z) => engine.whiz(x, y, z),
  footstep: (surface, x, y, z, vol) => engine.footstep(surface, x, y, z, vol),
  explosion: (x, y, z) => engine.explosion(x, y, z),
  ui: (name) => engine.ui(name),
};

export default audio;
