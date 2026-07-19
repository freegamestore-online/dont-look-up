# APPNAME

A free game on FreeGameStore, built on the **KAPLAY** browser game engine.

- Subdomain: `APPNAME.freegamestore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Engine: KAPLAY

This template uses [KAPLAY](https://kaplayjs.com) (the maintained successor to
Kaboom.js) — a small, beginner-friendly 2D game engine. It gives you sprites,
input, gravity, areas and collisions as one-line verbs, so a full game is tens of
lines instead of hundreds of hand-written canvas + physics code.

- **`web/src/game.ts`** — the whole game. KAPLAY owns the loop, rendering, input
  and collisions. This is where you build; start from the sample "catch" game.
- **`web/src/App.tsx`** — thin React layer: the `@freegamestore/games` shell +
  score readout. It mounts a `<canvas>` and hands it to `startGame`. You rarely
  touch this.

### Working in game.ts

- Everything is `k.<verb>` (the KAPLAY context is passed, `global: false`). Add
  entities with `k.add([...])` components: `k.pos`, `k.sprite`/`k.rect`/`k.circle`,
  `k.area` (collision), `k.body` (gravity), `k.move`, tags.
- Input: `k.onMouseMove`, `k.onMousePress`, `k.onKeyDown`, `k.onKeyPress`.
- Collisions: `thing.onCollide("tag", (other) => …)`.
- Scenes: `k.scene("name", () => …)` + `k.go("name")` for play / game-over.
- Report the score to React via the `onScore` callback passed into `startGame`.
- **Keep files focused (~300 lines).** Split multi-scene games into modules
  (`scenes/play.ts`, `entities/player.ts`) and import them — smaller files are
  easier to edit safely.

Free, MIT-licensed, no tracking. For platform conventions, read
https://freegamestore.online/skills.md
before writing or changing anything.
