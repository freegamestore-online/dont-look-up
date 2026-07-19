import kaplay from "kaplay";
import type { KAPLAYCtx, GameObj, Vec2 } from "kaplay";

// ─── Virtual resolution ───────────────────────────────────────────────────────
const VW = 640;
const VH = 480;

// ─── Maze layout ─────────────────────────────────────────────────────────────
// 0 = floor, 1 = wall, 2 = player start, 3 = key, 4 = exit, 5 = shadow zone
const TILE = 32;
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

// ─── Audio helpers (Web Audio API) ───────────────────────────────────────────
function createAudioCtx(): AudioContext | null {
  try { return new AudioContext(); } catch { return null; }
}

function playNoise(ctx: AudioContext, duration: number, vol: number) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

function playTone(ctx: AudioContext, freq: number, duration: number, vol: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playJumpscare(ctx: AudioContext) {
  // Loud screech
  playNoise(ctx, 0.8, 1.5);
  playTone(ctx, 880, 0.4, 0.8, "sawtooth");
  playTone(ctx, 440, 0.4, 0.6, "square");
}

function playPickup(ctx: AudioContext) {
  playTone(ctx, 660, 0.15, 0.4, "sine");
  setTimeout(() => playTone(ctx, 880, 0.15, 0.3, "sine"), 120);
}

function playExit(ctx: AudioContext) {
  playTone(ctx, 523, 0.2, 0.4, "sine");
  setTimeout(() => playTone(ctx, 659, 0.2, 0.4, "sine"), 180);
  setTimeout(() => playTone(ctx, 784, 0.3, 0.5, "sine"), 360);
}

// Ambient drone
function startAmbient(ctx: AudioContext): () => void {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = "sawtooth";
  osc2.type = "sine";
  osc1.frequency.setValueAtTime(55, ctx.currentTime);
  osc2.frequency.setValueAtTime(82, ctx.currentTime);

  const gain1 = ctx.createGain();
  const gain2 = ctx.createGain();
  gain1.gain.setValueAtTime(0.04, ctx.currentTime);
  gain2.gain.setValueAtTime(0.06, ctx.currentTime);

  osc1.connect(gain1); gain1.connect(ctx.destination);
  osc2.connect(gain2); gain2.connect(ctx.destination);
  osc1.start(); osc2.start();

  // Subtle tremolo
  let t = 0;
  const interval = setInterval(() => {
    t += 0.05;
    const v = 0.04 + Math.sin(t) * 0.02;
    gain1.gain.setValueAtTime(v, ctx.currentTime);
  }, 50);

  return () => {
    clearInterval(interval);
    try { osc1.stop(); osc2.stop(); } catch { /* already stopped */ }
  };
}

// Occasional creep sound
function scheduleCreep(ctx: AudioContext, onStop: () => boolean): void {
  if (onStop()) return;
  const delay = 3000 + Math.random() * 5000;
  setTimeout(() => {
    if (onStop()) return;
    playNoise(ctx, 0.3, 0.2);
    playTone(ctx, 110 + Math.random() * 80, 0.5, 0.15, "sawtooth");
    scheduleCreep(ctx, onStop);
  }, delay);
}

// ─── Main export ─────────────────────────────────────────────────────────────
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
  let stopAmbient: (() => void) | null = null;
  let audioStopped = false;
  let staticCanvas: HTMLCanvasElement | null = null;
  let staticCtx2d: CanvasRenderingContext2D | null = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = createAudioCtx();
      if (audioCtx) {
        stopAmbient = startAmbient(audioCtx);
        scheduleCreep(audioCtx, () => audioStopped);
      }
    }
  }

  // ── Static overlay canvas (sits on top of the KAPLAY canvas) ──────────────
  function initStaticOverlay() {
    if (staticCanvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    staticCanvas = document.createElement("canvas");
    staticCanvas.style.position = "absolute";
    staticCanvas.style.top = "0";
    staticCanvas.style.left = "0";
    staticCanvas.style.width = "100%";
    staticCanvas.style.height = "100%";
    staticCanvas.style.pointerEvents = "none";
    staticCanvas.style.opacity = "0.04";
    staticCanvas.style.mixBlendMode = "screen";
    staticCanvas.width = 160;
    staticCanvas.height = 120;
    parent.style.position = "relative";
    parent.appendChild(staticCanvas);
    staticCtx2d = staticCanvas.getContext("2d");
  }

  function destroyStaticOverlay() {
    if (staticCanvas && staticCanvas.parentElement) {
      staticCanvas.parentElement.removeChild(staticCanvas);
    }
    staticCanvas = null;
    staticCtx2d = null;
  }

  function drawStatic(intensity: number = 1) {
    if (!staticCtx2d || !staticCanvas) return;
    const w = staticCanvas.width;
    const h = staticCanvas.height;
    const img = staticCtx2d.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 255 : 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(intensity * 80);
    }
    staticCtx2d.putImageData(img, 0, 0);
  }

  // ── Scenes ────────────────────────────────────────────────────────────────
  k.scene("menu", () => {
    initStaticOverlay();

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    k.add([
      k.text("DON'T LOOK UP", { size: 40, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 - 90),
      k.color(200, 30, 30),
    ]);

    k.add([
      k.text("Find the key. Reach the exit.\nDon't look up.", { size: 14, font: "monospace", align: "center" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 - 20),
      k.color(180, 180, 180),
    ]);

    k.add([
      k.text("WASD / Arrow Keys to move\nSPACE = instant death\n(Don't press it. Don't even think about it.)", {
        size: 11, font: "monospace", align: "center",
      }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 + 60),
      k.color(120, 120, 120),
    ]);

    k.add([
      k.text("[ CLICK or ENTER to begin ]", { size: 14, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 + 140),
      k.color(200, 200, 200),
    ]);

    // Pulse the warning
    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt() * 2;
      drawStatic(0.5 + Math.sin(pulse) * 0.3);
    });

    k.onMousePress(() => { ensureAudio(); k.go("play"); });
    k.onKeyPress("enter", () => { ensureAudio(); k.go("play"); });
    k.onKeyPress("space", () => { ensureAudio(); k.go("play"); });
  });

  k.scene("play", () => {
    ensureAudio();
    initStaticOverlay();
    onScore(0);

    const startTime = Date.now();
    let hasKey = false;
    let gameOver = false;
    let staticIntensity = 0;

    // ── Map geometry ──────────────────────────────────────────────────────
    const walls: GameObj[] = [];
    const shadowZones: { x: number; y: number }[] = [];
    let playerStart: Vec2 = k.vec2(TILE * 1.5, TILE * 1.5);
    let keyPos: Vec2 = k.vec2(0, 0);
    let exitPos: Vec2 = k.vec2(0, 0);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = MAP[row]![col]!;
        const wx = col * TILE;
        const wy = row * TILE;
        if (cell === 1) {
          const w = k.add([
            k.rect(TILE, TILE),
            k.color(20, 20, 25),
            k.pos(wx, wy),
            k.area(),
            "wall",
          ]);
          walls.push(w);
        } else if (cell === 2) {
          playerStart = k.vec2(wx + TILE / 2, wy + TILE / 2);
        } else if (cell === 3) {
          keyPos = k.vec2(wx + TILE / 2, wy + TILE / 2);
        } else if (cell === 4) {
          exitPos = k.vec2(wx + TILE / 2, wy + TILE / 2);
        } else if (cell === 5) {
          shadowZones.push({ x: wx + TILE / 2, y: wy + TILE / 2 });
        }
      }
    }

    // ── Floor tiles (subtle texture) ──────────────────────────────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = MAP[row]![col]!;
        if (cell !== 1) {
          k.add([
            k.rect(TILE - 1, TILE - 1),
            k.color(12, 12, 16),
            k.pos(col * TILE + 0.5, row * TILE + 0.5),
          ]);
        }
      }
    }

    // ── Shadow zones on floor (ceiling drip indicators) ───────────────────
    for (const sz of shadowZones) {
      k.add([
        k.circle(18),
        k.color(40, 0, 0),
        k.anchor("center"),
        k.pos(sz.x, sz.y),
        k.area(),
        "shadowzone",
      ]);
      // Drip marks
      for (let i = 0; i < 3; i++) {
        k.add([
          k.circle(3),
          k.color(60, 0, 0),
          k.anchor("center"),
          k.pos(sz.x + (Math.random() - 0.5) * 20, sz.y + 8 + i * 8),
        ]);
      }
    }

    // ── Key ───────────────────────────────────────────────────────────────
    const keyObj = k.add([
      k.circle(7),
      k.color(255, 215, 0),
      k.anchor("center"),
      k.pos(keyPos),
      k.area(),
      "key",
    ]);
    // Key glow pulse
    let keyPulse = 0;
    k.onUpdate(() => {
      keyPulse += k.dt() * 3;
      if (!hasKey) {
        keyObj.color = k.rgb(
          220 + Math.floor(Math.sin(keyPulse) * 35),
          180 + Math.floor(Math.sin(keyPulse) * 35),
          0,
        );
      }
    });

    // ── Exit door ─────────────────────────────────────────────────────────
    const exitObj = k.add([
      k.rect(24, 28),
      k.color(30, 30, 120),
      k.anchor("center"),
      k.pos(exitPos),
      k.area(),
      "exit",
    ]);
    k.add([
      k.text("EXIT", { size: 7, font: "monospace" }),
      k.anchor("center"),
      k.pos(exitPos.x, exitPos.y - 20),
      k.color(80, 80, 255),
    ]);

    // ── Player ────────────────────────────────────────────────────────────
    const player = k.add([
      k.circle(8),
      k.color(220, 220, 220),
      k.anchor("center"),
      k.pos(playerStart),
      k.area(),
      "player",
    ]);

    // ── Camera follow ─────────────────────────────────────────────────────
    k.camScale(1.4);
    k.camPos(player.pos);

    // ── Flashlight (drawn each frame as a custom overlay) ─────────────────
    // We'll draw a dark overlay with a radial "hole" using the KAPLAY rect trick
    // by layering several semi-transparent rects and a bright center circle.

    // Dark overlay panels (simulate darkness around flashlight)
    const DARK = k.add([
      k.rect(VW * 4, VH * 4),
      k.color(0, 0, 0),
      k.anchor("center"),
      k.pos(player.pos),
      k.opacity(0.92),
      "darkness",
    ]);

    // Flashlight cone (bright spot)
    const flashlightInner = k.add([
      k.circle(55),
      k.color(255, 240, 200),
      k.anchor("center"),
      k.pos(player.pos),
      k.opacity(0.18),
      "flashlight",
    ]);
    const flashlightOuter = k.add([
      k.circle(90),
      k.color(255, 240, 200),
      k.anchor("center"),
      k.pos(player.pos),
      k.opacity(0.07),
      "flashlight",
    ]);

    // ── Monster on ceiling (visual indicator — dark dripping shape) ───────
    // Monster tracks player but stays "above" — shown as a distorted shadow
    // that appears on the floor near shadow zones when player gets close
    let monsterWarning = false;
    const monsterShadow = k.add([
      k.circle(14),
      k.color(80, 0, 0),
      k.anchor("center"),
      k.pos(-200, -200),
      k.opacity(0),
      "monstershadow",
    ]);

    // ── HUD ───────────────────────────────────────────────────────────────
    const keyHud = k.add([
      k.text("[ find the KEY ]", { size: 10, font: "monospace" }),
      k.anchor("topleft"),
      k.pos(8, 8),
      k.color(200, 200, 100),
      k.fixed(),
    ]);

    const warnHud = k.add([
      k.text("", { size: 11, font: "monospace" }),
      k.anchor("top"),
      k.pos(VW / 2, 8),
      k.color(200, 30, 30),
      k.fixed(),
    ]);

    const timerHud = k.add([
      k.text("0.0s", { size: 10, font: "monospace" }),
      k.anchor("topright"),
      k.pos(VW - 8, 8),
      k.color(140, 140, 140),
      k.fixed(),
    ]);

    // ── Collision: player vs key ──────────────────────────────────────────
    player.onCollide("key", () => {
      if (!hasKey) {
        hasKey = true;
        k.destroy(keyObj);
        keyHud.text = "[ KEY collected — find EXIT ]";
        keyHud.color = k.rgb(100, 255, 100);
        if (audioCtx) playPickup(audioCtx);
        exitObj.color = k.rgb(50, 200, 50);
      }
    });

    // ── Collision: player vs exit ─────────────────────────────────────────
    player.onCollide("exit", () => {
      if (hasKey && !gameOver) {
        gameOver = true;
        const elapsed = (Date.now() - startTime) / 1000;
        // Score: faster = higher. Max 10000, lose 10 per second
        const score = Math.max(100, Math.floor(10000 - elapsed * 10));
        onScore(score);
        if (audioCtx) playExit(audioCtx);
        k.go("win", score, elapsed);
      }
    });

    // ── SPEED ─────────────────────────────────────────────────────────────
    const SPEED = 90;

    // ── Main update ───────────────────────────────────────────────────────
    k.onUpdate(() => {
      if (gameOver) return;

      // Timer
      const elapsed = (Date.now() - startTime) / 1000;
      timerHud.text = `${elapsed.toFixed(1)}s`;

      // Movement with wall collision
      let dx = 0, dy = 0;
      if (k.isKeyDown("left") || k.isKeyDown("a")) dx -= 1;
      if (k.isKeyDown("right") || k.isKeyDown("d")) dx += 1;
      if (k.isKeyDown("up") || k.isKeyDown("w")) dy -= 1;
      if (k.isKeyDown("down") || k.isKeyDown("s")) dy += 1;

      // Normalize diagonal
      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

      const newX = player.pos.x + dx * SPEED * k.dt();
      const newY = player.pos.y + dy * SPEED * k.dt();

      // Simple AABB wall check
      let colX = false, colY = false;
      const R = 8;
      for (const w of walls) {
        const wx = w.pos.x, wy = w.pos.y;
        if (
          newX + R > wx && newX - R < wx + TILE &&
          player.pos.y + R > wy && player.pos.y - R < wy + TILE
        ) colX = true;
        if (
          player.pos.x + R > wx && player.pos.x - R < wx + TILE &&
          newY + R > wy && newY - R < wy + TILE
        ) colY = true;
      }

      if (!colX) player.pos.x = newX;
      if (!colY) player.pos.y = newY;

      // Camera
      k.camPos(player.pos);
      DARK.pos = player.pos;
      flashlightInner.pos = player.pos;
      flashlightOuter.pos = player.pos;

      // ── Shadow zone proximity check ────────────────────────────────────
      let nearShadow = false;
      let closestDist = 9999;
      let closestSz = shadowZones[0];
      for (const sz of shadowZones) {
        const dist = Math.hypot(player.pos.x - sz.x, player.pos.y - sz.y);
        if (dist < closestDist) { closestDist = dist; closestSz = sz; }
        if (dist < 20) nearShadow = true;
      }

      // Monster warning when close to shadow zone
      monsterWarning = closestDist < 60;
      if (monsterWarning && closestSz) {
        monsterShadow.pos = k.vec2(closestSz.x, closestSz.y);
        const t = 1 - Math.min(closestDist / 60, 1);
        monsterShadow.opacity = t * 0.6;
        warnHud.text = closestDist < 40 ? "⚠ DON'T LOOK UP ⚠" : "";
        staticIntensity = t * 0.8;
      } else {
        monsterShadow.opacity = 0;
        warnHud.text = "";
        staticIntensity = 0;
      }

      // If player walks INTO shadow zone — jumpscare!
      if (nearShadow && !gameOver) {
        gameOver = true;
        triggerJumpscare("You looked up.");
        return;
      }

      // Draw static
      drawStatic(0.3 + staticIntensity);
    });

    // ── SPACE = instant death ──────────────────────────────────────────────
    k.onKeyDown("space", () => {
      if (!gameOver) {
        gameOver = true;
        triggerJumpscare("You looked up.");
      }
    });

    // Touch "look up" button
    k.onMousePress(() => {
      // On mobile, tapping the top half of screen = "look up"
      const mpos = k.mousePos();
      if (mpos.y < VH * 0.25 && !gameOver) {
        gameOver = true;
        triggerJumpscare("You looked up.");
      }
    });

    // ── Jumpscare ─────────────────────────────────────────────────────────
    function triggerJumpscare(reason: string) {
      if (audioCtx) playJumpscare(audioCtx);

      // Flash the screen red
      const flash = k.add([
        k.rect(VW * 4, VH * 4),
        k.color(180, 0, 0),
        k.anchor("center"),
        k.pos(player.pos),
        k.opacity(0),
        k.fixed(),
      ]);

      // Monster face — ASCII art style text
      const monsterFace = k.add([
        k.text("👁 IT SAW YOU 👁\n\n" + reason, {
          size: 28,
          font: "monospace",
          align: "center",
        }),
        k.anchor("center"),
        k.pos(VW / 2, VH / 2),
        k.color(255, 255, 255),
        k.opacity(0),
        k.fixed(),
      ]);

      // Animate flash
      let t = 0;
      const unsub = k.onUpdate(() => {
        t += k.dt();
        if (t < 0.1) {
          flash.opacity = t * 10;
          drawStatic(3);
        } else if (t < 0.5) {
          flash.opacity = 1 - (t - 0.1) * 1.5;
          monsterFace.opacity = (t - 0.1) * 2.5;
          drawStatic(2);
        } else {
          flash.opacity = 0;
          monsterFace.opacity = 1;
          drawStatic(0.5);
        }
        if (t > 2.2) {
          unsub();
          k.go("over");
        }
      });
    }
  });

  // ── Win scene ─────────────────────────────────────────────────────────────
  k.scene("win", (score: number, elapsed: number) => {
    initStaticOverlay();
    onScore(score);

    const stored = localStorage.getItem("dontlookup_best");
    const prev = stored ? parseInt(stored, 10) : 0;
    const isNew = score > prev;
    if (isNew) localStorage.setItem("dontlookup_best", String(score));

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    k.add([
      k.text("YOU ESCAPED", { size: 36, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 - 100),
      k.color(100, 255, 100),
    ]);

    k.add([
      k.text(`Time: ${elapsed.toFixed(1)}s`, { size: 18, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 - 40),
      k.color(200, 200, 200),
    ]);

    k.add([
      k.text(`Score: ${score}`, { size: 24, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 + 10),
      k.color(255, 215, 0),
    ]);

    if (isNew) {
      k.add([
        k.text("★ NEW BEST ★", { size: 16, font: "monospace" }),
        k.anchor("center"),
        k.pos(VW / 2, VH / 2 + 50),
        k.color(255, 180, 0),
      ]);
    } else {
      k.add([
        k.text(`Best: ${prev}`, { size: 14, font: "monospace" }),
        k.anchor("center"),
        k.pos(VW / 2, VH / 2 + 50),
        k.color(140, 140, 140),
      ]);
    }

    k.add([
      k.text("[ click or ENTER to play again ]", { size: 13, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 + 120),
      k.color(180, 180, 180),
    ]);

    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt();
      drawStatic(0.2 + Math.sin(pulse * 2) * 0.1);
    });

    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  // ── Game Over scene ───────────────────────────────────────────────────────
  k.scene("over", () => {
    initStaticOverlay();
    onScore(0);

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    k.add([
      k.text("IT GOT YOU", { size: 38, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 - 80),
      k.color(200, 30, 30),
    ]);

    k.add([
      k.text("You should have kept\nyour eyes on the floor.", {
        size: 14,
        font: "monospace",
        align: "center",
      }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2),
      k.color(160, 160, 160),
    ]);

    k.add([
      k.text("[ click or ENTER to try again ]", { size: 13, font: "monospace" }),
      k.anchor("center"),
      k.pos(VW / 2, VH / 2 + 100),
      k.color(180, 180, 180),
    ]);

    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt();
      drawStatic(0.4 + Math.sin(pulse * 3) * 0.3);
    });

    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  k.go("menu");

  return () => {
    audioStopped = true;
    if (stopAmbient) stopAmbient();
    try { if (audioCtx) audioCtx.close(); } catch { /* ignore */ }
    destroyStaticOverlay();
    k.quit();
  };
}
