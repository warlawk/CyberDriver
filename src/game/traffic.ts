import * as THREE from "three";
import { axisGo, ROAD_W } from "./city";
import type { CityData, TrafficDot } from "./utils";
import { chance, clamp, mulberry32, pick, rand } from "./utils";
import { carPaintCanvas, toTex, disposeDeep } from "./textures";

interface Car {
  group: THREE.Group;
  tailMat: THREE.MeshBasicMaterial;
  axis: "h" | "v";
  lineIdx: number;
  nextLineIdx: number;
  dir: 1 | -1;
  s: number;
  speed: number;
  cruising: number;
  lane: number;
  braking: boolean;
  x: number;
  z: number;
  turn: Turn | null;
}

/** cubic-bezier arc through an intersection, tangents aligned with both lanes */
interface Turn {
  t: number;
  dur: number;
  p0x: number;
  p0z: number;
  c0x: number;
  c0z: number;
  c1x: number;
  c1z: number;
  p1x: number;
  p1z: number;
  axis: "h" | "v";
  lineIdx: number;
  dir: 1 | -1;
  lane: number;
  s: number;
}

const TARGET_COUNT = 26;
const LANE_OFF = ROAD_W * 0.24;

export class TrafficSystem {
  private cars: Car[] = [];
  private city: CityData;
  private group = new THREE.Group();
  private rng: () => number;
  private bodyGeo = new THREE.BoxGeometry(1.9, 0.95, 4.1);
  private cabinGeo = new THREE.BoxGeometry(1.6, 0.72, 1.9);
  private glassGeo = new THREE.BoxGeometry(1.5, 0.4, 0.12);
  private lightGeo = new THREE.BoxGeometry(0.42, 0.2, 0.1);
  private tailGeo = new THREE.BoxGeometry(0.44, 0.22, 0.1);
  private bodyMats = [0x35507e, 0x6e3560, 0x2e6e68, 0x7a6a2c, 0x27406b, 0x803a3a, 0x4a4a78].map(
    (c) =>
      new THREE.MeshLambertMaterial({
        map: toTex(carPaintCanvas("#" + c.toString(16).padStart(6, "0"), Math.random)),
        color: 0xe8ecf8,
      })
  );
  private glassMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
  private headMat = new THREE.MeshBasicMaterial({ color: 0xe8f6ff });

  constructor(scene: THREE.Scene, city: CityData) {
    this.city = city;
    this.rng = mulberry32(city.seed ^ 0x77aa11);
    scene.add(this.group);
  }

  private laneFor(axis: "h" | "v", dir: 1 | -1) {
    return (axis === "h" ? dir : -dir) * LANE_OFF;
  }
  private headingOf(axis: "h" | "v", dir: 1 | -1) {
    if (axis === "h") return dir === 1 ? Math.PI / 2 : -Math.PI / 2;
    return dir === 1 ? 0 : Math.PI;
  }
  private worldPos(c: { axis: "h" | "v"; lineIdx: number; s: number; lane: number }) {
    const line = this.city.lines[c.lineIdx];
    return c.axis === "h"
      ? { x: c.s, z: line + c.lane }
      : { x: line + c.lane, z: c.s };
  }

