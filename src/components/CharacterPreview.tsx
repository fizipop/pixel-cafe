"use client";
import { useEffect, useRef } from "react";

type Props = {
  pixels: string[];
  cols: number; // grid width (rows are derived)
  scale: number; // screen pixels per art pixel
  className?: string;
};

/** Crisp, non-blurry render of a pixel grid. Used for previews, thumbnails and sprites. */
export default function CharacterPreview({ pixels, cols, scale, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rows = Math.ceil(pixels.length / cols);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cols * scale, rows * scale);
    pixels.forEach((c, i) => {
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect((i % cols) * scale, Math.floor(i / cols) * scale, scale, scale);
    });
  }, [pixels, cols, rows, scale]);

  return (
    <canvas
      ref={ref}
      width={cols * scale}
      height={rows * scale}
      className={`pixelated ${className ?? ""}`}
    />
  );
}
