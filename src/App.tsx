import { useEffect, useRef, useState } from "react";
import { Game } from "./game/game";
import type { GamePhase, RunStats } from "./game/utils";
import { audio } from "./game/audio";

function Key({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="keycap">{k}</span>
      <span className="text-[13px] tracking-wide text-[#8fa6d8] uppercase font-semibold">{label}</span>
    </div>
  );
}

interface VolumeState {
  master: number;
  music: number;
  sfx: number;
}

function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 w-full max-w-[220px]">
      <span className="font-display text-[9px] tracking-[0.25em] text-[#7f95c8] uppercase w-[48px] text-right">
        {label}
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-[6px] bg-[rgba(38,230,255,0.15)] rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[14px] 
                   [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:rounded-full 
                   [&::-webkit-slider-thumb]:bg-[#26e6ff] [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(38,230,255,0.6)]"
      />
      <span className="font-mono text-[10px] text-[#26e6ff] w-[32px]">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export default function App() {
  const threeRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLPreElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<GamePhase>("title");
  const [stats, setStats] = useState<RunStats | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  const [volumeState, setVolumeState] = useState<VolumeState>({
    master: 1.0,
    music: 1.0,
    sfx: 1.0,
  });

  useEffect(() => {
    let game: Game | null = null;
    let mounted = true;
    (async () => {
      try {
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* fonts optional */
      }
      if (!mounted || !threeRef.current || !hudRef.current) return;
      game = new Game(threeRef.current, hudRef.current, {
        onPhase: (p, s) => {
          setPhase(p);
          setStats(s);
        },
        onDebugToggle: (on) => setDebugOn(on),
        onDebug: (lines) => {
          if (debugRef.current) debugRef.current.textContent = lines.join("\n");
        },
      });
      gameRef.current = game;
      await game.init();
    })();
    return () => {
      mounted = false;
      game?.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter") {
        if (phase === "title") gameRef.current?.startRun(false);
        else if (phase === "gameover") gameRef.current?.startRun(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#04060f] select-none">
      {/* 3D world */}
      <div ref={threeRef} className="absolute inset-0 z-0" />
      {/* particles.js atmosphere */}
      <div id="atmo-layer" className="absolute inset-0 z-10 pointer-events-none" />
      {/* pixi HUD */}
      <div ref={hudRef} className="absolute inset-0 z-20 pointer-events-none" />
      {/* CRT dressing */}
      <div className="absolute inset-0 z-30 scanlines" />
      <div className="absolute inset-0 z-30 crt-vignette" />

      {/* debug panel */}
      {debugOn && (
        <pre ref={debugRef} className="debug-panel absolute left-[18px] top-[292px] z-50 px-3 py-2 panel-clip-sm whitespace-pre" />
      )}

      {/* ------------ TITLE ------------ */}
      {phase === "title" && (
        <div
          className="absolute inset-0 z-40 flex items-end overlay-in"
          style={{
            background:
              "linear-gradient(100deg, rgba(3,5,14,0.92) 0%, rgba(3,5,14,0.66) 40%, rgba(3,5,14,0.18) 68%, rgba(3,5,14,0.02) 100%)",
          }}
        >
          <div className="w-full max-w-[1250px] px-8 md:px-14 pb-12">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <span className="panel-clip-sm bg-[rgba(38,230,255,0.1)] border border-[rgba(38,230,255,0.5)] text-[#7fe9ff] font-display text-[11px] tracking-[0.3em] px-3 py-1">
                SECTOR 7 GRID
              </span>
              <span className="panel-clip-sm bg-[rgba(255,46,126,0.1)] border border-[rgba(255,46,126,0.5)] text-[#ff8ab8] font-display text-[11px] tracking-[0.3em] px-3 py-1">
                NIGHT SHIFT 23:47
              </span>
              <span className="flex items-center gap-2 text-[#ff5577] font-display text-[11px] tracking-[0.3em]">
                <span className="w-2 h-2 rounded-full bg-[#ff3355] blink" /> LIVE DISPATCH
              </span>
            </div>

            <h1 className="font-display font-black leading-[0.92] tracking-tight">
              <span className="logo-glitch block text-[clamp(44px,7.2vw,96px)]">CYBERPUNK</span>
              <span className="logo-glitch block text-[clamp(34px,5.4vw,72px)] text-[#ffe9f2]">
                DELIVERY&nbsp;DRIVER
              </span>
            </h1>

            <div className="stripe-hazard h-[10px] w-[min(430px,60vw)] my-6 opacity-90" />

            <p className="font-body text-[19px] md:text-[21px] font-medium text-[#c3d5f5] max-w-[620px] leading-snug">
              The city is an illusion. The deadline is real. Pick up the package, thread the neon
              grid, and beat the clock — crashes cost paint, streaks multiply pay.
            </p>

            <div className="flex items-center gap-5 mt-7 flex-wrap font-display text-[13px] tracking-[0.22em]">
              <span className="text-[#26e6ff]">01 PICK UP</span>
              <span className="text-[#3a4d7a]">▸▸</span>
              <span className="text-[#ffe14d]">02 DRIVE FAST</span>
              <span className="text-[#3a4d7a]">▸▸</span>
              <span className="text-[#ff2e7e]">03 GET PAID</span>
            </div>

            <div className="flex items-center gap-x-8 gap-y-3 mt-7 flex-wrap">
              <Key k="W A S D" label="Drive" />
              <Key k="SPACE" label="Handbrake drift" />
              <Key k="H" label="Horn" />
              <Key k="R" label="Radio" />
              <Key k="F" label="Debug" />
              <Key k="P" label="Pause" />
            </div>

            <div className="flex items-center gap-6 mt-9 flex-wrap">
              <button
                className="btn-arcade px-12 py-4 text-[17px]"
                onClick={() => gameRef.current?.startRun(false)}
              >
                Start Engine
              </button>
              <span className="font-display text-[13px] tracking-[0.3em] text-[#ffe14d] blink">
                INSERT COIN · PRESS ENTER
              </span>
            </div>

            <div className="mt-8 font-body text-[12px] tracking-[0.28em] text-[#42558a] uppercase">
              Three.js world · PixiJS HUD · Howler audio · particles.js atmosphere · glTF assets
            </div>
          </div>
        </div>
      )}

      {/* ------------ PAUSED ------------ */}
      {phase === "paused" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(3,5,14,0.72)] overlay-in">
          <div className="panel-clip bg-[rgba(7,11,24,0.92)] border border-[rgba(38,230,255,0.4)] px-14 py-10 text-center">
            <div className="font-display text-[12px] tracking-[0.4em] text-[#ff2e7e] mb-3">
              SIGNAL HELD
            </div>
            <div className="font-display font-black text-[44px] text-[#eafcff] tracking-wide mb-6">
              PAUSED
            </div>
            <button className="btn-arcade px-10 py-3 text-[14px]" onClick={() => gameRef.current?.resume()}>
              Resume Shift
            </button>
            <div className="mt-4 text-[12px] tracking-[0.25em] text-[#42558a] font-body uppercase">
              P / ESC to resume
            </div>
            
            {/* Volume Controls */}
            <div className="mt-8 pt-6 border-t border-[rgba(38,230,255,0.2)]">
              <div className="font-display text-[10px] tracking-[0.3em] text-[#7f95c8] mb-4 uppercase">
                Audio Levels
              </div>
              <div className="flex flex-col gap-3 items-center">
                <VolumeSlider
                  label="Master"
                  value={volumeState.master}
                  onChange={(v) => {
                    setVolumeState(prev => ({ ...prev, master: v }));
                    audio.setMasterVolume(v);
                  }}
                />
                <VolumeSlider
                  label="Music"
                  value={volumeState.music}
                  onChange={(v) => {
                    setVolumeState(prev => ({ ...prev, music: v }));
                    audio.setMusicVolume(v);
                  }}
                />
                <VolumeSlider
                  label="SFX"
                  value={volumeState.sfx}
                  onChange={(v) => {
                    setVolumeState(prev => ({ ...prev, sfx: v }));
                    audio.setSfxVolume(v);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------ GAME OVER ------------ */}
      {phase === "gameover" && (
        <div
          className="absolute inset-0 z-40 flex items-center overlay-in"
          style={{ background: "linear-gradient(90deg, rgba(20,3,10,0.9) 0%, rgba(3,5,14,0.72) 55%, rgba(3,5,14,0.25) 100%)" }}
        >
          <div className="w-full max-w-[1100px] px-8 md:px-14">
            <div className="font-display text-[13px] tracking-[0.4em] text-[#ff5577] mb-3 flicker">
              ▚▚ TRANSMISSION LOST ▚▚
            </div>
            <h2 className="font-display font-black text-[clamp(40px,6vw,76px)] leading-none text-[#ffe9f2] logo-glitch">
              RUN TERMINATED
            </h2>
            <div className="stripe-hazard-m h-[8px] w-[min(360px,55vw)] my-6" />
            <p className="font-body text-[19px] text-[#c3d5f5] mb-8">
              Cause: <span className="text-[#ff5577] font-bold tracking-wider">{stats?.cause || "VAN TOTALED"}</span>
              <span className="text-[#5a6fa3]"> — dispatch is already looking for a replacement driver.</span>
            </p>

            <div className="flex gap-10 flex-wrap items-end mb-10">
              <div>
                <div className="font-body text-[13px] tracking-[0.3em] text-[#7f95c8] uppercase">Credits earned</div>
                <div className="font-display font-black text-[54px] leading-none text-[#ffe14d]">
                  ${Math.round(stats?.money ?? 0).toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div className="font-body text-[13px] tracking-[0.3em] text-[#7f95c8] uppercase">Deliveries</div>
                <div className="font-display font-bold text-[34px] leading-none text-[#26e6ff]">{stats?.deliveries ?? 0}</div>
              </div>
              <div>
                <div className="font-body text-[13px] tracking-[0.3em] text-[#7f95c8] uppercase">Best streak</div>
                <div className="font-display font-bold text-[34px] leading-none text-[#ff2e7e]">×{stats?.bestStreak ?? 0}</div>
              </div>
              <div>
                <div className="font-body text-[13px] tracking-[0.3em] text-[#7f95c8] uppercase">Time on shift</div>
                <div className="font-display font-bold text-[34px] leading-none text-[#eafcff]">
                  {Math.floor((stats?.elapsed ?? 0) / 60)}:{String(Math.floor((stats?.elapsed ?? 0) % 60)).padStart(2, "0")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 flex-wrap">
              <button className="btn-arcade btn-magenta px-12 py-4 text-[16px]" onClick={() => gameRef.current?.startRun(true)}>
                New City · Restart
              </button>
              <span className="font-display text-[12px] tracking-[0.3em] text-[#5a6fa3]">
                ENTER — FRESH SEED, FRESH GRID
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
