import * as THREE from "three";
import { clamp, dampAngle } from "./utils";
import type { MissionPhase } from "./utils";

const CYAN = 0x26e6ff;
const MAGENTA = 0xff2e7e;

/**
 * Arcade objective indicator: a wireframe drop-pin pyramid that spins above
 * the van, with a flat dart under it that always aims at the current target
 * (pickup = cyan, dropoff = magenta). Pulses harder as you close in.
 */
export class ObjectiveMarker {
  private group = new THREE.Group();
  private spinner = new THREE.Group();
  private pointer = new THREE.Group();
  private fillMat: THREE.MeshBasicMaterial;
  private wireMat: THREE.MeshBasicMaterial;
  private ptrMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private ptrMesh: THREE.Mesh;
  private angle = 0;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.fillMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.wireMat = new THREE.MeshBasicMaterial({
      color: 0xeafcff,
      wireframe: true,
      transparent: true,
      opacity: 0.95,
    });

    const cone = new THREE.ConeGeometry(1.05, 1.6, 4);
    cone.rotateX(Math.PI); // apex down, like a drop pin
    this.spinner.add(new THREE.Mesh(cone, this.fillMat));
    this.spinner.add(new THREE.Mesh(cone, this.wireMat));
    this.spinner.position.y = 0.55;

    // aiming dart (tip built along +Z, matching vehicle heading convention)
    const dart = new THREE.Shape();
    dart.moveTo(0, 1.55);
    dart.lineTo(0.9, -1.05);
    dart.lineTo(0, -0.42);
    dart.lineTo(-0.9, -1.05);
    dart.closePath();
    const dartGeo = new THREE.ShapeGeometry(dart);
    dartGeo.rotateX(Math.PI / 2); // lay flat, tip -> +Z
    this.ptrMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ptrMesh = new THREE.Mesh(dartGeo, this.ptrMat);
    this.ptrMesh.position.y = -1.5;
    this.pointer.add(this.ptrMesh);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.5, 28), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = -2.55;

    this.group.add(this.spinner, this.pointer, this.ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  show(on: boolean) {
    this.group.visible = on;
  }

  private lastPhase: MissionPhase | null = null;

  update(dt: number, px: number, pz: number, tx: number, tz: number, phase: MissionPhase, t: number) {
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      const col = phase === "pickup" ? CYAN : MAGENTA;
      this.fillMat.color.setHex(col);
      this.ptrMat.color.setHex(col);
      this.ringMat.color.setHex(col);
    }

    this.group.position.set(px, 6.5 + Math.sin(t * 3.1) * 0.32, pz);
    this.spinner.rotation.y += dt * 3.4;

    // aim the dart at the target (smoothed turn)
    const want = Math.atan2(tx - px, tz - pz);
    this.angle = dampAngle(this.angle, want, 9, dt);
    this.pointer.rotation.y = this.angle;

    // "getting hot" pulse as distance closes
    const d = Math.hypot(tx - px, tz - pz);
    const hot = clamp(1 - d / 34, 0, 1);
    const pulse = 1 + (0.06 + 0.16 * hot) * Math.sin(t * (4 + 5 * hot));
    this.ptrMesh.scale.set(pulse, 1, pulse);
    this.ptrMat.opacity = 0.7 + 0.3 * hot;
    this.ringMat.opacity = 0.32 + 0.3 * hot + 0.1 * Math.sin(t * 6);
    const rs = 1 + 0.1 * Math.sin(t * 4.4);
    this.ring.scale.set(rs, rs, 1);
  }

  dispose() {
    this.scene.remove(this.group);
    this.spinner.children.forEach((m) => (m as THREE.Mesh).geometry?.dispose());
    this.ptrMesh.geometry.dispose();
    this.ring.geometry.dispose();
    this.fillMat.dispose();
    this.wireMat.dispose();
    this.ptrMat.dispose();
    this.ringMat.dispose();
  }
}
