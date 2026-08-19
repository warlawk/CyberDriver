import * as THREE from "three";

/* Procedural texture factory — every surface in the game is painted
   onto canvases at city-build time. No external image files. */

export interface Canvas2D {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

export function makeCanvas(w: number, h: number): Canvas2D {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

export function toTex(
  c: HTMLCanvasElement,
  opts: { repeatX?: number; repeatY?: number; nearest?: boolean; srgb?: boolean } = {}
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(opts.repeatX ?? 1, opts.repeatY ?? 1);
  if (opts.nearest) {
    t.magFilter = THREE.NearestFilter;
  }
  t.anisotropy = 4;
  return t;
}

export function disposeDeep(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        for (const key of ["map", "emissiveMap", "alphaMap"] as const) {
          const tx = (m as unknown as Record<string, THREE.Texture | null>)[key];
          if (tx && tx.dispose) tx.dispose();
        }
        m.dispose();
      }
    }
  });
}

/* ---------------- shared painters ---------------- */

/** gritty asphalt: aggregate speckle, cracks, oil stains */
export function paintAsphalt(g: CanvasRenderingContext2D, w: number, h: number, rng: () => number) {
  g.fillStyle = "#0a0d18";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const light = rng() > 0.5;
    g.fillStyle = light
      ? `rgba(210,225,255,${(rng() * 0.06).toFixed(3)})`
      : `rgba(0,0,0,${(rng() * 0.16).toFixed(3)})`;
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
  }
  // cracks — jittered random walks
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.lineWidth = 1;
  for (let cr = 0; cr < 4; cr++) {
    g.beginPath();
    let x = rng() * w;
    let y = rng() * h;
    g.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      x += (rng() - 0.5) * 26;
      y += (rng() - 0.35) * 22;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // oil stains
  for (let s = 0; s < 3; s++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 10 + rng() * 22;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, "rgba(4,5,12,0.42)");
    grad.addColorStop(1, "rgba(4,5,12,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/* ---------------- building facades ---------------- */

const BUILDING_TINTS = ["#131c38", "#171229", "#0f2029", "#1d1533", "#121a2e", "#181226", "#0e1a20"];
const WINDOW_LIT = ["#ffdf9e", "#9fe8ff", "#ff9ec8", "#a5ffd0", "#ffe14d", "#ffd0a0"];

export interface FacadeSet {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

/** Rich tower facade: tinted panels, window grid with lit/dark cells,
    AC units, floor seams, storefront band. Separate emissive canvas so
    only lit windows + storefronts bloom. */
export function buildingFacade(rng: () => number): FacadeSet {
  const W = 128;
  const H = 256;
  const { c: cm, g: gm } = makeCanvas(W, H);
  const { c: ce, g: ge } = makeCanvas(W, H);

  const tint = BUILDING_TINTS[Math.floor(rng() * BUILDING_TINTS.length)];
  gm.fillStyle = tint;
  gm.fillRect(0, 0, W, H);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W, H);

  // vertical panel shading
  for (let x = 0; x < W; x += 16) {
    gm.fillStyle = `rgba(0,0,0,${(0.05 + rng() * 0.1).toFixed(3)})`;
    gm.fillRect(x, 0, 2, H);
  }
  // parapet band
  gm.fillStyle = "rgba(0,0,0,0.45)";
  gm.fillRect(0, 0, W, 8);
  gm.fillStyle = "rgba(190,215,255,0.16)";
  gm.fillRect(0, 8, W, 2);

  // window grid
  const cols = 6;
  const rows = 11;
  const top = 14;
  const bottom = 34; // storefront zone
  const cw = W / cols;
  const ch = (H - top - bottom) / rows;
  const litRatio = 0.24 + rng() * 0.2;

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const wx = x * cw + 3;
      const wy = top + y * ch + 3;
      const ww = cw - 6;
      const wh = ch - 6;
      // floor seam
      gm.fillStyle = "rgba(0,0,0,0.3)";
      gm.fillRect(0, top + y * ch, W, 1);

      const lit = rng() < litRatio;
      if (lit) {
        const col = WINDOW_LIT[Math.floor(rng() * WINDOW_LIT.length)];
        const a = 0.45 + rng() * 0.55;
        gm.globalAlpha = a;
        gm.fillStyle = col;
        const half = rng() < 0.22;
        gm.fillRect(wx, half ? wy + wh / 2 : wy, ww, half ? wh / 2 : wh);
        gm.globalAlpha = 1;
        // emissive twin (slightly inset, full alpha)
        ge.globalAlpha = Math.min(1, a + 0.2);
        ge.fillStyle = col;
        ge.fillRect(wx, half ? wy + wh / 2 : wy, ww, half ? wh / 2 : wh);
        ge.globalAlpha = 1;
      } else {
        // dark glass with faint sky reflection
        gm.fillStyle = "#0a1122";
        gm.fillRect(wx, wy, ww, wh);
        gm.fillStyle = "rgba(120,160,220,0.1)";
        gm.fillRect(wx, wy, ww, 2);
        // AC unit under some windows
        if (rng() < 0.16) {
          gm.fillStyle = "#232c44";
          gm.fillRect(wx + 1, wy + wh + 1, ww - 2, 4);
          gm.fillStyle = "rgba(0,0,0,0.55)";
          gm.fillRect(wx + 2, wy + wh + 2, ww - 4, 1);
          gm.fillRect(wx + 2, wy + wh + 4, ww - 4, 1);
        }
      }
    }
  }

  // storefront band
  const sy = H - bottom;
  gm.fillStyle = "#070a16";
  gm.fillRect(0, sy, W, bottom);
  const accent = WINDOW_LIT[Math.floor(rng() * WINDOW_LIT.length)];
  // awning stripes
  for (let x = 0; x < W; x += 12) {
    gm.fillStyle = (x / 12) % 2 === 0 ? accent : "#0b0f1f";
    gm.globalAlpha = 0.75;
    gm.fillRect(x, sy + 4, 12, 7);
    gm.globalAlpha = 1;
  }
  // shop windows
  for (let x = 4; x < W - 14; x += 26) {
    const wcol = rng() < 0.65 ? accent : "#9fe8ff";
    gm.fillStyle = wcol;
    gm.globalAlpha = 0.5 + rng() * 0.35;
    gm.fillRect(x, sy + 15, 20, 13);
    gm.globalAlpha = 1;
    ge.fillStyle = wcol;
    ge.globalAlpha = 0.8;
    ge.fillRect(x, sy + 15, 20, 13);
    ge.globalAlpha = 1;
  }
  // glow line under awning (emissive)
  ge.fillStyle = accent;
  ge.globalAlpha = 0.9;
  ge.fillRect(0, sy + 11, W, 2);
  ge.globalAlpha = 1;

  return {
    map: toTex(cm, { nearest: true }),
    emissiveMap: toTex(ce, { nearest: true }),
  };
}

