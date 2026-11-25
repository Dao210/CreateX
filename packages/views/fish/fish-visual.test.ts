// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { FISH_EXAMPLES, type FishSceneResident } from "@auro/core/fish";
import { makeFish } from "./fish-visual";

function resident(opacity = 1000): FishSceneResident {
  const draft = structuredClone(FISH_EXAMPLES[0]!);
  draft.appearance.opacity = opacity;
  return { id: "fish", revision: 1, seed: 17, fish: { draft, contentHash: "design" } };
}

describe("fish rendering resources", () => {
  it("reuses detail meshes through repeated quality changes and releases every resource", () => {
    const fish = makeFish(resident(), () => {});
    const mesh = fish.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    const distant = mesh.geometry;
    fish.setDetail(1, true);
    const standard = mesh.geometry;
    fish.setDetail(1, true, true);
    const high = mesh.geometry;
    expect(high.getAttribute("position").count).toBeGreaterThan(standard.getAttribute("position").count);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.material.clearcoat).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      fish.setDetail(1, true, false);
      expect(mesh.geometry).toBe(standard);
      expect(mesh.castShadow).toBe(false);
      fish.setDetail(0, false, true);
      expect(mesh.geometry).toBe(distant);
      fish.setDetail(1, true, true);
      expect(mesh.geometry).toBe(high);
    }
    const resources = [distant, standard, high, mesh.material, mesh.customDepthMaterial!];
    const disposed = resources.map(resource => vi.spyOn(resource, "dispose"));
    fish.dispose();
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does not cast solid shadows from translucent fish", () => {
    const fish = makeFish(resident(600), () => {});
    fish.setDetail(1, true, true);
    expect(fish.group.children[0]!.castShadow).toBe(false);
    fish.dispose();
  });
});
