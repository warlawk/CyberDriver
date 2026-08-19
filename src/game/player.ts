import * as THREE from "three";
import { clamp } from "./utils";

export interface InputState {
  throttle: number; // -1..1
  steer: number; // -1..1
  handbrake: boolean;
}

export interface VehicleFrame {
  vf: number;
  vl: number;
  kmh: number;
  drifting: boolean;
  braking: boolean;
}

function cnvTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PlayerVehicle {
  group = new THREE.Group();
  pos = new THREE.Vector3(0, 0, 0);
  vel = new THREE.Vector3();
  heading = 0;
  radius = 1.3;

  private wheels: THREE.Mesh[] = [];
  private frontPivots: THREE.Object3D[] = [];
  private tailMat = new THREE.MeshBasicMaterial({ color: 0x991122 });
  private packageMesh: THREE.Mesh;
  private underglow: THREE.Mesh;
  private spot: THREE.SpotLight;
  private smokeAnchor = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const body = new THREE.MeshLambertMaterial({ color: 0x31456e });
    const cargo = new THREE.MeshLambertMaterial({ color: 0x3d5488 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x141b30 });

    const cargoBox = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.0, 3.0), cargo);
    cargoBox.position.set(0, 1.5, -0.45);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.4, 1.8), body);
    cabin.position.set(0, 1.2, 1.55);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.7), body);
    hood.position.set(0, 0.85, 2.6);
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.62, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x86e7ff })
    );
    windshield.position.set(0, 1.55, 2.42);
    windshield.rotation.x = -0.28;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.42, 0.24, 3.12),
      new THREE.MeshBasicMaterial({ color: 0xff2e7e })
    );
    stripe.position.set(0, 1.5, -0.45);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 4.6), dark);
    bumper.position.set(0, 0.42, 0.3);
    const roofBar = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x26e6ff })
    );
    roofBar.position.set(0, 2.58, -0.45);

    // rear logo
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.95),
      new THREE.MeshBasicMaterial({
        map: cnvTex(192, 96, (g) => {
          g.fillStyle = "#0a0f22";
          g.fillRect(0, 0, 192, 96);
          g.font = "900 46px Orbitron, sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.shadowColor = "#26e6ff";
          g.shadowBlur = 18;
          g.fillStyle = "#26e6ff";
          g.fillText("CDD", 96, 34);
          g.font = "700 22px Rajdhani, sans-serif";
          g.fillStyle = "#ffe14d";
          g.shadowColor = "#ffe14d";
          g.fillText("EXPRESS", 96, 72);
        }),
      })
    );
    logo.position.set(0, 1.6, -1.96);
    logo.rotation.y = Math.PI;

    // lights
    const headMat = new THREE.MeshBasicMaterial({ color: 0xeaf8ff });
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.12), headMat);
      h.position.set(sx * 0.75, 0.95, 2.96);
      this.group.add(h);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.1), this.tailMat);
      tl.position.set(sx * 0.85, 1.25, -1.97);
      this.group.add(tl);
    }

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.36, 10);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0f1a });
    for (const sz of [1.7, -1.5]) {
      for (const sx of [-1.08, 1.08]) {
        const pivot = new THREE.Object3D();
        pivot.position.set(sx, 0.46, sz);
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        pivot.add(w);
        this.group.add(pivot);
        this.wheels.push(w);
        if (sz > 0) this.frontPivots.push(pivot);
      }
    }

    // package on roof
    this.packageMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.85, 0.85),
      new THREE.MeshLambertMaterial({ color: 0xd8a94e, emissive: 0xffe14d, emissiveIntensity: 0.35 })
    );
    this.packageMesh.position.set(0, 2.95, -0.45);
    this.packageMesh.visible = false;

    // underglow
    this.underglow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5.0),
      new THREE.MeshBasicMaterial({
        color: 0x26e6ff,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.underglow.rotation.x = -Math.PI / 2;
    this.underglow.position.y = 0.07;

    // headlight spotlight
    this.spot = new THREE.SpotLight(0xcfeaff, 260, 55, 0.55, 0.45, 1.6);
    this.spot.position.set(0, 1.7, 2.6);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0.4, 16);
    this.group.add(spotTarget);
    this.spot.target = spotTarget;

    this.group.add(cargoBox, cabin, hood, windshield, stripe, bumper, roofBar, logo, this.packageMesh, this.underglow, this.spot);
    scene.add(this.group);
  }

  reset(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.group.visible = true;
    this.syncMesh();
  }

  setPackage(on: boolean) {
    this.packageMesh.visible = on;
  }

  smokePoint(out: THREE.Vector3) {
    out.copy(this.smokeAnchor);
  }

  update(dt: number, input: InputState, offRoad: boolean): VehicleFrame {
    const f = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const side = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));

    let vf = this.vel.dot(f);
    let vl = this.vel.dot(side);

    // engine / brakes / reverse
    if (input.throttle > 0) vf += 30 * input.throttle * dt * (offRoad ? 0.6 : 1);
    else if (input.throttle < 0) {
      if (vf > 1) vf -= 42 * dt;
      else vf -= 13 * dt;
    }
    if (input.handbrake) vf -= vf * 1.6 * dt;

    // drag + caps
    vf -= vf * (0.5 + (offRoad ? 1.9 : 0)) * dt;
    vf = clamp(vf, -9.5, 46);

    // lateral grip (drift)
    const grip = input.handbrake ? 2.1 : offRoad ? 4.5 : 8.6;
    vl *= Math.exp(-grip * dt);

    // steering
    const speedFactor = clamp(Math.abs(vf) / 10, 0, 1) * (1 - 0.22 * (Math.abs(vf) / 46));
    const steerDir = vf < -0.6 ? -1 : 1;
    this.heading -= input.steer * 2.35 * speedFactor * steerDir * (input.handbrake ? 1.3 : 1) * dt;

    this.vel.copy(f).multiplyScalar(vf).addScaledVector(side, vl);
    this.pos.addScaledVector(this.vel, dt);

    this.syncMesh();

    // wheel spin + steer visuals
    for (const w of this.wheels) w.rotation.x += (vf * dt) / 0.46;
    for (const p of this.frontPivots) p.rotation.y = -input.steer * 0.42;

    const braking = input.throttle < 0 && vf > 1;
    this.tailMat.color.setHex(braking || input.handbrake ? 0xff2233 : 0x991122);
    this.smokeAnchor.set(this.pos.x - f.x * 2.2, 0.9, this.pos.z - f.z * 2.2);

    return {
      vf,
      vl,
      kmh: Math.abs(vf) * 3.6,
      drifting: Math.abs(vl) > 4.5 && Math.abs(vf) > 11,
      braking,
    };
  }

  private syncMesh() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  hide() {
    this.group.visible = false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}
