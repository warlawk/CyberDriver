import * as THREE from "three";
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from "postprocessing";

export class World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private hemi: THREE.HemisphereLight;
  private fog: THREE.FogExp2;
  private camPos = new THREE.Vector3(0, 80, 130);
  private lookAt = new THREE.Vector3(0, 0, 0);
  private fov = 62;
  private orbitAngle = 0;
  private tmp = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);
    this.fog = new THREE.FogExp2(0x070a18, 0.0078);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.copy(this.camPos);

    this.hemi = new THREE.HemisphereLight(0x3a4d80, 0x0b0d1c, 1.05);
    this.scene.add(this.hemi);
    const moon = new THREE.DirectionalLight(0x8fb4ff, 0.55);
    moon.position.set(80, 160, -60);
    this.scene.add(moon);
    const magentaGlow = new THREE.DirectionalLight(0xff2e7e, 0.16);
    magentaGlow.position.set(-120, 60, 140);
    this.scene.add(magentaGlow);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.42;
      const r = 500;
      starPos[i * 3] = Math.cos(th) * Math.sin(ph) * r;
      starPos[i * 3 + 1] = Math.cos(ph) * r;
      starPos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0x9fc4ff, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })
    );
    this.scene.add(stars);

    // moon disc
    const moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(34, 32),
      new THREE.MeshBasicMaterial({ color: 0xdceaff, fog: false, transparent: true, opacity: 0.9 })
    );
    moonDisc.position.set(-260, 300, -380);
    moonDisc.lookAt(0, 0, 0);
    this.scene.add(moonDisc);
    const moonHalo = new THREE.Mesh(
      new THREE.CircleGeometry(52, 32),
      new THREE.MeshBasicMaterial({
        color: 0x8fb4ff,
        fog: false,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    moonHalo.position.copy(moonDisc.position).multiplyScalar(0.999);
    moonHalo.lookAt(0, 0, 0);
    this.scene.add(moonHalo);

    // post processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({
      intensity: 1.05,
      luminanceThreshold: 0.32,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const ca = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.00075, 0.0005),
      radialModulation: false,
      modulationOffset: 0.15,
    });
    this.composer.addPass(new EffectPass(this.camera, bloom, vignette, ca));
  }

  setWeather(raining: boolean) {
    this.fog.density = raining ? 0.0098 : 0.0078;
    this.hemi.intensity = raining ? 0.85 : 1.05;
    (this.scene.background as THREE.Color).setHex(raining ? 0x04060d : 0x05070f);
  }

  /** cinematic orbit for title / game-over */
  updateOrbit(dt: number) {
    this.orbitAngle += dt * 0.07;
    const r = 150;
    this.tmp.set(Math.cos(this.orbitAngle) * r, 74, Math.sin(this.orbitAngle) * r);
    this.camPos.lerp(this.tmp, 1 - Math.exp(-1.2 * dt));
    this.lookAt.lerp(this.tmp2.set(0, 10, 0), 1 - Math.exp(-2 * dt));
    this.fov += (58 - this.fov) * (1 - Math.exp(-2 * dt));
    this.apply();
  }
  private tmp2 = new THREE.Vector3();

  /** chase cam behind the van */
  updateChase(
    dt: number,
    px: number,
    pz: number,
    heading: number,
    speedNorm: number,
    shake: THREE.Vector3
  ) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const back = 12.5 + speedNorm * 3.2;
    const height = 6.0 + speedNorm * 1.1;
    this.tmp.set(px - fx * back, height, pz - fz * back);
    const lambda = 5.0;
    this.camPos.lerp(this.tmp, 1 - Math.exp(-lambda * dt));
    this.camPos.add(shake);
    this.tmp.set(px + fx * (5 + speedNorm * 5), 1.7, pz + fz * (5 + speedNorm * 5));
    this.lookAt.lerp(this.tmp, 1 - Math.exp(-7 * dt));
    const targetFov = 61 + speedNorm * 17;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-3.2 * dt));
    this.apply();
  }

  private apply() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookAt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
