import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { CANNON_LIMITS, DEFAULT_CANNON, cannonGeometry, WORLD_SCALE, CANNON_PIVOT, type CannonDesign } from "@auro/core/siege";
import { paintCannon } from "./cannon-painter";

function DimensionControl({ id, label, value, min, max, hint, onChange, onSelect }: {
  id: string; label: string; value: number; min: number; max: number; hint: string;
  onChange: (value: number) => void; onSelect: () => void;
}) {
  const [input, setInput] = useState<string | null>(null);
  const commit = () => {
    if (input !== null && input.trim() && Number.isFinite(Number(input)))
      onChange(Math.min(max, Math.max(min, Math.round(Number(input) * 1000 / CANNON_LIMITS.step) * CANNON_LIMITS.step)));
    setInput(null);
  };
  return <div className="cannon-dimension">
    <div className="dimension-heading"><label htmlFor={id}>{label}</label>
      <div className="dimension-value"><input aria-label={`${label}数值`} type="number" min={min / 1000} max={max / 1000} step="0.05"
        value={input ?? (value / 1000).toFixed(2)} onFocus={onSelect}
        onChange={e => setInput(e.target.value)} onBlur={commit} onKeyDown={e => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.preventDefault(); setInput(null); }
        }} /><span>m</span></div></div>
    <input id={id} type="range" min={min} max={max} step={CANNON_LIMITS.step} value={value}
      aria-valuetext={`${(value / 1000).toFixed(2)} 米`} aria-describedby={`${id}-hint`}
      onFocus={onSelect} onPointerDown={onSelect} onChange={e => { setInput(null); onChange(Number(e.target.value)); }} />
    <div className="dimension-scale"><span>{(min / 1000).toFixed(2)} m</span><span>{(max / 1000).toFixed(2)} m</span></div>
    <p id={`${id}-hint`}>{hint}</p>
  </div>;
}

export function CannonWorkshop({ design, onChange }: { design: CannonDesign; onChange: (design: CannonDesign) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, 1000, 480);
    const { end, halfWidth, start } = cannonGeometry(design);
    const length = (end - CANNON_PIVOT[0]) * WORLD_SCALE;
    const scale = 174;
    const x = (1000 - (length - 0.6) * scale) / 2;
    ctx.save(); ctx.translate(x, 200); ctx.scale(scale, scale);
    paintCannon(ctx, design, -0.1, selected);
    ctx.restore();
    const left = x + (start - CANNON_PIVOT[0]) * WORLD_SCALE * scale;
    const right = x + length * scale;
    ctx.strokeStyle = "#8b927b"; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(left, 345); ctx.lineTo(right, 345);
    for (const p of [left, right]) { ctx.moveTo(p, 337); ctx.lineTo(p, 353); }
    ctx.stroke();
    ctx.fillStyle = "#566951"; ctx.font = '22px "Avenir Next", "PingFang SC", sans-serif'; ctx.textAlign = "center";
    ctx.fillText(`${((end - start) * WORLD_SCALE).toFixed(2)} m`, (left + right) / 2, 380);
    ctx.font = '18px "Avenir Next", "PingFang SC", sans-serif';
    ctx.fillText(`管体 ${(halfWidth * 2 * WORLD_SCALE).toFixed(2)} m`, (left + right) / 2, 412);
  }, [design, selected]);
  return <div className="cannon-workshop">
    <div className="cannon-preview">
      <div className="cannon-name"><span className="eyebrow">FOREST GUARD / MK. I</span><h3>林地守卫炮</h3><span className="cannon-badge">自动追踪 · 自动开火</span></div>
      <canvas ref={canvas} width={1000} height={480} role="img" aria-label={`精制炮台预览，炮管长 ${(design.barrelLengthMm / 1000).toFixed(2)} 米，宽 ${(design.barrelWidthMm / 1000).toFixed(2)} 米`} />
      <div className="cannon-preview-foot"><span>黄铜炮箍 · 森绿管身</span><span>01 / 可调炮管</span></div>
    </div>
    <div className="cannon-adjustments" role="group" aria-labelledby="cannon-parts-title">
      <div className="cannon-parts-heading"><h3 id="cannon-parts-title">调节炮管</h3>
        <Button size="xs" variant="ghost" onClick={() => { setSelected(false); onChange({ ...DEFAULT_CANNON }); }}><RotateCcw />恢复默认</Button></div>
      <DimensionControl id="barrel-length" label="炮管长度" value={design.barrelLengthMm} {...CANNON_LIMITS.length}
        hint="更长：弹速和射程提高，材料增加，装填与转向变慢。" onSelect={() => setSelected(true)}
        onChange={barrelLengthMm => onChange({ ...design, barrelLengthMm })} />
      <DimensionControl id="barrel-width" label="炮管粗细" value={design.barrelWidthMm} {...CANNON_LIMITS.width}
        hint="更粗：炮弹与伤害增大，材料增加，装填与转向变慢。" onSelect={() => setSelected(true)}
        onChange={barrelWidthMm => onChange({ ...design, barrelWidthMm })} />
      <p className="cannon-scale-note">粗细表示管体宽度；口径自动计算。尺寸采用游戏尺度。</p>
    </div>
  </div>;
}
