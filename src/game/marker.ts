import * as THREE from "three";
import { clamp, dampAngle } from "./utils";
import type { MissionPhase } from "./utils";

const CYAN = 0x26e6ff;
const MAGENTA = 0xff2e7e;

/**
 * Arcade objective arrow floating above the van, always aimed at the current
 * target (pickup = cyan, dropoff = magenta). Built as a flat dart then
 * pitched up toward the chase camera so the direction reads at a glance.
 * Pulses harder as the destination closes in.
 */
export class ObjectiveMarker {
  private group = new THREE.Group();
  private fillMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private arrow: THREE.Mesh;
  private glow: THREE.Mesh;
  private angle = 0;
  private lastPhase: MissionPhase | null = null;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // dart shape in XY, tip along +Y
    const dart = new THREE.Shape();
    dart.moveTo(0, 1.7);
    dart.lineTo(1.0, -1.1);
    dart.lineTo(0, -0.45);
    dart.lineTo(-1.0, -1.1);
    dart.closePath();
    const geo = new THREE.ShapeGeometry(dart);
    // lay flat (tip -> +Z, matching the vehicle heading convention), then
    // pitch the tip upward ~49 degrees so the camera sees it face-on
    geo.rotateX(Math.PI / 2 - 0.85);

    this.fillMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.arrow = new THREE.Mesh(geo, this.fillMat);

    // soft oversized ghost for bloom-friendly glow
    this.glowMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.glow = new THREE.Mesh(geo, this.glowMat);
    this.glow.scale.setScalar(1.5);

    this.group.add(this.glow, this.arrow);
    this.group.visible = false;
    scene.add(this.group);
  }

  show(on: boolean) {
    this.group.visible = on;
  }

  update(dt: number, px: number, pz: number, tx: number, tz: number, phase: MissionPhase, t: number) {
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      const col = phase === "pickup" ? CYAN : MAGENTA;
      this.fillMat.color.setHex(col);
      this.glowMat.color.setHex(col);
    }

    this.group.position.set(px, 5.4 + Math.sin(t * 3.1) * 0.3, pz);

    // aim at the target (smoothed turn)
    const want = Math.atan2(tx - px, tz - pz);
    this.angle = dampAngle(this.angle, want, 9, dt);
    this.arrow.rotation.y = this.angle;
    this.glow.rotation.y = this.angle;

    // "getting hot" pulse as distance closes
    const d = Math.hypot(tx - px, tz - pz);
    const hot = clamp(1 - d / 34, 0, 1);
    const pulse = 1 + (0.06 + 0.16 * hot) * Math.sin(t * (4 + 5 * hot));
    this.arrow.scale.set(pulse, pulse, pulse);
    this.glow.scale.setScalar(1.5 * pulse);
    this.fillMat.opacity = 0.72 + 0.28 * hot;
    this.glowMat.opacity = 0.18 + 0.22 * hot;
  }

  dispose() {
    this.scene.remove(this.group);
    this.arrow.geometry.dispose();
    this.fillMat.dispose();
    this.glowMat.dispose();
  }
}
