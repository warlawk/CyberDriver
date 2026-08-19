import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* Loads a small Khronos glTF sample as the plaza "holo-monument".
   If the network fetch fails (or times out) a procedural fallback
   hologram is used — the game never depends on the external model. */

const GLTF_URL =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb";

export interface HoloAsset {
  group: THREE.Group;
  update: (t: number, dt: number) => void;
  fromGltf: boolean;
}

export class AssetManager {
  loadedGltf = 0;
  private disposed = false;

  async loadHolo(scene: THREE.Scene, x: number, z: number): Promise<HoloAsset> {
    const group = new THREE.Group();
    group.position.set(x, 2.2, z);
    scene.add(group);

    const holoWire = new THREE.MeshBasicMaterial({
      color: 0x26e6ff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const holoFill = new THREE.MeshBasicMaterial({
      color: 0x26e6ff,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    let fromGltf = false;
    let inner: THREE.Object3D | null = null;

    try {
      const gltf = await Promise.race([
        new GLTFLoader().loadAsync(GLTF_URL),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("gltf timeout")), 6500)),
      ]);
      if (this.disposed) return { group, update: () => {}, fromGltf: false };
      inner = gltf.scene;
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const scale = 7.5 / Math.max(size.x, size.y, size.z);
      inner.scale.setScalar(scale);
      box.setFromObject(inner);
      const center = box.getCenter(new THREE.Vector3());
      inner.position.sub(center);
      inner.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.material = holoWire;
          m.castShadow = false;
        }
      });
      this.loadedGltf++;
      fromGltf = true;
    } catch {
      if (this.disposed) return { group, update: () => {}, fromGltf: false };
      // procedural fallback hologram
      const geo = new THREE.IcosahedronGeometry(3.1, 1);
      const wire = new THREE.Mesh(geo, holoWire);
      const fill = new THREE.Mesh(geo, holoFill);
      const ringA = new THREE.Mesh(
        new THREE.TorusGeometry(4.2, 0.1, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0xff2e7e, transparent: true, opacity: 0.7 })
      );
      ringA.rotation.x = Math.PI / 2.4;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), holoFill.clone());
      const holder = new THREE.Group();
      holder.add(wire, fill, ringA, core);
      holder.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o !== wire) {
          /* keep materials as configured */
        }
      });
      inner = holder;
    }

    group.add(inner);
    const fillClone = inner.clone(true);
    fillClone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = holoFill;
    });
    fillClone.scale.multiplyScalar(1.02);
    group.add(fillClone);

    const target = inner;
    const update = (t: number, dt: number) => {
      group.rotation.y += dt * 0.55;
      group.position.y = 6.4 + Math.sin(t * 1.4) * 0.5;
      holoWire.opacity = 0.65 + 0.25 * Math.sin(t * 9.3);
      void target;
    };

    return { group, update, fromGltf };
  }

  dispose() {
    this.disposed = true;
  }
}
