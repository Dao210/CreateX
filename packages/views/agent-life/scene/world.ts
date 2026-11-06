import * as THREE from "three";
import { TOWN_HOMES, TOWN_PLACES, STORAGE_DESIGNS, type CivicProject, type PlaceId } from "@auro/core/agent-life";
import { box, mesh, seeded, type TownMaterials } from "./materials";
import { batchArchitecture } from "./batch";

export const CELL = 5;
export const worldPoint = (position: { x: number; y: number }) => new THREE.Vector3((position.x - 5.5) * CELL, 0, (position.y - 3.5) * CELL);

export interface Building {
  group: THREE.Group;
  roof: THREE.Group;
  door: THREE.Group;
  entrance: THREE.Vector3;
  interior: THREE.Vector3;
  doorway: THREE.Vector3;
  place: PlaceId;
  home?: number;
}

function groundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 1152;
  const ctx = canvas.getContext("2d")!;
  const random = seeded(6381);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const point = (x: number, z: number) => [(x + 40) / 80 * canvas.width, (z + 30) / 60 * canvas.height];
  const road = (from: [number, number], to: [number, number], width = 1.8) => {
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...point(...from) as [number, number]);
    ctx.lineTo(...point(...to) as [number, number]);
    ctx.lineWidth = width * canvas.width / 80;
    ctx.strokeStyle = "#999999";
    ctx.stroke();
    ctx.lineWidth *= 0.8;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  };
  for (const y of [2, 5]) road([-30, (y - 3.5) * CELL], [30, (y - 3.5) * CELL]);
  for (const x of [3, 6, 10]) road([(x - 5.5) * CELL, -23], [(x - 5.5) * CELL, 23]);
  road([-12.5, 12.5], [22.5, 12.5]);
  for (const home of TOWN_HOMES) {
    const p = worldPoint(home);
    if (home.y === 7) road([p.x, p.z], [-12.5, p.z], 1.3);
    else road([p.x, p.z], [p.x, -7.5], 1.3);
  }
  for (const position of [...TOWN_HOMES, TOWN_PLACES.cafe, TOWN_PLACES.library, TOWN_PLACES.shop]) {
    const p = worldPoint(position);
    const offset = [3, 6, 10].includes(position.x) ? 4 : 0;
    road([p.x, p.z], [p.x + offset, p.z], 1.15);
    road([p.x + offset, p.z], [p.x + offset, p.z - 0.95], 1.15);
  }
  const plaza = point(-12.5, 12.5);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(plaza[0]!, plaza[1]!, 62, 55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.7;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < 18000; i++) {
    const x = random() * canvas.width, y = random() * canvas.height;
    if (pixels[(Math.floor(y) * canvas.width + Math.floor(x)) * 4]! < 155) continue;
    ctx.strokeStyle = "rgba(87,83,65,.2)";
    ctx.strokeRect(x, y, 2 + random() * 6, 2 + random() * 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function windowFrame(parent: THREE.Group, material: TownMaterials, x: number, y: number, z: number) {
  box(parent, material.glass, [0.72, 0.95, 0.06], [x, y, z]);
  box(parent, material.wood, [0.83, 0.08, 0.11], [x, y - 0.5, z + 0.02]);
  box(parent, material.wood, [0.83, 0.08, 0.11], [x, y + 0.5, z + 0.02]);
  for (const offset of [-0.4, 0, 0.4]) box(parent, material.wood, [0.055, 1, 0.12], [x + offset, y, z + 0.02]);
  box(parent, material.wood, [0.8, 0.045, 0.12], [x, y, z + 0.02]);
  box(parent, material.stone, [1.05, 0.12, 0.35], [x, y - 0.57, z + 0.13]);
}

function house(scene: THREE.Scene, material: TownMaterials, place: PlaceId, at: THREE.Vector3, index: number, home?: number): Building {
  const group = new THREE.Group();
  const besideJunction = [-12.5, 2.5, 22.5].some(x => Math.abs(at.x - x) < 0.01);
  group.position.copy(at).add(new THREE.Vector3(besideJunction ? 4 : 0, 0, -3.5));
  const width = place === "library" ? 5.3 : 4.2;
  const depth = place === "shop" ? 3.6 : 4;
  const height = place === "library" || home === 0 ? 5.4 : 3.1;
  const wall = index % 3 === 0 ? material.plasterWarm : material.plaster;
  box(group, material.stone, [width + 0.25, 0.35, depth + 0.25], [0, 0.16, 0]);
  box(group, wall, [width, height, 0.2], [0, height / 2 + 0.2, -depth / 2]);
  box(group, wall, [0.2, height, depth], [-width / 2, height / 2 + 0.2, 0]);
  box(group, wall, [0.2, height, depth], [width / 2, height / 2 + 0.2, 0]);
  for (const sign of [-1, 1]) box(group, wall, [(width - 1.1) / 2, height, 0.2], [sign * (width + 1.1) / 4, height / 2 + 0.2, depth / 2]);
  box(group, wall, [1.1, Math.max(0.4, height - 2.1), 0.2], [0, 2.3 + (height - 2.1) / 2, depth / 2]);
  box(group, material.lightWood, [width - 0.1, 0.16, depth - 0.1], [0, 0.35, 0]);
  const roof = new THREE.Group();
  const rise = width * 0.4;
  const slope = Math.hypot(width / 2 + 0.35, rise);
  for (const sign of [-1, 1]) {
    box(roof, index % 3 ? material.roof : material.terra, [slope, 0.2, depth + 0.7], [sign * width / 4, height + 0.2 + rise / 2, 0], [0, 0, -sign * Math.atan2(rise, width / 2)]);
  }
  const gable = new THREE.Shape();
  gable.moveTo(-width / 2, 0); gable.lineTo(0, rise); gable.lineTo(width / 2, 0); gable.closePath();
  for (const z of [-depth / 2, depth / 2]) {
    const face = mesh(new THREE.ShapeGeometry(gable), wall, 0, height + 0.2, z);
    face.material = wall.clone();
    (face.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    roof.add(face);
    for (const sign of [-1, 1]) box(roof, material.wood, [0.14, Math.hypot(width / 2, rise), 0.15], [sign * width / 4, height + 0.2 + rise / 2, z + 0.05], [0, 0, sign * Math.atan2(width / 2, rise)]);
    box(roof, material.wood, [0.13, rise, 0.16], [0, height + 0.2 + rise / 2, z + 0.05]);
  }
  roof.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.55, 8), material.stone, width * 0.3, height + rise * 0.85, -depth * 0.2));
  group.add(roof);
  for (const x of [-width / 2 + 0.04, width / 2 - 0.04]) box(group, material.wood, [0.16, height, 0.22], [x, height / 2 + 0.2, depth / 2 + 0.03]);
  for (const y of [0.5, height + 0.16]) box(group, material.wood, [width + 0.2, 0.15, 0.24], [0, y, depth / 2 + 0.04]);
  for (const x of [-width * 0.31, width * 0.31]) windowFrame(group, material, x, 1.7, depth / 2 + 0.13);
  if (height > 4) {
    for (const x of [-1.3, 0, 1.3]) windowFrame(group, material, x, 4, depth / 2 + 0.13);
    box(group, material.wood, [width, 0.16, 0.2], [0, 3.1, depth / 2 + 0.08]);
  }
  const door = new THREE.Group();
  door.position.set(-0.52, 0.36, depth / 2 + 0.08);
  box(door, material.wood, [1.02, 1.95, 0.1], [0.51, 0.98, 0]);
  box(door, material.metal, [0.06, 0.08, 0.08], [0.88, 0.95, 0.08]);
  group.add(door);
  box(group, material.stone, [1.65, 0.15, 0.8], [0, 0.08, depth / 2 + 0.4]);
  box(group, material.lamp, [0.2, 0.3, 0.2], [0.92, 2.1, depth / 2 + 0.18]);
  table(group, material, -0.7, -0.5, 0.85);
  bench(group, material, 1.1, -0.4, Math.PI / 2);
  if (place === "library" || place === "shop") {
    box(group, material.wood, [0.2, 1.8, 2.8], [-width / 2 + 0.3, 1.2, -0.2]);
    for (let i = 0; i < 12; i++) box(group, i % 2 ? material.cloth : material.terra, [0.32, 0.42, 0.12], [-width / 2 + 0.5, 0.85 + Math.floor(i / 6) * 0.55, -1.3 + (i % 6) * 0.38]);
  }
  if (place === "cafe") {
    const side = width / 2 + 1.4;
    box(group, material.cloth, [2.8, 0.1, 4.6], [side, 2.45, 0], [0, 0, -0.08]);
    for (const z of [-2, 2]) box(group, material.wood, [0.08, 2.35, 0.08], [side + 1.2, 1.17, z]);
    for (const z of [-1.1, 1.1]) {
      table(group, material, side, z, 0.65);
      bench(group, material, side + 0.95, z, Math.PI / 2);
    }
  }
  batchArchitecture(roof);
  batchArchitecture(door);
  batchArchitecture(group, [roof, door]);
  group.userData.place = place;
  group.userData.home = home;
  scene.add(group);
  return { group, roof, door, entrance: at.clone(), interior: group.position.clone().add(new THREE.Vector3(0, 0.4, 0.4)), doorway: group.position.clone().add(new THREE.Vector3(0, 0, depth / 2 + 0.55)), place, home };
}

