import * as THREE from "three";
import { Howler } from "howler";
import { World } from "./world";
import { generateCity, HALF_ROAD } from "./city";
import type { CityData } from "./utils";
import { TrafficSystem } from "./traffic";
import { PlayerVehicle } from "./player";
import { Effects } from "./effects";
import { DeliverySystem } from "./delivery";
import { HUD } from "./hud";
import { AssetManager } from "./assets";
import { audio } from "./audio";
import { ObjectiveMarker } from "./marker";
import { setAtmosphere } from "./particles";
import type { GamePhase, HudSnapshot, RunStats } from "./utils";
import { clamp, damp } from "./utils";

function disposeDeep(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        for (const key of ["map", "emissiveMap", "alphaMap"] as const) {
          const t = (m as unknown as Record<string, THREE.Texture | null>)[key];
          if (t && t.dispose) t.dispose();
        }
        m.dispose();
      }
    }
  });
}

export interface GameHooks {
  onPhase: (phase: GamePhase, stats: RunStats) => void;
  onDebugToggle: (on: boolean) => void;
  onDebug: (lines: string[]) => void;
}

// Expose audio manager for debug access
export function getAudioManager() {
  return audio;
}

const TOP_KMH = 165;

export class Game {
  phase: GamePhase = "title";

  private world!: World;
  private hud = new HUD();
  private city!: CityData;
  private traffic!: TrafficSystem;
  private player!: PlayerVehicle;
  private effects!: Effects;
  private delivery!: DeliverySystem;
  private assets = new AssetManager();
  private extraAnimators: ((t: number, dt: number) => void)[] = [];
  private holoGroup: THREE.Group | null = null;
  private marker!: ObjectiveMarker;

  private keys = new Set<string>();
  private seed = Math.floor(Math.random() * 1e9);
  private money = 0;
  private streak = 1;
  private bestStreak = 0;
  private deliveries = 0;
  private maxIntegrity = 130;
  private integrity = 130;
  private runTime = 0;
  private countdownT = 0;
  private wreckTimer = -1;
  private raining = false;
  private radioName: string | null = null;
  private debugOn = false;
  private debugFrame = 0;
  private fps = 60;
  private t = 0;
  private raf = 0;
  private clock = new THREE.Clock();
  private disposed = false;
  private shakeV = new THREE.Vector3();
  private smokeTimer = 0;
  private crashCool = 0;
  private hornCool = 0;
  private routeTimer = 0;
  private lastCountLabel = "";
  private hasPackage = false;

  private snap: HudSnapshot = {
    visible: false,
    speedKmh: 0,
    reversing: false,
    drifting: false,
    timeLeft: 0,
    timeTotal: 1,
    money: 0,
    streak: 1,
    mult: 1,
    integrity: 100,
    phase: "pickup",
    code: "A-1",
    distance: 0,
    route: [],
    px: 0,
    pz: 0,
    heading: 0,
    traffic: [],
    extent: 214,
    radio: null,
    hasPackage: false,
  };

  constructor(
    private container: HTMLElement,
    private hudEl: HTMLElement,
    private hooks: GameHooks
  ) {}

  async init() {
    this.world = new World(this.container);
    await this.hud.init(this.hudEl);
    this.marker = new ObjectiveMarker(this.world.scene);
    this.buildCity();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.loop();
  }

  private buildCity() {
    this.city = generateCity(this.seed);
    this.world.scene.add(this.city.group);
    this.traffic = new TrafficSystem(this.world.scene, this.city);
    this.player = new PlayerVehicle(this.world.scene);
    this.effects = new Effects(this.world.scene);
    this.delivery = new DeliverySystem(this.world.scene, this.city);
    this.hud.drawRoads(this.city.blocks, this.city.pitch, this.city.lines, this.city.roadW);
    // rotating GPS map: show a ~200 m window around the van so more of the route reads
    this.hud.setExtent(100);
    const spawn = this.city.lines[3];
    this.player.reset(spawn, spawn, Math.PI / 2);
    this.snap.route = [];

    const plaza = { x: 0, z: 0 };
    this.assets.loadHolo(this.world.scene, plaza.x, plaza.z).then((holo) => {
      if (this.disposed) return;
      this.extraAnimators.push(holo.update);
      this.holoGroup = holo.group;
    });
    void setAtmosphere("atmo-layer", "dust");
  }

  /* ---------------- run control ---------------- */

