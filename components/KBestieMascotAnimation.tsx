"use client";

import { useEffect, useRef, useState } from "react";

interface KBestieMascotAnimationProps {
  state?: string;
  size?: number;
  fps?: number;
  className?: string;
}

const SPRITESHEET_SRC = "/Mascot/spritesheet.webp";
const FALLBACK_SRC = "/Images/mascot/mascot-standing.png";
const SHEET_WIDTH = 1536;
const SHEET_HEIGHT = 2288;
const GRID_COLUMNS = 8;
const GRID_ROWS = 11;
const CELL_WIDTH = SHEET_WIDTH / GRID_COLUMNS;
const CELL_HEIGHT = SHEET_HEIGHT / GRID_ROWS;

// validation.json 기준 상태별 실제 사용(used:true) 프레임만 반영한 표.
const STATE_FRAMES: Record<string, { row: number; columns: number[] }> = {
  idle: { row: 0, columns: [0, 1, 2, 3, 4, 5, 6] },
  "running-right": { row: 1, columns: [0, 1, 2, 3, 4, 5, 6, 7] },
  "running-left": { row: 2, columns: [0, 1, 2, 3, 4, 5, 6, 7] },
  waving: { row: 3, columns: [0, 1, 2, 3] },
  jumping: { row: 4, columns: [0, 1, 2, 3, 4] },
  failed: { row: 5, columns: [0, 1, 2, 3, 4, 5, 6, 7] },
  waiting: { row: 6, columns: [0, 1, 2, 3, 4, 5] },
  running: { row: 7, columns: [0, 1, 2, 3, 4, 5] },
  review: { row: 8, columns: [0, 1, 2, 3, 4, 5] },
};

export function KBestieMascotAnimation({
  state = "idle",
  size = 96,
  fps = 10,
  className,
}: KBestieMascotAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const frameIndexRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const pausedRef = useRef(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.onerror = () => setImgFailed(true);
    img.src = SPRITESHEET_SRC;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    function handleVisibility() {
      pausedRef.current = document.visibilityState === "hidden";
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!imgReady || imgFailed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const frames = STATE_FRAMES[state] ?? STATE_FRAMES.idle;
    const frameDurationMs = 1000 / fps;

    function drawFrame(col: number) {
      if (!ctx || !imgRef.current) return;
      ctx.clearRect(0, 0, size, size);
      const sx = col * CELL_WIDTH;
      const sy = frames.row * CELL_HEIGHT;
      const scale = Math.min(size / CELL_WIDTH, size / CELL_HEIGHT);
      const dw = CELL_WIDTH * scale;
      const dh = CELL_HEIGHT * scale;
      const dx = (size - dw) / 2;
      const dy = (size - dh) / 2;
      ctx.drawImage(imgRef.current, sx, sy, CELL_WIDTH, CELL_HEIGHT, dx, dy, dw, dh);
    }

    if (reducedMotionRef.current) {
      drawFrame(frames.columns[0]);
      return;
    }

    function tick(ts: number) {
      if (!pausedRef.current && ts - lastFrameTimeRef.current >= frameDurationMs) {
        lastFrameTimeRef.current = ts;
        frameIndexRef.current = (frameIndexRef.current + 1) % frames.columns.length;
        drawFrame(frames.columns[frameIndexRef.current]);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    drawFrame(frames.columns[0]);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [imgReady, imgFailed, state, size, fps]);

  if (imgFailed) {
    return (
      <img
        src={FALLBACK_SRC}
        alt="케이 마스코트"
        width={size}
        height={size}
        style={{ objectFit: "contain" }}
        className={className}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className={className}
      aria-label="케이 마스코트"
      role="img"
    />
  );
}
