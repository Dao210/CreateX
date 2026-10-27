import { GRID, type Drawing } from "@auro/core/siege";

export function BlueprintPreview({ drawing, className }: { drawing: Drawing; className?: string }) {
  return <svg className={className} viewBox={`0 0 ${GRID} ${GRID}`} role="img" aria-hidden>
    {drawing.strokes.map((stroke) => (
      <polyline
        key={stroke.id}
        points={stroke.points.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke={stroke.color === "accent" ? "var(--color-brand)" : "currentColor"}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))}
  </svg>;
}
