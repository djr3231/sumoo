"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Logical (CSS) pixel size of the pad. The backing store is scaled up by
// devicePixelRatio in the setup effect below so strokes stay crisp on
// retina displays, but every coordinate used in this file (pointer math,
// drawImage target size) stays in this logical space.
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 150;
const STROKE_WIDTH = 2;

type Mode = "draw" | "upload";

export interface SignatureFieldProps {
  /** PNG (or JPEG) data-URL, or null when no signature is set. Controlled — this component keeps no persistence beyond the canvas's own drawing scratch. */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

export function SignatureField({ value, onChange }: SignatureFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>("draw");

  // One-time backing-store setup: size the canvas's actual pixel buffer to
  // CANVAS_WIDTH/HEIGHT * devicePixelRatio (crisp on retina), then scale the
  // 2D context so every drawing call below can keep working in logical
  // (CSS) pixel coordinates — no per-call DPR math needed elsewhere.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000";
    ctx.fillStyle = "#000000";
    ctx.lineWidth = STROKE_WIDTH;
    ctxRef.current = ctx;
  }, []);

  // Controlled sync: the canvas's visible content is derived from `value`
  // whenever it changes from OUTSIDE (including a parent resetting it to
  // null, e.g. after a form reset) — per the controlled-component contract,
  // this is the only place besides live drawing that paints the canvas.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!value) return;

    const img = new Image();
    img.onload = () => {
      // Guard: only paint if this is still the live context (component
      // could have unmounted while the image was decoding).
      const liveCtx = ctxRef.current;
      if (!liveCtx) return;
      liveCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      liveCtx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    };
    img.src = value;
  }, [value]);

  // Pointer clientX/clientY are in CSS viewport pixels; the canvas element's
  // displayed size (getBoundingClientRect) matches CANVAS_WIDTH/HEIGHT under
  // normal layout, but computing an explicit scale factor keeps strokes
  // aligned even if a parent ever stretches the element via CSS.
  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "draw") return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const point = getPoint(e);
    lastPointRef.current = point;
    // Draw a dot immediately so a tap without movement still leaves a mark.
    ctx.beginPath();
    ctx.arc(point.x, point.y, STROKE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const ctx = ctxRef.current;
    const last = lastPointRef.current;
    if (!ctx || !last) return;
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function endStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    const canvas = e.currentTarget;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    onChange(canvas.toDataURL("image/png"));
  }

  function handleClear() {
    const ctx = ctxRef.current;
    ctx?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    onChange(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file on a later attempt
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      const ctx = ctxRef.current;
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          const liveCtx = ctxRef.current;
          if (!liveCtx) return;
          liveCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          liveCtx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        };
        img.src = dataUrl;
      }
      onChange(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-pressed={mode === "draw"}
          onClick={() => setMode("draw")}
        >
          צייר חתימה
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-pressed={mode === "upload"}
          onClick={() => {
            setMode("upload");
            fileInputRef.current?.click();
          }}
        >
          העלאת תמונה
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={cn(
          "border border-border bg-background touch-none",
          mode === "draw" ? "cursor-crosshair" : "cursor-default",
        )}
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      />
      <Button type="button" variant="outline" onClick={handleClear}>
        נקה
      </Button>
    </div>
  );
}
