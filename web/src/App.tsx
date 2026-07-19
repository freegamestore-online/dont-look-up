import { GameShell, GameTopbar } from "@freegamestore/games";
import { useEffect, useRef, useState } from "react";
import { useHighScore } from "./hooks/useHighScore";
import { startGame } from "./game";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [highScore, updateHighScore] = useHighScore("dontlookup_best");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = startGame(canvas, (n: number) => {
      setScore(n);
      updateHighScore(n);
    });
    return stop;
  }, [updateHighScore]);

  return (
    <GameShell
      topbar={
        <GameTopbar title="Don't Look Up" score={score} highScore={highScore} />
      }
    >
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />
    </GameShell>
  );
}