/** dark rooftop: AC boxes, vents, gravel */
export function rooftopCanvas(rng: () => number): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128);
  g.fillStyle = "#101527";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(190,210,255,${(rng() * 0.05).toFixed(3)})`;
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.strokeRect(3, 3, 122, 122);
  // AC boxes
  for (let i = 0; i < 3; i++) {
    const x = 10 + rng() * 80;
    const y = 10 + rng() * 80;
    g.fillStyle = "#232c44";
    g.fillRect(x, y, 24, 18);
    g.fillStyle = "#0c1120";
    g.beginPath();
    g.arc(x + 12, y + 9, 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(140,160,200,0.35)";
    g.strokeRect(x, y, 24, 18);
  }
  // vent pipes
  g.fillStyle = "#2a3352";
  g.fillRect(100, 12, 10, 10);
  g.fillRect(14, 100, 12, 8);
  return c;
}

/* ---------------- street surfaces ---------------- */

export function concreteCanvas(rng: () => number): HTMLCanvasElement {
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = "#161d31";
  g.fillRect(0, 0, S, S);
  // tile grid 4x4
  const t = S / 4;
  for (let i = 0; i <= 4; i++) {
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(i * t - 1, 0, 2, S);
    g.fillRect(0, i * t - 1, S, 2);
    g.fillStyle = "rgba(150,175,220,0.07)";
    g.fillRect(i * t + 1, 0, 1, S);
  }
  // grime blotches
  for (let i = 0; i < 9; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 12 + rng() * 30;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // gum dots + cracks
  g.fillStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i < 40; i++) g.fillRect(rng() * S, rng() * S, 2, 2);
  g.strokeStyle = "rgba(0,0,0,0.4)";
  g.beginPath();
  let x = rng() * S;
  let y = 0;
  g.moveTo(x, y);
  while (y < S) {
    x += (rng() - 0.5) * 22;
    y += 14 + rng() * 12;
    g.lineTo(x, y);
  }
  g.stroke();
  return c;
}

/* ---------------- vehicle paints ---------------- */

/** metallic traffic paint: speckle, pinstripe, road grime, scratches */
export function carPaintCanvas(base: string, rng: () => number): HTMLCanvasElement {
  const W = 128;
  const H = 64;
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 380; i++) {
    g.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
    g.fillRect(rng() * W, rng() * H, 1, 1);
  }
  // roof / hood darkening at edges
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,255,255,0.12)");
  grad.addColorStop(0.25, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.4)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // pinstripe
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(0, 16, W, 2);
  // grime band
  g.fillStyle = "rgba(10,12,20,0.35)";
  g.fillRect(0, H - 12, W, 12);
  // scratches
  g.strokeStyle = "rgba(220,230,255,0.25)";
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const sx = rng() * W;
    const sy = rng() * H;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + 10 + rng() * 22, sy + (rng() - 0.5) * 6);
    g.stroke();
  }
  return c;
}

/** CDD EXPRESS delivery livery for the van cargo box sides */
export function vanLiveryCanvas(): HTMLCanvasElement {
  const W = 256;
  const H = 128;
  const { c, g } = makeCanvas(W, H);
  // steel-blue base with panel noise
  g.fillStyle = "#31456e";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
    g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }
  // diagonal magenta chevrons (front section)
  g.save();
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 0);
  g.lineTo(24, H);
  g.lineTo(0, H);
  g.closePath();
  g.clip();
  g.fillStyle = "#ff2e7e";
  g.fillRect(0, 0, 64, H);
  g.fillStyle = "#0e1526";
  for (let i = 0; i < 5; i++) {
    g.save();
    g.translate(0, i * 32);
    g.beginPath();
    g.moveTo(0, 26);
    g.lineTo(64, 10);
    g.lineTo(64, 16);
    g.lineTo(0, 32);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.restore();
  // brand block
  g.font = "900 42px Orbitron, Rajdhani, sans-serif";
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.shadowColor = "#26e6ff";
  g.shadowBlur = 14;
  g.fillStyle = "#eafcff";
  g.fillText("CDD", 84, 42);
  g.font = "700 24px Rajdhani, sans-serif";
  g.fillStyle = "#26e6ff";
  g.fillText("EXPRESS", 84, 74);
  g.shadowBlur = 0;
  g.font = "600 13px Rajdhani, sans-serif";
  g.fillStyle = "#ffe14d";
  g.fillText("SECTOR-7 COURIER LICENSE 77-C", 84, 96);
  // rivets
  g.fillStyle = "rgba(200,220,255,0.4)";
  for (let x = 6; x < W; x += 20) {
    g.fillRect(x, 5, 2, 2);
    g.fillRect(x, H - 21, 2, 2);
  }
  // hazard band along the bottom
  g.fillStyle = "#ffe14d";
  g.fillRect(0, H - 14, W, 14);
  g.fillStyle = "#10131f";
  for (let i = -1; i < 18; i++) {
    g.beginPath();
    g.moveTo(i * 16, H);
    g.lineTo(i * 16 + 8, H - 14);
    g.lineTo(i * 16 + 16, H - 14);
    g.lineTo(i * 16 + 8, H);
    g.closePath();
    g.fill();
  }
  // wear: scratches + dirt
  g.strokeStyle = "rgba(220,235,255,0.22)";
  for (let i = 0; i < 6; i++) {
    const sx = 70 + Math.random() * 170;
    const sy = 10 + Math.random() * 90;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + 14 + Math.random() * 26, sy + (Math.random() - 0.5) * 8);
    g.stroke();
  }
  const dirt = g.createLinearGradient(0, H - 34, 0, H);
  dirt.addColorStop(0, "rgba(8,10,18,0)");
  dirt.addColorStop(1, "rgba(8,10,18,0.4)");
  g.fillStyle = dirt;
  g.fillRect(0, H - 34, W, 34);
  return c;
}

/** plain brushed-steel panels for cab / hood / bumpers */
export function steelPanelCanvas(rng: () => number): HTMLCanvasElement {
  const W = 128;
  const H = 64;
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = "#2c3f66";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
    g.fillRect(rng() * W, rng() * H, 1, 1);
  }
  // panel seams
  g.strokeStyle = "rgba(0,0,0,0.4)";
  g.beginPath();
  g.moveTo(W * 0.5, 0);
  g.lineTo(W * 0.5, H);
  g.stroke();
  g.strokeStyle = "rgba(180,205,255,0.15)";
  g.beginPath();
  g.moveTo(W * 0.5 + 1, 0);
  g.lineTo(W * 0.5 + 1, H);
  g.stroke();
  // door handle
  g.fillStyle = "rgba(200,220,255,0.35)";
  g.fillRect(W * 0.5 - 14, H * 0.45, 10, 3);
  // grime
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.6, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return c;
}

/** van roof: ribs + vents */
export function vanRoofCanvas(rng: () => number): HTMLCanvasElement {
  const S = 128;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = "#3d5488";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
    g.fillRect(rng() * S, rng() * S, 1, 1);
  }
  g.strokeStyle = "rgba(0,0,0,0.35)";
  for (let x = 12; x < S; x += 16) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x, S - 4);
    g.stroke();
  }
  // vent
  g.fillStyle = "#232c44";
  g.fillRect(S / 2 - 16, S / 2 - 10, 32, 20);
  g.fillStyle = "#0c1120";
  g.fillRect(S / 2 - 12, S / 2 - 6, 24, 3);
  g.fillRect(S / 2 - 12, S / 2, 24, 3);
  g.fillRect(S / 2 - 12, S / 2 + 6, 24, 3);
  return c;
}
