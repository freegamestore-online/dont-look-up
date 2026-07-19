import kaplay from "kaplay";
import type { KAPLAYCtx, GameObj } from "kaplay";

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

// ─── Web Audio ────────────────────────────────────────────────────────────────
function createAudioCtx(): AudioContext | null {
  try { return new AudioContext(); } catch { return null; }
}

function playNoise(ctx: AudioContext, duration: number, vol: number) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
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

// Ambient drone — returns handles to modulate pitch/vol in real time
interface AmbientHandles {
  setThreat: (t: number) => void; // 0 = calm, 1 = max threat
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

  const iv = setInterval(() => {
    phase += 0.04;
    // Base tremolo
    const baseVol1 = 0.03 + Math.sin(phase * 0.7) * 0.012;
    const baseVol2 = 0.05 + Math.sin(phase * 1.1) * 0.018;
    // Threat modulates: raises pitch, raises volume, adds tremolo speed
    const threatFreqShift = currentThreat * 28;   // pitch rises up to +28 Hz
    const threatVolBoost  = currentThreat * 0.06;  // louder
    const tremorSpeed     = 1 + currentThreat * 4; // faster tremolo
    const tremor = Math.sin(phase * tremorSpeed) * 0.02 * (1 + currentThreat * 2);

    g1.gain.setValueAtTime(Math.max(0.001, baseVol1 + threatVolBoost + tremor), ctx.currentTime);
    g2.gain.setValueAtTime(Math.max(0.001, baseVol2 + threatVolBoost * 1.2 + tremor), ctx.currentTime);
    g3.gain.setValueAtTime(Math.max(0.001, 0.04 * (1 + currentThreat * 0.8)), ctx.currentTime);

    osc1.frequency.setValueAtTime(55 + threatFreqShift + Math.sin(phase * 0.2) * 2, ctx.currentTime);
    osc2.frequency.setValueAtTime(82.5 + threatFreqShift * 1.5 + Math.sin(phase * 0.3) * 3, ctx.currentTime);
    osc3.frequency.setValueAtTime(41 + threatFreqShift * 0.5, ctx.currentTime);
  }, 50);

  function scheduleCreep() {
    const delay = 2500 + Math.random() * 4500;
    setTimeout(() => {
      if (!iv) return;
      playNoise(ctx, 0.25, 0.10 + currentThreat * 0.15);
      playTone(ctx, 80 + Math.random() * 100 + currentThreat * 60, 0.6, 0.10 + currentThreat * 0.1, "sawtooth");
      scheduleCreep();
    }, delay);
  }
  scheduleCreep();

  return {
    setThreat(t: number) { currentThreat = Math.max(0, Math.min(1, t)); },
    stop() {
      clearInterval(iv);
      try { osc1.stop(); osc2.stop(); osc3.stop(); } catch { /* ok */ }
    },
  };
}

// ─── Static overlay ───────────────────────────────────────────────────────────
interface StaticFx {
  draw: (intensity: number) => void;
  destroy: () => void;
}

