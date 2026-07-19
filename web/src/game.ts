import kaplay from "kaplay";
import type { KAPLAYCtx } from "kaplay";

// ─── Virtual resolution ───────────────────────────────────────────────────────
const VW = 640;
const VH = 480;
const TILE = 32;

// ─── Maze layout ─────────────────────────────────────────────────────────────
// 0=floor 1=wall 2=player_start 3=key 4=exit 5=shadow_zone
const MAP: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,2,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,0,1,0,1,1,0,1,0,1,1,1,0,1,1,0,0,1],
  [1,0,1,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,1,1],
  [1,0,1,1,1,0,1,0,1,1,1,1,0,1,1,0,1,0,0,1],
  [1,0,0,0,1,0,0,0,1,5,0,1,0,0,1,0,0,0,0,1],
  [1,1,1,0,1,1,1,0,1,0,0,1,1,0,1,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,1,0,1],
  [1,0,1,1,1,0,1,1,1,0,1,0,1,1,1,1,0,1,0,1],
  [1,0,1,5,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1],
  [1,0,1,0,1,1,1,1,1,0,1,1,1,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1,3,1],
  [1,1,1,1,1,0,1,0,1,1,1,0,0,1,1,1,0,1,0,1],
  [1,0,0,0,1,0,1,0,0,0,1,0,1,0,0,1,0,0,0,1],
  [1,4,1,0,0,0,1,1,1,0,0,0,1,0,1,0,1,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const ROWS = MAP.length;
const COLS = MAP[0]!.length;

// All floor tile centers (for shadow zone drift)
const FLOOR_CELLS: { x: number; y: number }[] = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (MAP[r]![c] === 0 || MAP[r]![c] === 5) {
      FLOOR_CELLS.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
    }
  }
}

// ─── Web Audio ────────────────────────────────────────────────────────────────
function createAudioCtx(): AudioContext | null {
  try { return new AudioContext(); } catch { return null; }
}

function playNoise(ctx: AudioContext, duration: number, vol: number) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  src.connect(gain); gain.connect(ctx.destination);
  src.start();
}

function playTone(ctx: AudioContext, freq: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + dur);
}

function playJumpscare(ctx: AudioContext) {
  playNoise(ctx, 1.4, 2.0);
  playTone(ctx, 920, 0.5, 1.0, "sawtooth");
  playTone(ctx, 460, 0.7, 0.8, "square");
  setTimeout(() => playTone(ctx, 180, 0.5, 0.6, "sawtooth"), 250);
  setTimeout(() => playNoise(ctx, 0.4, 1.0), 500);
}

function playPickup(ctx: AudioContext) {
  playTone(ctx, 660, 0.12, 0.4);
  setTimeout(() => playTone(ctx, 880, 0.15, 0.35), 110);
  setTimeout(() => playTone(ctx, 1100, 0.18, 0.3), 220);
}

function playWin(ctx: AudioContext) {
  playTone(ctx, 523, 0.2, 0.4);
  setTimeout(() => playTone(ctx, 659, 0.2, 0.4), 200);
  setTimeout(() => playTone(ctx, 784, 0.3, 0.5), 400);
  setTimeout(() => playTone(ctx, 1046, 0.4, 0.4), 650);
}

// ─── Ambient drone: threat + time-based escalation ────────────────────────────
interface AmbientHandles {
  setThreat: (t: number) => void;   // 0..1 proximity threat
  setTimePanic: (t: number) => void; // 0..1 time-based panic (grows over 120s)
  stop: () => void;
}

