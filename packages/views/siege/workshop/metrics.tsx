import type { ReactNode } from "react";
import type { ArenaMode, ArenaStats, WeaponDefinition, WeaponSpec } from "@auro/core/siege";

const motionLabels = { rotating: "旋转", swinging: "摆动", tracking: "自动追踪 · 自动开火", static: "被动防御" };
function Metric({ label, value, unit, testId, delta }: { label: string; value: ReactNode; unit?: string; testId?: string; delta?: string }) {
  return <div><dt>{label}</dt><dd data-testid={testId}>{value}{unit && <small> {unit}</small>}{delta && <span className="metric-delta">{delta}</span>}</dd></div>;
}
const difference = (current: number | undefined, baseline: number | undefined, digits = 1) => {
  if (current === undefined || baseline === undefined) return undefined;
  const delta = Number((current - baseline).toFixed(digits));
  return delta ? `${delta > 0 ? "+" : ""}${delta.toFixed(digits)}` : undefined;
};

export function DesignMetrics({ definition, spec = definition?.spec ?? null, comparison = null }: { definition: WeaponDefinition | null; spec?: WeaponSpec | null; comparison?: WeaponDefinition | null }) {
  const cannon = definition?.launcher;
  const hasCannon = spec?.parts.some(p => p.type === "cannon");
  const hasShield = spec?.parts.some(p => p.type === "shield");
  return <section className="design-metrics" aria-labelledby="design-metrics-title">
    <div className="metrics-heading"><h3 id="design-metrics-title">设计参数</h3>
      <span>当前设计{definition ? " · " + motionLabels[definition.motion] : " · 待确认"}</span></div>
    {comparison && <p className="metric-comparison">增减数值与默认炮配置比较</p>}
    <dl className="metric-grid">
      <Metric label="墨水" value={definition?.ink ?? "—"} unit="/ 100" delta={difference(definition?.ink, comparison?.ink, 0)} />
      <Metric label="质量" value={definition?.mass.toFixed(1) ?? "—"} unit="游戏单位" delta={difference(definition?.mass, comparison?.mass)} />
      {hasCannon ? <>
        <Metric label="射程" value={cannon?.range.toFixed(1) ?? "—"} unit="m" testId="design-range" delta={difference(cannon?.range, comparison?.launcher?.range)} />
        <Metric label="基础伤害" value={cannon?.damage ?? "—"} unit="HP" testId="design-damage" delta={difference(cannon?.damage, comparison?.launcher?.damage, 0)} />
        <Metric label="装填时间" value={cannon ? (cannon.reloadTicks / 60).toFixed(2) : "—"} unit="s" delta={difference(cannon ? cannon.reloadTicks / 60 : undefined, comparison?.launcher ? comparison.launcher.reloadTicks / 60 : undefined, 2)} />
        <Metric label="最大追踪速度" value={cannon ? (cannon.maxTurnSpeed * 180 / Math.PI).toFixed(1) : "—"} unit="°/s" delta={difference(cannon ? cannon.maxTurnSpeed * 180 / Math.PI : undefined, comparison?.launcher ? comparison.launcher.maxTurnSpeed * 180 / Math.PI : undefined)} />
      </> : <Metric label={hasShield ? "防护覆盖半径" : "攻击覆盖半径"} value={definition?.reach.toFixed(1) ?? "—"} unit="m" />}
      {hasShield && <Metric label="初始耐久" value={definition ? "100" : "—"} unit="HP" />}
    </dl>
    {definition && <details className="metric-details"><summary>详细参数</summary>
      <dl className="metric-grid">
        <Metric label="转动惯量" value={definition.inertia.toFixed(2)} unit="游戏单位" />
        <Metric label="质心相对转轴" value={`${definition.centerOfMass[0].toFixed(2)}, ${definition.centerOfMass[1].toFixed(2)}`} unit="m" />
        {cannon && <>
          <Metric label="弹速" value={cannon.projectileSpeed.toFixed(1)} unit="m/s" />
          <Metric label="弹丸直径" value={(cannon.projectileRadius * 2).toFixed(2)} unit="m" />
          <Metric label="理论射速" value={(3600 / cannon.reloadTicks).toFixed(1)} unit="发/分钟" />
          <Metric label="结构覆盖半径" value={definition.reach.toFixed(1)} unit="m" />
        </>}
      </dl>
      <p>{cannon ? "基础伤害按无护甲目标计算；理论射速假设持续瞄准。" : definition.spec.parts.some(p => p.type === "blade" || p.type === "hammer") ? "刀锤伤害由接触速度、质量和目标护甲共同决定。" : ""}质量和惯量采用游戏单位。</p>
    </details>}
  </section>;
}

