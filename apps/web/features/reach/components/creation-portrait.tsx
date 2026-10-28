import type { EntityView } from "../types";
import { creationParts } from "../world-art";

export function CreationDrawing({ entity }: { entity: Pick<EntityView, "kind" | "silhouette" | "form" | "palette"> }) {
  return <>{creationParts(entity).map((part, index) => <path key={index} d={part.d} fill={part.fill} stroke={part.stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />)}</>;
}

export function CreationPortrait({ entity, className }: { entity: EntityView; className?: string }) {
  return <svg viewBox="-65 -80 135 140" aria-hidden="true" className={className}><ellipse cy="47" rx="32" ry="6" fill="#080E0C" fillOpacity="0.5" /><CreationDrawing entity={entity} /></svg>;
}
