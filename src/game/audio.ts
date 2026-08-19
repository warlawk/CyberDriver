import { Howl, Howler } from "howler";

/* ------------------------------------------------------------------
   AudioManager — all sounds are synthesized into WAV data-URIs at
   runtime (no external audio files) and played through Howler.
------------------------------------------------------------------- */

const SR = 22050;

function encodeWav(samples: Float32Array): string {
  const bytes = 44 + samples.length * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const wstr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i += 8192) {
    bin += String.fromCharCode.apply(
      null,
      u8.subarray(i, Math.min(i + 8192, u8.length)) as unknown as number[]
    );
  }
  return "data:audio/wav;base64," + btoa(bin);
}

class Buf {
  data: Float32Array;
  constructor(dur: number) {
    this.data = new Float32Array(Math.ceil(dur * SR));
  }
  tone(
    t0: number,
    dur: number,
    f0: number,
    f1: number,
    vol: number,
    type: OscillatorType = "sine",
    decay = 0
  ) {
    const a = Math.floor(t0 * SR);
    const n = Math.min(Math.floor(dur * SR), this.data.length - a);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const f = f0 + (f1 - f0) * t;
      ph += (2 * Math.PI * f) / SR;
      let w = 0;
      switch (type) {
        case "square":
          w = Math.sign(Math.sin(ph)) * 0.5;
          break;
        case "sawtooth":
          w = (((ph % (2 * Math.PI)) / Math.PI) - 1) * 0.6;
          break;
        case "triangle":
          w = (Math.asin(Math.sin(ph)) / (Math.PI / 2)) * 0.7;
          break;
        default:
          w = Math.sin(ph);
      }
      const env = decay > 0 ? Math.exp((-decay * i) / SR) : 1 - t * 0.25;
      this.data[a + i] += w * vol * env;
    }
    return this;
  }
  noise(t0: number, dur: number, vol: number, decay = 0, lp = 0) {
    const a = Math.floor(t0 * SR);
    const n = Math.min(Math.floor(dur * SR), this.data.length - a);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let w = Math.random() * 2 - 1;
      if (lp > 0) {
        prev += (w - prev) * lp;
        w = prev;
      }
      const env = decay > 0 ? Math.exp((-decay * i) / SR) : 1;
      this.data[a + i] += w * vol * env;
    }
    return this;
  }
  /** raised-cos fades so loops don't click */
  fadeLoop(ms = 30) {
    const n = Math.floor((ms / 1000) * SR);
    for (let i = 0; i < n; i++) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
      this.data[i] *= g;
      this.data[this.data.length - 1 - i] *= g;
    }
    return this;
  }
  /**
   * Circular crossfade: blends the tail into the head and trims it, so
   * noise loops stay at full level across the loop point instead of
   * dipping to silence every repeat (what fadeLoop does at both edges).
   */
  crossfade(ms = 120) {
    const M = Math.min(Math.floor((ms / 1000) * SR), Math.floor(this.data.length / 3));
    for (let i = 0; i < M; i++) {
      const t = i / M;
      this.data[i] = this.data[i] * t + this.data[this.data.length - M + i] * (1 - t);
    }
    this.data = this.data.slice(0, this.data.length - M);
    return this;
  }
  uri() {
    return encodeWav(this.data);
  }
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------------
   Radio station synth. Every event is written with wrap-around
   (sample index mod N), the buffer is exactly `beats` long, and all
   envelopes are pure exponential decays — so the loop point is
   mathematically seamless: a note that crosses the bar line simply
   continues at the start of the next repetition, like real audio.
------------------------------------------------------------------- */
interface RadioConfig {
  bpm: number;
  beats: number;
  bass?: number[]; // one MIDI note per beat (0 = rest)
  bassEighths?: number[]; // optional 8th-note bassline (2 per beat)
  arp?: number[]; // cycled 16th-note arpeggio
  arpWave?: OscillatorType;
  arpVol?: number;
  pad?: { beat: number; midis: number[]; durBeats: number }[];
  snareBeats?: number[];
  hats?: "8th" | "16th";
}

