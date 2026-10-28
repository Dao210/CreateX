import { previewSnapshot } from "../preview";
import { WORLD_WIDTH, WORLD_HEIGHT } from "../types";
import { CONTOURS, LAND_FORMS, ROCKS, riftPath, WORLD_INK } from "../world-art";
import { featuredEntity } from "../world-presentation";
import { CreationDrawing } from "./creation-portrait";

/** The same art vocabulary renders before JavaScript or when Canvas is unavailable. */
export function WorldPoster({ label }: { label: string }) {
  const snapshot = previewSnapshot();
  const featured = featuredEntity(snapshot);
  return (
    <svg viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={label}>
      <rect width={WORLD_WIDTH} height={WORLD_HEIGHT} fill={WORLD_INK.ground} />
      {LAND_FORMS.map((land, i) => <path key={i} {...land} />)}
      <g fill="none" stroke={WORLD_INK.line} strokeWidth="1.6" opacity="0.6">
        {CONTOURS.map((d, i) => <path key={i} d={d} />)}
        {ROCKS.map(({ x, y, size }, i) => <path key={i} d={`M${x} ${y}l${size} ${-size * 1.4} ${size * 1.4} ${size * 1.1}`} />)}
      </g>
      {snapshot.rifts.map((x) => <path key={x} d={riftPath(x)} fill="none" stroke={WORLD_INK.accent} strokeWidth="3" />)}
      {snapshot.supplies.map((supply) => <path key={supply.id} d={`M${supply.x - 10} ${supply.y}v-20l10-8 10 8v20Z`} fill={WORLD_INK.shadow} stroke={WORLD_INK.supply} strokeWidth="2" />)}
      {snapshot.entities.filter((entity) => entity.status === "alive").map((entity) => <g key={entity.id} transform={`translate(${entity.x} ${entity.y}) scale(.75)`} opacity={entity.id === featured?.id ? 1 : 0.75}><CreationDrawing entity={entity} /></g>)}
    </svg>
  );
}
