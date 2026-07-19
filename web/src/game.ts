import kaplay from "kaplay";
import type { KAPLAYCtx } from "kaplay";
import {
  VW, VH,
  createAudioCtx, playNoise, playTone, playJumpscare, playPickup, playWin,
  startAmbient, startPanting,
  makeStaticOverlay, makeGlitchFx, makeShakeFx,
  makeJumpscareOverlay, makeInvertOverlay,
  makeGhostDecoys, makeDustFx,
  type AmbientHandles, type PantHandles,
  type StaticFx, type GlitchFx, type ShakeFx,
  type JumpscareOverlay, type InvertOverlay,
  type GhostDecoyFx, type DustFx,
} from "./fx";

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

// Floor cell centres for monster pathfinding + zone drift
const FLOOR_CELLS: { x: number; y: number }[] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if ((MAP[r]![c] ?? 1) !== 1)
      FLOOR_CELLS.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

// ─── Simple BFS pathfinder (world coords → next step towards target) ──────────
function bfsNext(
  fromX: number, fromY: number,
  toX: number, toY: number,
  walls: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number } | null {
  const fc = (wx: number, wy: number) => ({ col: Math.round((wx - TILE / 2) / TILE), row: Math.round((wy - TILE / 2) / TILE) });
  const start = fc(fromX, fromY);
  const goal  = fc(toX, toY);
  if (start.col === goal.col && start.row === goal.row) return null;

  const isWall = (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
    return (MAP[row]![col] ?? 1) === 1;
  };

  const key = (c: number, r: number) => `${c},${r}`;
  const visited = new Set<string>();
  const queue: { col: number; row: number; path: { col: number; row: number }[] }[] = [];
  visited.add(key(start.col, start.row));
  queue.push({ col: start.col, row: start.row, path: [] });

  const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of dirs) {
      const nc = cur.col + d.dc, nr = cur.row + d.dr;
      if (isWall(nc, nr)) continue;
      const k2 = key(nc, nr);
      if (visited.has(k2)) continue;
      visited.add(k2);
      const newPath = [...cur.path, { col: nc, row: nr }];
      if (nc === goal.col && nr === goal.row) {
        const step = newPath[0] ?? { col: nc, row: nr };
        return { x: step.col * TILE + TILE / 2, y: step.row * TILE + TILE / 2 };
      }
      queue.push({ col: nc, row: nr, path: newPath });
    }
  }
  // Suppress unused-var warning — walls param used for future extension
  void walls;
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function startGame(canvas: HTMLCanvasElement, onScore: (n: number) => void): () => void {
  const k = kaplay({
    canvas, width: VW, height: VH,
    letterbox: true, background: [0, 0, 0],
    global: false,
    pixelDensity: Math.min(window.devicePixelRatio || 1, 2),
  }) as KAPLAYCtx;

  let audioCtx: AudioContext | null = null;
  let ambient:  AmbientHandles | null = null;
  let panting:  PantHandles | null = null;

  const parent = canvas.parentElement ?? document.body;
  const staticFx:  StaticFx         = makeStaticOverlay(parent);
  const glitchFx:  GlitchFx         = makeGlitchFx(parent);
  const shakeFx:   ShakeFx          = makeShakeFx(canvas);
  const jsFx:      JumpscareOverlay  = makeJumpscareOverlay(parent);
  const invertFx:  InvertOverlay     = makeInvertOverlay(parent);
  const ghostFx:   GhostDecoyFx      = makeGhostDecoys(parent);
  const dustFx:    DustFx            = makeDustFx(parent);

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = createAudioCtx();
    if (!audioCtx) return;
    ambient = startAmbient(audioCtx);
    panting = startPanting(audioCtx);
  }

  // ── MENU ──────────────────────────────────────────────────────────────────
  k.scene("menu", () => {
    onScore(0);
    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);
    k.add([k.text("DON'T",   { size: 54, font: "monospace" }), k.anchor("center"), k.pos(VW/2, VH/2-115), k.color(180,20,20)]);
    k.add([k.text("LOOK UP", { size: 54, font: "monospace" }), k.anchor("center"), k.pos(VW/2, VH/2-58),  k.color(220,30,30)]);
    k.add([k.text("◉",       { size: 38, font: "monospace" }), k.anchor("center"), k.pos(VW/2, VH/2+5),   k.color(100,0,0)]);
    k.add([k.text("Find the key. Reach the exit.\nKeep your eyes on the FLOOR.", { size: 12, font: "monospace", align: "center" }),
      k.anchor("center"), k.pos(VW/2, VH/2+65), k.color(150,150,150)]);
    k.add([k.text("WASD / Arrows to move  |  tap BOTTOM half on touch\n⚠  SPACE / top-half tap = instant death  ⚠", { size: 10, font: "monospace", align: "center" }),
      k.anchor("center"), k.pos(VW/2, VH/2+120), k.color(110,70,70)]);
    const startTxt = k.add([k.text("[ CLICK or ENTER to begin ]", { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2+180), k.color(200,200,200)]);
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

    // ── Flashlight state ──────────────────────────────────────────────────
    const FL_MAX = 75;
    const FL_MIN = 16;
    let flRadius    = FL_MAX;
    let flBlackout  = false;   // full blackout active
    let flBlackoutT = 0;       // countdown timer
    let flBlackoutCooldown = 12; // seconds until next possible blackout
    let tapCount    = 0;
    let tapResetT   = 0;

    // ── Inverted-rules state ──────────────────────────────────────────────
    let invertActive  = false;
    let invertTimer   = 0;     // countdown while active (3s)
    let invertCooldown = 15;   // seconds until next inversion

    // ── Monster state ─────────────────────────────────────────────────────
    // Each shadow zone is a monster that actively chases the player.
    // They use BFS every ~0.6s to get the next step.
    interface Monster {
      x: number; y: number;
      tx: number; ty: number;   // current BFS next-step target
      stepTimer: number;        // time until next BFS recalc
      stillTimer: number;       // how long player has been still near this monster
      aggroLocked: boolean;     // locked on after player stood still 2s
    }
    const monsters: Monster[] = [];

    // ── Wall rects ────────────────────────────────────────────────────────
    type WR = { x: number; y: number; w: number; h: number };
    const wallRects: WR[] = [];

    let playerStartX = TILE * 1.5, playerStartY = TILE * 1.5;
    let keyX = 0, keyY = 0, exitX = 0, exitY = 0;
    const wallObjs: ReturnType<typeof k.add>[] = [];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = MAP[row]![col]!;
        const wx = col * TILE, wy = row * TILE;
        if (cell === 1) {
          wallRects.push({ x: wx, y: wy, w: TILE, h: TILE });
          const wo = k.add([k.rect(TILE, TILE), k.color(72, 68, 78), k.pos(wx, wy), k.area(), "wall"]);
          wallObjs.push(wo);
          k.add([k.rect(TILE, 2), k.color(110,105,120), k.pos(wx, wy)]);
          k.add([k.rect(2, TILE), k.color(100,95,110),  k.pos(wx, wy)]);
          k.add([k.rect(TILE, 2), k.color(40,37,44),    k.pos(wx, wy+TILE-2)]);
          k.add([k.rect(2, TILE), k.color(40,37,44),    k.pos(wx+TILE-2, wy)]);
        } else {
          k.add([k.rect(TILE, TILE),     k.color(28,26,34), k.pos(wx, wy)]);
          k.add([k.rect(TILE-4,TILE-4),  k.color(34,32,42), k.pos(wx+2, wy+2)]);
          k.add([k.rect(TILE, 1),        k.color(18,16,24), k.pos(wx, wy)]);
          k.add([k.rect(1, TILE),        k.color(18,16,24), k.pos(wx, wy)]);
          if (cell === 2) { playerStartX = wx+TILE/2; playerStartY = wy+TILE/2; }
          else if (cell === 3) { keyX = wx+TILE/2; keyY = wy+TILE/2; }
          else if (cell === 4) { exitX = wx+TILE/2; exitY = wy+TILE/2; }
          else if (cell === 5) {
            monsters.push({
              x: wx+TILE/2, y: wy+TILE/2,
              tx: wx+TILE/2, ty: wy+TILE/2,
              stepTimer: 0, stillTimer: 0, aggroLocked: false,
            });
          }
        }
      }
    }

    // ── Monster visuals ───────────────────────────────────────────────────
    const monsterObjs: ReturnType<typeof k.add>[] = [];
    const monsterGlowObjs: ReturnType<typeof k.add>[] = [];
    for (const m of monsters) {
      monsterObjs.push(k.add([k.circle(22), k.color(50,0,0), k.anchor("center"), k.pos(m.x, m.y)]));
      monsterGlowObjs.push(k.add([k.circle(36), k.color(100,0,0), k.anchor("center"), k.pos(m.x, m.y), k.opacity(0)]));
    }

    // ── Exit + Key ────────────────────────────────────────────────────────
    const exitObj = k.add([k.rect(26,30), k.color(30,30,140), k.anchor("center"), k.pos(exitX, exitY), k.area(), "exit"]);
    k.add([k.text("EXIT", { size: 6, font: "monospace" }), k.anchor("center"), k.pos(exitX, exitY-22), k.color(80,80,255)]);
    const keyObj = k.add([k.circle(7), k.color(255,200,0), k.anchor("center"), k.pos(keyX, keyY), k.area(), "key"]);

    // ── Player ────────────────────────────────────────────────────────────
    const player = k.add([k.circle(8), k.color(220,220,220), k.anchor("center"),
      k.pos(playerStartX, playerStartY), k.area(), "player"]);

    const CAM_SCALE = 1.5;
    k.camScale(CAM_SCALE);
    k.camPos(player.pos);

    // ── Darkness + flashlight rings ───────────────────────────────────────
    const darkness = k.add([k.rect(VW*5, VH*5), k.color(0,0,0), k.anchor("center"),
      k.pos(player.pos.x, player.pos.y), k.opacity(0.88)]);
    const fl1 = k.add([k.circle(FL_MAX),       k.color(255,240,200), k.anchor("center"), k.pos(player.pos.x, player.pos.y), k.opacity(0.30)]);
    const fl2 = k.add([k.circle(FL_MAX*1.6),   k.color(255,230,180), k.anchor("center"), k.pos(player.pos.x, player.pos.y), k.opacity(0.13)]);
    const fl3 = k.add([k.circle(FL_MAX*2.3),   k.color(200,210,255), k.anchor("center"), k.pos(player.pos.x, player.pos.y), k.opacity(0.05)]);

    // ── HUD ───────────────────────────────────────────────────────────────
    const hudKey = k.add([k.text("[ find the KEY ]", { size: 10, font: "monospace" }),
      k.anchor("topleft"), k.pos(10, 10), k.color(210,175,45), k.fixed()]);
    const hudWarn = k.add([k.text("", { size: 12, font: "monospace" }),
      k.anchor("top"), k.pos(VW/2, 10), k.color(220,30,30), k.fixed()]);
    const hudTimer = k.add([k.text("0.0s", { size: 10, font: "monospace" }),
      k.anchor("topright"), k.pos(VW-10, 10), k.color(60,200,60), k.fixed()]);
    const hudFlash = k.add([k.text("", { size: 9, font: "monospace" }),
      k.anchor("botright"), k.pos(VW-10, VH-10), k.color(180,140,40), k.fixed()]);
    k.add([k.text("↑ top half = LOOK UP (death)  |  WASD / arrows to move", { size: 7, font: "monospace" }),
      k.anchor("botleft"), k.pos(10, VH-8), k.color(55,55,55), k.fixed()]);

    // ── Wall collision ─────────────────────────────────────────────────────
    const PR = 8;
    function collides(px: number, py: number): boolean {
      for (const w of wallRects) {
        if (px+PR > w.x && px-PR < w.x+w.w && py+PR > w.y && py-PR < w.y+w.h) return true;
      }
      return false;
    }

    // ── Monster collision (radius) ─────────────────────────────────────────
    const MONSTER_KILL_R = 20;
    function monsterHitsPlayer(mx: number, my: number): boolean {
      const dx = mx - player.pos.x, dy = my - player.pos.y;
      return Math.sqrt(dx*dx + dy*dy) < MONSTER_KILL_R;
    }

    // ── Trigger death ─────────────────────────────────────────────────────
    function triggerDeath() {
      if (isDead) return;
      isDead = true;
      invertFx.hide();
      if (audioCtx) playJumpscare(audioCtx);
      shakeFx.apply(1.0);
      glitchFx.trigger(0.3);
      jsFx.trigger(() => {
        shakeFx.reset();
        k.go("over", 0, (Date.now() - startTime) / 1000);
      });
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
      invertFx.hide();
      k.go("win", score, elapsed);
    });

    // ── SPACE = death ──────────────────────────────────────────────────────
    k.onKeyDown("space", () => { if (!isDead && !invertActive) triggerDeath(); });

    // ── Touch / click handler ──────────────────────────────────────────────
    // Bottom-half taps also pump the flashlight.
    // During inversion: bottom = death, top = safe.
    let lastPlayerX = playerStartX, lastPlayerY = playerStartY;
    let playerStillTimer = 0;

    k.onMousePress(() => {
      if (isDead) return;
      const mp = k.mousePos();
      const topHalf = mp.y < VH * 0.5;

      if (!invertActive) {
        // Normal rules: top = death
        if (topHalf) { triggerDeath(); return; }
        // Bottom tap = pump flashlight
        tapCount++;
        tapResetT = 0;
        if (tapCount >= 5) {
          flRadius = Math.min(FL_MAX, flRadius + 18);
          tapCount = 0;
          if (audioCtx) playTone(audioCtx, 440, 0.08, 0.15);
        }
      } else {
        // INVERTED: bottom = death, top = safe (no effect)
        if (!topHalf) { triggerDeath(); return; }
      }
    });

    // ── Main update ───────────────────────────────────────────────────────
    const SPEED = 130;
    let glitchCooldown = 0;   // prevent rapid glitch spam
    let jumpscareNearCooldown = 0; // prevent rapid screech spam

    k.onUpdate(() => {
      if (isDead) return;

      const dt = k.dt();
      const elapsed = (Date.now() - startTime) / 1000;
      const timePanic = Math.min(1, elapsed / 120);

      hudTimer.text = `${elapsed.toFixed(1)}s`;

      // ── Key pulse ───────────────────────────────────────────────────────
      keyPulse += dt * 4;
      if (!hasKey && keyObj.exists()) {
        keyObj.color = k.rgb(
          220 + Math.floor(Math.sin(keyPulse) * 35),
          170 + Math.floor(Math.sin(keyPulse) * 30),
          0,
        );
      }

      // ── Player still timer ──────────────────────────────────────────────
      const moved = Math.abs(player.pos.x - lastPlayerX) > 0.5 || Math.abs(player.pos.y - lastPlayerY) > 0.5;
      if (moved) { playerStillTimer = 0; }
      else { playerStillTimer += dt; }
      lastPlayerX = player.pos.x; lastPlayerY = player.pos.y;

      // ── Movement ────────────────────────────────────────────────────────
      let dx = 0, dy = 0;
      if (k.isKeyDown("left")  || k.isKeyDown("a")) dx -= 1;
      if (k.isKeyDown("right") || k.isKeyDown("d")) dx += 1;
      if (k.isKeyDown("up")    || k.isKeyDown("w")) dy -= 1;
      if (k.isKeyDown("down")  || k.isKeyDown("s")) dy += 1;
      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
      const nx = player.pos.x + dx * SPEED * dt;
      const ny = player.pos.y + dy * SPEED * dt;
      if (!collides(nx, player.pos.y)) player.pos.x = nx;
      if (!collides(player.pos.x, ny)) player.pos.y = ny;

      // ── Camera follow ────────────────────────────────────────────────────
      k.camPos(player.pos);
      darkness.pos.x = player.pos.x; darkness.pos.y = player.pos.y;
      fl1.pos.x = player.pos.x; fl1.pos.y = player.pos.y;
      fl2.pos.x = player.pos.x; fl2.pos.y = player.pos.y;
      fl3.pos.x = player.pos.x; fl3.pos.y = player.pos.y;

      // ── 1. Monster AI: BFS stalking + aggro lock ──────────────────────────
      let closestMonsterDist = Infinity;
      const MONSTER_SPEED_BASE = 38;

      for (let i = 0; i < monsters.length; i++) {
        const m = monsters[i]!;
        const mo = monsterObjs[i];
        const mg = monsterGlowObjs[i];

        // Aggro lock: if player is still for 2s near monster, lock on hard
        const distToPlayer = Math.hypot(player.pos.x - m.x, player.pos.y - m.y);
        if (distToPlayer < 180 && playerStillTimer > 2) {
          m.aggroLocked = true;
        }
        if (distToPlayer > 300) m.aggroLocked = false;

        // BFS recalc — more frequent when aggro locked or close
        const bfsInterval = m.aggroLocked ? 0.25 : (distToPlayer < 120 ? 0.4 : 0.7);
        m.stepTimer -= dt;
        if (m.stepTimer <= 0) {
          m.stepTimer = bfsInterval;
          // Target: player if aggro-locked or close, else drift toward random floor cell
          const targetX = (m.aggroLocked || distToPlayer < 200)
            ? player.pos.x
            : (FLOOR_CELLS[Math.floor(Math.random() * FLOOR_CELLS.length)]?.x ?? m.x);
          const targetY = (m.aggroLocked || distToPlayer < 200)
            ? player.pos.y
            : (FLOOR_CELLS[Math.floor(Math.random() * FLOOR_CELLS.length)]?.y ?? m.y);

          const next = bfsNext(m.x, m.y, targetX, targetY, wallRects);
          if (next) { m.tx = next.x; m.ty = next.y; }
        }

        // Move toward BFS step target
        const stepDx = m.tx - m.x, stepDy = m.ty - m.y;
        const stepDist = Math.hypot(stepDx, stepDy);
        // Speed scales with panic and aggro
        const monsterSpeed = MONSTER_SPEED_BASE
          * (1 + timePanic * 1.8)
          * (m.aggroLocked ? 2.2 : 1.0)
          * (distToPlayer < 100 ? 1.5 : 1.0);

        if (stepDist > 2) {
          m.x += (stepDx / stepDist) * monsterSpeed * dt;
          m.y += (stepDy / stepDist) * monsterSpeed * dt;
        }

        // Update visuals
        if (mo) { mo.pos.x = m.x; mo.pos.y = m.y; }
        if (mg) {
          mg.pos.x = m.x; mg.pos.y = m.y;
          const glowAlpha = Math.max(0, 0.6 - distToPlayer / 160);
          mg.opacity = glowAlpha;
        }

        // Track closest
        if (distToPlayer < closestMonsterDist) closestMonsterDist = distToPlayer;

        // Kill player on contact
        if (monsterHitsPlayer(m.x, m.y)) { triggerDeath(); return; }
      }

      // ── Threat level ──────────────────────────────────────────────────────
      const THREAT_DIST = 160;
      threatLevel = Math.max(0, Math.min(1, 1 - closestMonsterDist / THREAT_DIST));
      ambient?.setThreat(threatLevel);
      ambient?.setTimePanic(timePanic);

      // Panting rate: combines threat + time panic + still-timer (panic when cornered)
      const pantRate = Math.min(1, threatLevel * 0.7 + timePanic * 0.4 + (playerStillTimer > 1.5 ? 0.3 : 0));
      panting?.setRate(pantRate);

      // ── 2. Flashlight blackout ────────────────────────────────────────────
      tapResetT += dt;
      if (tapResetT > 1.5) tapCount = 0; // reset tap count if no taps for 1.5s

      // Shrink flashlight over time + threat
      if (!flBlackout) {
        const shrinkRate = 2.5 + timePanic * 5 + threatLevel * 4;
        flRadius = Math.max(FL_MIN, flRadius - shrinkRate * dt);

        // Random blackout trigger
        flBlackoutCooldown -= dt;
        if (flBlackoutCooldown <= 0 && elapsed > 10) {
          flBlackout = true;
          flBlackoutT = 1.5;
          flBlackoutCooldown = Math.max(8, 20 - timePanic * 12);
          // Heavy breathing burst during blackout
          if (audioCtx) {
            playNoise(audioCtx, 0.3, 0.5);
            playTone(audioCtx, 120, 0.4, 0.3, "sine");
          }
        }
      } else {
        flBlackoutT -= dt;
        if (flBlackoutT <= 0) {
          flBlackout = false;
          flRadius = FL_MIN + 10; // emerge from blackout with tiny light
        }
      }

      // Apply flashlight visuals
      const effectiveRadius = flBlackout ? 0 : flRadius;
      const breathScale = 1 + Math.sin(breathPhase) * 0.04 + threatLevel * Math.sin(breathPhase * 3) * 0.03;
      breathPhase += dt * (1.8 + threatLevel * 2.5);

      if (fl1.exists()) {
        (fl1 as unknown as { radius: number }).radius = effectiveRadius * breathScale;
        fl1.opacity = flBlackout ? 0 : (0.30 - threatLevel * 0.08);
      }
      if (fl2.exists()) {
        (fl2 as unknown as { radius: number }).radius = effectiveRadius * 1.6 * breathScale;
        fl2.opacity = flBlackout ? 0 : (0.13 - threatLevel * 0.04);
      }
      if (fl3.exists()) {
        (fl3 as unknown as { radius: number }).radius = effectiveRadius * 2.3 * breathScale;
        fl3.opacity = flBlackout ? 0 : Math.max(0, 0.05 - threatLevel * 0.02);
      }
      darkness.opacity = flBlackout ? 1.0 : (0.88 + threatLevel * 0.08);

      // HUD flashlight meter
      const flPct = Math.round((flRadius / FL_MAX) * 100);
      hudFlash.text = flBlackout ? "■■■■■ BLACKOUT ■■■■■" : `light: ${flPct}%  [tap×5 to recharge]`;
      hudFlash.color = flBlackout ? k.rgb(200,0,0) : (flPct < 30 ? k.rgb(220,60,30) : k.rgb(180,140,40));

      // ── 4. Glitch jumpscare when monster gets within 2 tiles ──────────────
      glitchCooldown -= dt;
      jumpscareNearCooldown -= dt;
      if (closestMonsterDist < TILE * 2.5 && glitchCooldown <= 0) {
        glitchFx.trigger(0.5);
        shakeFx.apply(0.6);
        glitchCooldown = 1.2;
        if (jumpscareNearCooldown <= 0 && audioCtx) {
          // Short white-noise screech
          playNoise(audioCtx, 0.12, 2.2);
          playTone(audioCtx, 900 + Math.random() * 400, 0.15, 1.5, "sawtooth");
          jumpscareNearCooldown = 3.0;
        }
      } else if (closestMonsterDist >= TILE * 2.5) {
        // Subtle shake near monster
        if (closestMonsterDist < TILE * 5) {
          shakeFx.apply(threatLevel * 0.35);
        } else {
          shakeFx.reset();
        }
      }

      // ── 5. Inverted panic ("DON'T LOOK DOWN!") ────────────────────────────
      invertCooldown -= dt;
      if (invertActive) {
        invertTimer -= dt;
        if (invertTimer <= 0) {
          invertActive = false;
          invertFx.hide();
          invertCooldown = Math.max(10, 15 - timePanic * 5);
        }
      } else if (invertCooldown <= 0 && elapsed > 20) {
        invertActive = true;
        invertTimer = 3.0;
        invertFx.show();
        if (audioCtx) {
          playNoise(audioCtx, 0.15, 0.8);
          playTone(audioCtx, 200, 0.3, 0.5, "sawtooth");
        }
      }

      // ── Tile flicker near monster ─────────────────────────────────────────
      if (threatLevel > 0.5 && Math.random() < threatLevel * 0.15) {
        const idx = Math.floor(Math.random() * wallObjs.length);
        const wo = wallObjs[idx];
        if (wo && wo.exists()) {
          const flicker = Math.random() > 0.5;
          wo.opacity = flicker ? 0 : 1;
          setTimeout(() => { if (wo.exists()) wo.opacity = 1; }, 60);
        }
      }

      // ── Warning HUD ───────────────────────────────────────────────────────
      warnPulse += dt * 4;
      if (threatLevel > 0.55) {
        const msgs = ["⚠ IT'S CLOSE", "DON'T STOP", "KEEP MOVING"];
        const msg = msgs[Math.floor(elapsed * 0.5) % msgs.length] ?? "⚠";
        hudWarn.text = msg;
        hudWarn.color = k.rgb(220, Math.floor(30 + Math.sin(warnPulse) * 30), 30);
      } else if (flBlackout) {
        hudWarn.text = "— BLACKOUT —";
        hudWarn.color = k.rgb(180, 0, 0);
      } else if (invertActive) {
        hudWarn.text = "⚠ RULES INVERTED ⚠";
        hudWarn.color = k.rgb(255, 50, 50);
      } else {
        hudWarn.text = "";
      }

      // ── Static FX ─────────────────────────────────────────────────────────
      const staticIntensity = threatLevel * 0.5 + timePanic * 0.3 + (flBlackout ? 0.7 : 0);
      staticFx.draw(staticIntensity);

      // ── Ghost decoys ──────────────────────────────────────────────────────
      ghostFx.update(elapsed);

      // ── Dust ──────────────────────────────────────────────────────────────
      dustFx.update(player.pos.x, player.pos.y, CAM_SCALE, player.pos.x, player.pos.y);
    });
  });

  // ── OVER ──────────────────────────────────────────────────────────────────
  k.scene("over", (_score: number, elapsed: number) => {
    invertFx.hide();
    shakeFx.reset();
    onScore(0);
    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);
    k.add([k.text("GAME OVER", { size: 40, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2-90), k.color(200,20,20)]);
    k.add([k.text("◉  ◉", { size: 30, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2-30), k.color(140,0,0)]);
    k.add([k.text("IT FOUND YOU", { size: 18, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2+20), k.color(160,40,40)]);
    k.add([k.text(`survived: ${elapsed.toFixed(1)}s`, { size: 13, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2+65), k.color(100,100,100)]);
    const retry = k.add([k.text("[ click or ENTER to try again ]", { size: 12, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2+130), k.color(160,160,160)]);
    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt() * 2;
      const v = 120 + Math.floor(Math.sin(pulse) * 40);
      retry.color = k.rgb(v, v, v);
      staticFx.draw(0.18 + Math.sin(pulse * 0.7) * 0.1);
    });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
    k.onKeyPress("space", () => k.go("play"));
  });

  // ── WIN ───────────────────────────────────────────────────────────────────
  k.scene("win", (score: number, elapsed: number) => {
    invertFx.hide();
    shakeFx.reset();
    onScore(score);
    k.add([k.rect(VW, VH), k.color(0, 0, 0), k.pos(0, 0)]);
    k.add([k.text("YOU ESCAPED", { size: 36, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2-90), k.color(40,200,80)]);
    k.add([k.text(`time: ${elapsed.toFixed(1)}s`, { size: 14, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2-30), k.color(100,180,100)]);
    k.add([k.text(`score: ${score}`, { size: 20, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2+20), k.color(80,220,80)]);
    const again = k.add([k.text("[ click or ENTER to play again ]", { size: 12, font: "monospace" }),
      k.anchor("center"), k.pos(VW/2, VH/2+100), k.color(160,160,160)]);
    let pulse = 0;
    k.onUpdate(() => {
      pulse += k.dt() * 2;
      const v = 120 + Math.floor(Math.sin(pulse) * 40);
      again.color = k.rgb(v, v, v);
      staticFx.draw(0.08);
    });
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("enter", () => k.go("play"));
    k.onKeyPress("space", () => k.go("play"));
  });

  k.go("menu");

  // ── Teardown ──────────────────────────────────────────────────────────────
  return () => {
    ambient?.stop();
    panting?.stop();
    staticFx.destroy();
    glitchFx.destroy();
    jsFx.destroy();
    invertFx.destroy();
    ghostFx.destroy();
    dustFx.destroy();
    shakeFx.reset();
    k.quit();
  };
}
