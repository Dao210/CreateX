import * as THREE from "three";

export function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export type TownMaterials = ReturnType<typeof createTownMaterials>;

function surface(kind: "stone" | "wood" | "plaster" | "roof" | "soil", color: string, repeat = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const random = seeded(kind.length * 1837 + repeat);
  context.fillStyle = color;
  context.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const light = random() > 0.5 ? 255 : 0;
    context.fillStyle = `rgba(${light},${light},${light},${random() * 0.12})`;
    context.fillRect(random() * 256, random() * 256, 1 + random() * 2, 1 + random() * 2);
  }
  if (kind === "wood") {
    for (let x = 0; x < 256; x += 3) {
      context.strokeStyle = `rgba(45,24,12,${0.06 + random() * 0.16})`;
      context.beginPath();
      context.moveTo(x, 0);
      context.bezierCurveTo(x + random() * 7, 90, x - random() * 7, 170, x, 256);
      context.stroke();
    }
  }
  if (kind === "stone" || kind === "roof") {
    const height = kind === "stone" ? 44 : 28;
    for (let row = 0; row < 256 / height; row++) {
      for (let col = -1; col < 6; col++) {
        const x = col * 52 + (row % 2) * 26;
        context.strokeStyle = "rgba(45,39,28,.32)";
        context.lineWidth = 2;
        context.strokeRect(x, row * height, 52, height);
        context.fillStyle = `rgba(255,255,230,${random() * 0.11})`;
        context.fillRect(x + 2, row * height + 2, 48, height - 4);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: kind === "roof" ? 0.85 : 0.94 });
}

export function createTownMaterials() {
  return {
    stone: surface("stone", "#a49b83", 2),
    wood: surface("wood", "#735336", 1),
    lightWood: surface("wood", "#b39365", 1),
    plaster: surface("plaster", "#ded2b5", 2),
    plasterWarm: surface("plaster", "#cbb89d", 2),
    roof: surface("roof", "#5b615e", 3),
    terra: surface("roof", "#927258", 3),
    soil: surface("soil", "#6c6244", 4),
    metal: new THREE.MeshStandardMaterial({ color: "#626860", roughness: 0.65, metalness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: "#526968", roughness: 0.25, metalness: 0.15 }),
    leaves: new THREE.MeshStandardMaterial({ color: "#697c43", roughness: 1 }),
    leafLight: new THREE.MeshStandardMaterial({ color: "#88915a", roughness: 1 }),
    cloth: surface("plaster", "#c2b692", 1),
    lamp: new THREE.MeshStandardMaterial({ color: "#e6c58a", emissive: "#ffc66e", emissiveIntensity: 0.2 }),
    water: new THREE.MeshStandardMaterial({ color: "#4d7775", roughness: 0.24, metalness: 0.35, transparent: true, opacity: 0.85 }),
  };
}

export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = result.receiveShadow = true;
  return result;
}

export function box(parent: THREE.Object3D, material: THREE.Material, size: [number, number, number], position: [number, number, number], rotation?: [number, number, number]) {
  const result = mesh(new THREE.BoxGeometry(...size), material, ...position);
  if (rotation) result.rotation.set(...rotation);
  parent.add(result);
  return result;
}

export function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  textures.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
}
