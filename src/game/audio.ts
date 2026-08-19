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
  uri() {
    return encodeWav(this.data);
  }
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** tiny step-sequenced synth for the two radio stations */
function musicLoop(
  bpm: number,
  beats: number,
  bass: number[],
  arp: number[] | null
): string {
  const beat = 60 / bpm;
  const dur = beat * beats;
  const b = new Buf(dur + 0.1);
  for (let i = 0; i < beats; i++) {
    const t = i * beat;
    b.tone(t, 0.13, 150, 42, 0.5, "sine", 14); // kick
    b.noise(t + beat / 2, 0.04, 0.1, 60, 0.4); // hat
    const note = bass[i % bass.length];
    if (note > 0) b.tone(t, beat * 0.85, midiHz(note), midiHz(note), 0.22, "square", 2.2);
    if (arp) {
      for (let s = 0; s < 4; s++) {
        const an = arp[(i * 4 + s) % arp.length];
        b.tone(t + (s * beat) / 4, 0.09, midiHz(an), midiHz(an), 0.07, "triangle", 8);
      }
    }
  }
  b.fadeLoop(40);
  return b.uri();
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
  const b = new Buf(1.2).noise(0, 1.2, 0.5, 0, 0.05);
  b.fadeLoop(80);
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
   High tyre squeal: two detuned wavering sine voices around 2–2.6 kHz
   with fast pitch jitter, gated by an 18 Hz scrub LFO. Gives the skid
   its sharp top register instead of just a sweep.
------------------------------------------------------------------- */
function skidSquealUri(): string {
  const dur = 1.6;
  const b = new Buf(dur);
  const N = b.data.length;
  let ph1 = 0;
  let ph2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const f1 = 2100 + 340 * Math.sin(2 * Math.PI * 6.3 * t) + 170 * Math.sin(2 * Math.PI * 23.7 * t);
    const f2 = 2580 + 300 * Math.sin(2 * Math.PI * 7.1 * t + 1.3);
    ph1 += (2 * Math.PI * f1) / SR;
    ph2 += (2 * Math.PI * f2) / SR;
    const scrub = 0.55 + 0.45 * Math.sin(2 * Math.PI * 17.3 * t);
    b.data[i] = (Math.sin(ph1) * 0.6 + Math.sin(ph2) * 0.4) * 0.5 * scrub;
  }
  b.fadeLoop(40);
  return b.uri();
}

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

export const RADIO_STATIONS = ["NEON FM 88.1", "SYNTHWAVE 95.4"];

class AudioManager {
  private one: Partial<Record<SfxName, Howl>> = {};
  private engine?: Howl;
  private road?: Howl;
  private skidGroan?: Howl;
  private skidHiss?: Howl;
  private skidSqueal?: Howl;
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
    this.skidSqueal = new Howl({ src: [skidSquealUri()], loop: true, volume: 0 });
    this.skidSqueal.play();

    const rn = new Buf(2.6).noise(0, 2.6, 0.4, 0, 0.12).fadeLoop(60);
    this.rain = new Howl({ src: [rn.uri()], loop: true, volume: 0 });
    this.rain.play();

    const amb = new Buf(3.2)
      .tone(0, 3.2, 52, 52, 0.05, "sine")
      .tone(0, 3.2, 104.5, 104.5, 0.03, "triangle")
      .noise(0, 3.2, 0.035, 0, 0.05)
      .fadeLoop(80);
    this.ambience = new Howl({ src: [amb.uri()], loop: true, volume: 0.5 });
    this.ambience.play();

    this.radios = [
      new Howl({
        src: [musicLoop(104, 8, [33, 0, 36, 33, 31, 0, 36, 38], [57, 60, 64, 67, 64, 60, 67, 64])],
        loop: true,
        volume: 0.34,
      }),
      new Howl({
        src: [musicLoop(88, 8, [45, 45, 0, 43, 41, 0, 43, 40], [69, 72, 76, 72, 69, 76, 72, 69])],
        loop: true,
        volume: 0.34,
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
    if (!this.ready || !this.skidGroan || !this.skidHiss || !this.skidSqueal) return;
    this.skidAmt += (amount - this.skidAmt) * 0.25;
    const t = Date.now() / 1000;
    const jG = 0.88 + 0.12 * Math.sin(t * 19.7);
    const jH = 0.88 + 0.12 * Math.sin(t * 27.3 + 2);
    const jS = 0.82 + 0.18 * Math.sin(t * 34.1 + 4);
    this.skidGroan.rate(0.85 + speedNorm * 0.5);
    this.skidHiss.rate(0.9 + speedNorm * 0.7);
    this.skidSqueal.rate(0.9 + speedNorm * 0.45);
    this.skidGroan.volume(Math.min(0.42, this.skidAmt * (0.55 - 0.22 * speedNorm) * jG));
    this.skidHiss.volume(Math.min(0.4, this.skidAmt * (0.18 + 0.34 * speedNorm) * jH));
    this.skidSqueal.volume(Math.min(0.26, this.skidAmt * (0.3 + 0.4 * speedNorm) * jS));
  }

  setRain(on: boolean) {
    if (!this.ready || !this.rain) return;
    this.rainTarget = on ? 0.4 : 0;
    this.rain.fade(this.rain.volume(), this.rainTarget, 1500);
  }

  /** returns station name or null when off */
  toggleRadio(): string | null {
    if (!this.ready) return null;
    if (this.radioOn) {
      this.radios[this.radioIdx].stop();
      this.radioOn = false;
      return null;
    }
    this.radioOn = true;
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