export function BattleMetrics({ definition, stats, mode, paused, changed, error }: {
  definition: WeaponDefinition | null; stats: ArenaStats; mode: ArenaMode; paused: boolean; changed: boolean; error: string;
}) {
  const cannon = definition?.launcher, ready = !!definition;
  const hasShield = definition?.spec.parts.some(p => p.type === "shield");
  const state = !ready ? "待测试" : stats.phase === "ready" ? "准备中" : stats.phase === "finished" ? stats.outcome === "victory" ? "守城胜利" : stats.outcome === "defeat" ? "城堡失守" : "测试结束" : paused ? "已暂停" : cannon
    ? ({ idle: "待敌", tracking: "追踪中", loading: "装填中", firing: "开火", limited: "炮弹数量已达上限" }[stats.cannonState]) : "测试中";
  const value = (n: number | string) => ready ? n : "—";
  return <section className="battle-log" aria-labelledby="battle-metrics-title" data-phase={stats.phase} data-wave={stats.wave} data-outcome={stats.outcome ?? ""}>
    <div className="metrics-heading"><h3 id="battle-metrics-title">实时数据</h3><span className="battle-state"><i className="log-dot" />{state}</span></div>
    {changed && <p className="design-changed" role="status">设计已修改，重新测试后生效。</p>}
    {cannon && <>
      <dl className="metric-grid live-metrics">
        <Metric label="目标距离" value={stats.targetDistance?.toFixed(1) ?? "—"} unit="m" />
        <Metric label="瞄准偏差" value={stats.aimError === null ? "—" : (stats.aimError * 180 / Math.PI).toFixed(1)} unit="°" />
        <Metric label="装填剩余" value={stats.reloadRemaining.toFixed(1)} unit="s" testId="reload" />
      </dl>
      <div className="reload-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, (1 - stats.reloadRemaining * 60 / cannon.reloadTicks) * 100))}%` }} /></div>
    </>}
    <dl className="metric-grid battle-results">
      {cannon && <Metric label="发射" value={value(stats.shots)} unit="发" testId="shots" />}
      <Metric label={cannon ? "命中炮弹" : "近战命中"} value={value(cannon ? stats.projectileHits : stats.hits)} unit={cannon ? "发" : "次"} testId="hits" />
      {cannon && <Metric label="命中率" value={stats.shots ? `${Math.round(stats.projectileHits / stats.shots * 100)}%` : "—"} />}
      <Metric label="实际总伤害" value={value(stats.damage)} unit="HP" testId="damage" />
      <Metric label="击败" value={value(stats.kills)} />
      <Metric label="击退离场" value={value(stats.knockouts)} />
      <Metric label="已用时间" value={value((stats.tick / 60).toFixed(1))} unit="s" testId="elapsed" />
      <Metric label="实际转速" value={value((stats.angularSpeed * 180 / Math.PI).toFixed(1))} unit="°/s" />
      {mode === "defense" && <><Metric label={`城堡 · 第 ${stats.wave} 波`} value={value(stats.castleHP)} unit="HP" />
        <Metric label="剩余敌人" value={value(stats.enemiesRemaining)} /><Metric label="已出场" value={value(stats.spawned)} unit="/ 15" /></>}
      {hasShield && <><Metric label="格挡" value={value(stats.blocked)} unit="次" /><Metric label="剩余耐久" value={value(stats.shieldHP)} unit="HP" /></>}
    </dl>
    {(ready ? stats.feedback : error) && <p className="battle-feedback" role="status">{ready ? stats.feedback : error}</p>}
    {cannon && <details className="metric-details"><summary>统计口径</summary><p>命中率 = 命中炮弹数 ÷ 发射数，飞行中的炮弹尚未计为命中。总伤害只累计实际扣血，不含超过剩余生命的伤害。测试结束时未命中的炮弹也计入发射数。</p></details>}
  </section>;
}