function radioTrack(cfg: RadioConfig): string {
  const beat = 60 / cfg.bpm;
  const N = Math.round(cfg.beats * beat * SR); // exact loop length
  const d = new Float32Array(N);
  const add = (i: number, v: number) => {
    d[((i % N) + N) % N] += v;
  };
  const at = (tSec: number) => Math.round(tSec * SR);

  const note = (
    t0s: number,
    durS: number,
    f0: number,
    f1: number,
    vol: number,
    wave: OscillatorType,
    decay: number,
    attMs = 4
  ) => {
    const a = at(t0s);
    const n = Math.max(4, at(durS));
    const att = Math.min(Math.floor((attMs / 1000) * SR), n >> 2);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      ph += (2 * Math.PI * (f0 + (f1 - f0) * t)) / SR;
      let w = 0;
      switch (wave) {
        case "square":
          w = Math.sign(Math.sin(ph)) * 0.5;
          break;
        case "sawtooth":
          w = (((ph % (2 * Math.PI)) / Math.PI) - 1) * 0.6;
          break;
        case "triangle":
          w = (Math.asin(Math.sin(ph)) / (Math.PI / 2)) * 0.7;
          break;
        default:
          w = Math.sin(ph);
      }
      const env = (i < att ? i / att : 1) * Math.exp((-decay * i) / SR);
      add(a + i, w * vol * env);
    }
  };

  const burst = (t0s: number, durS: number, vol: number, decay: number, mode: "low" | "high") => {
    const a = at(t0s);
    const n = Math.max(4, at(durS));
    let lp = 0;
    for (let i = 0; i < n; i++) {
      let w = Math.random() * 2 - 1;
      if (mode === "low") {
        lp += (w - lp) * 0.12;
        w = lp * 2.4;
      } else {
        lp += (w - lp) * 0.5;
        w = (w - lp) * 1.7;
      }
      add(a + i, w * vol * Math.exp((-decay * i) / SR));
    }
  };

  const kick = (t: number) => note(t, 0.16, 150, 42, 0.5, "sine", 13);
  const snare = (t: number, vol: number) => {
    note(t, 0.11, 196, 196, vol * 0.8, "triangle", 26);
    burst(t, 0.1, vol, 30, "high");
  };

  // drums — four on the floor unless stated otherwise
  for (let bI = 0; bI < cfg.beats; bI++) kick(bI * beat);
  for (const sb of cfg.snareBeats ?? []) snare(sb * beat, 0.2);
  if (cfg.hats === "8th") {
    for (let bI = 0; bI < cfg.beats; bI++) burst((bI + 0.5) * beat, 0.035, 0.09, 55, "high");
  } else if (cfg.hats === "16th") {
    const vols = [0.09, 0.045, 0.062, 0.045];
    for (let bI = 0; bI < cfg.beats; bI++)
      for (let s = 0; s < 4; s++) burst((bI + s / 4) * beat, 0.03, vols[s], 58, "high");
  }

  // bass
  if (cfg.bassEighths) {
    for (let s = 0; s < cfg.beats * 2; s++) {
      const m = cfg.bassEighths[s % cfg.bassEighths.length];
      if (m > 0) note((s * beat) / 2, beat * 0.44, midiHz(m), midiHz(m), 0.18, "square", 3.4);
    }
  } else if (cfg.bass) {
    for (let bI = 0; bI < cfg.beats; bI++) {
      const m = cfg.bass[bI % cfg.bass.length];
      if (m > 0) note(bI * beat, beat * 0.85, midiHz(m), midiHz(m), 0.2, "square", 2.2);
    }
  }

  // arpeggio (16ths)
  if (cfg.arp) {
    const wave = cfg.arpWave ?? "triangle";
    const vol = cfg.arpVol ?? 0.07;
    for (let s = 0; s < cfg.beats * 4; s++) {
      const m = cfg.arp[s % cfg.arp.length];
      if (m > 0) note((s * beat) / 4, 0.09, midiHz(m), midiHz(m), vol, wave, 8);
    }
  }

  // slow pads, slightly detuned
  for (const p of cfg.pad ?? []) {
    for (const m of p.midis) {
      for (const det of [0.996, 1.004]) {
        note(p.beat * beat, p.durBeats * beat, midiHz(m) * det, midiHz(m) * det, 0.042, "triangle", 0.85, 120);
      }
    }
  }

  for (let i = 0; i < N; i++) d[i] = Math.tanh(d[i] * 1.15) * 0.88;
  return encodeWav(d);
}

/* ------------------------------------------------------------------
   Loops: softer layered engine, speed-reactive road noise, and a
   two-layer tyre skid (low growl + high hiss, both "scrubbed" by an
   amplitude LFO so they read as rubber, not static).
------------------------------------------------------------------- */

