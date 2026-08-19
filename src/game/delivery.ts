import * as THREE from "three";
import type { CityData, IntersectionNode, Mission } from "./utils";
import { clamp, gridCode, mulberry32, type HudSnapshot } from "./utils";

const TRIGGER_R = 7.6;

export class DeliverySystem {
  private city: CityData;
  private scene: THREE.Scene;
  mission: Mission | null = null;
  private counter = 0;
  private marker = new THREE.Group();
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private pad: THREE.Mesh;
  private gem: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private padMat: THREE.MeshBasicMaterial;
  private gemMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, city: CityData) {
    this.scene = scene;
    this.city = city;

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x26e6ff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.6, 70, 14, 1, true), this.beamMat);
    this.beam.position.y = 35;
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x26e6ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.1, 36), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.12;
    this.padMat = new THREE.MeshBasicMaterial({
      color: 0x26e6ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.pad = new THREE.Mesh(new THREE.CircleGeometry(4.4, 28), this.padMat);
    this.pad.rotation.x = -Math.PI / 2;
    this.pad.position.y = 0.1;
    this.gemMat = new THREE.MeshBasicMaterial({ color: 0x26e6ff, wireframe: true });
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.25), this.gemMat);
    this.gem.position.y = 7.2;
    this.marker.add(this.beam, this.ring, this.pad, this.gem);
    this.marker.visible = false;
    scene.add(this.marker);
  }

  private node(gx: number, gz: number): IntersectionNode {
    return {
      gx,
      gz,
      x: this.city.lines[gx],
      z: this.city.lines[gz],
    };
  }

  nearestNode(x: number, z: number): IntersectionNode {
    const n = this.city.blocks;
    const gx = clamp(Math.round((x - this.city.lines[0]) / this.city.pitch), 0, n);
    const gz = clamp(Math.round((z - this.city.lines[0]) / this.city.pitch), 0, n);
    return this.node(gx, gz);
  }

  private routeFrom(a: IntersectionNode, b: IntersectionNode): { x: number; z: number }[] {
    const pts = [{ x: a.x, z: a.z }];
    if (a.gx !== b.gx && a.gz !== b.gz) {
      // random Manhattan corner
      const corner = Math.random() < 0.5 ? this.node(a.gx, b.gz) : this.node(b.gx, a.gz);
      pts.push({ x: corner.x, z: corner.z });
    }
    pts.push({ x: b.x, z: b.z });
    return pts;
  }

  newMission(px: number, pz: number) {
    this.counter++;
    const rng = mulberry32((this.city.seed ^ (this.counter * 2654435761)) >>> 0);
    const B = this.city.blocks;
    const here = this.nearestNode(px, pz);

    const pickNode = (minD: number, maxD: number, from: IntersectionNode) => {
      for (let tries = 0; tries < 40; tries++) {
        const gx = Math.floor(rng() * (B + 1));
        const gz = Math.floor(rng() * (B + 1));
        const d = Math.abs(gx - from.gx) + Math.abs(gz - from.gz);
        if (d >= minD && d <= maxD) return this.node(gx, gz);
      }
      return this.node(rng() < 0.5 ? 0 : B, rng() < 0.5 ? 0 : B);
    };

    const pickup = pickNode(2, 6, here);
    const dropoff = pickNode(3, 8, pickup);
    const legA = Math.hypot(pickup.x - px, pickup.z - pz);
    const legB = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
    const timeTotal = clamp(42 + (legA + legB) * 0.52, 70, 118);

    this.mission = {
      id: this.counter,
      code: gridCode(dropoff.gx, dropoff.gz),
      phase: "pickup",
      pickup,
      dropoff,
      target: pickup,
      timeLeft: timeTotal,
      timeTotal,
      baseReward: Math.round(90 + legB * 1.15),
      route: this.routeFrom(here, pickup),
    };
    this.setMarker(pickup, "pickup");
  }

  private setMarker(node: IntersectionNode, phase: "pickup" | "deliver") {
    this.marker.position.set(node.x, 0, node.z);
    this.marker.visible = true;
    const col = phase === "pickup" ? 0x26e6ff : 0xff2e7e;
    this.beamMat.color.setHex(col);
    this.ringMat.color.setHex(col);
    this.padMat.color.setHex(col);
    this.gemMat.color.setHex(col);
  }

  /** returns event when player enters the active target zone */
  checkTrigger(px: number, pz: number): "picked" | "delivered" | null {
    const m = this.mission;
    if (!m) return null;
    const d = Math.hypot(px - m.target.x, pz - m.target.z);
    if (d > TRIGGER_R) return null;
    if (m.phase === "pickup") {
      m.phase = "deliver";
      m.target = m.dropoff;
      m.timeLeft += 16;
      m.route = this.routeFrom(m.pickup, m.dropoff);
      this.setMarker(m.dropoff, "deliver");
      return "picked";
    }
    return "delivered";
  }

  reward(mult: number): number {
    const m = this.mission;
    if (!m) return 0;
    return Math.round((m.baseReward + Math.max(0, m.timeLeft) * 4.5) * mult);
  }

  failAndReplace(px: number, pz: number) {
    this.newMission(px, pz);
  }

  update(dt: number, t: number) {
    if (!this.mission) {
      this.marker.visible = false;
      return;
    }
    this.gem.rotation.y += dt * 2.2;
    this.gem.position.y = 7.2 + Math.sin(t * 2.6) * 0.8;
    const s = 1 + Math.sin(t * 4.5) * 0.12;
    this.ring.scale.set(s, s, 1);
    this.beamMat.opacity = 0.16 + 0.08 * Math.sin(t * 3.1);
    void dt;
  }

  snapshotInto(s: HudSnapshot) {
    const m = this.mission;
    if (!m) return;
    s.timeLeft = m.timeLeft;
    s.timeTotal = m.timeTotal;
    s.phase = m.phase;
    s.code = m.code;
    s.route = m.route;
  }

  dispose() {
    this.scene.remove(this.marker);
  }
}
