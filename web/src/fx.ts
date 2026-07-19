// ─── FX helpers for Don't Look Up ────────────────────────────────────────────
// Audio, overlays, particles, decoys, shake — all DOM/Web Audio side effects.

export const VW = 640;
export const VH = 480;

// ─── Web Audio ────────────────────────────────────────────────────────────────
export function createAudioCtx(): AudioContext | null {
  try { return new AudioContext(); } catch { return null; }
}

export function playNoise(ctx: AudioContext, duration: number, vol: number) {
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

export function playTone(
  ctx: AudioContext, freq: number, dur: number, vol: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + dur);
}

export function playJumpscare(ctx: AudioContext) {
  // Loud white-noise screech blast
  playNoise(ctx, 0.08, 3.0);
  playTone(ctx, 1200, 0.12, 2.5, "sawtooth");
  playTone(ctx, 800,  0.08, 2.0, "square");
  setTimeout(() => { playNoise(ctx, 1.2, 1.8); }, 80);
  setTimeout(() => { playTone(ctx, 920, 0.5, 1.0, "sawtooth"); }, 100);
  setTimeout(() => { playTone(ctx, 460, 0.7, 0.8, "square"); }, 250);
  setTimeout(() => { playTone(ctx, 180, 0.5, 0.6, "sawtooth"); }, 400);
  setTimeout(() => { playNoise(ctx, 0.4, 1.0); }, 600);
}

export function playPickup(ctx: AudioContext) {
  playTone(ctx, 660, 0.12, 0.4);
  setTimeout(() => { playTone(ctx, 880, 0.15, 0.35); }, 110);
  setTimeout(() => { playTone(ctx, 1100, 0.18, 0.3); }, 220);
}

export function playWin(ctx: AudioContext) {
  playTone(ctx, 523, 0.2, 0.4);
  setTimeout(() => { playTone(ctx, 659, 0.2, 0.4); }, 200);
  setTimeout(() => { playTone(ctx, 784, 0.3, 0.5); }, 400);
  setTimeout(() => { playTone(ctx, 1046, 0.4, 0.4); }, 650);
}

// ─── Panting / heavy breathing ────────────────────────────────────────────────
export interface PantHandles {
  setRate: (r: number) => void; // 0=calm, 1=max panic
  stop: () => void;
}

export function startPanting(ctx: AudioContext): PantHandles {
  let rate = 0;
  let active = true;

  function pant() {
    if (!active) return;
    if (rate < 0.05) { setTimeout(pant, 2000); return; }

    // Each "breath" = inhale tone + exhale noise
    const vol = 0.04 + rate * 0.18;
    const inhaleFreq = 180 + rate * 120;
    // Inhale — rising filtered noise
    const inhDur = Math.max(0.18, 0.55 - rate * 0.32);
    playTone(ctx, inhaleFreq, inhDur, vol * 0.7, "sine");
    playNoise(ctx, inhDur * 0.8, vol * 0.5);

    // Exhale after inhale
    const exhaleDur = Math.max(0.22, 0.7 - rate * 0.38);
    setTimeout(() => {
      if (!active) return;
      playTone(ctx, inhaleFreq * 0.7, exhaleDur, vol * 0.55, "sine");
      playNoise(ctx, exhaleDur, vol * 0.4);
    }, inhDur * 1000 + 60);

    // Schedule next breath cycle
    const cycleMs = Math.max(380, 2200 - rate * 1700);
    setTimeout(pant, cycleMs);
  }

  pant();

  return {
    setRate(r: number) { rate = Math.max(0, Math.min(1, r)); },
    stop() { active = false; },
  };
}

// ─── Ambient drone ────────────────────────────────────────────────────────────
export interface AmbientHandles {
  setThreat: (t: number) => void;
  setTimePanic: (t: number) => void;
  stop: () => void;
}

