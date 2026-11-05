import { GameShell, GameTopbar, useSound } from "@freegamestore/games";
import { useEffect, useRef, useState } from "react";
import { useHighScore } from "./hooks/useHighScore";
import { startGame } from "./game";
import { setMuted } from "./fx";

// Keeps the game's Web Audio master gain in step with the platform topbar Mute button.
function SoundBridge() {
  const { muted } = useSound();
  useEffect(() => {
    setMuted(muted);
  }, [muted]);
  return null;
}

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
        <GameTopbar title="Don't Look Up" score={score} stats={[{ label: "Best", value: highScore }]} />
      }
    >
      <SoundBridge />
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />
    </GameShell>
  );
}
