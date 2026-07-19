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

// ─── Web Audio helpers ────────────────────────────────────────────────────────
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
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

function playTone(ctx: AudioContext, freq: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

function playJumpscare(ctx: AudioContext) {
  // Loud screech burst
  playNoise(ctx, 1.2, 1.8);
  playTone(ctx, 900, 0.5, 0.9, "sawtooth");
  playTone(ctx, 450, 0.6, 0.7, "square");
  setTimeout(() => playTone(ctx, 200, 0.4, 0.5, "sawtooth"), 300);
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

function startAmbient(ctx: AudioContext): () => void {
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

  let t = 0;
  const iv = setInterval(() => {
    t += 0.04;
    g1.gain.setValueAtTime(0.03 + Math.sin(t * 0.7) * 0.015, ctx.currentTime);
    g2.gain.setValueAtTime(0.05 + Math.sin(t * 1.1) * 0.02, ctx.currentTime);
    osc2.frequency.setValueAtTime(82.5 + Math.sin(t * 0.3) * 3, ctx.currentTime);
  }, 50);

  return () => {
    clearInterval(iv);
    try { osc1.stop(); osc2.stop(); osc3.stop(); } catch { /* already stopped */ }
  };
}

function scheduleCreep(ctx: AudioContext, stopped: () => boolean) {
  if (stopped()) return;
  const delay = 2500 + Math.random() * 5000;
  setTimeout(() => {
    if (stopped()) return;
    playNoise(ctx, 0.25, 0.12);
    playTone(ctx, 80 + Math.random() * 100, 0.6, 0.12, "sawtooth");
    scheduleCreep(ctx, stopped);
  }, delay);
}

// ─── Static overlay (2D canvas layered over KAPLAY canvas) ───────────────────
function makeStaticOverlay(parent: HTMLElement): {
  draw: (intensity: number) => void;
  destroy: () => void;
} {
  const sc = document.createElement("canvas");
  sc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;opacity:0.05;mix-blend-mode:screen;";
  sc.width = 128; sc.height = 96;
  parent.style.position = "relative";
  parent.appendChild(sc);
  const ctx2 = sc.getContext("2d")!;

  return {
    draw(intensity: number) {
      const w = sc.width, h = sc.height;
      const img = ctx2.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() > 0.5 ? 255 : 0;
        img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v;
        img.data[i+3] = Math.floor(intensity * 70);
      }
      ctx2.putImageData(img, 0, 0);
      sc.style.opacity = String(Math.min(0.12, 0.03 + intensity * 0.09));
    },
    destroy() {
      if (sc.parentElement) sc.parentElement.removeChild(sc);
    },
  };
}

// ─── Jumpscare overlay (fullscreen HTML div for max horror) ──────────────────
function makeJumpscareOverlay(parent: HTMLElement): {
  trigger: (onDone: () => void) => void;
  destroy: () => void;
} {
  const div = document.createElement("div");
  div.style.cssText = [
    "position:absolute;top:0;left:0;width:100%;height:100%;",
    "display:flex;flex-direction:column;align-items:center;justify-content:center;",
    "background:#000;pointer-events:none;z-index:100;opacity:0;",
    "font-family:monospace;color:#fff;text-align:center;",
  ].join("");
  parent.appendChild(div);

  // Monster face built from text art
  div.innerHTML = `
    <div style="font-size:clamp(28px,8vw,64px);line-height:1;color:#cc0000;filter:blur(0px);">
      ◉ ◉
    </div>
    <div style="font-size:clamp(20px,5vw,40px);letter-spacing:4px;color:#880000;margin:4px 0;">
      ⌇⌇⌇⌇⌇⌇⌇⌇
    </div>
    <div style="font-size:clamp(18px,4vw,32px);color:#ff2222;margin-top:16px;text-shadow:0 0 20px #f00;">
      IT SAW YOU
    </div>
    <div style="font-size:clamp(11px,2.5vw,18px);color:#aaa;margin-top:12px;">
      You looked up.
    </div>
  `;

  return {
    trigger(onDone: () => void) {
      let t = 0;
      let raf = 0;

      const animate = () => {
        t += 0.016;
        if (t < 0.08) {
          div.style.opacity = "1";
          div.style.background = `rgb(${Math.floor(150 + Math.random()*105)},0,0)`;
          div.style.filter = `blur(${Math.random()*4}px)`;
        } else if (t < 0.4) {
          div.style.background = "#000";
          div.style.filter = "none";
          div.style.opacity = "1";
        } else if (t < 2.5) {
          div.style.opacity = "1";
          // Flicker
          if (Math.random() < 0.05) div.style.filter = `blur(${Math.random()*6}px)`;
          else div.style.filter = "none";
        } else {
          div.style.opacity = "0";
          div.style.filter = "none";
          cancelAnimationFrame(raf);
          onDone();
          return;
        }
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
    },
    destroy() {
      if (div.parentElement) div.parentElement.removeChild(div);
    },
  };
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

  const parent = canvas.parentElement ?? document.body;
  const staticFx = makeStaticOverlay(parent);
  const jsFx = makeJumpscareOverlay(parent);

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = createAudioCtx();
    if (!audioCtx) return;
    stopAmbient = startAmbient(audioCtx);
    scheduleCreep(audioCtx, () => audioStopped);
  }

  // ── MENU ──────────────────────────────────────────────────────────────────
  k.scene("menu", () => {
    onScore(0);

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    // Title
    k.add([
      k.text("DON'T", { size: 52, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 110),
      k.color(180, 20, 20),
    ]);
    k.add([
      k.text("LOOK UP", { size: 52, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 55),
      k.color(220, 30, 30),
    ]);

    // Eye icon
    k.add([
      k.text("◉", { size: 36, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 10),
      k.color(100, 0, 0),
    ]);

    k.add([
      k.text("Find the key. Reach the exit.\nKeep your eyes on the FLOOR.", {
        size: 12, font: "monospace", align: "center",
      }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 70),
      k.color(150, 150, 150),
    ]);

    k.add([
      k.text("WASD / Arrows to move\n⚠ SPACE = instant death ⚠", {
        size: 11, font: "monospace", align: "center",
      }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 125),
      k.color(120, 80, 80),
    ]);

    const startTxt = k.add([
      k.text("[ CLICK or ENTER to begin ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 180),
      k.color(200, 200, 200),
    ]);

    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt() * 2.5;
      startTxt.color = k.rgb(
        150 + Math.floor(Math.sin(pulse) * 50),
        150 + Math.floor(Math.sin(pulse) * 50),
        150 + Math.floor(Math.sin(pulse) * 50),
      );
      staticFx.draw(0.3 + Math.sin(pulse) * 0.2);
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
    let staticLevel = 0.25;

    // Parse map
    type WallRect = { x: number; y: number; w: number; h: number };
    const wallRects: WallRect[] = [];
    const shadowZones: { x: number; y: number }[] = [];
    let playerStartX = TILE * 1.5;
    let playerStartY = TILE * 1.5;
    let keyX = 0, keyY = 0;
    let exitX = 0, exitY = 0;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = MAP[row]![col]!;
        const wx = col * TILE, wy = row * TILE;
        if (cell === 1) {
          wallRects.push({ x: wx, y: wy, w: TILE, h: TILE });
          k.add([
            k.rect(TILE, TILE),
            k.color(18, 18, 22),
            k.pos(wx, wy),
            k.area(),
            "wall",
          ]);
        } else {
          // Floor tile
          k.add([
            k.rect(TILE - 1, TILE - 1),
            k.color(10, 10, 14),
            k.pos(wx + 0.5, wy + 0.5),
          ]);
          if (cell === 2) { playerStartX = wx + TILE / 2; playerStartY = wy + TILE / 2; }
          else if (cell === 3) { keyX = wx + TILE / 2; keyY = wy + TILE / 2; }
          else if (cell === 4) { exitX = wx + TILE / 2; exitY = wy + TILE / 2; }
          else if (cell === 5) { shadowZones.push({ x: wx + TILE / 2, y: wy + TILE / 2 }); }
        }
      }
    }

    // Shadow zone floor marks
    for (const sz of shadowZones) {
      // Dark blood pool
      k.add([
        k.circle(20),
        k.color(35, 0, 0),
        k.anchor("center"),
        k.pos(sz.x, sz.y),
      ]);
      // Drip marks
      for (let d = 0; d < 4; d++) {
        const angle = (d / 4) * Math.PI * 2;
        k.add([
          k.circle(3),
          k.color(55, 0, 0),
          k.anchor("center"),
          k.pos(sz.x + Math.cos(angle) * 12, sz.y + Math.sin(angle) * 12),
        ]);
      }
      // Warning text (very faint, only visible up close with flashlight)
      k.add([
        k.text("▲", { size: 8, font: "monospace" }),
        k.anchor("center"),
        k.pos(sz.x, sz.y - 18),
        k.color(80, 0, 0),
      ]);
    }

    // Exit door
    k.add([
      k.rect(26, 30),
      k.color(25, 25, 100),
      k.anchor("center"),
      k.pos(exitX, exitY),
      k.area(),
      "exit",
    ]);
    k.add([
      k.text("EXIT", { size: 6, font: "monospace" }),
      k.anchor("center"),
      k.pos(exitX, exitY - 22),
      k.color(60, 60, 200),
    ]);

    // Key
    const keyObj = k.add([
      k.circle(7),
      k.color(255, 200, 0),
      k.anchor("center"),
      k.pos(keyX, keyY),
      k.area(),
      "key",
    ]);

    // Player
    const player = k.add([
      k.circle(8),
      k.color(210, 210, 210),
      k.anchor("center"),
      k.pos(playerStartX, playerStartY),
      k.area(),
      "player",
    ]);

    // Camera
    k.camScale(1.5);
    k.camPos(player.pos);

    // ── Darkness overlay — big black rect centered on player ──────────────
    // This creates the "only flashlight" effect. KAPLAY renders in draw order,
    // so we add the dark rect AFTER the map tiles and objects, making them
    // invisible unless the flashlight circles overlap.
    const darkness = k.add([
      k.rect(VW * 5, VH * 5),
      k.color(0, 0, 0),
      k.anchor("center"),
      k.pos(player.pos.x, player.pos.y),
      k.opacity(0.93),
    ]);

    // Flashlight glow layers (bright center, soft outer)
    const fl1 = k.add([
      k.circle(60),
      k.color(255, 235, 180),
      k.anchor("center"),
      k.pos(player.pos.x, player.pos.y),
      k.opacity(0.22),
    ]);
    const fl2 = k.add([
      k.circle(100),
      k.color(255, 235, 180),
      k.anchor("center"),
      k.pos(player.pos.x, player.pos.y),
      k.opacity(0.08),
    ]);
    const fl3 = k.add([
      k.circle(140),
      k.color(200, 200, 255),
      k.anchor("center"),
      k.pos(player.pos.x, player.pos.y),
      k.opacity(0.03),
    ]);

    // Monster ceiling shadow (appears near shadow zones)
    const monsterGlow = k.add([
      k.circle(22),
      k.color(120, 0, 0),
      k.anchor("center"),
      k.pos(-500, -500),
      k.opacity(0),
    ]);

    // ── HUD ───────────────────────────────────────────────────────────────
    const hudKey = k.add([
      k.text("🔑 Find the KEY", { size: 10, font: "monospace" }),
      k.anchor("topleft"),
      k.pos(10, 10),
      k.color(200, 180, 60),
      k.fixed(),
    ]);

    const hudWarn = k.add([
      k.text("", { size: 12, font: "monospace" }),
      k.anchor("top"),
      k.pos(VW / 2, 10),
      k.color(220, 30, 30),
      k.fixed(),
    ]);

    const hudTimer = k.add([
      k.text("0.0s", { size: 10, font: "monospace" }),
      k.anchor("topright"),
      k.pos(VW - 10, 10),
      k.color(100, 100, 100),
      k.fixed(),
    ]);

    // Mobile hint
    k.add([
      k.text("tap bottom to move →  tap top = DEATH", { size: 8, font: "monospace" }),
      k.anchor("botleft"),
      k.pos(10, VH - 10),
      k.color(60, 60, 60),
      k.fixed(),
    ]);

    // ── Wall collision (AABB) ─────────────────────────────────────────────
    const PR = 8; // player radius

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
      hudKey.text = "🔑 KEY — find the EXIT";
      hudKey.color = k.rgb(80, 220, 80);
      if (audioCtx) playPickup(audioCtx);
      // Light up exit
      k.onUpdate("exit", (e: GameObj) => {
        e.color = k.rgb(40, 180, 40);
      });
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
    k.onKeyDown("space", () => {
      if (!isDead) triggerDeath();
    });

    // Mobile: tap top quarter = look up
    k.onMousePress(() => {
      const mp = k.mousePos();
      if (mp.y < VH * 0.22 && !isDead) triggerDeath();
    });

    // ── Main update loop ──────────────────────────────────────────────────
    const SPEED = 95;
    let warnPulse = 0;

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

      // Movement
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

      // Update camera + flashlight
      k.camPos(player.pos);
      darkness.pos.x = player.pos.x; darkness.pos.y = player.pos.y;
      fl1.pos.x = player.pos.x; fl1.pos.y = player.pos.y;
      fl2.pos.x = player.pos.x; fl2.pos.y = player.pos.y;
      fl3.pos.x = player.pos.x; fl3.pos.y = player.pos.y;

      // ── Shadow zone check ─────────────────────────────────────────────
      let minDist = 9999;
      let nearestSz = shadowZones[0];
      for (const sz of shadowZones) {
        const d = Math.hypot(player.pos.x - sz.x, player.pos.y - sz.y);
        if (d < minDist) { minDist = d; nearestSz = sz; }
      }

      const TRIGGER_DIST = 18;
      const WARN_DIST    = 65;

      if (minDist < TRIGGER_DIST) {
        // Walked into shadow zone — instant death
        triggerDeath();
        return;
      }

      if (minDist < WARN_DIST && nearestSz) {
        warnPulse += k.dt() * 6;
        const t = 1 - minDist / WARN_DIST;
        monsterGlow.pos.x = nearestSz.x;
        monsterGlow.pos.y = nearestSz.y;
        monsterGlow.opacity = t * 0.7;
        staticLevel = 0.25 + t * 0.9;
        hudWarn.text = minDist < 40 ? "⚠ DON'T LOOK UP ⚠" : "something is above you...";
        hudWarn.color = k.rgb(
          200 + Math.floor(Math.sin(warnPulse) * 55),
          20,
          20,
        );
        // Flicker flashlight
        fl1.opacity = 0.22 - t * 0.06 + Math.sin(warnPulse) * 0.03;
      } else {
        warnPulse = 0;
        monsterGlow.opacity = 0;
        staticLevel = 0.25;
        hudWarn.text = "";
      }

      staticFx.draw(staticLevel);
    });

    // ── Death / Jumpscare ─────────────────────────────────────────────────
    function triggerDeath() {
      isDead = true;
      if (audioCtx) playJumpscare(audioCtx);
      staticFx.draw(3);
      jsFx.trigger(() => {
        k.go("over");
      });
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

    k.add([
      k.text("YOU ESCAPED", { size: 38, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 105),
      k.color(60, 220, 60),
    ]);

    k.add([
      k.text(`Time: ${elapsed.toFixed(1)}s`, { size: 17, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 45),
      k.color(180, 180, 180),
    ]);

    k.add([
      k.text(`Score: ${score}`, { size: 26, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 10),
      k.color(255, 210, 0),
    ]);

    k.add([
      k.text(isNew ? "★  NEW BEST  ★" : `Best: ${prev}`, { size: 15, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 55),
      k.color(isNew ? 255 : 120, isNew ? 180 : 120, 0),
    ]);

    k.add([
      k.text("[ click / ENTER to play again ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 130),
      k.color(160, 160, 160),
    ]);

    let p = 0;
    k.onUpdate(() => { p += k.dt(); staticFx.draw(0.15 + Math.sin(p * 2) * 0.08); });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  // ── GAME OVER ─────────────────────────────────────────────────────────────
  k.scene("over", () => {
    onScore(0);

    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);

    k.add([
      k.text("IT GOT YOU", { size: 40, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 90),
      k.color(200, 20, 20),
    ]);

    k.add([
      k.text("You should have kept\nyour eyes on the floor.", {
        size: 14, font: "monospace", align: "center",
      }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 - 10),
      k.color(140, 140, 140),
    ]);

    k.add([
      k.text("[ click / ENTER to try again ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW / 2, VH / 2 + 100),
      k.color(160, 160, 160),
    ]);

    let p = 0;
    k.onUpdate(() => { p += k.dt(); staticFx.draw(0.5 + Math.sin(p * 4) * 0.35); });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
  });

  k.go("menu");

  return () => {
    audioStopped = true;
    if (stopAmbient) stopAmbient();
    try { if (audioCtx) audioCtx.close(); } catch { /* ignore */ }
    staticFx.destroy();
    jsFx.destroy();
    k.quit();
  };
}
