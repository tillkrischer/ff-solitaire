import type { PointerEvent, RefObject } from "react";

type SolitaireCanvasProps = {
  wrapRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: () => void;
};

export function SolitaireCanvas({
  wrapRef,
  canvasRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: SolitaireCanvasProps): JSX.Element {
  return (
    <div ref={wrapRef} className="grid min-h-0 w-full items-start justify-items-center">
      <canvas
        ref={canvasRef}
        className="block max-w-full touch-none border border-[rgba(237,175,92,0.5)] bg-[#21110d] shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        aria-label="Canvas solitaire board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </div>
  );
}