function makeStaticOverlay(parent: HTMLElement): StaticFx {
  const sc = document.createElement("canvas");
  sc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:0.05;";
  // Higher resolution for more visible jitter at high intensity
  sc.width = 160; sc.height = 120;
  parent.style.position = "relative";
  parent.appendChild(sc);
  const ctx2 = sc.getContext("2d")!;

  let lastIntensity = 0;
  return {
    draw(intensity: number) {
      lastIntensity = intensity;
      const w = sc.width, h = sc.height;
      const img = ctx2.createImageData(w, h);
      const d = img.data;
      // At high intensity, cluster pixels (pixelation effect)
      const blockSize = intensity > 0.7 ? Math.floor(1 + intensity * 5) : 1;
      for (let y = 0; y < h; y += blockSize) {
        for (let x = 0; x < w; x += blockSize) {
          const v = Math.random() > 0.5 ? 255 : 0;
          const alpha = Math.floor(intensity * 90 * (0.5 + Math.random() * 0.5));
          for (let by = 0; by < blockSize && y + by < h; by++) {
            for (let bx = 0; bx < blockSize && x + bx < w; bx++) {
              const i = ((y + by) * w + (x + bx)) * 4;
              d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = alpha;
            }
          }
        }
      }
      ctx2.putImageData(img, 0, 0);
      // Scale opacity with intensity — clamp to visible range
      sc.style.opacity = String(Math.min(0.25, 0.03 + intensity * 0.22));
      // At very high intensity, jitter the canvas position
      if (intensity > 0.6) {
        const jx = (Math.random() - 0.5) * intensity * 6;
        const jy = (Math.random() - 0.5) * intensity * 6;
        sc.style.transform = `translate(${jx}px,${jy}px)`;
      } else {
        sc.style.transform = "none";
      }
    },
    destroy() {
      void lastIntensity; // suppress unused warning
      if (sc.parentElement) sc.parentElement.removeChild(sc);
    },
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
    "font-family:monospace;color:#fff;text-align:center;transition:none;",
  ].join("");

  div.innerHTML = `
    <div style="font-size:clamp(36px,10vw,80px);line-height:1;color:#cc0000;letter-spacing:8px;">◉ ◉</div>
    <div style="font-size:clamp(22px,6vw,48px);letter-spacing:6px;color:#880000;margin:6px 0;">⌇⌇⌇⌇⌇⌇⌇⌇</div>
    <div style="font-size:clamp(20px,5vw,38px);color:#ff2222;margin-top:18px;
                text-shadow:0 0 30px #f00,0 0 60px #900;">IT SAW YOU</div>
    <div style="font-size:clamp(12px,3vw,20px);color:#999;margin-top:14px;letter-spacing:2px;">
      you looked up
    </div>
  `;
  parent.appendChild(div);

  return {
    trigger(onDone: () => void) {
      let t = 0;
      let raf = 0;
      const step = () => {
        t += 0.016;
        if (t < 0.07) {
          // Flash red
          const r = Math.floor(120 + Math.random() * 135);
          div.style.background = `rgb(${r},0,0)`;
          div.style.opacity = "1";
          div.style.filter = `blur(${Math.random() * 5}px)`;
        } else if (t < 0.35) {
          div.style.background = "#000";
          div.style.filter = "none";
          div.style.opacity = "1";
        } else if (t < 2.6) {
          // Subtle flicker
          if (Math.random() < 0.04) {
            div.style.filter = `blur(${Math.random() * 8}px) brightness(${0.6 + Math.random() * 0.8})`;
          } else {
            div.style.filter = "none";
          }
        } else {
          div.style.opacity = "0";
          div.style.filter = "none";
          cancelAnimationFrame(raf);
          onDone();
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    destroy() {
      if (div.parentElement) div.parentElement.removeChild(div);
    },
  };
}

// ─── Dust mote particle system ────────────────────────────────────────────────
// Rendered on a separate 2D canvas so they don't interact with KAPLAY layers.
interface DustFx {
  update: (playerX: number, playerY: number, camScale: number, camX: number, camY: number) => void;
  destroy: () => void;
}

interface Mote {
  wx: number;   // world-space X
  wy: number;   // world-space Y
  vx: number;   // drift velocity X
  vy: number;   // drift velocity Y (negative = upward)
  r: number;    // radius
  alpha: number;
  life: number; // 0..1
  maxLife: number;
}

function makeDustFx(parent: HTMLElement): DustFx {
  const dc = document.createElement("canvas");
  dc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;";
  dc.width = VW; dc.height = VH;
  parent.appendChild(dc);
  const ctx2 = dc.getContext("2d")!;

  const motes: Mote[] = [];
  const MAX_MOTES = 28;

  function spawnMote(px: number, py: number) {
    // Spawn in a ring around the player (in world coords)
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 80;
    motes.push({
      wx: px + Math.cos(angle) * dist,
      wy: py + Math.sin(angle) * dist,
      vx: (Math.random() - 0.5) * 8,
      vy: -(4 + Math.random() * 12), // always drift upward
      r: 0.8 + Math.random() * 1.6,
      alpha: 0.1 + Math.random() * 0.25,
      life: 0,
      maxLife: 1.5 + Math.random() * 2.5,
    });
  }

  let spawnTimer = 0;

  return {
    update(playerX: number, playerY: number, camScale: number, camX: number, camY: number) {
      // Spawn new motes
      spawnTimer += 0.016;
      if (spawnTimer > 0.12 && motes.length < MAX_MOTES) {
        spawnMote(playerX, playerY);
        spawnTimer = 0;
      }

      ctx2.clearRect(0, 0, VW, VH);

      // World-to-screen transform matching KAPLAY letterbox cam
      // Screen center = camX, camY in world; scale = camScale
      const screenCX = VW / 2;
      const screenCY = VH / 2;

      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i]!;
        m.life += 0.016;
        m.wx += m.vx * 0.016;
        m.wy += m.vy * 0.016;
        // Slow down over time
        m.vx *= 0.995;
        m.vy *= 0.998;

        if (m.life >= m.maxLife) { motes.splice(i, 1); continue; }

        // Fade in/out
        const t = m.life / m.maxLife;
        const fade = t < 0.2 ? t / 0.2 : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;

        // World → screen
        const sx = screenCX + (m.wx - camX) * camScale;
        const sy = screenCY + (m.wy - camY) * camScale;

        // Only draw if on screen
        if (sx < -10 || sx > VW + 10 || sy < -10 || sy > VH + 10) continue;

        ctx2.beginPath();
        ctx2.arc(sx, sy, m.r * camScale, 0, Math.PI * 2);
        ctx2.fillStyle = `rgba(180,160,120,${m.alpha * fade})`;
        ctx2.fill();
      }
    },
    destroy() {
      if (dc.parentElement) dc.parentElement.removeChild(dc);
    },
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
  const staticFx = makeStaticOverlay(parent);
  const jsFx = makeJumpscareOverlay(parent);
  const dustFx = makeDustFx(parent);

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

    k.add([
      k.text("DON'T", { size: 54, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 115),
      k.color(180, 20, 20),
    ]);
    k.add([
      k.text("LOOK UP", { size: 54, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 58),
      k.color(220, 30, 30),
    ]);
    k.add([
      k.text("◉", { size: 38, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 5),
      k.color(100, 0, 0),
    ]);
    k.add([
      k.text("Find the key. Reach the exit.\nKeep your eyes on the FLOOR.", {
        size: 12, font: "monospace", align: "center",
      }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 65),
      k.color(150, 150, 150),
    ]);
    k.add([
      k.text("WASD / Arrows to move\n⚠  SPACE = instant death  ⚠\n(Mobile: tap BOTTOM half to move)", {
        size: 11, font: "monospace", align: "center",
      }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 125),
      k.color(110, 70, 70),
    ]);

    const startTxt = k.add([
      k.text("[ CLICK or ENTER to begin ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 185),
      k.color(200, 200, 200),
    ]);

    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt() * 2.5;
      const v = 140 + Math.floor(Math.sin(pulse) * 60);
      startTxt.color = k.rgb(v, v, v);
      staticFx.draw(0.25 + Math.sin(pulse * 0.8) * 0.15);
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
    let hasKey = false;
    let isDead = false;
    let threatLevel = 0;    // 0..1 — drives audio + visual
    let breathPhase = 0;    // for darkness ring breathing animation
    let warnPulse = 0;

    // ── Parse map ─────────────────────────────────────────────────────────
    type WallRect = { x: number; y: number; w: number; h: number };
    const wallRects: WallRect[] = [];
    const shadowZones: { x: number; y: number }[] = [];
    let playerStartX = TILE * 1.5, playerStartY = TILE * 1.5;
    let keyX = 0, keyY = 0, exitX = 0, exitY = 0;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = MAP[row]![col]!;
        const wx = col * TILE, wy = row * TILE;
        if (cell === 1) {
          wallRects.push({ x: wx, y: wy, w: TILE, h: TILE });
          k.add([k.rect(TILE, TILE), k.color(18, 18, 22), k.pos(wx, wy), k.area(), "wall"]);
        } else {
          k.add([k.rect(TILE - 1, TILE - 1), k.color(10, 10, 14), k.pos(wx + 0.5, wy + 0.5)]);
          if (cell === 2) { playerStartX = wx + TILE / 2; playerStartY = wy + TILE / 2; }
          else if (cell === 3) { keyX = wx + TILE / 2; keyY = wy + TILE / 2; }
          else if (cell === 4) { exitX = wx + TILE / 2; exitY = wy + TILE / 2; }
          else if (cell === 5) { shadowZones.push({ x: wx + TILE / 2, y: wy + TILE / 2 }); }
        }
      }
    }

    // ── Shadow zone floor marks ────────────────────────────────────────────
    for (const sz of shadowZones) {
      k.add([k.circle(22), k.color(35, 0, 0), k.anchor("center"), k.pos(sz.x, sz.y)]);
      for (let d = 0; d < 5; d++) {
        const a = (d / 5) * Math.PI * 2;
        k.add([k.circle(2 + Math.random() * 2), k.color(55, 0, 0), k.anchor("center"),
          k.pos(sz.x + Math.cos(a) * 14, sz.y + Math.sin(a) * 14)]);
      }
      k.add([k.text("▲", { size: 7, font: "monospace" }), k.anchor("center"),
        k.pos(sz.x, sz.y - 20), k.color(70, 0, 0)]);
    }

    // ── Exit door ─────────────────────────────────────────────────────────
    const exitObj = k.add([
      k.rect(26, 30), k.color(25, 25, 100), k.anchor("center"),
      k.pos(exitX, exitY), k.area(), "exit",
    ]);
    k.add([k.text("EXIT", { size: 6, font: "monospace" }), k.anchor("center"),
      k.pos(exitX, exitY - 22), k.color(60, 60, 200)]);

    // ── Key ───────────────────────────────────────────────────────────────
    const keyObj = k.add([
      k.circle(7), k.color(255, 200, 0), k.anchor("center"),
      k.pos(keyX, keyY), k.area(), "key",
    ]);

    // ── Player ────────────────────────────────────────────────────────────
    const player = k.add([
      k.circle(8), k.color(210, 210, 210), k.anchor("center"),
      k.pos(playerStartX, playerStartY), k.area(), "player",
    ]);

    // ── Camera ────────────────────────────────────────────────────────────
    const CAM_SCALE = 1.5;
    k.camScale(CAM_SCALE);
    k.camPos(player.pos);

    // ── Darkness overlay ──────────────────────────────────────────────────
    // Big black rect follows player — creates pitch-darkness illusion.
    const darkness = k.add([
      k.rect(VW * 5, VH * 5), k.color(0, 0, 0),
      k.anchor("center"), k.pos(player.pos.x, player.pos.y),
      k.opacity(0.93),
    ]);

    // Flashlight glow rings — breathing scale applied each frame
    const fl1 = k.add([
      k.circle(60), k.color(255, 235, 180), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.22),
    ]);
    const fl2 = k.add([
      k.circle(100), k.color(255, 235, 180), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.08),
    ]);
    const fl3 = k.add([
      k.circle(145), k.color(200, 200, 255), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.03),
    ]);

    // Monster glow near shadow zones
    const monsterGlow = k.add([
      k.circle(24), k.color(130, 0, 0), k.anchor("center"),
      k.pos(-1000, -1000), k.opacity(0),
    ]);

    // ── HUD — glowing terminal style ──────────────────────────────────────
    // Key status — amber glow
    const hudKey = k.add([
      k.text("[ find the KEY ]", { size: 10, font: "monospace" }),
      k.anchor("topleft"), k.pos(10, 10),
      k.color(200, 170, 40), k.fixed(),
    ]);

    // Warning — red center
    const hudWarn = k.add([
      k.text("", { size: 12, font: "monospace" }),
      k.anchor("top"), k.pos(VW / 2, 10),
      k.color(220, 30, 30), k.fixed(),
    ]);

    // Timer — green terminal right
    const hudTimer = k.add([
      k.text("0.0s", { size: 10, font: "monospace" }),
      k.anchor("topright"), k.pos(VW - 10, 10),
      k.color(60, 200, 60), k.fixed(),
    ]);

    // Mobile hint — very faint at bottom
    k.add([
      k.text("↑ top half = LOOK UP (death)  |  bottom half = move →", { size: 7, font: "monospace" }),
      k.anchor("botleft"), k.pos(10, VH - 8),
      k.color(50, 50, 50), k.fixed(),
    ]);

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

    // ── Exit ──────────────────────────────────────────────────────────────
    player.onCollide("exit", () => {
      if (!hasKey || isDead) return;
      isDead = true;
      const elapsed = (Date.now() - startTime) / 1000;
      const score = Math.max(50, Math.floor(10000 - elapsed * 8));
      onScore(score);
      if (audioCtx) playWin(audioCtx);
      k.go("win", score, elapsed);
    });

    // ── SPACE = look up = death ───────────────────────────────────────────
    k.onKeyDown("space", () => { if (!isDead) triggerDeath(); });

    // ── Touch: strict 50/50 vertical split ───────────────────────────────
    k.onMousePress(() => {
      const mp = k.mousePos();
      // Top half of virtual screen = look up = instant death
      if (mp.y < VH * 0.5 && !isDead) {
        triggerDeath();
      }
    });

    // Mobile joystick: dragging in bottom half moves player
    let touchMoveDir = { x: 0, y: 0 };
    let touchActive = false;
    let touchStartY = 0;

    k.onMouseMove((mp) => {
      // Only track as movement if touch started in bottom half
      if (touchActive) {
        const dx = mp.x - VW / 2;
        const dy = mp.y - touchStartY;
        const len = Math.hypot(dx, dy);
        if (len > 8) {
          touchMoveDir = { x: dx / len, y: dy / len };
        } else {
          touchMoveDir = { x: 0, y: 0 };
        }
      }
    });

    // Track touch start position
    canvas.addEventListener("touchstart", (e) => {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      if (!touch) return;
      // Convert to virtual coords
      const scaleX = VW / rect.width;
      const scaleY = VH / rect.height;
      const vy = (touch.clientY - rect.top) * scaleY;
      if (vy >= VH * 0.5) {
        touchActive = true;
        touchStartY = vy;
      } else {
        // Top half touch = death
        if (!isDead) triggerDeath();
      }
    }, { passive: true });

    canvas.addEventListener("touchend", () => {
      touchActive = false;
      touchMoveDir = { x: 0, y: 0 };
    }, { passive: true });

    // ── Main update ───────────────────────────────────────────────────────
    const SPEED = 130; // snappy but deliberate

    k.onUpdate(() => {
      if (isDead) return;

      // Timer
      const elapsed = (Date.now() - startTime) / 1000;
      hudTimer.text = `${elapsed.toFixed(1)}s`;

      // Key pulse
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

      // Blend in touch dir
      if (touchActive) {
        dx += touchMoveDir.x;
        dy += touchMoveDir.y;
      }

      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

      const nx = player.pos.x + dx * SPEED * k.dt();
      const ny = player.pos.y + dy * SPEED * k.dt();
      if (!collides(nx, player.pos.y)) player.pos.x = nx;
      if (!collides(player.pos.x, ny)) player.pos.y = ny;

      // ── Camera + flashlight follow ─────────────────────────────────────
      k.camPos(player.pos);
      darkness.pos.x = player.pos.x; darkness.pos.y = player.pos.y;
      fl1.pos.x = player.pos.x; fl1.pos.y = player.pos.y;
      fl2.pos.x = player.pos.x; fl2.pos.y = player.pos.y;
      fl3.pos.x = player.pos.x; fl3.pos.y = player.pos.y;

      // ── Breathing / ripple animation on flashlight rings ───────────────
      breathPhase += k.dt() * (1.2 + threatLevel * 2.5);
      const breathScale = 1 + Math.sin(breathPhase) * (0.04 + threatLevel * 0.10);
      // KAPLAY circles use radius — scale by adjusting opacity to simulate pulse
      // (KAPLAY doesn't expose scale on individual objects without transform component,
      //  so we modulate opacity to create a "breathing" shimmer effect)
      fl1.opacity = (0.22 + Math.sin(breathPhase) * 0.04) * (1 - threatLevel * 0.15);
      fl2.opacity = (0.08 + Math.sin(breathPhase * 0.8) * 0.02) * (1 - threatLevel * 0.1);
      fl3.opacity = 0.03 + Math.sin(breathPhase * 0.6) * 0.01;
      // Modulate darkness opacity slightly for "breathing" room feel
      darkness.opacity = 0.93 - Math.sin(breathPhase * 0.5) * 0.015 * breathScale;

      // ── Shadow zone proximity ──────────────────────────────────────────
      let minDist = 9999;
      let nearestSz = shadowZones[0];
      for (const sz of shadowZones) {
        const d = Math.hypot(player.pos.x - sz.x, player.pos.y - sz.y);
        if (d < minDist) { minDist = d; nearestSz = sz; }
      }

      const TRIGGER_DIST = 18;
      const WARN_DIST    = 70;

      if (minDist < TRIGGER_DIST) {
        triggerDeath();
        return;
      }

      if (minDist < WARN_DIST && nearestSz) {
        warnPulse += k.dt() * (5 + threatLevel * 8);
        threatLevel = Math.min(1, 1 - minDist / WARN_DIST);

        monsterGlow.pos.x = nearestSz.x;
        monsterGlow.pos.y = nearestSz.y;
        monsterGlow.opacity = threatLevel * 0.75;

        // Warn text
        hudWarn.text = minDist < 38 ? "⚠  DON'T LOOK UP  ⚠" : "something is above you...";
        hudWarn.color = k.rgb(
          180 + Math.floor(Math.sin(warnPulse) * 75),
          20,
          20,
        );

        // Flashlight flicker at high threat
        if (threatLevel > 0.5 && Math.random() < 0.08) {
          fl1.opacity *= 0.3 + Math.random() * 0.4;
        }
      } else {
        threatLevel = Math.max(0, threatLevel - k.dt() * 0.8);
        warnPulse = 0;
        monsterGlow.opacity = 0;
        hudWarn.text = "";
      }

      // Update ambient audio threat
      if (ambient) ambient.setThreat(threatLevel);

      // Static intensity: base + threat boost + high-freq jitter near zones
      const staticInt = 0.22 + threatLevel * 1.1;
      staticFx.draw(staticInt);

      // Dust motes — pass camera info for world→screen projection
      dustFx.update(player.pos.x, player.pos.y, CAM_SCALE, player.pos.x, player.pos.y);
    });

    // ── Jumpscare + death ─────────────────────────────────────────────────
    function triggerDeath() {
      if (isDead) return;
      isDead = true;
      if (audioCtx) playJumpscare(audioCtx);
      if (ambient) ambient.setThreat(1);
      staticFx.draw(3);
      jsFx.trigger(() => k.go("over"));
    }
  });

  // ── WIN ───────────────────────────────────────────────────────────────────
  k.scene("win", (score: number, elapsed: number) => {
    const stored = localStorage.getItem("dontlookup_best");
    const prev = stored ? parseInt(stored, 10) : 0;
    const isNew = score > prev;
    if (isNew) localStorage.setItem("dontlookup_best", String(score));
    onScore(score);
    if (ambient) ambient.setThreat(0);

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    k.add([
      k.text("YOU ESCAPED", { size: 38, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 105),
      k.color(60, 220, 60),
    ]);
    k.add([
      k.text(`Time: ${elapsed.toFixed(1)}s`, { size: 17, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 48),
      k.color(160, 160, 160),
    ]);
    k.add([
      k.text(`Score: ${score}`, { size: 28, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 8),
      k.color(255, 210, 0),
    ]);
    k.add([
      k.text(isNew ? "★  NEW BEST  ★" : `Best: ${prev}`, { size: 15, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 55),
      k.color(isNew ? 255 : 120, isNew ? 175 : 120, 0),
    ]);
    k.add([
      k.text("[ click / ENTER to play again ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 130),
      k.color(140, 140, 140),
    ]);

    let p = 0;
    k.onUpdate(() => { p += k.dt(); staticFx.draw(0.12 + Math.sin(p * 2) * 0.06); });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  // ── GAME OVER ─────────────────────────────────────────────────────────────
  k.scene("over", () => {
    onScore(0);
    if (ambient) ambient.setThreat(0);

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    k.add([
      k.text("IT GOT YOU", { size: 42, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 90),
      k.color(200, 20, 20),
    ]);
    k.add([
      k.text("You should have kept\nyour eyes on the floor.", {
        size: 14, font: "monospace", align: "center",
      }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 10),
      k.color(130, 130, 130),
    ]);
    k.add([
      k.text("[ click / ENTER to try again ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 100),
      k.color(150, 150, 150),
    ]);

    let p = 0;
    k.onUpdate(() => { p += k.dt(); staticFx.draw(0.45 + Math.sin(p * 4) * 0.3); });
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
    k.quit();
  };
}
