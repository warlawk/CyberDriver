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
  private skid?: Howl;
  private rain?: Howl;
  private ambience?: Howl;
  private radios: Howl[] = [];
  ready = false;
  radioOn = false;
  radioIdx = 0;
  private rainTarget = 0;

  /** must be called from a user gesture */
  unlock() {
    if (this.ready) return;
    this.ready = true;
    Howler.volume(0.85);

    // seamless periodic engine hum (40Hz base, integer cycles in 0.25s)
    const eng = new Buf(0.25);
    for (let h = 1; h <= 6; h++) {
      const cycles = 10 * h;
      const w = (2 * Math.PI * cycles) / eng.data.length;
      for (let i = 0; i < eng.data.length; i++)
        eng.data[i] += (Math.sin(i * w) * 0.5 + Math.sin(i * w * 2.02) * 0.18) / h;
    }
    const sub = new Buf(0.25);
    for (let i = 0; i < sub.data.length; i++)
      sub.data[i] = eng.data[i] * (0.8 + 0.2 * Math.sin((i / sub.data.length) * Math.PI * 10));

    this.engine = new Howl({ src: [sub.uri()], loop: true, volume: 0 });
    this.engine.play();

    const sk = new Buf(0.4).noise(0, 0.4, 0.5, 0, 0.25).fadeLoop(25);
    this.skid = new Howl({ src: [sk.uri()], loop: true, volume: 0 });
    this.skid.play();

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
        volume: 0.4,
      }),
      new Howl({
        src: [musicLoop(88, 8, [45, 45, 0, 43, 41, 0, 43, 40], [69, 72, 76, 72, 69, 76, 72, 69])],
        loop: true,
        volume: 0.4,
      }),
    ];

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
    this.engine.fade(this.engine.volume(), on ? 0.3 : 0, 500);
  }

  setEngine(speedNorm: number, throttle: number) {
    if (!this.ready || !this.engine) return;
    this.engine.rate(0.72 + speedNorm * 0.95 + throttle * 0.15);
    this.engine.volume(0.16 + speedNorm * 0.26 + throttle * 0.05);
  }

  setSkid(v: number) {
    if (!this.ready || !this.skid) return;
    this.skid.volume(Math.min(0.5, v));
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

  nextStation(): string {
    if (!this.ready) return RADIO_STATIONS[0];
    this.radios[this.radioIdx].stop();
    this.radioIdx = (this.radioIdx + 1) % this.radios.length;
    if (this.radioOn) this.radios[this.radioIdx].play();
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