function table(parent: THREE.Group, material: TownMaterials, x: number, z: number, radius: number) {
  parent.add(mesh(new THREE.CylinderGeometry(radius, radius, 0.09, 16), material.lightWood, x, 0.95, z));
  box(parent, material.wood, [0.16, 0.9, 0.16], [x, 0.46, z]);
  box(parent, material.wood, [radius * 1.4, 0.12, 0.14], [x, 0.09, z]);
}

function bench(parent: THREE.Group, material: TownMaterials, x: number, z: number, rotation: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  box(group, material.wood, [1.5, 0.09, 0.48], [0, 0.49, 0]);
  box(group, material.wood, [1.5, 0.4, 0.08], [0, 0.87, -0.2]);
  for (const sign of [-1, 1]) box(group, material.metal, [0.07, 0.5, 0.4], [sign * 0.6, 0.24, 0]);
  parent.add(group);
}

function trees(scene: THREE.Scene, materials: TownMaterials) {
  const random = seeded(8192);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.21, 2.5, 7), materials.wood, 36);
  const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 9, 7), materials.leaves, 36 * 5);
  const light = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), materials.leafLight, 36 * 2);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 36; i++) {
    const forest = i < 14;
    const x = forest ? 16 + random() * 12 : -34 + random() * 68;
    const z = forest ? 14 + random() * 10 : (i % 2 ? -1 : 1) * (21 + random() * 6);
    transform.position.set(x, 1.25, z); transform.scale.set(1, 1, 1); transform.updateMatrix();
    trunks.setMatrixAt(i, transform.matrix);
    for (let j = 0; j < 5; j++) {
      transform.position.set(x + (random() - 0.5) * 2.1, 3.1 + random() * 1.3, z + (random() - 0.5) * 2.1);
      transform.scale.set(1.2 + random() * 0.7, 1 + random() * 0.7, 1.2 + random() * 0.6);
      transform.updateMatrix(); crowns.setMatrixAt(i * 5 + j, transform.matrix);
    }
    for (let j = 0; j < 2; j++) {
      transform.position.set(x - 0.5 + random(), 4.2 + random(), z - 0.6 + random());
      transform.scale.set(1, 0.9, 1.1); transform.updateMatrix(); light.setMatrixAt(i * 2 + j, transform.matrix);
    }
  }
  for (const object of [trunks, crowns, light]) { object.castShadow = object.receiveShadow = true; scene.add(object); }
}

