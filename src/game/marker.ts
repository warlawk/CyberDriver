import * as THREE from "three";
import { clamp, dampAngle } from "./utils";
import type { MissionPhase } from "./utils";
import { disposeDeep } from "./textures";

const CYAN = 0x26e6ff;
const GREEN = 0x38ff9e;

/**
 * Objective indicator: one chunky extruded 3D arrow that yaws to point at
 * the active target (pickup = cyan, dropoff = magenta) while spinning around
 * its own long axis like a drill, so it always reads as solid geometry.
 * Spins faster and glows harder as the target gets close.
 */
export class ObjectiveMarker {
  private group = new THREE.Group(); // positioned above the van (+ bob)
  private yaw = new THREE.Group(); // aims at the target
  private pitch = new THREE.Group(); // slight camera-facing tilt
  private spin = new THREE.Group(); // rotates around the arrow's long axis
  private mat: THREE.MeshLambertMaterial;
  private angle = 0;
  private lastPhase: MissionPhase | null = null;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // arrow profile in XY, tip up (+Y), symmetric about the Y axis
    const s = new THREE.Shape();
    s.moveTo(0, 1.95); // tip
    s.lineTo(1.08, -0.32); // right wing tip
    s.lineTo(0.42, -0.02); // right wing root
    s.lineTo(0.42, -1.35); // tail right
    s.lineTo(-0.42, -1.35); // tail left
    s.lineTo(-0.42, -0.02); // left wing root
    s.lineTo(-1.08, -0.32); // left wing tip
    s.closePath();

    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.55,
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.14,
      bevelSegments: 2,
    });
    // lay the arrow along +Z (vehicle heading convention) and center it
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -0.18);

    this.mat = new THREE.MeshLambertMaterial({
      color: 0x0b3340,
      emissive: CYAN,
      emissiveIntensity: 0.55,
    });
    const body = new THREE.Mesh(geo, this.mat);
    // outline only: sharp feature edges, no triangle clutter on the faces
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 20),
      new THREE.LineBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.8 })
    );
    this.spin.add(body, edges);
    this.spin.scale.setScalar(0.5); // ~half the previous footprint
    this.pitch.add(this.spin);
    this.pitch.rotation.x = -0.42; // tilt the tip up toward the chase camera
    this.yaw.add(this.pitch);
    this.group.add(this.yaw);
    this.group.visible = false;
    scene.add(this.group);
  }

  show(on: boolean) {
    this.group.visible = on;
  }

  update(dt: number, px: number, pz: number, tx: number, tz: number, phase: MissionPhase, t: number) {
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      const col = phase === "pickup" ? CYAN : GREEN;
      this.mat.emissive.setHex(col);
      this.mat.color.setHex(phase === "pickup" ? 0x0b3340 : 0x0b3d24);
    }

    this.group.position.set(px, 6.4 + Math.sin(t * 3.1) * 0.3, pz);

    // aim at the objective (smoothed turn)
    const want = Math.atan2(tx - px, tz - pz);
    this.angle = dampAngle(this.angle, want, 9, dt);
    this.yaw.rotation.y = this.angle;

    // drill-spin around its own long axis
    const d = Math.hypot(tx - px, tz - pz);
    const hot = clamp(1 - d / 34, 0, 1);
    this.spin.rotation.z += dt * (3.2 + 3.0 * hot);

    // glow + scale pulse, stronger when closing in
    this.mat.emissiveIntensity = 0.5 + 0.5 * hot + 0.12 * Math.sin(t * (4 + 6 * hot));
    const pulse = 1 + (0.05 + 0.14 * hot) * Math.sin(t * (4 + 5 * hot));
    this.spin.scale.setScalar(0.5 * pulse);
  }

  dispose() {
    disposeDeep(this.group);
    this.scene.remove(this.group);
  }
}
