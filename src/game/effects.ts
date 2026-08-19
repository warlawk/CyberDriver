import * as THREE from "three";

/* ---------------- generic additive point pool ---------------- */
class PointPool {
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private cursor = 0;
  private count: number;
  points: THREE.Points;
  gravity: number;

  constructor(scene: THREE.Scene, count: number, size: number, gravity: number) {
    this.count = count;
    this.gravity = gravity;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
  }

  burst(x: number, y: number, z: number, n: number, speed: number, life: number, color: THREE.Color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * speed * 0.8;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.spawn(
        x, y, z,
        Math.cos(a) * sp, up, Math.sin(a) * sp,
        life * (0.5 + Math.random() * 0.5),
        color.r, color.g, color.b
      );
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.4;
      }
      const f = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6);
      // colors were stored at full brightness; scale toward zero as they die
      this.col[i * 3] *= 0.9 + 0.1 * f;
      this.col[i * 3 + 1] *= 0.9 + 0.1 * f;
      this.col[i * 3 + 2] *= 0.9 + 0.1 * f;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------------- rain as streak line segments ---------------- */
class Rain {
  segs: THREE.LineSegments;
  private pos: Float32Array;
  private n: number;
  private cx = 0;
  private cz = 0;
  private spread = 42;

  constructor(scene: THREE.Scene) {
    this.n = 520;
    this.pos = new Float32Array(this.n * 6);
    for (let i = 0; i < this.n; i++) this.resetDrop(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.segs = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x8fb8e8, transparent: true, opacity: 0.32 })
    );
    this.segs.frustumCulled = false;
    this.segs.visible = false;
    scene.add(this.segs);
  }

  private resetDrop(i: number, randomY: boolean) {
    const x = this.cx + (Math.random() - 0.5) * this.spread * 2;
    const z = this.cz + (Math.random() - 0.5) * this.spread * 2;
    const y = randomY ? Math.random() * 34 : 30 + Math.random() * 6;
    this.pos[i * 6] = x;
    this.pos[i * 6 + 1] = y;
    this.pos[i * 6 + 2] = z;
    this.pos[i * 6 + 3] = x - 0.12;
    this.pos[i * 6 + 4] = y + 1.35;
    this.pos[i * 6 + 5] = z;
  }

  set(on: boolean) {
    this.segs.visible = on;
  }

  update(dt: number, cx: number, cz: number) {
    if (!this.segs.visible) return;
    if (Math.hypot(cx - this.cx, cz - this.cz) > 12) {
      this.cx = cx;
      this.cz = cz;
    }
    const fall = 42 * dt;
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 6 + 1] -= fall;
      this.pos[i * 6 + 4] -= fall;
      if (this.pos[i * 6 + 1] < 0) this.resetDrop(i, false);
    }
    (this.segs.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------------- facade: everything the game needs ---------------- */
export class Effects {
  sparks: PointPool;
  smoke: PointPool;
  rain: Rain;
  private shakeAmt = 0;
  private cSpark = new THREE.Color(0xffe14d);
  private cCyan = new THREE.Color(0x26e6ff);
  private cSmoke = new THREE.Color(0x5a6a88);
  private cFire = new THREE.Color(0xff8a3d);

  constructor(scene: THREE.Scene) {
    this.sparks = new PointPool(scene, 700, 0.34, 22);
    this.smoke = new PointPool(scene, 420, 1.5, -1.4); // negative gravity = rises
    this.rain = new Rain(scene);
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.4, this.shakeAmt + amount);
  }

  /** decaying camera shake offset */
  shakeOffset(dt: number, out: THREE.Vector3) {
    this.shakeAmt *= Math.exp(-5.5 * dt);
    const a = this.shakeAmt * this.shakeAmt;
    out.set(
      (Math.random() - 0.5) * a * 1.1,
      (Math.random() - 0.5) * a * 0.7,
      (Math.random() - 0.5) * a * 1.1
    );
  }

  crashSparks(x: number, y: number, z: number, hard: boolean) {
    this.sparks.burst(x, y, z, hard ? 34 : 14, hard ? 13 : 8, 0.7, hard ? this.cFire : this.cSpark);
    if (hard) this.smoke.burst(x, y + 0.5, z, 10, 3, 1.4, this.cSmoke);
  }

  driftSmoke(x: number, y: number, z: number) {
    this.smoke.spawn(
      x + (Math.random() - 0.5) * 1.2, y, z + (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.5, 1.6 + Math.random(), (Math.random() - 0.5) * 1.5,
      0.8 + Math.random() * 0.5,
      this.cSmoke.r * 0.55, this.cSmoke.g * 0.55, this.cSmoke.b * 0.6
    );
  }

  pickupBurst(x: number, z: number) {
    this.sparks.burst(x, 1.4, z, 40, 9, 1.0, this.cCyan);
  }

  deliverBurst(x: number, z: number) {
    this.sparks.burst(x, 1.4, z, 55, 11, 1.2, this.cSpark);
    this.sparks.burst(x, 2.4, z, 30, 7, 1.4, this.cCyan);
  }

  explode(x: number, z: number) {
    this.sparks.burst(x, 1.2, z, 90, 18, 1.4, this.cFire);
    this.sparks.burst(x, 1.6, z, 50, 12, 1.6, this.cSpark);
    this.smoke.burst(x, 1.4, z, 40, 5, 2.6, this.cSmoke);
    this.shake(1.3);
  }

  engineSmoke(x: number, y: number, z: number) {
    this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 0.8, 2.4, (Math.random() - 0.5) * 0.8, 1.2, 0.22, 0.2, 0.24);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.sparks.points, this.smoke.points, this.rain.segs);
    this.sparks.points.geometry.dispose();
    (this.sparks.points.material as THREE.Material).dispose();
    this.smoke.points.geometry.dispose();
    (this.smoke.points.material as THREE.Material).dispose();
    this.rain.segs.geometry.dispose();
    (this.rain.segs.material as THREE.Material).dispose();
  }

  update(dt: number, cx: number, cz: number) {
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.rain.update(dt, cx, cz);
  }
}