export function startAmbient(ctx: AudioContext): AmbientHandles {
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
  let currentPanic = 0;

  const iv = setInterval(() => {
    const combined = Math.min(1, currentThreat + currentPanic);
    phase += 0.04 + currentPanic * 0.14;
    const freqShift  = combined * 55;
    const volBoost   = combined * 0.10;
    const tremorRate = 1 + combined * 10;
    const tremor     = Math.sin(phase * tremorRate) * 0.028 * (1 + combined * 3.5);
    g1.gain.setValueAtTime(Math.max(0.001, 0.03 + Math.sin(phase * 0.7) * 0.012 + volBoost + tremor), ctx.currentTime);
    g2.gain.setValueAtTime(Math.max(0.001, 0.05 + Math.sin(phase * 1.1) * 0.018 + volBoost * 1.4 + tremor), ctx.currentTime);
    g3.gain.setValueAtTime(Math.max(0.001, 0.04 + volBoost * 0.9 + Math.abs(tremor) * 0.6), ctx.currentTime);
    osc1.frequency.setValueAtTime(55  + freqShift + Math.sin(phase * 0.2) * 2, ctx.currentTime);
    osc2.frequency.setValueAtTime(82.5 + freqShift * 1.7 + Math.sin(phase * 0.3) * 3, ctx.currentTime);
    osc3.frequency.setValueAtTime(41  + freqShift * 0.6, ctx.currentTime);
  }, 50);

  function scheduleCreep() {
    const delay = Math.max(500, 3000 - currentPanic * 2400 + Math.random() * 1800);
    setTimeout(() => {
      const vol = 0.08 + currentThreat * 0.18 + currentPanic * 0.14;
      playNoise(ctx, 0.2 + currentPanic * 0.25, vol);
      playTone(ctx, 70 + Math.random() * 130 + currentThreat * 90, 0.5, vol * 0.9, "sawtooth");
      scheduleCreep();
    }, delay);
  }
  scheduleCreep();

  return {
    setThreat(t: number) { currentThreat = Math.max(0, Math.min(1, t)); },
    setTimePanic(t: number) { currentPanic = Math.max(0, Math.min(1, t)); },
    stop() { clearInterval(iv); try { osc1.stop(); osc2.stop(); osc3.stop(); } catch { /**/ } },
  };
}

// ─── Static / film-grain overlay ──────────────────────────────────────────────
export interface StaticFx { draw: (intensity: number) => void; destroy: () => void; }

export function makeStaticOverlay(parent: HTMLElement): StaticFx {
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
      const bs = intensity > 0.65 ? Math.floor(1 + intensity * 6) : 1;
      for (let y = 0; y < h; y += bs) {
        for (let x = 0; x < w; x += bs) {
          const v = Math.random() > 0.5 ? 255 : 0;
          const alpha = Math.floor(intensity * 100 * (0.4 + Math.random() * 0.6));
          for (let by = 0; by < bs && y + by < h; by++) {
            for (let bx = 0; bx < bs && x + bx < w; bx++) {
              const i = ((y + by) * w + (x + bx)) * 4;
              d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = alpha;
            }
          }
        }
      }
      ctx2.putImageData(img, 0, 0);
      sc.style.opacity = String(Math.min(0.30, 0.03 + intensity * 0.27));
      if (intensity > 0.5) {
        const jx = (Math.random() - 0.5) * intensity * 9;
        const jy = (Math.random() - 0.5) * intensity * 9;
        sc.style.transform = `translate(${jx}px,${jy}px)`;
      } else { sc.style.transform = "none"; }
    },
    destroy() { if (sc.parentElement) sc.parentElement.removeChild(sc); },
  };
}

// ─── Chromatic aberration / glitch overlay ────────────────────────────────────
export interface GlitchFx { trigger: (dur?: number) => void; destroy: () => void; }

