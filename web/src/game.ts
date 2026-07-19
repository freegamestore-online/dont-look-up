import kaplay from "kaplay";

// A complete, playable game in ~75 lines — because KAPLAY gives you sprites,
// input, gravity, areas and collisions as verbs. Compare this to hand-rolling a
// game loop, a renderer and a physics step on a raw <canvas>. Replace the body of
// the "play" scene to build your own game; keep `startGame`'s signature so
// App.tsx can mount it.
//
// Catch: move the basket to catch falling fruit. Miss three and it's game over.

const VW = 400; // virtual width  (KAPLAY letterboxes this to the real canvas)
const VH = 600; // virtual height

export function startGame(canvas: HTMLCanvasElement, onScore: (n: number) => void): () => void {
  const k = kaplay({
    canvas,
    width: VW,
    height: VH,
    letterbox: true,
    background: [24, 24, 27],
    global: false, // don't pollute window — call methods on `k`
    pixelDensity: Math.min(window.devicePixelRatio || 1, 2),
  });

  k.scene("play", () => {
    let score = 0;
    let lives = 3;
    onScore(0);

    const basket = k.add([
      k.rect(72, 20, { radius: 4 }),
      k.color(16, 185, 129), // brand emerald
      k.area(),
      k.anchor("center"),
      k.pos(VW / 2, VH - 48),
      "basket",
    ]);

    // Move the basket to the pointer (touch or mouse) — the whole control scheme.
    k.onMouseMove((mpos) => {
      basket.pos.x = k.clamp(mpos.x, 36, VW - 36);
    });
    // Keyboard fallback for desktop.
    k.onUpdate(() => {
      if (k.isKeyDown("left")) basket.pos.x = Math.max(36, basket.pos.x - 6);
      if (k.isKeyDown("right")) basket.pos.x = Math.min(VW - 36, basket.pos.x + 6);
    });

    // Spawn a piece of fruit that falls at a random speed.
    function spawnFruit() {
      k.add([
        k.circle(k.rand(8, 13)),
        k.color(k.choose([k.rgb(239, 68, 68), k.rgb(250, 204, 21), k.rgb(59, 130, 246), k.rgb(244, 114, 182)])),
        k.area(),
        k.anchor("center"),
        k.pos(k.rand(24, VW - 24), -20),
        k.move(k.DOWN, k.rand(120, 220)),
        "fruit",
      ]);
      k.wait(k.rand(0.5, 1.1), spawnFruit);
    }
    spawnFruit();

    basket.onCollide("fruit", (fruit) => {
      k.destroy(fruit);
      score += 1;
      onScore(score);
    });

    // A fruit that falls past the bottom costs a life.
    k.onUpdate("fruit", (fruit) => {
      if (fruit.pos.y > VH + 20) {
        k.destroy(fruit);
        lives -= 1;
        if (lives <= 0) k.go("over", score);
      }
    });
  });

  k.scene("over", (finalScore: number) => {
    k.add([k.text("Game Over", { size: 40 }), k.anchor("center"), k.pos(VW / 2, VH / 2 - 30), k.color(255, 255, 255)]);
    k.add([k.text(`Score: ${finalScore}`, { size: 24 }), k.anchor("center"), k.pos(VW / 2, VH / 2 + 16), k.color(16, 185, 129)]);
    k.add([k.text("tap to play again", { size: 16 }), k.anchor("center"), k.pos(VW / 2, VH / 2 + 56), k.color(160, 160, 160)]);
    k.onMousePress(() => k.go("play"));
    k.onKeyPress("space", () => k.go("play"));
  });

  k.go("play");

  // KAPLAY manages the RAF loop; return a teardown so React can unmount cleanly.
  return () => k.quit();
}