  private nextIdx(lineIdx: number, s: number, dir: 1 | -1): number {
    const lines = this.city.lines;
    if (dir === 1) {
      for (let i = 0; i < lines.length; i++) if (lines[i] > s + 0.5) return i;
      return lineIdx; // at end of world — will turn around
    }
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i] < s - 0.5) return i;
    return lineIdx;
  }

  private makeCar(x: number, z: number): Car {
    const group = new THREE.Group();
    const bodyMat = pick(this.rng, this.bodyMats);
    const body = new THREE.Mesh(this.bodyGeo, bodyMat);
    body.position.y = 0.75;
    const cabin = new THREE.Mesh(this.cabinGeo, bodyMat);
    cabin.position.set(0, 1.5, -0.25);
    const glass = new THREE.Mesh(this.glassGeo, this.glassMat);
    glass.position.set(0, 1.5, 0.72);
    const h1 = new THREE.Mesh(this.lightGeo, this.headMat);
    h1.position.set(0.6, 0.72, 2.06);
    const h2 = h1.clone();
    h2.position.x = -0.6;
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xaa1122 });
    const t1 = new THREE.Mesh(this.tailGeo, tailMat);
    t1.position.set(0.62, 0.8, -2.06);
    const t2 = t1.clone();
    t2.position.x = -0.62;
    group.add(body, cabin, glass, h1, h2, t1, t2);
    group.position.set(x, 0.03, z);
    this.group.add(group);

    const axis: "h" | "v" = chance(this.rng, 0.5) ? "h" : "v";
    const dir: 1 | -1 = chance(this.rng, 0.5) ? 1 : -1;
    const lineIdx = Math.floor(rand(this.rng, 0, this.city.lines.length));
    const s = axis === "h" ? x : z;
    const car: Car = {
      group,
      tailMat,
      axis,
      lineIdx,
      nextLineIdx: 0,
      dir,
      s,
      speed: rand(this.rng, 4, 9),
      cruising: rand(this.rng, 8.5, 14),
      lane: this.laneFor(axis, dir),
      braking: false,
      x,
      z,
      turn: null,
    };
    car.nextLineIdx = this.nextIdx(lineIdx, s, dir);
    return car;
  }

  private spawnNear(px: number, pz: number) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const axis: "h" | "v" = chance(this.rng, 0.5) ? "h" : "v";
      const lineIdx = Math.floor(rand(this.rng, 0, this.city.lines.length));
      const line = this.city.lines[lineIdx];
      const s = rand(this.rng, -this.city.half + 12, this.city.half - 12);
      const dir: 1 | -1 = chance(this.rng, 0.5) ? 1 : -1;
      const lane = this.laneFor(axis, dir);
      const x = axis === "h" ? s : line + lane;
      const z = axis === "h" ? line + lane : s;
      const dP = Math.hypot(x - px, z - pz);
      if (dP < 30 || dP > 185) continue;
      let crowded = false;
      for (const c of this.cars) {
        const p = this.worldPos(c);
        if (Math.hypot(p.x - x, p.z - z) < 14) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;
      const car = this.makeCar(x, z);
      car.axis = axis;
      car.lineIdx = lineIdx;
      car.dir = dir;
      car.s = s;
      car.lane = lane;
      car.nextLineIdx = this.nextIdx(lineIdx, s, dir);
      car.group.rotation.y = this.headingOf(axis, dir);
      this.cars.push(car);
      return;
    }
  }

  update(dt: number, t: number, px: number, pz: number, pvx: number, pvz: number) {
    while (this.cars.length < TARGET_COUNT) this.spawnNear(px, pz);

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const pos = { x: c.x, z: c.z };
      if (Math.hypot(pos.x - px, pos.z - pz) > 210) {
        this.group.remove(c.group);
        this.cars.splice(i, 1);
        continue;
      }

      // mid-turn: follow the bezier arc, heading from the curve tangent
      if (c.turn) {
        const tn = c.turn;
        tn.t += dt / tn.dur;
        const tt = Math.min(1, tn.t);
        const u = 1 - tt;
        const bx = u * u * u * tn.p0x + 3 * u * u * tt * tn.c0x + 3 * u * tt * tt * tn.c1x + tt * tt * tt * tn.p1x;
        const bz = u * u * u * tn.p0z + 3 * u * u * tt * tn.c0z + 3 * u * tt * tt * tn.c1z + tt * tt * tt * tn.p1z;
        const dx = 3 * u * u * (tn.c0x - tn.p0x) + 6 * u * tt * (tn.c1x - tn.c0x) + 3 * tt * tt * (tn.p1x - tn.c1x);
        const dz = 3 * u * u * (tn.c0z - tn.p0z) + 6 * u * tt * (tn.c1z - tn.c0z) + 3 * tt * tt * (tn.p1z - tn.c1z);
        c.x = bx;
        c.z = bz;
        c.group.position.set(bx, 0.03, bz);
        c.group.rotation.y = Math.atan2(dx, dz);
        c.tailMat.color.setHex(0xaa1122);
        if (tt >= 1) {
          c.axis = tn.axis;
          c.lineIdx = tn.lineIdx;
          c.dir = tn.dir;
          c.lane = tn.lane;
          c.s = tn.s;
          c.turn = null;
          c.nextLineIdx = this.nextIdx(c.lineIdx, c.s, c.dir);
        }
        continue;
      }

      const fx = Math.sin(this.headingOf(c.axis, c.dir));
      const fz = Math.cos(this.headingOf(c.axis, c.dir));
      let target = c.cruising;
      c.braking = false;

      // red light check
      const distToNode = (this.city.lines[c.nextLineIdx] - c.s) * c.dir;
      if (distToNode > 1.5 && distToNode < 16) {
        const gx = c.axis === "h" ? c.nextLineIdx : c.lineIdx;
        const gz = c.axis === "h" ? c.lineIdx : c.nextLineIdx;
        if (!axisGo(t, gx, gz, c.axis)) {
          target = Math.min(target, Math.max(0, (distToNode - 3.2) * 1.4));
          c.braking = target < c.speed - 0.5;
        }
      }

      // obstacle ahead (other cars + player)
      for (const o of this.cars) {
        if (o === c) continue;
        const op = this.worldPos(o);
        const dx = op.x - pos.x;
        const dz = op.z - pos.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 10 && side < 2.6) {
          target = Math.min(target, o.speed * 0.85);
          c.braking = target < c.speed - 0.5;
        }
      }
      {
        const dx = px - pos.x;
        const dz = pz - pos.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 11 && side < 2.8) {
          target = 0;
          c.braking = true;
        }
      }

      const acc = target > c.speed ? 7 : 16;
      c.speed += clamp(target - c.speed, -acc * dt, acc * dt);
      c.speed = Math.max(0, c.speed);
      c.s += c.speed * c.dir * dt;

      // intersection decision
      const crossed = (this.city.lines[c.nextLineIdx] - c.s) * c.dir <= 0;
      if (crossed) {
        const atEnd =
          (c.dir === 1 && c.nextLineIdx === this.city.lines.length - 1) ||
          (c.dir === -1 && c.nextLineIdx === 0);
        const wantTurn = atEnd || chance(this.rng, 0.42);
        if (wantTurn) {
          const oldAxis = c.axis;
          const oldDir = c.dir;
          const newAxis: "h" | "v" = oldAxis === "h" ? "v" : "h";
          const newLineIdx = c.nextLineIdx;
          const newDir: 1 | -1 = atEnd ? ((-oldDir) as 1 | -1) : chance(this.rng, 0.5) ? 1 : -1;
          const newLane = this.laneFor(newAxis, newDir);
          const oldLine = this.city.lines[c.lineIdx]; // intersection coord along the new axis
          const lead = 7;
          const p0 = { x: c.x, z: c.z };
          const t0x = Math.sin(this.headingOf(oldAxis, oldDir));
          const t0z = Math.cos(this.headingOf(oldAxis, oldDir));
          const t1x = Math.sin(this.headingOf(newAxis, newDir));
          const t1z = Math.cos(this.headingOf(newAxis, newDir));
          const p1 = this.worldPos({
            axis: newAxis,
            lineIdx: newLineIdx,
            s: oldLine + newDir * lead,
            lane: newLane,
          });
          const chord = Math.hypot(p1.x - p0.x, p1.z - p0.z);
          const k = clamp(chord * 0.42, 4, 12);
          const turnSpeed = clamp(c.speed, 5.5, 10);
          c.turn = {
            t: 0,
            dur: (chord * 1.25) / turnSpeed,
            p0x: p0.x,
            p0z: p0.z,
            c0x: p0.x + t0x * k,
            c0z: p0.z + t0z * k,
            c1x: p1.x - t1x * k,
            c1z: p1.z - t1z * k,
            p1x: p1.x,
            p1z: p1.z,
            axis: newAxis,
            lineIdx: newLineIdx,
            dir: newDir,
            lane: newLane,
            s: oldLine + newDir * lead,
          };
          c.speed = turnSpeed;
          c.braking = false;
        }
        if (!c.turn) c.nextLineIdx = this.nextIdx(c.lineIdx, c.s, c.dir);
      }

      const p = this.worldPos(c);
      c.x = p.x;
      c.z = p.z;
      c.group.position.set(p.x, 0.03, p.z);
      c.tailMat.color.setHex(c.braking ? 0xff2233 : 0xaa1122);
    }
    void pvx;
    void pvz;
  }

  /** dynamic circle colliders for the crash system */
  circles(): { x: number; z: number; r: number; car: Car }[] {
    return this.cars.map((c) => ({ x: c.x, z: c.z, r: 1.5, car: c }));
  }

  dots(): TrafficDot[] {
    return this.cars.map((c) => ({ x: c.x, z: c.z }));
  }

  /** shove a car after being hit */
  impulse(car: Car, nx: number, nz: number) {
    car.s -= (car.axis === "h" ? nx : nz) * 2 * car.dir * 0 + 0; // keep lane logic stable
    car.speed = Math.max(car.speed * 0.4, 2);
    void nx;
    void nz;
  }

  dispose(scene: THREE.Scene) {
    disposeDeep(this.group);
    scene.remove(this.group);
    this.cars = [];
  }
}