  startRun(newCity: boolean) {
    audio.unlock();
    if (newCity) {
      this.teardownCity();
      this.seed = Math.floor(Math.random() * 1e9);
      this.buildCity();
    }
    // stop any playing radio tracks first to prevent overlap on restart
    audio.stopAllRadios();
    this.radioName = null;
    audio.play("start");
    this.money = 0;
    this.streak = 1;
    this.bestStreak = 0;
    this.deliveries = 0;
    this.integrity = this.maxIntegrity;
    this.runTime = 0;
    this.hasPackage = false;
    this.wreckTimer = -1;
    this.player.setPackage(false);
    this.rollWeather(true);
    const spawn = this.city.lines[3];
    this.player.reset(spawn, spawn, Math.PI / 2);
    this.delivery.newMission(spawn, spawn);
    this.countdownT = 3.9;
    this.lastCountLabel = "";
    this.setPhase("countdown");
    audio.setEngineActive(true);
    audio.play("chatter");
    // start radio track 1 immediately on game start (before countdown)
    const am = getAudioManager();
    audio.startTrack(0, am.MUSIC_MAX * am.musicVol * am.masterVol);
    this.radioName = "track 1";
    this.hud.notify("DISPATCH: JOB #" + (this.delivery.mission?.id ?? 1), 0x26e6ff);
  }

  private teardownCity() {
    this.traffic.dispose(this.world.scene);
    this.delivery.dispose();
    this.player.dispose(this.world.scene);
    if (this.holoGroup) {
      this.world.scene.remove(this.holoGroup);
      this.holoGroup = null;
    }
    this.extraAnimators = [];
    this.effects.dispose(this.world.scene);
    disposeDeep(this.city.group);
    this.world.scene.remove(this.city.group);
  }

  private rollWeather(force = false) {
    const rain = Math.random() < 0.42;
    if (force || rain !== this.raining) {
      this.raining = rain;
      this.world.setWeather(rain);
      this.effects.rain.set(rain);
      audio.setRain(rain);
      void setAtmosphere("atmo-layer", rain ? "rain" : "dust");
      if (!force) this.hud.notify(rain ? "ACID RAIN INBOUND" : "SKIES CLEARING", 0x9fc4e8);
    }
  }

  pause() {
    if (this.phase !== "playing") return;
    // Don't mute audio - let music continue through pause menu
    this.setPhase("paused");
  }

  resume() {
    if (this.phase !== "paused") return;
    // No need to unmute since we didn't mute
    this.clock.getDelta();
    this.setPhase("playing");
  }

  private setPhase(p: GamePhase, cause = "") {
    this.phase = p;
    this.hooks.onPhase(p, this.currentStats(cause));
  }

  private currentStats(cause: string): RunStats {
    return {
      money: this.money,
      deliveries: this.deliveries,
      bestStreak: this.bestStreak,
      elapsed: this.runTime,
      cause,
    };
  }

  private gameOver(cause: string) {
    audio.setEngineActive(false);
    audio.setSkid(0);
    this.setPhase("gameover", cause);
  }

  /* ---------------- input ---------------- */

  private onResize = () => this.world.resize();

  private onKeyDown = (e: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);

