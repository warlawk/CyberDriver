/* Thin wrapper around particles.js — used only for the cheap 2D
   screen-space atmosphere layer (drifting neon dust / rain haze).
   Anything that lives in the 3D world uses Three.js particles instead. */

declare global {
  interface Window {
    particlesJS?: (id: string, cfg: unknown) => void;
    pJSDom?: { pJS: { fn: { destroy(): void } } }[];
  }
}

const DUST = {
  particles: {
    number: { value: 44, density: { enable: true, value_area: 1100 } },
    color: { value: ["#26e6ff", "#ff2e7e", "#ffe14d"] },
    shape: { type: "circle" },
    opacity: { value: 0.22, random: true, anim: { enable: true, speed: 0.5, opacity_min: 0.03, sync: false } },
    size: { value: 2.4, random: true },
    line_linked: { enable: false },
    move: { enable: true, speed: 0.7, direction: "top", random: true, straight: false, out_mode: "out" },
  },
  interactivity: {
    detect_on: "canvas",
    events: { onhover: { enable: false }, onclick: { enable: false }, resize: true },
  },
  retina_detect: true,
};

const RAIN = {
  particles: {
    number: { value: 120, density: { enable: true, value_area: 900 } },
    color: { value: "#9fc4e8" },
    shape: { type: "circle" },
    opacity: { value: 0.28, random: true },
    size: { value: 1.5, random: true },
    line_linked: { enable: false },
    move: { enable: true, speed: 13, direction: "bottom", random: false, straight: true, out_mode: "out" },
  },
  interactivity: {
    detect_on: "canvas",
    events: { onhover: { enable: false }, onclick: { enable: false }, resize: true },
  },
  retina_detect: true,
};

export async function setAtmosphere(elId: string, mode: "dust" | "rain" | "off") {
  try {
    if (!window.particlesJS) {
      await import("particles.js");
    }
    if (window.pJSDom && window.pJSDom.length) {
      for (const inst of window.pJSDom) {
        try {
          const p = inst.pJS as unknown as {
            fn?: { destroy?: () => void; vendors?: { destroy?: () => void } };
          };
          p.fn?.vendors?.destroy?.();
          p.fn?.destroy?.();
        } catch {
          /* already gone */
        }
      }
      window.pJSDom.length = 0;
    }
    // belt & braces: drop any leftover canvas before re-init
    const el = document.getElementById(elId);
    if (el) el.innerHTML = "";
    if (mode === "off" || !window.particlesJS) return;
    window.particlesJS(elId, mode === "rain" ? RAIN : DUST);
  } catch {
    /* atmosphere layer is purely optional */
  }
}
