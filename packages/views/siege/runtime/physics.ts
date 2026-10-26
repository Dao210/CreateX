import RAPIER from "@dimforge/rapier2d-compat";

let initialization: Promise<void> | undefined;
export function initializePhysics(): Promise<void> {
  return initialization ??= RAPIER.init().catch(error => {
    initialization = undefined;
    throw error;
  });
}
export { RAPIER };
