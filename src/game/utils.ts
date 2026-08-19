import type * as THREE from "three";

/* ---------------- shared types ---------------- */

export interface BoxCollider {
  kind: "box";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface CircleCollider {
  kind: "circle";
  x: number;
  z: number;
  r: number;
}
export type Collider = BoxCollider | CircleCollider;

export interface IntersectionNode {
  gx: number;
  gz: number;
  x: number;
  z: number;
}

export interface CityData {
  seed: number;
  group: THREE.Group;
  blocks: number;
  pitch: number;
  roadW: number;
  lines: number[];
  half: number;
  colliders: Collider[];
  nodes: IntersectionNode[];
  animators: ((t: number, dt: number) => void)[];
}

export type MissionPhase = "pickup" | "deliver";

export interface Mission {
  id: number;
  code: string;
  phase: MissionPhase;
  pickup: IntersectionNode;
  dropoff: IntersectionNode;
  target: IntersectionNode;
  timeLeft: number;
  timeTotal: number;
  baseReward: number;
  route: { x: number; z: number }[];
}

export interface TrafficDot {
  x: number;
  z: number;
}

export interface HudSnapshot {
  visible: boolean;
  speedKmh: number;
  reversing: boolean;
  drifting: boolean;
  timeLeft: number;
  timeTotal: number;
  money: number;
  streak: number;
  mult: number;
  integrity: number;
  phase: MissionPhase;
  code: string;
  distance: number;
  route: { x: number; z: number }[];
  px: number;
  pz: number;
  heading: number;
  traffic: TrafficDot[];
  extent: number;
  radio: string | null;
  hasPackage: boolean;
}

export type GamePhase = "title" | "countdown" | "playing" | "paused" | "gameover";

export interface RunStats {
  money: number;
  deliveries: number;
  bestStreak: number;
  elapsed: number;
  cause: string;
}

/* ---------------- math / rng ---------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(a: number, b: number): number {
  let h = (a * 73856093) ^ (b * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v: number, a: number, b: number) =>
  v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** frame-rate independent exponential smoothing */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

export const rand = (rng: () => number, a: number, b: number) =>
  a + rng() * (b - a);
export const randInt = (rng: () => number, a: number, b: number) =>
  Math.floor(rand(rng, a, b + 1));
export const pick = <T,>(rng: () => number, arr: T[]): T =>
  arr[Math.floor(rng() * arr.length)];
export const chance = (rng: () => number, p: number) => rng() < p;

export function gridCode(gx: number, gz: number): string {
  return `${String.fromCharCode(65 + gx)}-${gz + 1}`;
}

export function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function fmtTime(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  const m = Math.floor(t / 60);
  const ss = t % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}