export function makeGlitchFx(parent: HTMLElement): GlitchFx {
  const gc = document.createElement("canvas");
  gc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;opacity:0;";
  gc.width = VW; gc.height = VH;
  parent.appendChild(gc);
  const ctx2 = gc.getContext("2d")!;
  let endTime = 0;
  let rafId = 0;

  function drawGlitch() {
    const now = performance.now() / 1000;
    if (now > endTime) {
      gc.style.opacity = "0";
      ctx2.clearRect(0, 0, VW, VH);
      return;
    }
    gc.style.opacity = "1";
    ctx2.clearRect(0, 0, VW, VH);
    // Chromatic aberration: draw 3 offset colour bands
    const shift = 4 + Math.random() * 8;
    // Red channel strip
    ctx2.fillStyle = `rgba(255,0,0,0.15)`;
    for (let i = 0; i < 6; i++) {
      const sy = Math.random() * VH;
      const sh = 2 + Math.random() * 18;
      ctx2.fillRect(-shift, sy, VW + shift * 2, sh);
    }
    // Cyan channel strip (opposite offset)
    ctx2.fillStyle = `rgba(0,255,255,0.12)`;
    for (let i = 0; i < 6; i++) {
      const sy = Math.random() * VH;
      const sh = 2 + Math.random() * 14;
      ctx2.fillRect(shift, sy, VW, sh);
    }
    // Random white scan lines
    ctx2.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    for (let i = 0; i < 4; i++) {
      const sy = Math.random() * VH;
      ctx2.fillRect(0, sy, VW, 1 + Math.random() * 3);
    }
    // Random black horizontal tears
    ctx2.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
    for (let i = 0; i < 3; i++) {
      const sy = Math.random() * VH;
      ctx2.fillRect(0, sy, VW, 1 + Math.random() * 5);
    }
    rafId = requestAnimationFrame(drawGlitch);
  }

  return {
    trigger(dur = 0.7) {
      endTime = performance.now() / 1000 + dur;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(drawGlitch);
    },
    destroy() {
      cancelAnimationFrame(rafId);
      if (gc.parentElement) gc.parentElement.removeChild(gc);
    },
  };
}

// ─── Canvas shake ─────────────────────────────────────────────────────────────
export interface ShakeFx { apply: (intensity: number) => void; reset: () => void; }

export function makeShakeFx(canvas: HTMLCanvasElement): ShakeFx {
  return {
    apply(intensity: number) {
      if (intensity < 0.05) { canvas.style.transform = "none"; return; }
      const mag = intensity * 12;
      const tx = (Math.random() - 0.5) * mag;
      const ty = (Math.random() - 0.5) * mag;
      const rot = (Math.random() - 0.5) * intensity * 2;
      canvas.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg)`;
    },
    reset() { canvas.style.transform = "none"; },
  };
}

// ─── Jumpscare overlay (death screen) ─────────────────────────────────────────
export interface JumpscareOverlay { trigger: (onDone: () => void) => void; destroy: () => void; }

export function makeJumpscareOverlay(parent: HTMLElement): JumpscareOverlay {
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
      let t = 0; let raf = 0;
      const step = () => {
        t += 0.016;
        if (t < 0.07) {
          const r = Math.floor(120 + Math.random() * 135);
          div.style.background = `rgb(${r},0,0)`; div.style.opacity = "1";
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

// ─── Inverted panic overlay ("DON'T LOOK DOWN!") ─────────────────────────────
export interface InvertOverlay {
  show: () => void;
  hide: () => void;
  destroy: () => void;
  readonly visible: boolean;
}

export function makeInvertOverlay(parent: HTMLElement): InvertOverlay {
  const div = document.createElement("div");
  div.style.cssText = [
    "position:absolute;top:0;left:0;width:100%;height:100%;",
    "display:none;align-items:center;justify-content:center;flex-direction:column;",
    "pointer-events:none;z-index:100;",
    "background:rgba(180,0,0,0.18);",
  ].join("");
  div.innerHTML = `
    <div id="dld-msg" style="
      font-family:monospace;font-size:clamp(22px,6vw,52px);
      color:#ff0000;letter-spacing:4px;text-align:center;
      text-shadow:0 0 20px #f00,0 0 40px #900;
      animation:none;
    ">⚠ DON'T LOOK DOWN! ⚠</div>
    <div style="font-family:monospace;font-size:clamp(10px,2.5vw,18px);
      color:#ff8888;margin-top:10px;letter-spacing:2px;">
      RULES INVERTED — bottom half = DEATH
    </div>
  `;
  parent.appendChild(div);
  let _visible = false;
  let flickerRaf = 0;

  function flicker() {
    if (!_visible) return;
    const msg = div.querySelector("#dld-msg") as HTMLElement | null;
    if (msg) {
      const v = 180 + Math.floor(Math.random() * 75);
      msg.style.color = `rgb(${v},0,0)`;
      msg.style.textShadow = `0 0 ${15 + Math.random() * 20}px #f00, 0 0 ${30 + Math.random() * 30}px #900`;
    }
    div.style.background = `rgba(${150 + Math.floor(Math.random() * 50)},0,0,${0.12 + Math.random() * 0.12})`;
    flickerRaf = requestAnimationFrame(flicker);
  }

  return {
    get visible() { return _visible; },
    show() {
      _visible = true;
      div.style.display = "flex";
      cancelAnimationFrame(flickerRaf);
      flickerRaf = requestAnimationFrame(flicker);
    },
    hide() {
      _visible = false;
      div.style.display = "none";
      cancelAnimationFrame(flickerRaf);
    },
    destroy() {
      cancelAnimationFrame(flickerRaf);
      if (div.parentElement) div.parentElement.removeChild(div);
    },
  };
}

