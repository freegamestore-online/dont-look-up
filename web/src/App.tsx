import { GameShell, GameTopbar } from "@freegamestore/games";
import { useEffect, useRef, useState } from "react";
import { startGame } from "./game";

// The React layer is thin on purpose: it owns the SDK shell + the score readout,
// and hands the <canvas> to KAPLAY, which owns the game loop, rendering, input,
// physics and collisions. All the game logic lives in ./game.ts — see how short
// a full playable game is when the engine does the heavy lifting.
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // startGame returns a teardown fn; run it on unmount so hot-reload / route
    // changes don't leak a second KAPLAY instance onto the page.
    const stop = startGame(canvas, setScore);
    return stop;
  }, []);

  return (
    <GameShell topbar={<GameTopbar title="APPNAME" score={score} />}>
      {/* KAPLAY letterboxes its fixed virtual resolution to fill this box. */}
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />
    </GameShell>
  );
}
