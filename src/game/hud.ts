import { Application, Container, Graphics, Text } from "pixi.js";
import type { HudSnapshot } from "./utils";
import { clamp, damp, fmtTime } from "./utils";

const CYAN = 0x26e6ff;
const MAGENTA = 0xff2e7e;
const YELLOW = 0xffe14d;
const RED = 0xff3355;
const GREEN = 0x38ff9e;
const PANEL = 0x070b18;

const DISPLAY = "Orbitron";
const BODY = "Rajdhani";

function panel(g: Graphics, x: number, y: number, w: number, h: number, cut = 12) {
  g.poly([x + cut, y, x + w, y, x + w, y + h - cut, x + w - cut, y + h, x, y + h, x, y + cut])
    .fill({ color: PANEL, alpha: 0.8 })
    .stroke({ color: CYAN, alpha: 0.32, width: 1 });
}

function setText(t: Text, s: string) {
  if (t.text !== s) t.text = s;
}

interface Notif {
  c: Container;
  age: number;
}

export class HUD {
  app: Application;
  private root = new Container();
  private w = 0;
  private h = 0;

  // money / integrity
  private moneyPanel = new Container();
  private moneyTxt: Text;
  private streakTxt: Text;
  private integG = new Graphics();
  private lastInteg = -1;

  // timer
  private timeTxt: Text;
  private timePanel = new Container();

  // minimap (rotating GPS style: player pinned center, forward = up)
  private mapSize = 214;
  private mapX = 0;
  private mapY = 18;
  private mapStatic = new Graphics();
  private mapDyn = new Graphics();
  private mapWorld = new Container(); // rotates with the player
  private mapClip = new Graphics(); // circular window
  private mapRim = new Graphics(); // fixed bezel, ticks, vignette
  private playerG = new Graphics(); // screen-fixed player dart (heading rotation)
  private mapContainer = new Container();
  private extent = 210;

  // mission
  private missionPanel = new Container();
  private phaseTxt: Text;
  private codeTxt: Text;
  private distTxt: Text;
  private chevron = new Graphics();
  private pkgG = new Graphics();
  private lastPkg = false;

  // speedometer
  private speedo = new Container();
  private speedoDyn = new Graphics();
  private needle = new Graphics();
  private kmhTxt: Text;
  private gearTxt: Text;
  private driftTxt: Text;

  // radio
  private radioPanel = new Container();
  private radioTxt: Text;
  private eqG = new Graphics();
  private eqBars = [0.3, 0.5, 0.7, 0.4, 0.6];

  // center pieces
  private notifContainer = new Container();
  private notifs: Notif[] = [];
  private countdownTxt: Text;
  private countdownScale = 1;
  private flashG = new Graphics();
  private flashAlpha = 0;
  private flashColor = 0xff0000;
  private lastFlashColor = -1;
  private hintTxt: Text;
  private t = 0;
  private shownMoney = 0;

  constructor() {
    this.app = new Application();

    this.moneyTxt = new Text({ text: "$0", style: { fontFamily: DISPLAY, fontSize: 30, fontWeight: "800", fill: YELLOW, letterSpacing: 1 } });
    this.streakTxt = new Text({ text: "", style: { fontFamily: BODY, fontSize: 17, fontWeight: "700", fill: CYAN, letterSpacing: 2 } });
    this.timeTxt = new Text({ text: "-:--", style: { fontFamily: DISPLAY, fontSize: 36, fontWeight: "800", fill: 0xeafcff, letterSpacing: 2 } });
    this.phaseTxt = new Text({ text: "PICKUP", style: { fontFamily: BODY, fontSize: 18, fontWeight: "700", fill: CYAN, letterSpacing: 4 } });
    this.codeTxt = new Text({ text: "SEC A-1", style: { fontFamily: DISPLAY, fontSize: 26, fontWeight: "800", fill: 0xeafcff, letterSpacing: 2 } });
    this.distTxt = new Text({ text: "0m", style: { fontFamily: BODY, fontSize: 20, fontWeight: "600", fill: 0x9fb8e8, letterSpacing: 2 } });
    this.kmhTxt = new Text({ text: "0", style: { fontFamily: DISPLAY, fontSize: 34, fontWeight: "800", fill: 0xeafcff } });
    this.gearTxt = new Text({ text: "D", style: { fontFamily: DISPLAY, fontSize: 16, fontWeight: "700", fill: CYAN } });
    this.driftTxt = new Text({ text: "DRIFT", style: { fontFamily: BODY, fontSize: 16, fontWeight: "700", fill: MAGENTA, letterSpacing: 3 } });
    this.radioTxt = new Text({ text: "RADIO OFF", style: { fontFamily: BODY, fontSize: 16, fontWeight: "700", fill: 0x7f95c8, letterSpacing: 2 } });
    this.countdownTxt = new Text({ text: "", style: { fontFamily: DISPLAY, fontSize: 130, fontWeight: "900", fill: CYAN, letterSpacing: 6 } });
    this.hintTxt = new Text({
      text: "SPACE DRIFT · H HORN · R RADIO · F DEBUG · P PAUSE",
      style: { fontFamily: BODY, fontSize: 14, fontWeight: "600", fill: 0x6f86b8, letterSpacing: 3 },
    });

    // rotating world content lives inside the masked, player-centered container
    this.mapWorld.addChild(this.mapStatic, this.mapDyn);
  }

