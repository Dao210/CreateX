import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { LifeSnapshot } from "@auro/core/agent-life";
import { box, type TownMaterials } from "./materials";

const urls = {
  male: new URL("./assets/resident-male.glb", import.meta.url).href,
  female: new URL("./assets/resident-female.glb", import.meta.url).href,
  animations: new URL("./assets/animations.glb", import.meta.url).href,
  short: new URL("./assets/hair_buzzed.glb", import.meta.url).href,
  parted: new URL("./assets/hair_simpleparted.glb", import.meta.url).href,
};
export async function loadResidents() {
  const loader = new GLTFLoader();
  const [male, female, animations, short, parted] = await Promise.all(Object.values(urls).map(url => loader.loadAsync(url)));
  if (!male || !female || !animations || !short || !parted) throw new Error("resident_assets_missing");
  const clips = new Map(animations.animations.map(clip => [clip.name, clip]));
  return { male: male.scene, female: female.scene, clips, short: short.scene, parted: parted.scene };
}
export type ResidentAssets = Awaited<ReturnType<typeof loadResidents>>;
export interface ResidentActor {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationAction>;
  current?: THREE.AnimationAction;
  cargo: THREE.Group;
  marker: THREE.Mesh;
  target: THREE.Vector3;
  interior?: string;
  entry?: { buildingId: string; phase: "door" | "inside" | "exit" | "road" };
  model: THREE.Object3D;
  dispose: () => void;
}
const shirts = ["#869984", "#b28a64", "#526f7a", "#b3aa8b", "#a57165", "#6a748b"];
const skin = ["#c49677", "#a97450", "#deb598", "#865b41", "#bc8b66"];

export function createResident(assets: ResidentAssets, id: string, materials: TownMaterials): ResidentActor {
  const index = Number.parseInt(id.replaceAll("-", "").slice(-6), 16) || 0;
  const model = clone(index % 3 === 0 ? assets.female : assets.male);
  const ownedGeometries: THREE.BufferGeometry[] = [], ownedMaterials: THREE.Material[] = [];
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.frustumCulled = false;
    if (/Eye/i.test(object.name)) {
      const material = new THREE.MeshStandardMaterial({ color: /brow/i.test(object.name) ? "#44352b" : "#302e27", roughness: 0.8 });
      object.material = material; ownedMaterials.push(material);
      return;
    }
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const shirt = new THREE.Color(shirts[index % shirts.length]);
    const complexion = new THREE.Color(skin[index % skin.length]);
    const pants = new THREE.Color(index % 2 ? "#656250" : "#434b50");
    const boots = new THREE.Color("#493f34");
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i), x = Math.abs(positions.getX(i));
      const color = y < 0.16 ? boots : y < 0.98 ? pants : y < 1.52 && x < 0.5 ? shirt : complexion;
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    object.geometry = geometry;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    object.material = material;
    ownedGeometries.push(geometry); ownedMaterials.push(material);
  });
  model.updateMatrixWorld(true);
  const head = model.getObjectByName("Head");
  if (head) {
    const hair = (index % 2 ? assets.short : assets.parted).clone(true);
    hair.applyMatrix4(head.matrixWorld.clone().invert());
    head.add(hair);
  }
  const group = new THREE.Group();
  group.userData.residentId = id;
  group.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of assets.clips) {
    const action = mixer.clipAction(clip);
    clips.set(name, action);
  }
  const cargo = new THREE.Group();
  for (const x of [-0.23, 0.23]) box(cargo, materials.lightWood, [0.04, 0.33, 0.37], [x, 0, 0]);
  for (const y of [-0.16, 0.16]) box(cargo, materials.wood, [0.5, 0.045, 0.4], [0, y, 0]);
  for (const z of [-0.18, 0.18]) box(cargo, materials.lightWood, [0.49, 0.32, 0.035], [0, 0, z]);
  cargo.position.set(0, 1, 0.36); cargo.visible = false; group.add(cargo);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 40), new THREE.MeshBasicMaterial({ color: "#f5e6b6", depthWrite: false, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.035; marker.visible = false; group.add(marker);
  ownedGeometries.push(marker.geometry); ownedMaterials.push(marker.material);
  return { group, model, mixer, clips, cargo, marker, target: new THREE.Vector3(), dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(model);
    ownedGeometries.forEach(value => value.dispose()); ownedMaterials.forEach(value => value.dispose());
  } };
}

export function animateResident(actor: ResidentActor, kind: string | undefined, moving: boolean, delta: number, reduced: boolean, carrying: boolean) {
  const clip = moving ? "Walk_Loop" : kind === "TALK" ? "Idle_Talking_Loop" : kind === "BUILD" || kind === "MAINTAIN" || kind === "WORK" ? "Fixing_Kneeling" : kind === "STORE_FOOD" || kind === "WITHDRAW_FOOD" || kind === "DELIVER_WOOD" ? "PickUp_Table" : kind === "GATHER_WOOD" ? "Interact" : "Idle_Loop";
  const action = actor.clips.get(clip);
  if (action && actor.current !== action) {
    if (reduced) actor.current?.stop(); else actor.current?.fadeOut(0.25);
    action.reset();
    if (!reduced) action.fadeIn(0.25);
    action.play(); actor.current = action;
  }
  actor.cargo.visible = carrying || kind === "DELIVER_WOOD" || kind === "STORE_FOOD" || kind === "WITHDRAW_FOOD";
  if (!reduced) actor.mixer.update(delta * (moving ? 1.35 : 1));
  else { if (action) action.time = 0.2; actor.mixer.update(0); }
  if (actor.cargo.visible) holdCargo(actor);
}

export function actionFor(data: LifeSnapshot, id: string) { return data.actions.find(action => action.agentId === id && action.status === "running"); }


function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const wanted = target.clone().sub(origin).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(current, wanted);
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation);
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

/** Match both hands to the crate while the authored walking clip drives the lower body. */
function holdCargo(actor: ResidentActor) {
  actor.group.updateMatrixWorld(true);
  for (const [side, sign] of [["l", 1], ["r", -1]] as const) {
    const upper = actor.model.getObjectByName(`upperarm_${side}`);
    const lower = actor.model.getObjectByName(`lowerarm_${side}`);
    const hand = actor.model.getObjectByName(`hand_${side}`);
    if (!upper || !lower || !hand) continue;
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3());
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const target = actor.group.localToWorld(new THREE.Vector3(sign * 0.27, 1.03, 0.38));
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
    const distance = Math.max(0.01, Math.min(a + b - 0.001, shoulder.distanceTo(target)));
    const forward = target.clone().sub(shoulder).normalize();
    const outward = new THREE.Vector3(sign, -0.15, 0).applyQuaternion(actor.group.quaternion);
    outward.addScaledVector(forward, -outward.dot(forward)).normalize();
    const cosine = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
    const desiredElbow = shoulder.clone().addScaledVector(forward, a * cosine).addScaledVector(outward, a * Math.sqrt(1 - cosine * cosine));
    aimBone(upper, lower, desiredElbow); aimBone(lower, hand, target);
  }
}