    if (e.code === "KeyF") {
      this.debugOn = !this.debugOn;
      this.hooks.onDebugToggle(this.debugOn);
    }
    if (e.code === "KeyH" && this.phase === "playing" && this.hornCool <= 0) {
      audio.play("horn");
      this.hornCool = 0.6;
    }
    if (e.code === "KeyR" && (this.phase === "playing" || this.phase === "countdown")) {
      this.radioName = audio.toggleRadio();
      this.hud.notify(this.radioName ? "TUNED TO " + this.radioName : "RADIO OFF", 0xff2e7e);
    }
    if ((e.code === "KeyP" || e.code === "Escape") && (this.phase === "playing" || this.phase === "paused")) {
      if (this.phase === "playing") this.pause();
      else this.resume();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  /* ---------------- per-frame ---------------- */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.t += dt;
    if (rawDt > 0) this.fps = damp(this.fps, 1 / rawDt, 2.5, dt);

    switch (this.phase) {
      case "title":
      case "gameover":
        this.marker.show(false);
        this.world.updateOrbit(dt);
        this.traffic.update(dt, this.t, this.player.pos.x, this.player.pos.z, 0, 0);
        this.runAnimators(dt);
        this.effects.update(dt, this.player.pos.x, this.player.pos.z);
        this.snap.visible = false;
        this.hud.setVisible(false);
        this.hud.update(this.snap, dt);
        break;

      case "countdown": {
        this.countdownT -= dt;
        const label =
          this.countdownT > 2.9 ? "3" : this.countdownT > 1.9 ? "2" : this.countdownT > 0.9 ? "1" : "GO!";
        if (label !== this.lastCountLabel) {
          this.lastCountLabel = label;
          this.hud.setCountdown(label);
          audio.play(label === "GO!" ? "go" : "beep");
        }
        this.traffic.update(dt, this.t, this.player.pos.x, this.player.pos.z, 0, 0);
        this.player.update(dt, { throttle: 0, steer: 0, handbrake: false }, false);
        this.runAnimators(dt);
        this.delivery.update(dt, this.t);
        this.effects.update(dt, this.player.pos.x, this.player.pos.z);
        if (this.delivery.mission) {
          const mt = this.delivery.mission.target;
          this.marker.show(true);
          this.marker.update(dt, this.player.pos.x, this.player.pos.z, mt.x, mt.z, this.delivery.mission.phase, this.t);
        }
        this.world.updateChase(dt, this.player.pos.x, this.player.pos.z, this.player.heading, 0, this.shakeV.set(0, 0, 0));
        this.updateSnap(0, false, false);
        this.hud.setVisible(true);
        this.hud.update(this.snap, dt);
        if (this.countdownT <= -0.55) {
          this.hud.setCountdown(null);
          // radio already started in startRun(), just transition to playing
          this.setPhase("playing");
        }
        break;
      }

      case "playing":
        this.updatePlaying(dt);
        break;

      case "paused":
        break;
    }

    this.world.render(dt);

    if (this.debugOn && ++this.debugFrame % 6 === 0) {
      const am = getAudioManager();
      const currentRadio = am.radios[am.radioIdx];
      const radioVol = currentRadio ? currentRadio.volume() : -1;
      this.hooks.onDebug([
        `FPS       ${this.fps.toFixed(0)}`,
        `SPEED     ${this.snap.speedKmh.toFixed(0)} km/h`,
        `MISSION   #${this.delivery.mission?.id ?? 0} ${this.delivery.mission?.phase.toUpperCase() ?? "-"} → SEC ${this.delivery.mission?.code ?? "-"}`,
        `TRAFFIC   ${this.traffic.dots().length} vehicles`,
        `CITY SEED ${this.seed}`,
        `GLTF      ${this.assets.loadedGltf} loaded`,
        `DRAWCALLS ${this.world.renderer.info.render.calls}`,
        `INTEGRITY ${Math.max(0, Math.round((this.integrity / this.maxIntegrity) * 100))}%`,
        `AUDIO READY ${am.ready}`,
        `MUSIC_MAX ${am.MUSIC_MAX}`,
        `masterVol ${am.masterVol.toFixed(2)}`,
        `musicVol  ${am.musicVol.toFixed(2)}`,
        `sfxVol    ${am.sfxVol.toFixed(2)}`,
        `Howler vol ${Howler.volume().toFixed(3)}`,
        `radioOn   ${am.radioOn}`,
        `radioIdx  ${am.radioIdx}`,
        `radio track vol ${radioVol.toFixed(3)}`,
        `expected vol ${(am.MUSIC_MAX * am.musicVol * am.masterVol).toFixed(3)}`,
      ]);
    }
  };

  private runAnimators(dt: number) {
    for (const a of this.city.animators) a(this.t, dt);
    for (const a of this.extraAnimators) a(this.t, dt);
  }