function engineLoopUri(): string {
  const dur = 0.5;
  const b = new Buf(dur);
  const N = b.data.length;
  // harmonic motor stack — every frequency is an integer number of
  // cycles over the loop so it stays seamless at any playback rate
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let s = Math.sin(2 * Math.PI * 54 * t);
    s += 0.45 * Math.sin(2 * Math.PI * 108 * t + 0.6);
    s += 0.2 * Math.sin(2 * Math.PI * 162 * t);
    s += 0.09 * Math.sin(2 * Math.PI * 216 * t);
    s *= 0.72 + 0.28 * Math.sin(2 * Math.PI * 26 * t); // cylinder chug
    b.data[i] = s * 0.3;
  }
  // one-pole low-pass + gentle saturation: hum instead of buzz
  let prev = 0;
  for (let i = 0; i < N; i++) {
    prev += (b.data[i] - prev) * 0.12;
    b.data[i] = Math.tanh(prev * 1.5);
  }
  b.fadeLoop(15);
  return b.uri();
}

function roadLoopUri(): string {
  const b = new Buf(1.6).noise(0, 1.6, 0.5, 0, 0.05);
  b.crossfade(140);
  return b.uri();
}

function skidGroanUri(): string {
  const dur = 1.0;
  const b = new Buf(dur);
  const N = b.data.length;
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const f = 85 + 14 * Math.sin(2 * Math.PI * 3 * t); // wobbling tyre groan
    ph += (2 * Math.PI * f) / SR;
    lp += (Math.random() * 2 - 1 - lp) * 0.06; // low rubber rumble
    const scrub = 0.55 + 0.45 * Math.sin(2 * Math.PI * 7 * t + 1.3); // tread grab/release
    b.data[i] = Math.tanh((Math.sin(ph) * 0.55 + lp * 3.2) * scrub * 1.6) * 0.5;
  }
  b.fadeLoop(30);
  return b.uri();
}

function skidHissUri(): string {
  const dur = 1.0;
  const b = new Buf(dur);
  const N = b.data.length;
  let lpA = 0;
  let lpB = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const w = Math.random() * 2 - 1;
    lpA += (w - lpA) * 0.5;
    lpB += (w - lpB) * 0.1;
    const band = (lpA - lpB) * 1.4; // rough band-pass: rubber hiss
    const scrub = 0.45 + 0.55 * Math.sin(2 * Math.PI * 13 * t); // faster tread slap
    b.data[i] = Math.tanh(band * scrub * 1.8) * 0.42;
  }
  b.fadeLoop(30);
  return b.uri();
}

/* ------------------------------------------------------------------
   Tyre squeal — three debug-switchable flavors (cycle with G).
   All are continuous (no rectified gating), only slowly modulated.
------------------------------------------------------------------- */

/** A — LOW GRIND: dark detuned saws ~240/355 Hz, heavy LP + hard drive */
function skidSquealUriA(): string {
  const dur = 1.4;
  const b = new Buf(dur);
  const N = b.data.length;
  let ph1 = 0;
  let ph2 = 0;
  let nzF = 0;
  let lpS = 0;
  const TWO_PI = 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    nzF += (Math.random() * 2 - 1 - nzF) * 0.01;
    const smear = nzF * 55;
    const wobble = Math.sin(TWO_PI * 3.7 * t) * 18 + Math.sin(TWO_PI * 7.3 * t + 1) * 9;
    const f1 = 240 + wobble + smear;
    const f2 = 357 - wobble * 0.6 + smear * 1.2;
    ph1 += (TWO_PI * f1) / SR;
    ph2 += (TWO_PI * f2) / SR;
    const saw1 = (ph1 % TWO_PI) / Math.PI - 1;
    const saw2 = (ph2 % TWO_PI) / Math.PI - 1;
    lpS += (saw1 * 0.62 + saw2 * 0.5 - lpS) * 0.14; // strong LP: dark body
    const swell = 0.72 + 0.28 * Math.sin(TWO_PI * 2.3 * t + 0.4);
    b.data[i] = Math.tanh(lpS * swell * 3.6) * 0.5;
  }
  b.fadeLoop(40);
  return b.uri();
}