  async init(container: HTMLElement) {
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      resizeTo: window,
    });
    this.app.canvas.style.pointerEvents = "none";
    container.appendChild(this.app.canvas);

    this.root.addChild(
      this.flashG,
      this.moneyPanel,
      this.timePanel,
      this.mapContainer,
      this.missionPanel,
      this.speedo,
      this.radioPanel,
      this.notifContainer,
      this.countdownTxt,
      this.hintTxt
    );
    this.app.stage.addChild(this.root);
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  private onResize = () => {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.layout();
  };

  private layout() {
    // money panel
    this.moneyPanel.removeChildren();
    const mg = new Graphics();
    panel(mg, 0, 0, 252, 108);
    const label = new Text({ text: "CREDITS", style: { fontFamily: BODY, fontSize: 13, fontWeight: "700", fill: 0x7f95c8, letterSpacing: 3 } });
    label.position.set(16, 10);
    this.moneyTxt.position.set(14, 26);
    this.streakTxt.position.set(16, 62);
    this.integG.clear();
    this.moneyPanel.addChild(mg, label, this.moneyTxt, this.streakTxt, this.integG);
    this.integG.position.set(16, 86);
    this.moneyPanel.position.set(18, 18);
    this.lastInteg = -1;
    this.redrawMap();

    // timer
    this.timePanel.removeChildren();
    const tg = new Graphics();
    panel(tg, 0, 0, 210, 96);
    const tlabel = new Text({ text: "DELIVERY TIME", style: { fontFamily: BODY, fontSize: 13, fontWeight: "700", fill: 0x7f95c8, letterSpacing: 3 } });
    tlabel.position.set(20, 12);
    this.timeTxt.position.set(105, 52);
    this.timeTxt.anchor.set(0.5);
    this.timePanel.addChild(tg, tlabel, this.timeTxt);
    this.timePanel.position.set(this.w / 2 - 105, 18);

    // minimap — circular rotating GPS
    this.mapX = this.w - this.mapSize - 18;
    this.mapContainer.removeChildren();
    const frame = new Graphics();
    panel(frame, 0, 0, this.mapSize, this.mapSize + 26);
    const mlabel = new Text({ text: "GPS · ROTATING", style: { fontFamily: BODY, fontSize: 13, fontWeight: "700", fill: 0x7f95c8, letterSpacing: 3 } });
    mlabel.position.set(14, this.mapSize + 4);

    const mcx = this.mapSize / 2;
    const mcy = this.mapSize / 2;
    const R = this.mapSize / 2 - 10;

    // circular window for the rotating world content
    this.mapClip.clear();
    this.mapClip.circle(mcx, mcy, R).fill({ color: 0xffffff, alpha: 0.001 });
    this.mapWorld.mask = this.mapClip;

    // fixed bezel: soft vignette so the rotating edge never looks raw
    const rim = this.mapRim;
    rim.clear();
    for (let i = 0; i < 7; i++) {
      rim.circle(mcx, mcy, R - 2 - i * 4).stroke({ color: 0x04060f, alpha: 0.05 + i * 0.06, width: 8 });
    }
    // compass ticks (fixed to the screen — north is always up)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const big = k % 3 === 0;
      const r1 = R - (big ? 11 : 6);
      rim.moveTo(mcx + Math.cos(a) * r1, mcy + Math.sin(a) * r1)
        .lineTo(mcx + Math.cos(a) * (R - 2), mcy + Math.sin(a) * (R - 2))
        .stroke({ color: 0x9fb8e8, alpha: big ? 0.75 : 0.35, width: big ? 2 : 1.2 });
    }
    rim.circle(mcx, mcy, R).stroke({ color: CYAN, alpha: 0.6, width: 2 });
    rim.circle(mcx, mcy, R + 4).stroke({ color: 0x182647, width: 2 });


    this.mapContainer.addChild(frame, this.mapClip, this.mapWorld, rim, this.playerG, mlabel);
    this.mapContainer.position.set(this.mapX, this.mapY);
    this.redrawMap();

    // mission panel
    this.missionPanel.removeChildren();
    const mpanel = new Graphics();
    panel(mpanel, 0, 0, 252, 128);
    const mlabel2 = new Text({ text: "CURRENT JOB", style: { fontFamily: BODY, fontSize: 13, fontWeight: "700", fill: 0x7f95c8, letterSpacing: 3 } });
    mlabel2.position.set(16, 10);
    this.phaseTxt.position.set(16, 30);
    this.codeTxt.position.set(16, 52);
    this.distTxt.position.set(16, 86);
    this.chevron.position.set(210, 66);
    this.pkgG.position.set(210, 102);
    this.missionPanel.addChild(mpanel, mlabel2, this.phaseTxt, this.codeTxt, this.distTxt, this.chevron, this.pkgG);
    this.missionPanel.position.set(18, 146);

    // speedo
    this.speedo.removeChildren();
    const sBg = new Graphics();
    const cx = 0;
    const cy = 0;
    const r = 88;
    sBg.circle(cx, cy, r + 12).fill({ color: PANEL, alpha: 0.8 }).stroke({ color: CYAN, alpha: 0.32, width: 1 });
    sBg.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25).stroke({ color: 0x182647, width: 9 });
    const nums: Text[] = [];
    for (let v = 0; v <= 180; v += 15) {
      const a = Math.PI * 0.75 + (v / 180) * Math.PI * 1.5;
      const big = v % 45 === 0;
      const r1 = r - (big ? 16 : 10);
      sBg.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
        .lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3))
        .stroke({ color: big ? 0x9fb8e8 : 0x41548a, width: big ? 2.4 : 1.4 });
      if (big) {
        const num = new Text({ text: String(v), style: { fontFamily: BODY, fontSize: 13, fontWeight: "700", fill: 0x7f95c8 } });
        num.anchor.set(0.5);
        num.position.set(cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
        nums.push(num);
      }
    }
    this.kmhTxt.anchor.set(0.5);
    this.kmhTxt.position.set(0, 26);
    const unit = new Text({ text: "KM/H", style: { fontFamily: BODY, fontSize: 12, fontWeight: "700", fill: 0x7f95c8, letterSpacing: 2 } });
    unit.anchor.set(0.5);
    unit.position.set(0, 50);
    this.gearTxt.position.set(-14, -34);
    this.driftTxt.anchor.set(0.5);
    this.driftTxt.position.set(0, -52);
    this.speedo.addChild(sBg, ...nums, this.speedoDyn, this.needle, this.kmhTxt, unit, this.gearTxt, this.driftTxt);
    this.speedo.position.set(this.w - 140, this.h - 148);

    // radio
    this.radioPanel.removeChildren();
    const rg = new Graphics();
    panel(rg, 0, 0, 232, 52, 8);
    const ricon = new Graphics();
    ricon.circle(20, 26, 7).stroke({ color: MAGENTA, width: 2 });
    ricon.circle(20, 26, 2).fill({ color: MAGENTA });
    this.radioTxt.position.set(38, 17);
    this.eqG.position.set(160, 12);
    this.radioPanel.addChild(rg, ricon, this.radioTxt, this.eqG);
    this.radioPanel.position.set(18, this.h - 74);

    // center pieces
    this.countdownTxt.anchor.set(0.5);
    this.countdownTxt.position.set(this.w / 2, this.h * 0.4);
    this.hintTxt.anchor.set(0.5, 1);
    this.hintTxt.position.set(this.w / 2, this.h - 16);

    this.flashG.clear();
    this.flashG.rect(0, 0, this.w, this.h).fill({ color: 0xffffff });
    this.flashG.alpha = this.flashAlpha;
  }

  setExtent(e: number) {
    this.extent = e;
    this.redrawMap();
  }

  private mapInfo: { blocks: number; pitch: number; lines: number[]; roadW: number } | null = null;

  private redrawMap() {
    const mi = this.mapInfo;
    if (!mi) {
      this.mapStatic.clear();
      return;
    }
    const g = this.mapStatic;
    g.clear();
    const scale = (this.mapSize - 20) / (this.extent * 2);
    const halfBlock = (mi.pitch - mi.roadW) / 2;
    for (let bx = 0; bx < mi.blocks; bx++) {
      for (let bz = 0; bz < mi.blocks; bz++) {
        const cxp = (bx - (mi.blocks - 1) / 2) * mi.pitch;
        const czp = (bz - (mi.blocks - 1) / 2) * mi.pitch;
        const x = this.mapPx(cxp - halfBlock);
        const y = this.mapPx(czp - halfBlock);
        g.rect(x, y, halfBlock * 2 * scale, halfBlock * 2 * scale).fill({ color: 0x111a33, alpha: 0.75 });
      }
    }
    // content now pans/rotates with the player at center, so every road is
    // drawn across the whole city (the circular window decides what's seen)
    const rw = Math.max(2.5, mi.roadW * scale);
    const edgeA = this.mapPx(mi.lines[0] - 20);
    const edgeB = this.mapPx(mi.lines[mi.lines.length - 1] + 20);
    for (const l of mi.lines) {
      const m = this.mapPx(l);
      g.moveTo(edgeA, m).lineTo(edgeB, m).stroke({ color: 0x2a3c6e, width: rw });
      g.moveTo(m, edgeA).lineTo(m, edgeB).stroke({ color: 0x2a3c6e, width: rw });
    }
  }

  private mapPx(v: number) {
    const pad = 10;
    const scale = (this.mapSize - pad * 2) / (this.extent * 2);
    return pad + (v + this.extent) * scale;
  }

  drawRoads(blocks: number, pitch: number, lines: number[], roadW: number) {
    this.mapInfo = { blocks, pitch, lines, roadW };
    this.redrawMap();
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }

  notify(text: string, color: number = CYAN) {
    if (this.notifs.length >= 4) {
      const old = this.notifs.shift();
      if (old) this.notifContainer.removeChild(old.c);
    }
    const c = new Container();
    const bg = new Graphics();
    const txt = new Text({
      text,
      style: { fontFamily: BODY, fontSize: 21, fontWeight: "700", fill: color, letterSpacing: 2 },
    });
    txt.anchor.set(0.5);
    const w = text.length * 11 + 44;
    panel(bg, -w / 2, -20, w, 40, 8);
    c.addChild(bg, txt);
    c.position.set(this.w / 2, 118);
    c.scale.set(1.2);
    this.notifContainer.addChild(c);
    this.notifs.push({ c, age: 0 });
  }

  flash(kind: "damage" | "pickup" | "deliver" | "explode") {
    if (kind === "damage") {
      this.flashColor = 0xff2244;
      this.flashAlpha = Math.max(this.flashAlpha, 0.32);
    } else if (kind === "pickup") {
      this.flashColor = CYAN;
      this.flashAlpha = Math.max(this.flashAlpha, 0.2);
    } else if (kind === "deliver") {
      this.flashColor = YELLOW;
      this.flashAlpha = Math.max(this.flashAlpha, 0.26);
    } else {
      this.flashColor = 0xff7733;
      this.flashAlpha = 0.7;
    }
  }

  setCountdown(v: string | null) {
    if (v === null) {
      setText(this.countdownTxt, "");
      return;
    }
    if (this.countdownTxt.text !== v) {
      this.countdownTxt.text = v;
      this.countdownTxt.style.fill = v === "GO!" ? YELLOW : CYAN;
      this.countdownScale = 1.7;
    }
  }

  update(s: HudSnapshot, dt: number) {
    this.t += dt;

    // money
    this.shownMoney = damp(this.shownMoney, s.money, 6, dt);
    if (Math.abs(this.shownMoney - s.money) < 1) this.shownMoney = s.money;
    setText(this.moneyTxt, "$" + Math.round(this.shownMoney).toLocaleString("en-US"));
    setText(this.streakTxt, s.streak > 1 ? `STREAK ×${s.mult.toFixed(2)} · ${s.streak - 1} CLEAN` : "NO CRASH BONUS YET");
    this.streakTxt.style.fill = s.streak > 1 ? CYAN : 0x54688f;

    // integrity segments
    const seg = Math.round((s.integrity / 100) * 12);
    if (seg !== this.lastInteg) {
      this.lastInteg = seg;
      const g = this.integG;
      g.clear();
      const col = s.integrity > 55 ? CYAN : s.integrity > 28 ? YELLOW : RED;
      for (let i = 0; i < 12; i++) {
        g.rect(i * 18, 0, 14, 9).fill({ color: i < seg ? col : 0x1a2440, alpha: i < seg ? 0.95 : 1 });
      }
    }

    // timer
    setText(this.timeTxt, s.visible ? fmtTime(s.timeLeft) : "-:--");
    const low = s.visible && s.timeLeft < 10;
    this.timeTxt.style.fill = low ? RED : 0xeafcff;
    const pulse = low ? 1 + Math.sin(this.t * 12) * 0.06 : 1;
    this.timeTxt.scale.set(pulse);

    // mission
    const isPickup = s.phase === "pickup";
    setText(this.phaseTxt, isPickup ? "PICKUP PACKAGE" : "DELIVER PACKAGE");
    this.phaseTxt.style.fill = isPickup ? CYAN : GREEN;
    setText(this.codeTxt, "SEC " + s.code);
    const last = s.route.length ? s.route[s.route.length - 1] : null;
    if (last) {
      const d = Math.hypot(last.x - s.px, last.z - s.pz);
      setText(this.distTxt, `${Math.max(0, Math.round(d))} m`);
      const bearing = Math.atan2(last.x - s.px, last.z - s.pz);
      this.chevron.rotation = -bearing + Math.PI;
    }
    this.chevron.clear();
    this.chevron.poly([0, -16, 13, 10, 0, 2, -13, 10]).fill({ color: isPickup ? CYAN : GREEN, alpha: 0.95 });
    if (s.hasPackage !== this.lastPkg) {
      this.lastPkg = s.hasPackage;
      this.pkgG.clear();
      if (s.hasPackage) {
        this.pkgG.rect(-9, -9, 18, 18).fill({ color: 0xd8a94e }).stroke({ color: YELLOW, width: 2 });
        this.pkgG.moveTo(0, -9).lineTo(0, 9).stroke({ color: 0x8a6420, width: 3 });
      } else {
        this.pkgG.rect(-9, -9, 18, 18).stroke({ color: 0x3a4a75, width: 2 });
      }
    }

    // minimap: pin the player to the circle center, rotate the world so the
    // van's forward direction always points up (GPS style)
    this.mapWorld.pivot.set(this.mapPx(s.px), this.mapPx(s.pz));
    this.mapWorld.position.set(this.mapSize / 2, this.mapSize / 2);
    this.mapWorld.rotation = s.heading + Math.PI;

    const md = this.mapDyn;
    md.clear();
    if (s.route.length > 1) {
      md.moveTo(this.mapPx(s.route[0].x), this.mapPx(s.route[0].z));
      for (let i = 1; i < s.route.length; i++) md.lineTo(this.mapPx(s.route[i].x), this.mapPx(s.route[i].z));
      md.stroke({ color: YELLOW, width: 2.4, alpha: 0.9 });
    }
    for (const c of s.traffic) {
      md.circle(this.mapPx(c.x), this.mapPx(c.z), 2.1).fill({ color: MAGENTA, alpha: 0.75 });
    }
    if (last) {
      const tx = this.mapPx(last.x);
      const tz = this.mapPx(last.z);
      const pr = 6 + Math.sin(this.t * 5) * 2.4;
      md.circle(tx, tz, pr).stroke({ color: isPickup ? CYAN : GREEN, width: 2.4 });
      md.circle(tx, tz, 2.6).fill({ color: isPickup ? CYAN : GREEN });
    }
    // player marker: fixed at the circle center, always pointing straight up.
    // The world rotates around it as the player steers — classic GPS illusion.
    const pg = this.playerG;
    pg.clear();
    const mx = this.mapSize / 2;
    const my = this.mapSize / 2;
    pg.circle(mx, my, 10).stroke({ color: CYAN, alpha: 0.45, width: 1.4 });
    pg.poly([mx, my - 9, mx + 6.5, my + 7, mx, my + 3.5, mx - 6.5, my + 7]).fill({ color: 0xeafcff });

    // speedo
    const kmh = clamp(s.speedKmh, 0, 180);
    setText(this.kmhTxt, String(Math.round(kmh)));
    setText(this.gearTxt, s.reversing ? "R" : "D");
    this.gearTxt.style.fill = s.reversing ? MAGENTA : CYAN;
    this.driftTxt.alpha = s.drifting ? 0.5 + Math.sin(this.t * 16) * 0.5 : 0;
    const sd = this.speedoDyn;
    sd.clear();
    const a0 = Math.PI * 0.75;
    const sweep = (kmh / 180) * Math.PI * 1.5;
    if (sweep > 0.02) {
      sd.arc(0, 0, 88, a0, a0 + sweep).stroke({ color: kmh > 130 ? MAGENTA : CYAN, width: 9, alpha: 0.9 });
    }
    const na = a0 + sweep;
    this.needle.clear();
    this.needle.poly([Math.cos(na) * 66, Math.sin(na) * 66, Math.cos(na + 0.12) * 10, Math.sin(na + 0.12) * 10, Math.cos(na - 0.12) * 10, Math.sin(na - 0.12) * 10])
      .fill({ color: kmh > 130 ? MAGENTA : 0xeafcff });

    // radio
    setText(this.radioTxt, s.radio ?? "RADIO OFF · [R]");
    this.radioTxt.style.fill = s.radio ? 0x9ef3ff : 0x54688f;
    const eq = this.eqG;
    eq.clear();
    for (let i = 0; i < 5; i++) {
      const targetH = s.radio ? 0.25 + Math.abs(Math.sin(this.t * (6 + i * 1.7) + i * 2.2)) * 0.75 : 0.12;
      this.eqBars[i] = damp(this.eqBars[i], targetH, 10, dt);
      const bh = this.eqBars[i] * 26;
      eq.rect(i * 12, 28 - bh, 8, bh).fill({ color: s.radio ? MAGENTA : 0x2a3a62, alpha: 0.9 });
    }

    // notifications
    for (let i = this.notifs.length - 1; i >= 0; i--) {
      const n = this.notifs[i];
      n.age += dt;
      const targetY = 132 + (this.notifs.length - 1 - i) * 46;
      n.c.position.y = damp(n.c.position.y, targetY, 10, dt);
      n.c.position.x = this.w / 2;
      n.c.scale.set(damp(n.c.scale.x, 1, 12, dt));
      n.c.alpha = n.age > 2.3 ? Math.max(0, 1 - (n.age - 2.3) / 0.5) : 1;
      if (n.age > 2.8) {
        this.notifContainer.removeChild(n.c);
        this.notifs.splice(i, 1);
      }
    }

    // countdown pop
    this.countdownScale = damp(this.countdownScale, 1, 8, dt);
    this.countdownTxt.scale.set(this.countdownScale);

    // flash decay
    this.flashAlpha *= Math.exp(-4.2 * dt);
    this.flashG.alpha = this.flashAlpha;
    if (this.lastFlashColor !== this.flashColor) {
      this.lastFlashColor = this.flashColor;
      this.flashG.clear();
      this.flashG.rect(0, 0, this.w, this.h).fill({ color: this.flashColor });
    }
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.app.destroy(true);
  }
}