function startAmbient(ctx: AudioContext): AmbientHandles {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const osc3 = ctx.createOscillator();
  osc1.type = "sawtooth"; osc1.frequency.value = 55;
  osc2.type = "sine";     osc2.frequency.value = 82.5;
  osc3.type = "triangle"; osc3.frequency.value = 41;

  const g1 = ctx.createGain(); g1.gain.value = 0.03;
  const g2 = ctx.createGain(); g2.gain.value = 0.05;
  const g3 = ctx.createGain(); g3.gain.value = 0.04;

  osc1.connect(g1); g1.connect(ctx.destination);
  osc2.connect(g2); g2.connect(ctx.destination);
  osc3.connect(g3); g3.connect(ctx.destination);
  osc1.start(); osc2.start(); osc3.start();

  let phase = 0;
  let currentThreat = 0;
  let currentPanic = 0;  // time-driven escalation

  const iv = setInterval(() => {
    // Combined intensity: proximity threat + time panic
    const combined = Math.min(1, currentThreat + currentPanic);
    phase += 0.04 + currentPanic * 0.12; // tempo speeds up with panic

    const freqShift  = combined * 45;
    const volBoost   = combined * 0.09;
    // Tremolo rate accelerates exponentially with panic
    const tremorRate = 1 + combined * 8;
    const tremor     = Math.sin(phase * tremorRate) * 0.025 * (1 + combined * 3);

    g1.gain.setValueAtTime(Math.max(0.001, 0.03 + Math.sin(phase * 0.7) * 0.012 + volBoost + tremor), ctx.currentTime);
    g2.gain.setValueAtTime(Math.max(0.001, 0.05 + Math.sin(phase * 1.1) * 0.018 + volBoost * 1.3 + tremor), ctx.currentTime);
    g3.gain.setValueAtTime(Math.max(0.001, 0.04 + volBoost * 0.8 + Math.abs(tremor) * 0.5), ctx.currentTime);

    osc1.frequency.setValueAtTime(55 + freqShift + Math.sin(phase * 0.2) * 2, ctx.currentTime);
    osc2.frequency.setValueAtTime(82.5 + freqShift * 1.6 + Math.sin(phase * 0.3) * 3, ctx.currentTime);
    osc3.frequency.setValueAtTime(41 + freqShift * 0.6, ctx.currentTime);
  }, 50);

  function scheduleCreep() {
    // Creep sounds get more frequent with panic
    const delay = Math.max(600, 3000 - currentPanic * 2200 + Math.random() * 2000);
    setTimeout(() => {
      const vol = 0.08 + currentThreat * 0.15 + currentPanic * 0.12;
      playNoise(ctx, 0.2 + currentPanic * 0.2, vol);
      playTone(ctx, 70 + Math.random() * 120 + currentThreat * 80, 0.5, vol * 0.9, "sawtooth");
      scheduleCreep();
    }, delay);
  }
  scheduleCreep();

  return {
    setThreat(t: number) { currentThreat = Math.max(0, Math.min(1, t)); },
    setTimePanic(t: number) { currentPanic = Math.max(0, Math.min(1, t)); },
    stop() {
      clearInterval(iv);
      try { osc1.stop(); osc2.stop(); osc3.stop(); } catch { /* ok */ }
    },
  };
}

// ─── Static / film-grain overlay ──────────────────────────────────────────────
interface StaticFx {
  draw: (intensity: number) => void;
  destroy: () => void;
}

function makeStaticOverlay(parent: HTMLElement): StaticFx {
  const sc = document.createElement("canvas");
  sc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;";
  sc.width = 160; sc.height = 120;
  parent.style.position = "relative";
  parent.appendChild(sc);
  const ctx2 = sc.getContext("2d")!;

  return {
    draw(intensity: number) {
      const w = sc.width, h = sc.height;
      const img = ctx2.createImageData(w, h);
      const d = img.data;
      const blockSize = intensity > 0.65 ? Math.floor(1 + intensity * 6) : 1;
      for (let y = 0; y < h; y += blockSize) {
        for (let x = 0; x < w; x += blockSize) {
          const v = Math.random() > 0.5 ? 255 : 0;
          const alpha = Math.floor(intensity * 100 * (0.4 + Math.random() * 0.6));
          for (let by = 0; by < blockSize && y + by < h; by++) {
            for (let bx = 0; bx < blockSize && x + bx < w; bx++) {
              const i = ((y + by) * w + (x + bx)) * 4;
              d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = alpha;
            }
          }
        }
      }
      ctx2.putImageData(img, 0, 0);
      sc.style.opacity = String(Math.min(0.28, 0.03 + intensity * 0.25));
      if (intensity > 0.55) {
        const jx = (Math.random() - 0.5) * intensity * 8;
        const jy = (Math.random() - 0.5) * intensity * 8;
        sc.style.transform = `translate(${jx}px,${jy}px)`;
      } else {
        sc.style.transform = "none";
      }
    },
    destroy() { if (sc.parentElement) sc.parentElement.removeChild(sc); },
  };
}

// ─── Canvas shake ─────────────────────────────────────────────────────────────
interface ShakeFx {
  apply: (intensity: number) => void;
  reset: () => void;
}