/** B — RUBBER MOAN: sine-led ~430 Hz with a slow smooth glissando */
function skidSquealUriB(): string {
  const dur = 1.8;
  const b = new Buf(dur);
  const N = b.data.length;
  let ph1 = 0;
  let ph2 = 0;
  const TWO_PI = 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    // one long lazy pitch bend — the "moan"
    const glide = 95 * Math.sin(TWO_PI * (1 / 1.8) * t) + 34 * Math.sin(TWO_PI * 1.6 * t + 0.8);
    const f1 = 430 + glide;
    const f2 = 646 + glide * 0.8;
    ph1 += (TWO_PI * f1) / SR;
    ph2 += (TWO_PI * f2) / SR;
    const s1 = Math.sin(ph1);
    const saw2 = ((ph2 % TWO_PI) / Math.PI - 1) * 0.35;
    const swell = 0.7 + 0.3 * Math.sin(TWO_PI * 2.7 * t + 1.1);
    b.data[i] = Math.tanh((s1 * 0.75 + saw2) * swell * 2.1) * 0.45;
  }
  b.fadeLoop(40);
  return b.uri();
}

/** C — GRAVEL SCRATCH: resonant band-pass noise scrape + quiet undertone */
function skidSquealUriC(): string {
  const dur = 1.3;
  const b = new Buf(dur);
  const N = b.data.length;
  let lpA = 0;
  let lpB = 0;
  let phU = 0;
  const TWO_PI = 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const w = Math.random() * 2 - 1;
    // band center wanders slowly between ~700 Hz and ~1500 Hz
    const aA = 0.34 + 0.22 * Math.sin(TWO_PI * 0.8 * t + 0.5);
    lpA += (w - lpA) * aA;
    lpB += (w - lpB) * 0.055;
    const band = (lpA - lpB) * 1.9;
    phU += (TWO_PI * (300 + 40 * Math.sin(TWO_PI * 1.1 * t))) / SR;
    const undertone = Math.sin(phU) * 0.18;
    const swell = 0.78 + 0.22 * Math.sin(TWO_PI * 5.4 * t);
    b.data[i] = Math.tanh((band * swell + undertone) * 2.3) * 0.46;
  }
  b.fadeLoop(40);
  return b.uri();
}

export const SQUEAL_LABELS = ["A · LOW GRIND", "B · RUBBER MOAN", "C · GRAVEL SCRATCH"];

export type SfxName =
  | "click"
  | "start"
  | "beep"
  | "go"
  | "horn"
  | "crashLight"
  | "crashHeavy"
  | "explode"
  | "pickup"
  | "deliver"
  | "fail"
  | "cash"
  | "chatter";

export const RADIO_STATIONS = ["NEON FM 88.1", "TURBO 112.5", "SYNTHWAVE 95.4"];

class AudioManager {
  private one: Partial<Record<SfxName, Howl>> = {};
  private engine?: Howl;
  private road?: Howl;
  private skidGroan?: Howl;
  private skidHiss?: Howl;
  private skidSqueals: Howl[] = [];
  squealMode = 0;
  private rain?: Howl;
  private ambience?: Howl;
  private radios: Howl[] = [];
  ready = false;
  radioOn = false;
  radioIdx = 0;
  private rainTarget = 0;
  private skidAmt = 0;

