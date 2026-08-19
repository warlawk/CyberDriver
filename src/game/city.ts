import * as THREE from "three";
import {
  mulberry32,
  rand,
  randInt,
  pick,
  chance,
  hash2,
  type CityData,
  type Collider,
  type IntersectionNode,
} from "./utils";
import {
  buildingFacade,
  rooftopCanvas,
  concreteCanvas,
  paintAsphalt,
  carPaintCanvas,
  barrierStripeCanvas,
  toTex,
} from "./textures";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* ---------------- city constants ---------------- */
export const BLOCKS = 7;
export const BLOCK = 44;
export const ROAD_W = 14;
export const PITCH = BLOCK + ROAD_W; // 58
export const HALF_ROAD = (BLOCKS / 2) * PITCH + ROAD_W / 2; // 210

const NEON = [0x26e6ff, 0xff2e7e, 0xffe14d, 0x38ff9e, 0xff8a3d];
const CAR_COLORS = [0x2b3550, 0x4a2540, 0x20444a, 0x3d3d20, 0x152438, 0x542b2b];

/* ---------------- canvas texture helpers ---------------- */
function cnv(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  return { c, g };
}
function tex(c: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

function asphaltBase(g: CanvasRenderingContext2D, w: number, h: number) {
  paintAsphalt(g, w, h, Math.random);
}

function laneCanvas(vertical: boolean) {
  const { c, g } = cnv(256, 256);
  asphaltBase(g, 256, 256);
  const draw = (horiz: boolean) => {
    g.fillStyle = "rgba(255,225,77,0.75)";
    if (horiz) {
      g.fillRect(10, 122, 108, 12);
      g.fillRect(148, 122, 108, 12);
      g.fillStyle = "rgba(210,230,255,0.4)";
      g.fillRect(0, 10, 256, 6);
      g.fillRect(0, 240, 256, 6);
    } else {
      g.fillRect(122, 10, 12, 108);
      g.fillRect(122, 148, 12, 108);
      g.fillStyle = "rgba(210,230,255,0.4)";
      g.fillRect(10, 0, 6, 256);
      g.fillRect(240, 0, 6, 256);
    }
  };
  draw(!vertical);
  return c;
}

function crossCanvas() {
  const { c, g } = cnv(256, 256);
  asphaltBase(g, 256, 256);
  g.fillStyle = "rgba(215,232,255,0.34)";
  for (let i = 0; i < 6; i++) {
    const o = 18 + i * 38;
    g.fillRect(o, 4, 20, 40); // top zebra
    g.fillRect(o, 212, 20, 40); // bottom
    g.fillRect(4, o, 40, 20); // left
    g.fillRect(212, o, 40, 20); // right
  }
  return c;
}

const SIGN_WORDS = ["RAMEN", "24H", "MOTEL", "ネオン", "ARCADE", "SYNTH", "CDD", "TAXI", "ホテル", "CLUB", "BAR", "PHO"];
function signCanvas(rng: () => number) {
  const { c, g } = cnv(256, 128);
  g.fillStyle = "rgba(4,6,16,0.92)";
  g.fillRect(0, 0, 256, 128);
  const col = "#" + pick(rng, NEON).toString(16).padStart(6, "0");
  const word = pick(rng, SIGN_WORDS);
  g.strokeStyle = col;
  g.lineWidth = 5;
  g.strokeRect(8, 8, 240, 112);
  g.font = `900 ${word.length > 5 ? 44 : 58}px Orbitron, Rajdhani, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = col;
  g.shadowBlur = 26;
  g.fillStyle = col;
  g.fillText(word, 128, 68);
  g.fillText(word, 128, 68);
  return c;
}

const BILL_WORDS = ["DRINK SYNTH-COLA", "CDD EXPRESS", "GRID-NET 24/7", "SECTOR 7 NIGHTS"];
function billboardCanvas(rng: () => number) {
  const { c, g } = cnv(512, 256);
  g.fillStyle = "#060918";
  g.fillRect(0, 0, 512, 256);
  const col = "#" + pick(rng, NEON).toString(16).padStart(6, "0");
  g.strokeStyle = col;
  g.lineWidth = 10;
  g.strokeRect(10, 10, 492, 236);
  g.font = "900 56px Orbitron, Rajdhani, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = col;
  g.shadowBlur = 30;
  g.fillStyle = col;
  g.fillText(pick(rng, BILL_WORDS), 256, 100);
  g.font = "700 30px Rajdhani, sans-serif";
  g.fillStyle = "#d7e6ff";
  g.shadowBlur = 10;
  g.fillText("/// NIGHT CITY APPROVED ///", 256, 180);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = col;
    g.globalAlpha = 0.5;
    g.fillRect(30 + i * 80, 218, 44, 10);
    g.globalAlpha = 1;
  }
  return c;
}

function poolCanvas() {
  const { c, g } = cnv(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,190,110,0.55)");
  grad.addColorStop(0.5, "rgba(255,150,70,0.16)");
  grad.addColorStop(1, "rgba(255,150,70,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function stripeCanvas() {
  const { c, g } = cnv(128, 32);
  g.fillStyle = "#141827";
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = "#ffe14d";
  for (let i = -1; i < 5; i++) {
    g.beginPath();
    g.moveTo(i * 32, 32);
    g.lineTo(i * 32 + 16, 0);
    g.lineTo(i * 32 + 32, 0);
    g.lineTo(i * 32 + 16, 32);
    g.fill();
  }
  return c;
}

/* ---------------- signal phase helpers (shared with traffic AI) ---------------- */
export function lightPhase(t: number, gx: number, gz: number) {
  return (t * 0.075 + hash2(gx, gz) * 0.97) % 1;
}
export function axisGo(t: number, gx: number, gz: number, axis: "h" | "v") {
  const ph = lightPhase(t, gx, gz);
  return axis === "h" ? ph < 0.5 : ph >= 0.5;
}

/* ---------------- generator ---------------- */
export function generateCity(seed: number): CityData {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const animators: CityData["animators"] = [];
  const plazas: { x: number; z: number }[] = [];
  const tallSpots: { x: number; y: number; z: number }[] = [];

  const lines: number[] = [];
  for (let i = 0; i <= BLOCKS; i++) lines.push((i - BLOCKS / 2) * PITCH);

  const nodes: IntersectionNode[] = [];
  for (let gx = 0; gx <= BLOCKS; gx++)
    for (let gz = 0; gz <= BLOCKS; gz++)
      nodes.push({ gx, gz, x: lines[gx], z: lines[gz] });

  /* --- ground --- */
  const concreteT = toTex(concreteCanvas(rng), { repeatX: 90, repeatY: 90 });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshLambertMaterial({ map: concreteT, color: 0x4a5474 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  /* --- road strips + lane markings --- */
  const laneTexH = tex(laneCanvas(false), HALF_ROAD * 2 / 18, 1);
  const laneTexV = tex(laneCanvas(true), 1, HALF_ROAD * 2 / 18);
  const roadMatH = new THREE.MeshLambertMaterial({ map: laneTexH });
  const roadMatV = new THREE.MeshLambertMaterial({ map: laneTexV });
  const stripGeoH = new THREE.PlaneGeometry(HALF_ROAD * 2, ROAD_W);
  const stripGeoV = new THREE.PlaneGeometry(ROAD_W, HALF_ROAD * 2);
  for (const l of lines) {
    const sh = new THREE.Mesh(stripGeoH, roadMatH);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(0, 0.02, l);
    group.add(sh);
    const sv = new THREE.Mesh(stripGeoV, roadMatV);
    sv.rotation.x = -Math.PI / 2;
    sv.position.set(l, 0.02, 0);
    group.add(sv);
  }

  /* --- intersections with crosswalks --- */
  const crossMat = new THREE.MeshLambertMaterial({ map: tex(crossCanvas()) });
  const crossGeo = new THREE.PlaneGeometry(ROAD_W, ROAD_W);
  for (const n of nodes) {
    const m = new THREE.Mesh(crossGeo, crossMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(n.x, 0.045, n.z);
    group.add(m);
  }

  /* --- shared facade textures (sides painted, rooftops separate) --- */
  const roofMat = new THREE.MeshLambertMaterial({
    map: toTex(rooftopCanvas(rng)),
    color: 0x9aa8cc,
  });
  const towerBottomMat = new THREE.MeshLambertMaterial({ color: 0x0c1120 });
  const facadeMats = Array.from({ length: 8 }, () => {
    const f = buildingFacade(rng);
    const side = new THREE.MeshLambertMaterial({
      map: f.map,
      emissiveMap: f.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      color: 0xcdd8f2,
    });
    // BoxGeometry face order: +x, -x, +y(top), -y(bottom), +z, -z
    return [side, side, roofMat, towerBottomMat, side, side];
  });
  const signTextures = Array.from({ length: 10 }, () => tex(signCanvas(rng)));
  const billTextures = Array.from({ length: 4 }, () => tex(billboardCanvas(rng)));
  const dummy = new THREE.Object3D();

  /* --- blocks: sidewalks + buildings + plazas --- */
  const sidewalkTop = new THREE.MeshLambertMaterial({
    map: toTex(concreteCanvas(rng), { repeatX: 5, repeatY: 5 }),
    color: 0xb8c4e4,
  });
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x232c48 });
  const sidewalkMats = [curbMat, curbMat, sidewalkTop, curbMat, curbMat, curbMat];
  const sidewalkGeo = new THREE.BoxGeometry(BLOCK, 0.3, BLOCK);
  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      const cx = (bx - (BLOCKS - 1) / 2) * PITCH;
      const cz = (bz - (BLOCKS - 1) / 2) * PITCH;
      const sw = new THREE.Mesh(sidewalkGeo, sidewalkMats);
      sw.position.set(cx, 0.15, cz);
      group.add(sw);

      const centerBias = 1 - (Math.abs(bx - 3) + Math.abs(bz - 3)) / 6;
      const isCenter = bx === 3 && bz === 3;
      const layout = isCenter ? 3 : rng() < 0.1 ? 3 : randInt(rng, 0, 2);

      if (layout === 3) {
        // plaza
        plazas.push({ x: cx, z: cz });
        const pad = new THREE.Mesh(
          new THREE.CylinderGeometry(13, 13, 0.16, 28),
          new THREE.MeshLambertMaterial({ color: 0x0b1126 })
        );
        pad.position.set(cx, 0.38, cz);
        group.add(pad);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(11.6, 12.4, 40),
          new THREE.MeshBasicMaterial({ color: 0x26e6ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cx, 0.47, cz);
        group.add(ring);
        animators.push((t) => {
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * Math.sin(t * 2.4);
        });
        if (isCenter) {
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(2.2, 2.6, 1.6, 10),
            new THREE.MeshLambertMaterial({ color: 0x1a2340, emissive: 0x26e6ff, emissiveIntensity: 0.4 })
          );
          base.position.set(cx, 1.18, cz);
          group.add(base);
        }
        continue;
      }

      const boxes: { w: number; d: number; h: number; ox: number; oz: number }[] = [];
      if (layout === 0) {
        boxes.push({ w: rand(rng, 16, 26), d: rand(rng, 16, 26), h: rand(rng, 20, 46) * (0.5 + 0.95 * centerBias), ox: 0, oz: 0 });
      } else if (layout === 1) {
        boxes.push(
          { w: 15, d: rand(rng, 20, 30), h: rand(rng, 10, 28) * (0.5 + 0.95 * centerBias), ox: -9.5, oz: 0 },
          { w: 15, d: rand(rng, 20, 30), h: rand(rng, 10, 28) * (0.5 + 0.95 * centerBias), ox: 9.5, oz: 0 }
        );
      } else {
        for (const sx of [-1, 1])
          for (const sz of [-1, 1])
            boxes.push({ w: 14, d: 14, h: rand(rng, 6, 18) * (0.5 + 0.95 * centerBias), ox: sx * 9, oz: sz * 9 });
      }

      for (const b of boxes) {
        const h = Math.max(5, b.h);
        const mat = pick(rng, facadeMats);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, h, b.d), mat);
        mesh.position.set(cx + b.ox, 0.3 + h / 2, cz + b.oz);
        group.add(mesh);
        colliders.push({
          kind: "box",
          minX: cx + b.ox - b.w / 2 - 0.25,
          maxX: cx + b.ox + b.w / 2 + 0.25,
          minZ: cz + b.oz - b.d / 2 - 0.25,
          maxZ: cz + b.oz + b.d / 2 + 0.25,
        });

        if (h > 24 && chance(rng, 0.55)) {
          const trim = new THREE.Mesh(
            new THREE.BoxGeometry(b.w + 0.4, 0.5, b.d + 0.4),
            new THREE.MeshBasicMaterial({ color: pick(rng, NEON) })
          );
          trim.position.set(cx + b.ox, 0.3 + h + 0.1, cz + b.oz);
          group.add(trim);
        }
        if (h > 15 && chance(rng, 0.3)) {
          const ant = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.12, 7, 5),
            new THREE.MeshLambertMaterial({ color: 0x3a4468 })
          );
          ant.position.set(cx + b.ox + b.w * 0.2, 0.3 + h + 3.5, cz + b.oz);
          group.add(ant);
          const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3344 });
          const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), beaconMat);
          beacon.position.set(cx + b.ox + b.w * 0.2, 0.3 + h + 7.1, cz + b.oz);
          group.add(beacon);
          const ph = rng() * 10;
          animators.push((t) => {
            beaconMat.color.setHex(Math.sin(t * 2.6 + ph) > 0.2 ? 0xff3344 : 0x2a0a10);
          });
        }
        if (h > 26) tallSpots.push({ x: cx + b.ox, y: 0.3 + h, z: cz + b.oz });

        // wall neon signs
        if (h > 9 && chance(rng, 0.65)) {
          const nSigns = randInt(rng, 1, 2);
          for (let s = 0; s < nSigns; s++) {
            const smat = new THREE.MeshBasicMaterial({
              map: pick(rng, signTextures),
              transparent: true,
              side: THREE.DoubleSide,
            });
            const blade = chance(rng, 0.4);
            const w = blade ? 2.6 : rand(rng, 5, 9);
            const hh = blade ? rand(rng, 7, 11) : w * 0.5;
            const geo = new THREE.PlaneGeometry(w, hh);
            const sign = new THREE.Mesh(geo, smat);
            const face = randInt(rng, 0, 3);
            const y = 0.3 + rand(rng, h * 0.35, Math.max(h * 0.4, h * 0.85));
            const off = 0.2;
            if (face === 0) { sign.position.set(cx + b.ox, y, cz + b.oz + b.d / 2 + off); }
            else if (face === 1) { sign.position.set(cx + b.ox, y, cz + b.oz - b.d / 2 - off); sign.rotation.y = Math.PI; }
            else if (face === 2) { sign.position.set(cx + b.ox + b.w / 2 + off, y, cz + b.oz); sign.rotation.y = Math.PI / 2; }
            else { sign.position.set(cx + b.ox - b.w / 2 - off, y, cz + b.oz); sign.rotation.y = -Math.PI / 2; }
            if (blade) {
              sign.position.x += face === 2 ? 1.4 : face === 3 ? -1.4 : 0;
              sign.position.z += face === 0 ? 1.4 : face === 1 ? -1.4 : 0;
            }
            group.add(sign);
            if (chance(rng, 0.3)) {
              const ph = rng() * 20;
              animators.push((t) => {
                smat.opacity = Math.sin(t * 17 + ph) > -0.94 ? 1 : 0.2;
              });
            }
          }
        }
      }
    }
  }

  /* --- rooftop billboards --- */
  for (let i = tallSpots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tallSpots[i], tallSpots[j]] = [tallSpots[j], tallSpots[i]];
  }
  for (const spot of tallSpots.slice(0, 6)) {
    const bmat = new THREE.MeshBasicMaterial({ map: pick(rng, billTextures), transparent: true, side: THREE.DoubleSide });
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(15, 7.5), bmat);
    bb.position.set(spot.x, spot.y + 5.2, spot.z);
    bb.rotation.y = pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    group.add(bb);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 3.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x2a3352 })
    );
    pole.position.set(spot.x, spot.y + 1.6, spot.z);
    group.add(pole);
    const ph = rng() * 9;
    animators.push((t) => {
      bmat.opacity = 0.88 + 0.12 * Math.sin(t * 1.7 + ph);
    });
  }

  /* --- street lamps (instanced) --- */
  const lampPositions: THREE.Vector3[] = [];
  for (const n of nodes)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        lampPositions.push(new THREE.Vector3(n.x + sx * (ROAD_W / 2 + 1.6), 0, n.z + sz * (ROAD_W / 2 + 1.6)));

  const poleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.18, 6.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x2a3352 }),
    lampPositions.length
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.0, 0.26, 1.0),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    lampPositions.length
  );
  const poolTexT = tex(poolCanvas());
  const poolMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ map: poolTexT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
    lampPositions.length
  );
  lampPositions.forEach((p, i) => {
    dummy.position.set(p.x, 3.2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 6.45, p.z);
    dummy.updateMatrix();
    headMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 0.06, p.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    poolMesh.setMatrixAt(i, dummy.matrix);
    dummy.rotation.set(0, 0, 0);
  });
  group.add(poleMesh, headMesh, poolMesh);

  /* --- traffic signals (instanced dots, updated per frame) --- */
  const sigDots: { node: number; axis: "h" | "v"; kind: "r" | "g" }[] = [];
  const sigGeo = new THREE.SphereGeometry(0.17, 6, 6);
  const sigHousing = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.55, 1.5, 0.55),
    new THREE.MeshLambertMaterial({ color: 0x11182c }),
    nodes.length * 2
  );
  const sigPoles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.1, 0.12, 4.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x232c4c }),
    nodes.length * 2
  );
  let hi = 0;
  const dotSlots: THREE.Vector3[] = [];
  for (const n of nodes) {
    for (const s of [1, -1]) {
      const px = n.x + s * (ROAD_W / 2 + 0.9);
      const pz = n.z + s * (ROAD_W / 2 + 0.9);
      dummy.position.set(px, 2.2, pz);
      dummy.updateMatrix();
      sigPoles.setMatrixAt(hi, dummy.matrix);
      dummy.position.set(px, 4.7, pz);
      dummy.updateMatrix();
      sigHousing.setMatrixAt(hi, dummy.matrix);
      // dots face both axes: red over green, offset outward per axis
      dotSlots.push(new THREE.Vector3(px + 0.34 * s, 5.0, pz), new THREE.Vector3(px + 0.34 * s, 4.45, pz));
      sigDots.push({ node: nodes.indexOf(n), axis: "h", kind: "r" }, { node: nodes.indexOf(n), axis: "h", kind: "g" });
      dotSlots.push(new THREE.Vector3(px, 5.0, pz + 0.34 * s), new THREE.Vector3(px, 4.45, pz + 0.34 * s));
      sigDots.push({ node: nodes.indexOf(n), axis: "v", kind: "r" }, { node: nodes.indexOf(n), axis: "v", kind: "g" });
      hi++;
    }
  }
  const dotMesh = new THREE.InstancedMesh(sigGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), dotSlots.length);
  dotSlots.forEach((p, i) => {
    dummy.position.copy(p);
    dummy.updateMatrix();
    dotMesh.setMatrixAt(i, dummy.matrix);
    dotMesh.setColorAt(i, new THREE.Color(0x111111));
  });
  group.add(sigPoles, sigHousing, dotMesh);

  const cTmp = new THREE.Color();
  animators.push((t) => {
    for (let i = 0; i < sigDots.length; i++) {
      const d = sigDots[i];
      const n = nodes[d.node];
      const go = axisGo(t, n.gx, n.gz, d.axis);
      const on = d.kind === "g" ? go : !go;
      cTmp.setHex(on ? (d.kind === "g" ? 0x39ff6e : 0xff3344) : d.kind === "g" ? 0x062b12 : 0x2b060a);
      dotMesh.setColorAt(i, cTmp);
    }
    if (dotMesh.instanceColor) dotMesh.instanceColor.needsUpdate = true;
  });

  /* --- parked cars: exact traffic-car silhouette, but with lights off / muted --- */
  const parkedCount = 40;
  // same boxes & offsets as TrafficSystem.makeCar (front faces +Z, no side windows)
  const pcBodyGeo = mergeGeometries([
    new THREE.BoxGeometry(1.9, 0.95, 4.1).translate(0, 0.75, 0),
    new THREE.BoxGeometry(1.6, 0.72, 1.9).translate(0, 1.5, -0.25),
  ])!;
  const pcGlassGeo = new THREE.BoxGeometry(1.5, 0.4, 0.12).translate(0, 1.5, 0.72); // front windshield only
  const pcHeadGeo = mergeGeometries([
    new THREE.BoxGeometry(0.42, 0.2, 0.1).translate(0.6, 0.72, 2.06),
    new THREE.BoxGeometry(0.42, 0.2, 0.1).translate(-0.6, 0.72, 2.06),
  ])!;
  const pcTailGeo = mergeGeometries([
    new THREE.BoxGeometry(0.44, 0.22, 0.1).translate(0.62, 0.8, -2.06),
    new THREE.BoxGeometry(0.44, 0.22, 0.1).translate(-0.62, 0.8, -2.06),
  ])!;
  const parked = new THREE.InstancedMesh(
    pcBodyGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    parkedCount
  );
  const parkedGlass = new THREE.InstancedMesh(
    pcGlassGeo,
    new THREE.MeshLambertMaterial({ color: 0x182430 }), // dark glass, lights off
    parkedCount
  );
  const parkedHead = new THREE.InstancedMesh(
    pcHeadGeo,
    new THREE.MeshLambertMaterial({ color: 0x2c3550 }), // headlights off
    parkedCount
  );
  const parkedTail = new THREE.InstancedMesh(
    pcTailGeo,
    new THREE.MeshLambertMaterial({ color: 0x381018 }), // tail lights off
    parkedCount
  );
  for (let i = 0; i < parkedCount; i++) {
    const axisH = chance(rng, 0.5);
    const line = pick(rng, lines);
    const along = rand(rng, -HALF_ROAD + 10, HALF_ROAD - 10);
    const side = chance(rng, 0.5) ? 1 : -1;
    const px = axisH ? along : line + side * (ROAD_W / 2 - 1.9);
    const pz = axisH ? line + side * (ROAD_W / 2 - 1.9) : along;
    // keep intersections clear
    const nearLine = (v: number) => lines.some((l) => Math.abs(v - l) < 12);
    if (nearLine(axisH ? px : pz)) {
      i--;
      continue;
    }
    dummy.position.set(px, 0.03, pz);
    // local front (+Z) points along the road
    dummy.rotation.set(0, axisH ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? 0 : Math.PI, 0);
    dummy.updateMatrix();
    parked.setMatrixAt(i, dummy.matrix);
    parked.setColorAt(i, cTmp.setHex(pick(rng, CAR_COLORS)).multiplyScalar(0.8));
    parkedGlass.setMatrixAt(i, dummy.matrix);
    parkedHead.setMatrixAt(i, dummy.matrix);
    parkedTail.setMatrixAt(i, dummy.matrix);
    colliders.push({ kind: "circle", x: px, z: pz, r: 2.2 });
  }
  group.add(parked, parkedGlass, parkedHead, parkedTail);

  /* --- construction barriers (proper barricades: feet, striped boards, lamp, cones) --- */
  const boardTex = toTex(barrierStripeCanvas(), { repeatX: 2 });
  const boardMat = new THREE.MeshLambertMaterial({
    map: boardTex,
    emissiveMap: boardTex,
    emissive: 0xffffff,
    emissiveIntensity: 0.22,
    color: 0xf8efe2,
  });
  const orangeMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
  const darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x2c3550 });
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a10, emissive: 0xff6a10, emissiveIntensity: 0.12 });
  const coneBandMat = new THREE.MeshLambertMaterial({ color: 0xf2f4fb });
  const boardGeo = new THREE.BoxGeometry(6.4, 0.55, 0.14);
  const bPostGeo = new THREE.BoxGeometry(0.16, 1.05, 0.16);
  const bFootGeo = new THREE.BoxGeometry(0.5, 0.12, 1.1);
  const lampPostGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
  const bLampGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const coneGeo = new THREE.ConeGeometry(0.34, 0.85, 10);
  const coneBandGeo = new THREE.CylinderGeometry(0.21, 0.25, 0.14, 10);
  const nearRoadLine = (v: number) => lines.some((l) => Math.abs(v - l) < 12);
  let placedBarriers = 0;
  let barrierGuard = 0;
  while (placedBarriers < 4 && barrierGuard++ < 80) {
    const axisH = chance(rng, 0.5);
    const line = lines[randInt(rng, 1, BLOCKS - 1)];
    const along = rand(rng, -HALF_ROAD * 0.6, HALF_ROAD * 0.6);
    if (nearRoadLine(along)) continue; // keep intersections clear
    const side = chance(rng, 0.5) ? 1 : -1;
    const bx = axisH ? along : line + side * (ROAD_W / 2 - 2.4);
    const bz = axisH ? line + side * (ROAD_W / 2 - 2.4) : along;
    placedBarriers++;

    const bar = new THREE.Group();
    for (const sx of [-2.7, 2.7]) {
      const foot = new THREE.Mesh(bFootGeo, darkMetalMat);
      foot.position.set(sx, 0.06, 0);
      const post = new THREE.Mesh(bPostGeo, orangeMat);
      post.position.set(sx, 0.6, 0);
      bar.add(foot, post);
    }
    const upper = new THREE.Mesh(boardGeo, boardMat);
    upper.position.set(0, 1.02, 0);
    const lower = new THREE.Mesh(boardGeo, boardMat);
    lower.position.set(0, 0.42, 0);
    const lampPost = new THREE.Mesh(lampPostGeo, darkMetalMat);
    lampPost.position.set(2.7, 1.35, 0);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffa028 });
    const lampB = new THREE.Mesh(bLampGeo, lampMat);
    lampB.position.set(2.7, 1.72, 0);
    bar.add(upper, lower, lampPost, lampB);
    bar.position.set(bx, 0, bz);
    bar.rotation.y = axisH ? 0 : Math.PI / 2;
    group.add(bar);

    colliders.push({
      kind: "box",
      minX: bx - (axisH ? 3.3 : 0.55),
      maxX: bx + (axisH ? 3.3 : 0.55),
      minZ: bz - (axisH ? 0.55 : 3.3),
      maxZ: bz + (axisH ? 0.55 : 3.3),
    });

    const ph = rng() * 8;
    animators.push((t) => {
      lampMat.color.setHex(Math.sin(t * 5 + ph) > 0 ? 0xffa028 : 0x331a04);
    });

    // a traffic cone kicked out toward the live lane
    if (chance(rng, 0.8)) {
      const endOff = rand(rng, 3.7, 4.7) * (chance(rng, 0.5) ? 1 : -1);
      const latOff = side * (ROAD_W / 2 - 1.15);
      const cone = new THREE.Group();
      const body = new THREE.Mesh(coneGeo, coneMat);
      body.position.y = 0.42;
      const band = new THREE.Mesh(coneBandGeo, coneBandMat);
      band.position.y = 0.48;
      cone.add(body, band);
      cone.position.set(
        axisH ? along + endOff : bx + (latOff - side * (ROAD_W / 2 - 2.4)),
        0.02,
        axisH ? bz + (latOff - side * (ROAD_W / 2 - 2.4)) : along + endOff
      );
      cone.rotation.y = rng() * Math.PI;
      group.add(cone);
    }
  }

  /* --- perimeter guard rails with neon strip (solid — crashing works) --- */
  const railMat = new THREE.MeshLambertMaterial({ color: 0x16233d });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x1a8fa8 });
  const R = HALF_ROAD + 3.4;
  const RAIL_T = 1.0; // collider half-thickness — thick enough to never tunnel
  for (const s of [-1, 1]) {
    for (const axisH of [true, false]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(axisH ? R * 2 + 10 : 0.7, 1.3, axisH ? 0.7 : R * 2 + 10), railMat);
      rail.position.set(axisH ? 0 : s * R, 0.65, axisH ? s * R : 0);
      group.add(rail);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(axisH ? R * 2 + 10 : 0.2, 0.18, axisH ? 0.2 : R * 2 + 10), stripMat);
      strip.position.set(axisH ? 0 : s * R, 1.35, axisH ? s * R : 0);
      group.add(strip);
      // solid wall collider on every side of the map
      if (axisH) {
        colliders.push({
          kind: "box",
          minX: -(R + 6),
          maxX: R + 6,
          minZ: s * R - RAIL_T,
          maxZ: s * R + RAIL_T,
        });
      } else {
        colliders.push({
          kind: "box",
          minX: s * R - RAIL_T,
          maxX: s * R + RAIL_T,
          minZ: -(R + 6),
          maxZ: R + 6,
        });
      }
    }
  }

  // keep the center plaza first (holo monument anchor)
  plazas.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));

  return {
    seed,
    group,
    blocks: BLOCKS,
    pitch: PITCH,
    roadW: ROAD_W,
    lines,
    half: HALF_ROAD,
    colliders,
    nodes,
    animators,
  };
}