function makeShakeFx(canvas: HTMLCanvasElement): ShakeFx {
  return {
    apply(intensity: number) {
      if (intensity < 0.05) { canvas.style.transform = "none"; return; }
      const mag = intensity * 10;
      const tx = (Math.random() - 0.5) * mag;
      const ty = (Math.random() - 0.5) * mag;
      const rot = (Math.random() - 0.5) * intensity * 1.5;
      canvas.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg)`;
    },
    reset() { canvas.style.transform = "none"; },
  };
}

// ─── Jumpscare overlay ────────────────────────────────────────────────────────
interface JumpscareOverlay {
  trigger: (onDone: () => void) => void;
  destroy: () => void;
}

function makeJumpscareOverlay(parent: HTMLElement): JumpscareOverlay {
  const div = document.createElement("div");
  div.style.cssText = [
    "position:absolute;top:0;left:0;width:100%;height:100%;",
    "display:flex;flex-direction:column;align-items:center;justify-content:center;",
    "background:#000;pointer-events:none;z-index:200;opacity:0;",
    "font-family:monospace;color:#fff;text-align:center;",
  ].join("");
  div.innerHTML = `
    <div style="font-size:clamp(36px,10vw,80px);line-height:1;color:#cc0000;letter-spacing:8px;">◉ ◉</div>
    <div style="font-size:clamp(22px,6vw,48px);letter-spacing:6px;color:#880000;margin:6px 0;">⌇⌇⌇⌇⌇⌇⌇⌇</div>
    <div style="font-size:clamp(20px,5vw,38px);color:#ff2222;margin-top:18px;
                text-shadow:0 0 30px #f00,0 0 60px #900;">IT SAW YOU</div>
    <div style="font-size:clamp(12px,3vw,20px);color:#999;margin-top:14px;letter-spacing:2px;">you looked up</div>
  `;
  parent.appendChild(div);

  return {
    trigger(onDone: () => void) {
      let t = 0;
      let raf = 0;
      const step = () => {
        t += 0.016;
        if (t < 0.07) {
          const r = Math.floor(120 + Math.random() * 135);
          div.style.background = `rgb(${r},0,0)`;
          div.style.opacity = "1";
          div.style.filter = `blur(${Math.random() * 5}px)`;
        } else if (t < 0.35) {
          div.style.background = "#000"; div.style.filter = "none"; div.style.opacity = "1";
        } else if (t < 2.6) {
          if (Math.random() < 0.04)
            div.style.filter = `blur(${Math.random() * 8}px) brightness(${0.6 + Math.random() * 0.8})`;
          else div.style.filter = "none";
        } else {
          div.style.opacity = "0"; div.style.filter = "none";
          cancelAnimationFrame(raf); onDone(); return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    destroy() { if (div.parentElement) div.parentElement.removeChild(div); },
  };
}

// ─── Dust mote particles ──────────────────────────────────────────────────────
interface DustFx {
  update: (px: number, py: number, cs: number, cx: number, cy: number) => void;
  destroy: () => void;
}
interface Mote { wx: number; wy: number; vx: number; vy: number; r: number; alpha: number; life: number; maxLife: number; }

function makeDustFx(parent: HTMLElement): DustFx {
  const dc = document.createElement("canvas");
  dc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;";
  dc.width = VW; dc.height = VH;
  parent.appendChild(dc);
  const ctx2 = dc.getContext("2d")!;
  const motes: Mote[] = [];
  const MAX = 30;
  let timer = 0;

  return {
    update(px, py, cs, cx, cy) {
      timer += 0.016;
      if (timer > 0.1 && motes.length < MAX) {
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 90;
        motes.push({ wx: px + Math.cos(a) * d, wy: py + Math.sin(a) * d,
          vx: (Math.random() - 0.5) * 7, vy: -(3 + Math.random() * 11),
          r: 0.7 + Math.random() * 1.5, alpha: 0.08 + Math.random() * 0.22,
          life: 0, maxLife: 1.5 + Math.random() * 2.5 });
        timer = 0;
      }
      ctx2.clearRect(0, 0, VW, VH);
      const scx = VW / 2, scy = VH / 2;
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i]!;
        m.life += 0.016; m.wx += m.vx * 0.016; m.wy += m.vy * 0.016;
        m.vx *= 0.995; m.vy *= 0.998;
        if (m.life >= m.maxLife) { motes.splice(i, 1); continue; }
        const t = m.life / m.maxLife;
        const fade = t < 0.2 ? t / 0.2 : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
        const sx = scx + (m.wx - cx) * cs;
        const sy = scy + (m.wy - cy) * cs;
        if (sx < -10 || sx > VW + 10 || sy < -10 || sy > VH + 10) continue;
        ctx2.beginPath();
        ctx2.arc(sx, sy, m.r * cs, 0, Math.PI * 2);
        ctx2.fillStyle = `rgba(180,160,120,${m.alpha * fade})`;
        ctx2.fill();
      }
    },
    destroy() { if (dc.parentElement) dc.parentElement.removeChild(dc); },
  };
}

// ─── Ghost decoys (fake KEY / EXIT icons that lure player upward) ─────────────
interface GhostDecoy {
  update: (elapsed: number) => void;
  destroy: () => void;
}

function makeGhostDecoys(parent: HTMLElement): GhostDecoy {
  const gc = document.createElement("canvas");
  gc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:8;";
  gc.width = VW; gc.height = VH;
  parent.appendChild(gc);
  const ctx2 = gc.getContext("2d")!;

  interface Ghost {
    x: number; y: number;      // screen coords
    label: string;
    alpha: number;
    phase: number;             // 0=fadein 1=hold 2=fadeout
    phaseT: number;
    life: number;
    maxLife: number;
  }

  const ghosts: Ghost[] = [];
  let spawnCooldown = 8; // first spawn after 8s

  function spawn() {
    const labels = ["🔑 KEY", "EXIT ▶", "KEY →", "← EXIT"];
    const label = labels[Math.floor(Math.random() * labels.length)] ?? "KEY";
    // Always in top 40% of screen to tempt upward looks
    ghosts.push({
      x: 60 + Math.random() * (VW - 120),
      y: 20 + Math.random() * (VH * 0.38),
      label,
      alpha: 0,
      phase: 0, phaseT: 0,
      life: 0, maxLife: 4 + Math.random() * 3,
    });
  }

  return {
    update(elapsed: number) {
      // Spawn more frequently as time goes on (every 12s early, every 4s late)
      spawnCooldown -= 0.016;
      if (spawnCooldown <= 0 && elapsed > 6) {
        spawn();
        spawnCooldown = Math.max(4, 12 - elapsed * 0.08);
      }

      ctx2.clearRect(0, 0, VW, VH);

      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i]!;
        g.life += 0.016;
        g.phaseT += 0.016;

        if (g.phase === 0) {
          g.alpha = Math.min(0.65, g.phaseT * 1.2);
          if (g.phaseT > 0.6) { g.phase = 1; g.phaseT = 0; }
        } else if (g.phase === 1) {
          // Ghostly flicker during hold
          g.alpha = 0.45 + Math.sin(g.phaseT * 6) * 0.2;
          if (g.life > g.maxLife - 1.2) { g.phase = 2; g.phaseT = 0; }
        } else {
          g.alpha = Math.max(0, 0.65 - g.phaseT * 0.9);
        }

        if (g.life >= g.maxLife) { ghosts.splice(i, 1); continue; }

        // Drift slowly upward — further tempting the eye
        g.y -= 0.3;

        ctx2.save();
        ctx2.globalAlpha = g.alpha;
        ctx2.font = "bold 13px monospace";
        ctx2.shadowColor = g.label.includes("KEY") ? "#ffcc00" : "#4488ff";
        ctx2.shadowBlur = 10 + Math.sin(g.life * 4) * 5;
        ctx2.fillStyle = g.label.includes("KEY") ? "#ffe066" : "#88aaff";
        ctx2.fillText(g.label, g.x, g.y);
        // Ghostly second pass slightly offset for double-vision effect
        ctx2.globalAlpha = g.alpha * 0.3;
        ctx2.fillStyle = "#ffffff";
        ctx2.fillText(g.label, g.x + 2, g.y + 1);
        ctx2.restore();
      }
    },
    destroy() { if (gc.parentElement) gc.parentElement.removeChild(gc); },
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function startGame(canvas: HTMLCanvasElement, onScore: (n: number) => void): () => void {
  const k = kaplay({
    canvas,
    width: VW,
    height: VH,
    letterbox: true,
    background: [0, 0, 0],
    global: false,
    pixelDensity: Math.min(window.devicePixelRatio || 1, 2),
  }) as KAPLAYCtx;

  let audioCtx: AudioContext | null = null;
  let ambient: AmbientHandles | null = null;

  const parent = canvas.parentElement ?? document.body;
  const staticFx  = makeStaticOverlay(parent);
  const jsFx      = makeJumpscareOverlay(parent);
  const dustFx    = makeDustFx(parent);
  const ghostFx   = makeGhostDecoys(parent);
  const shakeFx   = makeShakeFx(canvas);

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = createAudioCtx();
    if (!audioCtx) return;
    ambient = startAmbient(audioCtx);
  }

  // ── MENU ──────────────────────────────────────────────────────────────────
  k.scene("menu", () => {
    onScore(0);
    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);
    k.add([k.text("DON'T", { size: 54, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 115), k.color(180, 20, 20)]);
    k.add([k.text("LOOK UP", { size: 54, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 58), k.color(220, 30, 30)]);
    k.add([k.text("◉", { size: 38, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 5), k.color(100, 0, 0)]);
    k.add([k.text("Find the key. Reach the exit.\nKeep your eyes on the FLOOR.", {
        size: 12, font: "monospace", align: "center" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 65), k.color(150, 150, 150)]);
    k.add([k.text("WASD / Arrows  |  tap bottom to move\n⚠  SPACE = instant death  ⚠", {
        size: 11, font: "monospace", align: "center" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 125), k.color(110, 70, 70)]);
    const startTxt = k.add([k.text("[ CLICK or ENTER to begin ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 185), k.color(200, 200, 200)]);
    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt() * 2.5;
      const v = 140 + Math.floor(Math.sin(pulse) * 60);
      startTxt.color = k.rgb(v, v, v);
      staticFx.draw(0.22 + Math.sin(pulse * 0.8) * 0.12);
    });
    k.onMousePress(() => { ensureAudio(); k.go("play"); });
    k.onKeyPress("enter", () => { ensureAudio(); k.go("play"); });
    k.onKeyPress("space", () => { ensureAudio(); k.go("play"); });
  });

  // ── PLAY ──────────────────────────────────────────────────────────────────
  k.scene("play", () => {
    ensureAudio();
    onScore(0);

    const startTime = Date.now();
    let hasKey    = false;
    let isDead    = false;
    let threatLevel = 0;
    let breathPhase = 0;
    let warnPulse   = 0;

    // ── Flashlight state (shrinks over time, tap to refill) ───────────────
    const FL_MAX = 75;   // max inner radius
    const FL_MIN = 18;   // minimum (almost blind)
    let flRadius = FL_MAX;  // current inner radius
    // Tap counter for flashlight pump
    let tapCount = 0;
    let tapWindow = 0;  // seconds since last tap burst

    // ── Parse map ─────────────────────────────────────────────────────────
    type WallRect = { x: number; y: number; w: number; h: number };
    const wallRects: WallRect[] = [];

    // Shadow zones: mutable world positions (they drift!)
    const shadowZones: { x: number; y: number; tx: number; ty: number; driftT: number }[] = [];

    let playerStartX = TILE * 1.5, playerStartY = TILE * 1.5;
    let keyX = 0, keyY = 0, exitX = 0, exitY = 0;

    // Tile flicker objects — walls that can be briefly hidden for glitch effect
    const wallObjs: ReturnType<typeof k.add>[] = [];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = MAP[row]![col]!;
        const wx = col * TILE, wy = row * TILE;

        if (cell === 1) {
          wallRects.push({ x: wx, y: wy, w: TILE, h: TILE });
          const w = k.add([k.rect(TILE, TILE), k.color(72, 68, 78), k.pos(wx, wy), k.area(), "wall"]);
          wallObjs.push(w);
          // Bevel highlights
          k.add([k.rect(TILE, 2), k.color(110, 105, 120), k.pos(wx, wy)]);
          k.add([k.rect(2, TILE), k.color(100, 95, 110), k.pos(wx, wy)]);
          k.add([k.rect(TILE, 2), k.color(40, 37, 44), k.pos(wx, wy + TILE - 2)]);
          k.add([k.rect(2, TILE), k.color(40, 37, 44), k.pos(wx + TILE - 2, wy)]);
        } else {
          // Floor tiles
          k.add([k.rect(TILE, TILE), k.color(28, 26, 34), k.pos(wx, wy)]);
          k.add([k.rect(TILE - 4, TILE - 4), k.color(34, 32, 42), k.pos(wx + 2, wy + 2)]);
          k.add([k.rect(TILE, 1), k.color(18, 16, 24), k.pos(wx, wy)]);
          k.add([k.rect(1, TILE), k.color(18, 16, 24), k.pos(wx, wy)]);

          if (cell === 2) { playerStartX = wx + TILE / 2; playerStartY = wy + TILE / 2; }
          else if (cell === 3) { keyX = wx + TILE / 2; keyY = wy + TILE / 2; }
          else if (cell === 4) { exitX = wx + TILE / 2; exitY = wy + TILE / 2; }
          else if (cell === 5) {
            // Shadow zones start at their map position; pick a random floor target to drift toward
            const target = FLOOR_CELLS[Math.floor(Math.random() * FLOOR_CELLS.length)]
              ?? { x: wx + TILE / 2, y: wy + TILE / 2 };
            shadowZones.push({
              x: wx + TILE / 2, y: wy + TILE / 2,
              tx: target.x, ty: target.y,
              driftT: 0,
            });
          }
        }
      }
    }

    // ── Shadow zone visuals (dynamic — redrawn as they move) ──────────────
    // We keep KAPLAY objects for each zone and update their position each frame.
    const szObjs: ReturnType<typeof k.add>[] = [];
    const szDripObjs: ReturnType<typeof k.add>[][] = [];
    const szWarnObjs: ReturnType<typeof k.add>[] = [];

    for (const sz of shadowZones) {
      szObjs.push(k.add([k.circle(22), k.color(50, 0, 0), k.anchor("center"), k.pos(sz.x, sz.y)]));
      const drips: ReturnType<typeof k.add>[] = [];
      for (let d = 0; d < 5; d++) {
        const a = (d / 5) * Math.PI * 2;
        drips.push(k.add([k.circle(3), k.color(80, 0, 0), k.anchor("center"),
          k.pos(sz.x + Math.cos(a) * 14, sz.y + Math.sin(a) * 14)]));
      }
      szDripObjs.push(drips);
      szWarnObjs.push(k.add([k.text("▲", { size: 7, font: "monospace" }),
        k.anchor("center"), k.pos(sz.x, sz.y - 20), k.color(100, 0, 0)]));
    }

    // ── Exit door ─────────────────────────────────────────────────────────
    const exitObj = k.add([k.rect(26, 30), k.color(30, 30, 140), k.anchor("center"),
      k.pos(exitX, exitY), k.area(), "exit"]);
    k.add([k.text("EXIT", { size: 6, font: "monospace" }), k.anchor("center"),
      k.pos(exitX, exitY - 22), k.color(80, 80, 255)]);

    // ── Key ───────────────────────────────────────────────────────────────
    const keyObj = k.add([k.circle(7), k.color(255, 200, 0), k.anchor("center"),
      k.pos(keyX, keyY), k.area(), "key"]);

    // ── Player ────────────────────────────────────────────────────────────
    const player = k.add([k.circle(8), k.color(220, 220, 220), k.anchor("center"),
      k.pos(playerStartX, playerStartY), k.area(), "player"]);

    const CAM_SCALE = 1.5;
    k.camScale(CAM_SCALE);
    k.camPos(player.pos);

    // ── Darkness overlay ──────────────────────────────────────────────────
    const darkness = k.add([k.rect(VW * 5, VH * 5), k.color(0, 0, 0),
      k.anchor("center"), k.pos(player.pos.x, player.pos.y), k.opacity(0.88)]);

    // Flashlight rings — radius driven by flRadius
    const fl1 = k.add([k.circle(FL_MAX), k.color(255, 240, 200), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.30)]);
    const fl2 = k.add([k.circle(FL_MAX * 1.6), k.color(255, 230, 180), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.13)]);
    const fl3 = k.add([k.circle(FL_MAX * 2.3), k.color(200, 210, 255), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.05)]);

    const monsterGlow = k.add([k.circle(24), k.color(130, 0, 0), k.anchor("center"),
      k.pos(-1000, -1000), k.opacity(0)]);

    // ── HUD ───────────────────────────────────────────────────────────────
    const hudKey = k.add([k.text("[ find the KEY ]", { size: 10, font: "monospace" }),
      k.anchor("topleft"), k.pos(10, 10), k.color(210, 175, 45), k.fixed()]);
    const hudWarn = k.add([k.text("", { size: 12, font: "monospace" }),
      k.anchor("top"), k.pos(VW / 2, 10), k.color(220, 30, 30), k.fixed()]);
    const hudTimer = k.add([k.text("0.0s", { size: 10, font: "monospace" }),
      k.anchor("topright"), k.pos(VW - 10, 10), k.color(60, 200, 60), k.fixed()]);
    // Flashlight meter
    const hudLight = k.add([k.text("◈◈◈◈◈", { size: 9, font: "monospace" }),
      k.anchor("botright"), k.pos(VW - 10, VH - 8), k.color(200, 170, 40), k.fixed()]);
    k.add([k.text("↑ top half = DEATH  |  WASD/arrows to move  |  tap fast = light", { size: 7, font: "monospace" }),
      k.anchor("botleft"), k.pos(10, VH - 8), k.color(50, 50, 50), k.fixed()]);

    // ── Wall collision ─────────────────────────────────────────────────────
    const PR = 8;
    function collides(px: number, py: number): boolean {
      for (const w of wallRects) {
        if (px + PR > w.x && px - PR < w.x + w.w &&
            py + PR > w.y && py - PR < w.y + w.h) return true;
      }
      return false;
    }

    // ── Key pickup ────────────────────────────────────────────────────────
    let keyPulse = 0;
    player.onCollide("key", () => {
      if (hasKey || isDead) return;
      hasKey = true;
      k.destroy(keyObj);
      hudKey.text = "[ KEY ✓ — find EXIT ]";
      hudKey.color = k.rgb(60, 220, 60);
      if (audioCtx) playPickup(audioCtx);
      exitObj.color = k.rgb(40, 180, 40);
    });

    player.onCollide("exit", () => {
      if (!hasKey || isDead) return;
      isDead = true;
      const elapsed = (Date.now() - startTime) / 1000;
      const score = Math.max(50, Math.floor(10000 - elapsed * 8));
      onScore(score);
      if (audioCtx) playWin(audioCtx);
      shakeFx.reset();
      k.go("win", score, elapsed);
    });

    k.onKeyDown("space", () => { if (!isDead) triggerDeath(); });

    // ── Touch / click split ───────────────────────────────────────────────
    // Bottom half taps also pump the flashlight
    k.onMousePress(() => {
      const mp = k.mousePos();
      if (isDead) return;
      if (mp.y < VH * 0.5) {
        triggerDeath();
      } else {
        // Bottom half tap — pump flashlight
        tapCount++;
        tapWindow = 0;
      }
    });

    canvas.addEventListener("touchstart", (e) => {
      if (isDead) return;
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      if (!touch) return;
      const vy = (touch.clientY - rect.top) * (VH / rect.height);
      if (vy < VH * 0.5) {
        triggerDeath();
      } else {
        tapCount++;
        tapWindow = 0;
      }
    }, { passive: true });

    // ── Main update ───────────────────────────────────────────────────────
    const SPEED = 130;
    let flickerTimer = 0;
    let flickerActive = false;
    let shadowDriftTimer = 0;

    k.onUpdate(() => {
      if (isDead) return;

      const elapsed = (Date.now() - startTime) / 1000;
      // Time panic: reaches 1 at ~120s, exponential feel
      const timePanic = Math.min(1, (elapsed / 120) * (1 + elapsed / 80));
      hudTimer.text = `${elapsed.toFixed(1)}s`;
      // Timer color shifts red as panic grows
      hudTimer.color = k.rgb(
        Math.floor(60 + timePanic * 195),
        Math.floor(200 - timePanic * 170),
        Math.floor(60 - timePanic * 50),
      );

      if (ambient) ambient.setTimePanic(timePanic);

      // ── Flashlight shrink ──────────────────────────────────────────────
      // Shrinks at 3 units/s at start, up to 10 units/s at full panic
      const shrinkRate = 3 + timePanic * 7;
      flRadius = Math.max(FL_MIN, flRadius - shrinkRate * k.dt());

      // Tap pump: each tap in a burst window adds 6 units
      tapWindow += k.dt();
      if (tapWindow > 1.5) tapCount = 0; // reset burst if no taps for 1.5s
      if (tapCount > 0) {
        flRadius = Math.min(FL_MAX, flRadius + tapCount * 6);
        tapCount = 0;
      }

      // Apply flashlight radius to circles (scale the circle objects)
      const flScale = flRadius / FL_MAX;
      fl1.scale = k.vec2(flScale);
      fl2.scale = k.vec2(flScale);
      fl3.scale = k.vec2(flScale);

      // Flashlight meter HUD (5 blocks)
      const bars = Math.ceil((flRadius / FL_MAX) * 5);
      hudLight.text = "◈".repeat(bars) + "◇".repeat(5 - bars);
      hudLight.color = k.rgb(
        Math.floor(60 + (1 - flScale) * 195),
        Math.floor(200 - (1 - flScale) * 170),
        40,
      );

      // ── Key pulse ─────────────────────────────────────────────────────
      keyPulse += k.dt() * 4;
      if (!hasKey && keyObj.exists()) {
        keyObj.color = k.rgb(
          220 + Math.floor(Math.sin(keyPulse) * 35),
          170 + Math.floor(Math.sin(keyPulse) * 30),
          0,
        );
      }

      // ── Movement ──────────────────────────────────────────────────────
      let dx = 0, dy = 0;
      if (k.isKeyDown("left")  || k.isKeyDown("a")) dx -= 1;
      if (k.isKeyDown("right") || k.isKeyDown("d")) dx += 1;
      if (k.isKeyDown("up")    || k.isKeyDown("w")) dy -= 1;
      if (k.isKeyDown("down")  || k.isKeyDown("s")) dy += 1;
      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

      const nx = player.pos.x + dx * SPEED * k.dt();
      const ny = player.pos.y + dy * SPEED * k.dt();
      if (!collides(nx, player.pos.y)) player.pos.x = nx;
      if (!collides(player.pos.x, ny)) player.pos.y = ny;

      // Camera + overlays follow player
      k.camPos(player.pos);
      darkness.pos.x = player.pos.x; darkness.pos.y = player.pos.y;
      fl1.pos.x = player.pos.x; fl1.pos.y = player.pos.y;
      fl2.pos.x = player.pos.x; fl2.pos.y = player.pos.y;
      fl3.pos.x = player.pos.x; fl3.pos.y = player.pos.y;

      // Breathing animation on flashlight
      breathPhase += k.dt() * (1.8 + timePanic * 3);
      const breathBump = Math.sin(breathPhase) * 0.04;
      fl1.opacity = Math.max(0.05, 0.30 + breathBump - threatLevel * 0.08);
      fl2.opacity = Math.max(0.02, 0.13 + breathBump * 0.5);

      // ── Shadow zone drift ─────────────────────────────────────────────
      // Zones slowly creep toward their target, then pick a new target.
      // Speed increases with time panic.
      const driftSpeed = 8 + timePanic * 22;
      shadowDriftTimer += k.dt();
      // Pick new targets every 15-30s (shorter with panic)
      const retargetInterval = Math.max(8, 25 - timePanic * 17);

      for (let si = 0; si < shadowZones.length; si++) {
        const sz = shadowZones[si]!;
        sz.driftT += k.dt();

        if (sz.driftT > retargetInterval) {
          sz.driftT = 0;
          const nxt = FLOOR_CELLS[Math.floor(Math.random() * FLOOR_CELLS.length)]
            ?? { x: sz.x, y: sz.y };
          sz.tx = nxt.x; sz.ty = nxt.y;
        }

        // Move toward target
        const ddx = sz.tx - sz.x;
        const ddy = sz.ty - sz.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist > 2) {
          sz.x += (ddx / dist) * driftSpeed * k.dt();
          sz.y += (ddy / dist) * driftSpeed * k.dt();
        }

        // Update KAPLAY objects
        const so = szObjs[si];
        if (so) { so.pos.x = sz.x; so.pos.y = sz.y; }

        const drips = szDripObjs[si];
        if (drips) {
          for (let d = 0; d < drips.length; d++) {
            const drip = drips[d];
            const a = (d / drips.length) * Math.PI * 2;
            if (drip) {
              drip.pos.x = sz.x + Math.cos(a) * 14;
              drip.pos.y = sz.y + Math.sin(a) * 14;
            }
          }
        }
        const sw = szWarnObjs[si];
        if (sw) { sw.pos.x = sz.x; sw.pos.y = sz.y - 20; }
      }

      // ── Shadow zone proximity check ────────────────────────────────────
      let minDist = 9999;
      let nearestSz = shadowZones[0];
      for (const sz of shadowZones) {
        const d = Math.hypot(player.pos.x - sz.x, player.pos.y - sz.y);
        if (d < minDist) { minDist = d; nearestSz = sz; }
      }

      const TRIGGER_DIST = 18;
      const WARN_DIST    = 80;

      if (minDist < TRIGGER_DIST) { triggerDeath(); return; }

      if (minDist < WARN_DIST && nearestSz) {
        warnPulse += k.dt() * (6 + timePanic * 8);
        const t = 1 - minDist / WARN_DIST;
        threatLevel = t;
        monsterGlow.pos.x = nearestSz.x; monsterGlow.pos.y = nearestSz.y;
        monsterGlow.opacity = t * 0.8;
        hudWarn.text = minDist < 40 ? "⚠ DON'T LOOK UP ⚠" : "something is above you...";
        hudWarn.color = k.rgb(200 + Math.floor(Math.sin(warnPulse) * 55), 20, 20);

        // ── Canvas shake ──────────────────────────────────────────────
        shakeFx.apply(t * 0.6 + timePanic * 0.3);

        // ── Tile flicker ──────────────────────────────────────────────
        flickerTimer += k.dt();
        const flickerRate = 0.06 - t * 0.04; // faster when closer
        if (flickerTimer > flickerRate) {
          flickerTimer = 0;
          flickerActive = !flickerActive;
          // Randomly hide/show a subset of wall objects near the player
          for (const wo of wallObjs) {
            if (Math.random() < t * 0.35) {
              wo.opacity = flickerActive ? 0.15 + Math.random() * 0.5 : 1;
            } else {
              wo.opacity = 1;
            }
          }
        }
      } else {
        warnPulse = 0;
        threatLevel = 0;
        monsterGlow.opacity = 0;
        hudWarn.text = "";
        shakeFx.reset();
        // Restore all wall opacities
        if (flickerActive) {
          flickerActive = false;
          for (const wo of wallObjs) wo.opacity = 1;
        }
      }

      if (ambient) ambient.setThreat(threatLevel);

      // Static intensity = proximity threat + time panic
      const staticIntensity = 0.2 + threatLevel * 0.8 + timePanic * 0.4;
      staticFx.draw(staticIntensity);

      // Dust motes
      dustFx.update(player.pos.x, player.pos.y, CAM_SCALE, k.camPos().x, k.camPos().y);

      // Ghost decoys
      ghostFx.update(elapsed);

      void shadowDriftTimer;
    });

    // ── Death ─────────────────────────────────────────────────────────────
    function triggerDeath() {
      isDead = true;
      shakeFx.reset();
      if (audioCtx) playJumpscare(audioCtx);
      staticFx.draw(3);
      jsFx.trigger(() => { k.go("over"); });
    }
  });

  // ── WIN ───────────────────────────────────────────────────────────────────
  k.scene("win", (score: number, elapsed: number) => {
    const stored = localStorage.getItem("dontlookup_best");
    const prev = stored ? parseInt(stored, 10) : 0;
    const isNew = score > prev;
    if (isNew) localStorage.setItem("dontlookup_best", String(score));
    onScore(score);
    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);
    k.add([k.text("YOU ESCAPED", { size: 38, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 105), k.color(60, 220, 60)]);
    k.add([k.text(`Time: ${elapsed.toFixed(1)}s`, { size: 17, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 45), k.color(180, 180, 180)]);
    k.add([k.text(`Score: ${score}`, { size: 26, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 10), k.color(255, 210, 0)]);
    k.add([k.text(isNew ? "★  NEW BEST  ★" : `Best: ${prev}`, { size: 15, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 55),
      k.color(isNew ? 255 : 120, isNew ? 180 : 120, 0)]);
    k.add([k.text("[ click / ENTER to play again ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 130), k.color(160, 160, 160)]);
    let p = 0;
    k.onUpdate(() => { p += k.dt(); staticFx.draw(0.12 + Math.sin(p * 2) * 0.06); });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  // ── GAME OVER ─────────────────────────────────────────────────────────────
  k.scene("over", () => {
    onScore(0);
    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);
    k.add([k.text("IT GOT YOU", { size: 40, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 90), k.color(200, 20, 20)]);
    k.add([k.text("You should have kept\nyour eyes on the floor.", {
        size: 14, font: "monospace", align: "center" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 10), k.color(140, 140, 140)]);
    k.add([k.text("[ click / ENTER to try again ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 100), k.color(160, 160, 160)]);
    let p = 0;
    k.onUpdate(() => { p += k.dt(); staticFx.draw(0.5 + Math.sin(p * 4) * 0.3); });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  k.go("menu");

  return () => {
    if (ambient) ambient.stop();
    try { if (audioCtx) audioCtx.close(); } catch { /* ok */ }
    staticFx.destroy();
    jsFx.destroy();
    dustFx.destroy();
    ghostFx.destroy();
    shakeFx.reset();
    k.quit();
  };
}