  /** must be called from a user gesture */
  unlock() {
    if (this.ready) return;
    this.ready = true;
    Howler.volume(0.85);

    this.engine = new Howl({ src: [engineLoopUri()], loop: true, volume: 0 });
    this.engine.play();

    this.road = new Howl({ src: [roadLoopUri()], loop: true, volume: 0 });
    this.road.play();

    this.skidGroan = new Howl({ src: [skidGroanUri()], loop: true, volume: 0 });
    this.skidGroan.play();
    this.skidHiss = new Howl({ src: [skidHissUri()], loop: true, volume: 0 });
    this.skidHiss.play();
    this.skidSqueals = [
      new Howl({ src: [skidSquealUriA()], loop: true, volume: 0 }),
      new Howl({ src: [skidSquealUriB()], loop: true, volume: 0 }),
      new Howl({ src: [skidSquealUriC()], loop: true, volume: 0 }),
    ];
    for (const s of this.skidSqueals) s.play();

    // rain: seamless via circular crossfade — no volume dip at the loop point
    const rn = new Buf(3.4).noise(0, 3.4, 0.4, 0, 0.12).crossfade(160);
    this.rain = new Howl({ src: [rn.uri()], loop: true, volume: 0 });
    this.rain.play();

    // city hum: 50/100 Hz are integer cycles over 3.2 s, so the tones are
    // periodic across the loop; the noise floor is crossfaded
    const amb = new Buf(3.2)
      .tone(0, 3.2, 50, 50, 0.05, "sine")
      .tone(0, 3.2, 100, 100, 0.03, "triangle")
      .noise(0, 3.2, 0.035, 0, 0.05)
      .crossfade(140);
    this.ambience = new Howl({ src: [amb.uri()], loop: true, volume: 0.5 });
    this.ambience.play();

    this.radios = [
      // driving synthwave — the city's default soundtrack
      new Howl({
        src: [
          radioTrack({
            bpm: 104,
            beats: 8,
            bass: [33, 0, 36, 33, 31, 0, 36, 38],
            arp: [57, 60, 64, 67, 64, 60, 67, 64],
            hats: "8th",
          }),
        ],
        loop: true,
        volume: 0.42,
      }),
      // punchy electro — 8th-note bass, 16th hats, claps
      new Howl({
        src: [
          radioTrack({
            bpm: 112,
            beats: 8,
            bassEighths: [36, 0, 36, 0, 39, 0, 36, 0, 36, 0, 36, 0, 34, 0, 31, 0],
            arp: [60, 63, 67, 70, 67, 63, 60, 63],
            arpWave: "square",
            arpVol: 0.042,
            snareBeats: [2, 6],
            hats: "16th",
          }),
        ],
        loop: true,
        volume: 0.42,
      }),
      // dreamy slow wave — pads over a soft pulse
      new Howl({
        src: [
          radioTrack({
            bpm: 88,
            beats: 8,
            bass: [45, 45, 0, 43, 41, 0, 43, 40],
            arp: [69, 72, 76, 72, 69, 76, 72, 69],
            hats: "8th",
            pad: [
              { beat: 0, midis: [57, 60, 64], durBeats: 4 },
              { beat: 4, midis: [53, 57, 60], durBeats: 4 },
            ],
          }),
        ],
        loop: true,
        volume: 0.42,
      }),
    ];
    // the city has a soundtrack from second one — the radio starts live
    this.radioOn = true;
    this.radios[this.radioIdx].play();

    const S: [SfxName, () => string][] = [
      ["click", () => new Buf(0.08).tone(0, 0.07, 950, 700, 0.16, "square", 30).uri()],
      ["start", () => new Buf(0.55).tone(0, 0.5, 180, 920, 0.25, "sawtooth", 1.2).noise(0.3, 0.2, 0.08, 8, 0.3).uri()],
      ["beep", () => new Buf(0.14).tone(0, 0.12, 880, 880, 0.28, "square", 6).uri()],
      ["go", () => new Buf(0.4).tone(0, 0.36, 1318, 1318, 0.3, "square", 3).tone(0, 0.36, 659, 659, 0.2, "square", 3).uri()],
      ["horn", () => new Buf(0.42).tone(0, 0.4, 392, 392, 0.16, "square").tone(0, 0.4, 466, 466, 0.16, "square").uri()],
      [
        "crashLight",
        () => new Buf(0.35).noise(0, 0.3, 0.4, 12, 0.35).tone(0, 0.25, 130, 45, 0.4, "sine", 9).uri(),
      ],
      [
        "crashHeavy",
        () => {
          const b = new Buf(0.8).noise(0, 0.7, 0.6, 5, 0.3).tone(0, 0.6, 95, 28, 0.6, "sine", 4).tone(0.02, 0.3, 240, 180, 0.15, "square", 10);
          for (let i = 0; i < b.data.length; i++) b.data[i] = Math.tanh(b.data[i] * 1.8);
          return b.uri();
        },
      ],
      [
        "explode",
        () => {
          const b = new Buf(1.4).noise(0, 1.3, 0.7, 2.4, 0.22).tone(0, 1.1, 75, 18, 0.65, "sine", 2.2);
          for (let k = 0; k < 90; k++) {
            const i = Math.floor(Math.random() * b.data.length * 0.6);
            b.data[i] += (Math.random() * 2 - 1) * 0.5;
          }
          for (let i = 0; i < b.data.length; i++) b.data[i] = Math.tanh(b.data[i] * 1.6);
          return b.uri();
        },
      ],
      ["pickup", () => new Buf(0.34).tone(0, 0.12, 660, 1320, 0.25, "sine", 4).tone(0.13, 0.18, 1760, 1760, 0.2, "triangle", 5).uri()],
      [
        "deliver",
        () => {
          const b = new Buf(0.85);
          [523, 659, 784, 1047].forEach((f, i) => b.tone(i * 0.1, 0.3, f, f, 0.22, "triangle", 4));
          b.noise(0.42, 0.3, 0.06, 6, 0.5);
          return b.uri();
        },
      ],
      ["fail", () => new Buf(0.5).tone(0, 0.45, 330, 160, 0.28, "sawtooth", 3).uri()],
      ["cash", () => new Buf(0.25).tone(0, 0.07, 1568, 1568, 0.2, "sine", 12).tone(0.06, 0.16, 2093, 2093, 0.18, "sine", 8).uri()],
      [
        "chatter",
        () => {
          const b = new Buf(0.3);
          for (let i = 0; i < 5; i++) b.tone(i * 0.055, 0.045, i % 2 ? 930 : 1240, i % 2 ? 930 : 1240, 0.1, "square", 20);
          return b.uri();
        },
      ],
    ];
    for (const [name, build] of S) {
      this.one[name] = new Howl({ src: [build()], volume: name === "explode" ? 0.9 : 0.6 });
    }
  }