// ─── Ghost decoys (fake KEY / EXIT icons) ────────────────────────────────────
export interface GhostDecoyFx { update: (elapsed: number) => void; destroy: () => void; }

export function makeGhostDecoys(parent: HTMLElement): GhostDecoyFx {
  const gc = document.createElement("canvas");
  gc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:8;";
  gc.width = VW; gc.height = VH;
  parent.appendChild(gc);
  const ctx2 = gc.getContext("2d")!;

  interface Ghost {
    x: number; y: number; label: string;
    alpha: number; phase: number; phaseT: number; life: number; maxLife: number;
  }
  const ghosts: Ghost[] = [];
  let spawnCooldown = 7;

  function spawn() {
    const labels = ["🔑 KEY", "EXIT ▶", "KEY →", "← EXIT", "KEY ↑", "EXIT ↗"];
    const label = labels[Math.floor(Math.random() * labels.length)] ?? "KEY";
    ghosts.push({
      x: 55 + Math.random() * (VW - 110),
      y: 18 + Math.random() * (VH * 0.40),
      label, alpha: 0, phase: 0, phaseT: 0,
      life: 0, maxLife: 4 + Math.random() * 3,
    });
  }

  return {
    update(elapsed: number) {
      spawnCooldown -= 0.016;
      if (spawnCooldown <= 0 && elapsed > 5) {
        spawn();
        spawnCooldown = Math.max(3.5, 11 - elapsed * 0.09);
      }
      ctx2.clearRect(0, 0, VW, VH);
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i]!;
        g.life += 0.016; g.phaseT += 0.016;
        if (g.phase === 0) {
          g.alpha = Math.min(0.70, g.phaseT * 1.3);
          if (g.phaseT > 0.55) { g.phase = 1; g.phaseT = 0; }
        } else if (g.phase === 1) {
          g.alpha = 0.50 + Math.sin(g.phaseT * 7) * 0.20;
          if (g.life > g.maxLife - 1.1) { g.phase = 2; g.phaseT = 0; }
        } else {
          g.alpha = Math.max(0, 0.70 - g.phaseT);
        }
        if (g.life >= g.maxLife) { ghosts.splice(i, 1); continue; }
        g.y -= 0.28;
        ctx2.save();
        ctx2.globalAlpha = g.alpha;
        ctx2.font = "bold 13px monospace";
        const isKey = g.label.includes("KEY");
        ctx2.shadowColor = isKey ? "#ffcc00" : "#4488ff";
        ctx2.shadowBlur = 12 + Math.sin(g.life * 5) * 6;
        ctx2.fillStyle = isKey ? "#ffe066" : "#88aaff";
        ctx2.fillText(g.label, g.x, g.y);
        ctx2.globalAlpha = g.alpha * 0.28;
        ctx2.fillStyle = "#ffffff";
        ctx2.fillText(g.label, g.x + 2, g.y + 1);
        ctx2.restore();
      }
    },
    destroy() { if (gc.parentElement) gc.parentElement.removeChild(gc); },
  };
}

// ─── Dust motes ───────────────────────────────────────────────────────────────
export interface DustFx { update: (px: number, py: number, cs: number, cx: number, cy: number) => void; destroy: () => void; }
interface Mote { wx: number; wy: number; vx: number; vy: number; r: number; alpha: number; life: number; maxLife: number; }

export function makeDustFx(parent: HTMLElement): DustFx {
  const dc = document.createElement("canvas");
  dc.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;";
  dc.width = VW; dc.height = VH;
  parent.appendChild(dc);
  const ctx2 = dc.getContext("2d")!;
  const motes: Mote[] = [];
  const MAX = 30; let timer = 0;
  return {
    update(px, py, cs, cx, cy) {
      timer += 0.016;
      if (timer > 0.1 && motes.length < MAX) {
        const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 90;
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