  private updatePlaying(dt: number) {
    this.runTime += dt;
    this.hornCool -= dt;
    this.crashCool -= dt;

    const k = this.keys;
    const wrecked = this.wreckTimer >= 0;
    const throttle = wrecked ? 0 : (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) + (k.has("KeyS") || k.has("ArrowDown") ? -1 : 0);
    const steer = wrecked ? 0 : (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const handbrake = !wrecked && k.has("Space");

    // off-road (sidewalk/block) detection: roads occupy ±roadW/2 around each grid line
    const p0 = this.city.lines[0];
    const halfR = this.city.roadW / 2;
    const lx = (((this.player.pos.x - p0) % this.city.pitch) + this.city.pitch) % this.city.pitch;
    const lz = (((this.player.pos.z - p0) % this.city.pitch) + this.city.pitch) % this.city.pitch;
    const offRoad = lx > halfR && lx < this.city.pitch - halfR && lz > halfR && lz < this.city.pitch - halfR;

    const frame = this.player.update(dt, { throttle: clamp(throttle, -1, 1), steer, handbrake }, offRoad);

    // world bounds
    const B = HALF_ROAD + 1.5;
    const pos = this.player.pos;
    if (Math.abs(pos.x) > B) {
      pos.x = clamp(pos.x, -B, B);
      this.player.vel.x *= -0.3;
    }
    if (Math.abs(pos.z) > B) {
      pos.z = clamp(pos.z, -B, B);
      this.player.vel.z *= -0.3;
    }

    if (!wrecked) this.handleCollisions(frame.vf);

    // damage state
    if (!wrecked && this.integrity < this.maxIntegrity * 0.35) {
      this.smokeTimer += dt;
      if (this.smokeTimer > 0.13) {
        this.smokeTimer = 0;
        const sp = new THREE.Vector3();
        this.player.smokePoint(sp);
        this.effects.engineSmoke(sp.x, sp.y, sp.z);
      }
    }
    if (wrecked) {
      this.wreckTimer -= dt;
      if (this.wreckTimer <= 0) {
        this.wreckTimer = -1;
        this.gameOver("VAN TOTALED");
        return;
      }
    }

    this.traffic.update(dt, this.t, pos.x, pos.z, this.player.vel.x, this.player.vel.z);

    // mission timer + triggers
    const m = this.delivery.mission;
    if (m && !wrecked) {
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) {
        audio.play("fail");
        this.streak = 1;
        this.money = Math.max(0, this.money - 50);
        this.hud.notify("DELIVERY MISSED  -$50", 0xff3355);
        this.delivery.failAndReplace(pos.x, pos.z);
        this.player.setPackage(false);
        this.hasPackage = false;
        audio.play("chatter");
      } else {
        const ev = this.delivery.checkTrigger(pos.x, pos.z);
        if (ev === "picked") {
          this.hasPackage = true;
          this.player.setPackage(true);
          audio.play("pickup");
          audio.play("chatter");
          this.hud.flash("pickup");
          this.effects.pickupBurst(pos.x, pos.z);
          this.hud.notify("PACKAGE ACQUIRED → DELIVER TO SEC " + (m.code), 0x26e6ff);
        } else if (ev === "delivered") {
          const mult = Math.min(3, 1 + 0.25 * (this.streak - 1));
          const reward = this.delivery.reward(mult);
          this.money += reward;
          this.deliveries++;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
          this.streak++;
          this.integrity = clamp(this.integrity + 18, 0, this.maxIntegrity);
          this.hasPackage = false;
          this.player.setPackage(false);
          audio.play("deliver");
          audio.play("cash");
          audio.play("chatter");
          this.hud.flash("deliver");
          this.effects.deliverBurst(pos.x, pos.z);
          this.hud.notify(`+$${reward}  DELIVERED · SEC ${m.code}  ×${mult.toFixed(2)}`, 0xffe14d);
          this.hud.notify("VAN SERVICED  +18 INTEGRITY", 0x38ff9e);
          this.rollWeather();
          this.delivery.newMission(pos.x, pos.z);
        }
      }
    }
    this.delivery.update(dt, this.t);

    // live GPS: re-route from the van's current position ~3x per second
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) {
      this.routeTimer = 0.35;
      this.delivery.replanRoute(pos.x, pos.z);
    }

    // objective indicator above the van
    const mm = this.delivery.mission;
    if (mm && !wrecked) {
      this.marker.show(true);
      this.marker.update(dt, pos.x, pos.z, mm.target.x, mm.target.z, mm.phase, this.t);
    } else {
      this.marker.show(false);
    }

    // drift smoke + skid audio
    if (frame.drifting) {
      const f = new THREE.Vector3(Math.sin(this.player.heading), 0, Math.cos(this.player.heading));
      this.effects.driftSmoke(pos.x - f.x * 1.8, 0.3, pos.z - f.z * 1.8);
    }
    audio.setSkid(
      handbrake && Math.abs(frame.vf) > 8 ? 0.45 : frame.drifting ? 0.32 : 0,
      clamp(frame.kmh / TOP_KMH, 0, 1)
    );
    audio.setEngine(clamp(frame.kmh / TOP_KMH, 0, 1), throttle > 0 ? 1 : 0);