  play(name: SfxName) {
    if (!this.ready) return;
    this.one[name]?.play();
  }

  setEngineActive(on: boolean) {
    if (!this.engine) return;
    this.engine.fade(this.engine.volume(), on ? 0.16 : 0, 500);
    this.road?.fade(this.road.volume(), on ? 0.1 : 0, 500);
  }

  setEngine(speedNorm: number, throttle: number) {
    if (!this.ready || !this.engine) return;
    this.engine.rate(0.7 + speedNorm * 0.9 + throttle * 0.14);
    // much gentler curve — the hum sits under the music now
    this.engine.volume(0.08 + speedNorm * 0.15 + throttle * 0.03);
    if (this.road) {
      this.road.rate(0.75 + speedNorm * 0.7);
      this.road.volume(speedNorm * speedNorm * 0.22);
    }
  }

  /** amount 0..1, speedNorm 0..1 — groan at low speed, hiss at high */
  setSkid(amount: number, speedNorm = 0) {
    if (!this.ready || !this.skidGroan || !this.skidHiss || this.skidSqueals.length === 0) return;
    this.skidAmt += (amount - this.skidAmt) * 0.25;
    const t = Date.now() / 1000;
    const jG = 0.88 + 0.12 * Math.sin(t * 19.7);
    const jH = 0.88 + 0.12 * Math.sin(t * 27.3 + 2);
    const jS = 0.82 + 0.18 * Math.sin(t * 34.1 + 4);
    this.skidGroan.rate(0.85 + speedNorm * 0.5);
    this.skidHiss.rate(0.9 + speedNorm * 0.7);
    this.skidGroan.volume(Math.min(0.42, this.skidAmt * (0.55 - 0.22 * speedNorm) * jG));
    this.skidHiss.volume(Math.min(0.4, this.skidAmt * (0.18 + 0.34 * speedNorm) * jH));
    // only the selected squeal flavor is audible
    for (let i = 0; i < this.skidSqueals.length; i++) {
      if (i === this.squealMode) {
        this.skidSqueals[i].rate(0.85 + speedNorm * 0.35);
        this.skidSqueals[i].volume(Math.min(0.26, this.skidAmt * (0.3 + 0.36 * speedNorm) * jS));
      } else {
        this.skidSqueals[i].volume(0);
      }
    }
  }

  /** debug: cycle through the three squeal flavors — returns the label */
  cycleSqueal(): string {
    this.squealMode = (this.squealMode + 1) % SQUEAL_LABELS.length;
    return SQUEAL_LABELS[this.squealMode];
  }

  setRain(on: boolean) {
    if (!this.ready || !this.rain) return;
    this.rainTarget = on ? 0.4 : 0;
    this.rain.fade(this.rain.volume(), this.rainTarget, 1500);
  }

  /** cycles NEON FM → TURBO → SYNTHWAVE → OFF → NEON FM…; returns station name or null when off */
  toggleRadio(): string | null {
    if (!this.ready) return null;
    this.radios[this.radioIdx].stop();
    if (this.radioOn) {
      // next slot; the slot after the last station is "off"
      this.radioIdx = (this.radioIdx + 1) % (this.radios.length + 1);
      if (this.radioIdx === this.radios.length) {
        this.radioOn = false;
        return null;
      }
    } else {
      this.radioIdx = this.radioIdx % this.radios.length;
      this.radioOn = true;
    }
    this.radios[this.radioIdx].play();
    return RADIO_STATIONS[this.radioIdx];
  }

  setMuted(m: boolean) {
    Howler.mute(m);
  }

  dispose() {
    Howler.stop();
    this.ready = false;
  }
}

export const audio = new AudioManager();
