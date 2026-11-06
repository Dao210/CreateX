"use client";
import { TOWN_HOMES, TOWN_PLACES, type LifeSnapshot, type PlaceId } from "@auro/core/agent-life";
import { useT } from "../i18n";

const colors = ["#c27c56", "#738c80", "#8185aa", "#b89753", "#bb7980", "#668b9d"];
export function TownMap({ data, selectedId, onSelect }: { data: LifeSnapshot; selectedId?: string; onSelect: (id: string) => void }) {
  const { t } = useT("life");
  const minute = (data.world?.tick ?? 0) % 1440;
  const night = minute < 360 || minute >= 1200;
  const buildings = [
    ...TOWN_HOMES.map((position, i) => ({ ...position, id: `home-${i}`, place: "home" as PlaceId })),
    ...Object.entries(TOWN_PLACES).filter(([id]) => id !== "home").map(([id, position]) => ({ ...position, id, place: id as PlaceId })),
  ];
  return <div className={`town-map ${night ? "town-map-night" : ""}`} data-testid="town-map">
    <svg viewBox="0 0 960 640" role="group" aria-label={t($ => $.map)}>
      <defs>
        <pattern id="town-grass" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M5 14l2-4 2 4m15 14l2-4 2 4" fill="none" stroke="currentColor" strokeWidth="1" opacity=".15" /></pattern>
      </defs>
      <rect width="960" height="640" rx="20" className="town-ground" />
      <rect width="960" height="640" rx="20" fill="url(#town-grass)" className="town-grass" />
      <path d="M0 200H960M0 440H960M280 0V640M520 0V640M840 0V640M280 520H840M120 120V200M120 360H280M200 600H280" className="town-road-edge" fill="none" strokeWidth="40" />
      <path d="M0 200H960M0 440H960M280 0V640M520 0V640M840 0V640M280 520H840M120 120V200M120 360H280M200 600H280" className="town-road" fill="none" strokeWidth="30" />
      <path d="M770 530q40-65 95-25t95-20v155H770Z" className="town-water" />
      {[{ x: 60, y: 280 }, { x: 420, y: 70 }, { x: 710, y: 600 }, { x: 910, y: 85 }, { x: 90, y: 560 }].map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y})`}><rect x="-3" y="0" width="6" height="30" rx="3" fill="#806c51" /><circle cy="-8" r="23" className="town-tree" /><circle cx="-10" cy="-15" r="17" className="town-tree-light" /></g>)}
      {buildings.map((building, i) => {
        const occupied = data.agents.some(a => a.position.x === building.x && a.position.y === building.y);
        const forest = building.place === "forest", farm = building.place === "farm", square = building.place === "square";
        return <g key={building.id} transform={`translate(${building.x * 80 + 40} ${building.y * 80 + 40})`}>
          {forest ? <><path d="M-35 15l13-42 14 42m1-4L8-38l18 49m-4 7L36-22l13 40" className="town-tree" stroke="#617c54" strokeWidth="4" strokeLinejoin="round" /></> : farm ? <><rect x="-48" y="-30" width="96" height="62" rx="8" fill="#b5a37c" />{[-28, -10, 8, 26].map(x => <path key={x} d={`M${x} -20v44m-4-35l4 5 4-5m-8 15l4 5 4-5`} stroke="#728c52" strokeWidth="4" fill="none" />)}</> : square ? <><ellipse cy="5" rx="44" ry="31" className="town-paving" /><ellipse cy="3" rx="19" ry="12" fill="#80b5bc" /><path d="M0-19v23m-9-9q9-15 18 0" stroke="#d1e8de" strokeWidth="3" fill="none" /></> : <>
            <rect x="-39" y="-21" width="78" height="55" rx="5" className="town-building-shadow" />
            <rect x="-36" y="-27" width="72" height="54" rx="4" className="town-building" />
            {occupied ? <><rect x="-28" y="-20" width="56" height="39" rx="2" className="town-floor" /><rect x="-22" y="-15" width="16" height="11" rx="2" fill={colors[i % colors.length]} /><path d="M12-15h10v12H12Z" fill="#b6a588" /></> : <path d="M-44-19L0-51l44 32-7 9H-37Z" fill={colors[i % colors.length]} />}
            <path d="M-7 27V10H7v17" fill="#9c805f" />
            {night && !occupied && <path d="M-24-4h12V7h-12Zm36 0h12V7H12Z" fill="#f7d995" />}
          </>}
          <text y={building.y === 7 ? -60 : forest ? 40 : 49} textAnchor="middle" className="town-place-label">{t($ => $.places[building.place])}</text>
        </g>;
      })}
      {data.agents.map(agent => {
        const action = data.actions.find(a => a.agentId === agent.id);
        const selected = selectedId === agent.id;
        const neighbors = data.agents.filter(a => a.position.x === agent.position.x && a.position.y === agent.position.y);
        const offset = neighbors.findIndex(a => a.id === agent.id);
        return <g key={agent.id} role="button" tabIndex={0} aria-label={t($ => $.select, { name: agent.name })} aria-pressed={selected}
          className={`town-person ${selected ? "town-person-selected" : ""} ${action?.intent.kind === "MOVE" ? "town-person-walking" : ""}`}
          style={{ transform: `translate(${agent.position.x * 80 + 40 + (offset % 3 - 1) * 17}px, ${agent.position.y * 80 + 35 + Math.floor(offset / 3) * 18}px)`, transitionDuration: `${data.world?.tickMs ?? 2000}ms` }}
          onClick={() => onSelect(agent.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(agent.id); } }}>
          <title>{agent.name}</title><ellipse cy="12" rx="11" ry="5" fill="#18261e" opacity=".17" />
          <circle cy="-1" r="20" className="town-person-ring" />
          <g className="town-person-body"><path d="M-4 4v9m8-9v9" stroke="#4b4b51" strokeWidth="4" strokeLinecap="round" /><rect x="-7" y="-8" width="14" height="16" rx="5" fill={colors[Number.parseInt(agent.id.slice(-4), 16) % colors.length]} /><circle cy="-13" r="6" fill="#dfbca0" /><path d="M-6-14q0-8 7-5l5 4" fill="#584a42" /></g>
          {selected && <g transform="translate(0 -34)"><rect x={-Math.max(28, agent.name.length * 4.4)} y="-14" width={Math.max(56, agent.name.length * 8.8)} height="24" rx="8" className="town-name-bg" /><text textAnchor="middle" y="2" className="town-name">{agent.name}</text></g>}
        </g>;
      })}
    </svg>
    <div className="town-map-caption"><span className="town-live-dot" />{t($ => night ? $.night : $.daytime)}</div>
  </div>;
}
