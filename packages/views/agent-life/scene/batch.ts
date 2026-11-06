import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Bake static architecture while preserving independently moving roofs and doors. */
export function batchArchitecture(root: THREE.Group, exclude: THREE.Object3D[] = []) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<THREE.Material, { meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>();
  const visit = (object: THREE.Object3D) => {
    if (exclude.includes(object)) return;
    if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
      const batch = batches.get(object.material) ?? { meshes: [], geometries: [] };
      const geometry = object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      batch.meshes.push(object); batch.geometries.push(geometry); batches.set(object.material, batch);
    }
    for (const child of object.children) visit(child);
  };
  for (const child of root.children) visit(child);
  for (const [material, batch] of batches) {
    if (batch.meshes.length < 2) { batch.geometries.forEach(geometry => geometry.dispose()); continue; }
    const geometry = mergeGeometries(batch.geometries);
    batch.geometries.forEach(geometry => geometry.dispose());
    if (!geometry) continue;
    for (const object of batch.meshes) { object.removeFromParent(); object.geometry.dispose(); }
    const merged = new THREE.Mesh(geometry, material); merged.castShadow = merged.receiveShadow = true; root.add(merged);
  }
}