    // camera + effects + HUD
    this.runAnimators(dt);
    this.effects.update(dt, pos.x, pos.z);
    this.effects.shakeOffset(dt, this.shakeV);
    this.world.updateChase(dt, pos.x, pos.z, this.player.heading, clamp(frame.kmh / TOP_KMH, 0, 1), this.shakeV);

    this.updateSnap(frame.kmh, frame.vf < -0.6, frame.drifting);
    this.hud.setVisible(true);
    this.hud.update(this.snap, dt);
  }

  private updateSnap(kmh: number, reversing: boolean, drifting: boolean) {
    const s = this.snap;
    s.visible = true;
    s.speedKmh = kmh;
    s.reversing = reversing;
    s.drifting = drifting;
    s.money = this.money;
    s.streak = this.streak;
    s.mult = Math.min(3, 1 + 0.25 * (this.streak - 1));
    s.integrity = clamp((this.integrity / this.maxIntegrity) * 100, 0, 100);
    s.px = this.player.pos.x;
    s.pz = this.player.pos.z;
    s.heading = this.player.heading;
    s.traffic = this.traffic.dots();
    s.radio = this.radioName;
    s.hasPackage = this.hasPackage;
    const mm = this.delivery.mission;
    s.distance = mm ? Math.hypot(mm.target.x - this.player.pos.x, mm.target.z - this.player.pos.z) : 0;
    this.delivery.snapshotInto(s);
  }

  /* ---------------- collisions ---------------- */

  private applyImpact(nx: number, nz: number, impact: number, hx: number, hz: number, heavy: boolean) {
    if (impact < 2.5) return;
    // kill inward velocity, small bounce
    const v = this.player.vel;
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) {
      // restitution ~0: kill inward velocity so the van slides off and can
      // immediately keep driving instead of bouncing backward
      v.x -= nx * vn * 1.0;
      v.z -= nz * vn * 1.0;
    }
    if (impact > 6 && this.crashCool <= 0) {
      this.crashCool = 0.24;
      const dmg = (impact - 6) * (heavy ? 1.6 : 1.15);
      this.integrity -= dmg;
      this.streak = 1;
      this.effects.crashSparks(hx, 1.0, hz, impact > 11);
      audio.play(impact > 11 ? "crashHeavy" : "crashLight");
      this.effects.shake(clamp(impact / 16, 0.2, 1));
      this.hud.flash("damage");
      if (this.integrity <= 0) this.wreck();
    } else if (impact > 2.5) {
      this.effects.shake(0.12);
    }
  }

  private wreck() {
    this.integrity = 0;
    this.wreckTimer = 1.5;
    this.player.hide();
    this.effects.explode(this.player.pos.x, this.player.pos.z);
    audio.play("explode");
    this.hud.flash("explode");
  }

  private handleCollisions(vf: number) {
    const pos = this.player.pos;
    const r = this.player.radius;

    for (const c of this.city.colliders) {
      if (c.kind === "box") {
        const cx = clamp(pos.x, c.minX, c.maxX);
        const cz = clamp(pos.z, c.minZ, c.maxZ);
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = d2 > 0.0001 ? dx / d : 1;
        const nz = d2 > 0.0001 ? dz / d : 0;
        pos.x = cx + nx * r;
        pos.z = cz + nz * r;
        this.applyImpact(nx, nz, Math.abs(vf) * 0.72 + 2, cx, cz, true);
      } else {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d;
        const nz = dz / d;
        pos.x = c.x + nx * rr;
        pos.z = c.z + nz * rr;
        this.applyImpact(nx, nz, Math.abs(vf) * 0.72 + 2, c.x + nx * c.r, c.z + nz * c.r, false);
      }
    }

    for (const tc of this.traffic.circles()) {
      const dx = pos.x - tc.x;
      const dz = pos.z - tc.z;
      const rr = r + tc.r;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      pos.x = tc.x + nx * rr;
      pos.z = tc.z + nz * rr;
      this.traffic.impulse(tc.car, nx, nz);
      this.applyImpact(nx, nz, Math.abs(vf) * 0.85 + 3, tc.x + nx * tc.r, tc.z + nz * tc.r, true);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.assets.dispose();
    this.marker.dispose();
    this.hud.dispose();
    this.world.dispose();
    audio.dispose();
  }
}