export function createTownWorld(scene: THREE.Scene, materials: TownMaterials) {
  const surround = mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: "#89916a", roughness: 1 }), 0, -0.06, 0);
  surround.rotation.x = -Math.PI / 2; scene.add(surround);
  const texture = groundTexture();
  const loader = new THREE.TextureLoader();
  let loaded = 0;
  let resolveTerrain!: () => void, rejectTerrain!: (error: unknown) => void;
  const terrainReady = new Promise<void>((resolve, reject) => { resolveTerrain = resolve; rejectTerrain = reject; });
  const done = () => { if (++loaded === 2) resolveTerrain(); };
  const grass = loader.load(new URL("./assets/grass-color.webp", import.meta.url).href, done, undefined, rejectTerrain);
  grass.colorSpace = THREE.SRGBColorSpace; grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.anisotropy = 8;
  const normal = loader.load(new URL("./assets/grass-normal.webp", import.meta.url).href, done, undefined, rejectTerrain);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.repeat.set(40, 30); normal.anisotropy = 4;
  const groundMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35) });
  groundMaterial.onBeforeCompile = shader => {
    shader.uniforms.grassTexture = { value: grass };
    shader.fragmentShader = "uniform sampler2D grassTexture;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      vec4 sampledDiffuseColor = texture2D(map, vMapUv);
      vec3 grassColor = texture2D(grassTexture, vMapUv * vec2(40.0, 30.0)).rgb;
      float road = smoothstep(0.2, 0.5, sampledDiffuseColor.r);
      float grain = 0.96 + 0.04 * sin(vMapUv.x * 15000.0) * sin(vMapUv.y * 12000.0);
      vec3 pathColor = vec3(0.48, 0.43, 0.34) * grain;
      diffuseColor *= vec4(mix(grassColor * vec3(0.86, 0.9, 0.78), pathColor, road), 1.0);
    `);
  };
  groundMaterial.customProgramCacheKey = () => "life-grass-roads-v1";
  // The custom shader owns an additional texture outside the built-in material slots.
  groundMaterial.addEventListener("dispose", () => grass.dispose());
  const ground = mesh(new THREE.PlaneGeometry(80, 60), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const river = mesh(new THREE.PlaneGeometry(9, 66, 1, 1), materials.water, -31, 0.025, 0);
  river.rotation.x = -Math.PI / 2;
  scene.add(river);
  for (const x of [-35.6, -26.5]) box(scene, materials.stone, [0.35, 0.3, 58], [x, 0.12, 0]);
  box(scene, materials.stone, [11, 0.5, 2.5], [-31, 0.25, 7.5]);
  for (const z of [6.15, 8.85]) box(scene, materials.stone, [11, 0.65, 0.35], [-31, 0.78, z]);
  trees(scene, materials);
  const buildings = TOWN_HOMES.map((position, i) => house(scene, materials, "home", worldPoint(position), i, i));
  for (const place of ["cafe", "library", "shop"] as const) buildings.push(house(scene, materials, place, worldPoint(TOWN_PLACES[place]), buildings.length));
  const square = worldPoint(TOWN_PLACES.square);
  scene.add(mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.45, 24), materials.stone, square.x + 1.7, 0.24, square.z - 1.6));
  scene.add(mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.03, 24), materials.water, square.x + 1.7, 0.47, square.z - 1.6));
  for (const sign of [-1, 1]) {
    const group = new THREE.Group(); group.position.set(square.x + sign * 3, 0, square.z + 0.8);
    bench(group, materials, 0, 0, Math.PI); scene.add(group);
  }
  const farm = worldPoint(TOWN_PLACES.farm);
  box(scene, materials.soil, [6.8, 0.07, 5.4], [farm.x, 0.03, farm.z - 3.5]);
  const crops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.7, 5), materials.leafLight, 96);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 96; i++) {
    transform.position.set(farm.x - 3 + (i % 12) * 0.55, 0.35, farm.z - 5.9 + Math.floor(i / 12) * 0.65);
    transform.rotation.y = i * 1.27; transform.updateMatrix(); crops.setMatrixAt(i, transform.matrix);
  }
  crops.castShadow = true; scene.add(crops);
  const projects = new Map<string, { group: THREE.Group; stage: string }>();
  return { buildings, river, projects, terrainReady };
}

export function updateProject(scene: THREE.Scene, material: TownMaterials, project: CivicProject, previous?: THREE.Group) {
  if (previous) { scene.remove(previous); previous.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); }
  const group = new THREE.Group();
  group.position.copy(worldPoint(project.position)).add(new THREE.Vector3([3, 6, 10].includes(project.position.x) ? 4 : 0, 0, -2.6));
  const design = STORAGE_DESIGNS[project.variant];
  const progress = project.labor / design.labor;
  box(group, material.stone, [4, 0.2, 3], [0, 0.1, 0]);
  if (progress > 0) {
    for (const x of [-1.7, 1.7]) for (const z of [-1.1, 1.1]) box(group, material.lightWood, [0.16, 2.6, 0.16], [x, 1.4, z]);
    for (const z of [-1.1, 1.1]) box(group, material.lightWood, [3.6, 0.18, 0.2], [0, 2.7, z]);
  }
  if (progress > 0.35) for (const x of [-1.8, 1.8]) box(group, material.wood, [0.12, 2.3, 2.5], [x, 1.4, 0]);
  if (progress > 0.7) {
    for (const sign of [-1, 1]) box(group, material.roof, [2.2, 0.15, 3.2], [sign * 0.95, 3, 0], [0, 0, -sign * 0.4]);
  }
  for (let i = 0; i < Math.min(8, Math.ceil(project.wood / 3)); i++) box(group, material.lightWood, [1.2, 0.14, 0.14], [-2.7, 0.15 + Math.floor(i / 3) * 0.15, (i % 3) * 0.18]);
  if (project.status === "active" || project.status === "paused") {
    for (let i = 0; i < Math.min(12, Math.ceil(project.food / 3)); i++) box(group, material.lightWood, [0.55, 0.48, 0.5], [-1.1 + (i % 3) * 0.7, 0.5 + Math.floor(i / 6) * 0.5, -0.5 + (Math.floor(i / 3) % 2) * 0.65]);
  }
  batchArchitecture(group);
  group.userData.projectId = project.id;
  scene.add(group);
  return group;
}
