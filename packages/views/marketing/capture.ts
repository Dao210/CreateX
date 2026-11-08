import * as THREE from "three";
import { TankDefenseGame, TANK_LEVELS, compileTankCharacter } from "@auro/core/tank-defense";
import { paintTankBattle } from "../tank-defense/painter";
import { FISH_EXAMPLES, stepFish, type FishSceneResident } from "@auro/core/fish";
import { createReef } from "../fish/reef";
import { createSwimPose, makeFish } from "../fish/fish-visual";
import { seedResidents, seedResources, advanceTick, newTown, type Simulation } from "@auro/core/agent-life";
import { TownRuntime } from "../agent-life/scene/runtime";

const host = document.getElementById("scene")!;
const kind = new URLSearchParams(location.search).get("kind");
const width = 960, height = 600;

if (kind === "tank") {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; host.append(canvas);
  const ctx = canvas.getContext("2d")!;
  const field = document.createElement("canvas"); field.width = field.height = 1040;
  const fieldCtx = field.getContext("2d")!;
  const { blueprint } = compileTankCharacter({ profile: "tank-defense@1", name: "Terra", parts: { chassis: "standard", armor: "standard", cannon: "rapid" }, appearance: { body: "#d7a959", accent: "#fff0ba", pattern: "stripe" } });
  const game = new TankDefenseGame(TANK_LEVELS[0]!, { playerBlueprint: blueprint, difficulty: "casual", seed: 7919 }); game.start();
  const step = () => {
    const tick = game.tick;
    const direction = tick < 180 ? "up" : tick % 420 < 130 ? "left" : tick % 420 < 260 ? "right" : "up";
    game.setInput(direction, true); game.step();
  };
  for (let i = 0; i < 600; i++) step();
  let last = performance.now(), acc = 0;
  const frame = (now: number) => {
    acc += Math.min(.1, (now - last) / 1000); last = now;
    while (acc >= 1 / 60) { step(); acc -= 1 / 60; }
    paintTankBattle(fieldCtx, game, false);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(field, 0, 390, 1040, 650, 0, 0, width, height);
    requestAnimationFrame(frame);
  };
  frame(last);
} else if (kind === "fish") {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(width, height); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06; host.append(renderer.domElement);
  const scene = new THREE.Scene(), waterTime = { value: 0 };
  const reef = createReef(scene, waterTime);
  const camera = new THREE.PerspectiveCamera(45, width / height, .08, 100);
  const objects = FISH_EXAMPLES.slice(0, 5).map((draft, i) => {
    const resident = { id: `sample-${i}`, revision: 1, seed: 17 + i * 793, fish: { contentHash: `sample-${i}`, draft: i ? { ...draft, body: { ...draft.body, lengthMm: Math.round(draft.body.lengthMm * .55) } } : draft } } as FishSceneResident;
    const object = makeFish(resident, reef.tintFish); scene.add(object.group); return object;
  });
  const subject = objects[0]!;
  subject.state.position = [0, 3.5, 0]; subject.state.velocity = [.12, 0, .04];
  const pose = createSwimPose();
  let last = performance.now(), acc = 0, time = 0;
  const target = new THREE.Vector3();
  const frame = (now: number) => {
    const dt = Math.min(.1, (now - last) / 1000); last = now; acc += dt;
    while (acc >= .05) { stepFish(objects.map(o => o.state), .05, time); time += .05; acc -= .05; }
    for (const object of objects) { pose(object, dt, false, acc); object.setDetail(1, object === subject); }
    target.copy(subject.group.position); camera.position.copy(target).add(new THREE.Vector3(.3, .45, 3.4)); camera.lookAt(target);
    waterTime.value += dt; reef.configure(false, false, camera.position); renderer.render(scene, camera); requestAnimationFrame(frame);
  };
  frame(last);
} else {
  const residents = seedResidents();
  let state: Simulation = { tick: 0, agents: residents, resources: seedResources(residents), actions: [], town: newTown(residents) };
  const nextId = () => crypto.randomUUID();
  for (let i = 0; i < 472; i++) state = advanceTick(state, nextId).state;
  const runtime = new TownRuntime(host, () => {}, () => {}, () => {});
  const update = () => runtime.update({ world: { id: "marketing", workspaceId: "marketing", tick: state.tick, tickMs: 350, updatedAt: new Date().toISOString() }, agents: state.agents, resources: state.resources, actions: state.actions, town: state.town ?? null, events: [], eventCursor: 0 }, residents[1]!.id);
  update(); await runtime.start(); runtime.followSelected(); runtime.zoom(1.35);
  setInterval(() => { state = advanceTick(state, nextId).state; update(); }, 350);
}
document.documentElement.dataset.ready = "true";
