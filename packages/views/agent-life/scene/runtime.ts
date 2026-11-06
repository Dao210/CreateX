import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { LifeSnapshot } from "@auro/core/agent-life";
import { createTownMaterials, disposeScene } from "./materials";
import { createTownWorld, worldPoint, updateProject } from "./world";
import { actionFor, animateResident, createResident, loadResidents, type ResidentActor, type ResidentAssets } from "./characters";

export class TownRuntime {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 220);
  readonly controls: OrbitControls;
  private readonly materials = createTownMaterials();
  private readonly world: ReturnType<typeof createTownWorld>;
  private readonly residents = new Map<string, ResidentActor>();
  private assets?: ResidentAssets;
  private data?: LifeSnapshot;
  private selectedId?: string;
  private follow = false;
  private disposed = false;
  private frame = 0;
  private lastTime = 0;
  private readonly sun = new THREE.DirectionalLight("#fff0cf", 3);
  private readonly sky = new THREE.HemisphereLight("#d5e5ed", "#82755a", 2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly point = new THREE.Vector2();
  private readonly markerPoint = new THREE.Vector3();
  private pointerStart = { x: 0, y: 0 };
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");
  constructor(private host: HTMLElement, private onSelect: (id: string) => void, private onProject: (id: string) => void, private onLabel: (x: number, y: number, visible: boolean) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color("#c8d1c0");
    this.scene.fog = new THREE.Fog("#c8d1c0", 65, 145);
    this.camera.position.set(42, 48, 56);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = !this.reduced.matches;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 9; this.controls.maxDistance = 100;
    this.controls.minPolarAngle = Math.PI / 9; this.controls.maxPolarAngle = Math.PI / 2.6;
    this.controls.maxTargetRadius = 40;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.addEventListener("start", this.stopFollowing);
    this.sun.position.set(-22, 40, 22); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -44, right: 44, top: 40, bottom: -40, near: 1, far: 110 });
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sky, this.sun, this.sun.target);
    this.world = createTownWorld(this.scene, this.materials);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize();
  }
  async start() {
    const [assets] = await Promise.all([loadResidents(), this.world.terrainReady]);
    if (this.disposed) { disposeScene(assets.male); disposeScene(assets.female); disposeScene(assets.short); disposeScene(assets.parted); return; }
    this.assets = assets;
    if (this.data) this.update(this.data, this.selectedId);
    this.frame = requestAnimationFrame(this.render);
  }
  update(data: LifeSnapshot, selectedId?: string) {
    this.data = data; this.selectedId = selectedId;
    if (!this.assets) return;
    for (const agent of data.agents) {
      if (this.residents.has(agent.id)) continue;
      const actor = createResident(this.assets, agent.id, this.materials);
      actor.group.position.copy(worldPoint(agent.position));
      this.residents.set(agent.id, actor); this.scene.add(actor.group);
    }
    for (const [id, actor] of this.residents) if (!data.agents.some(agent => agent.id === id)) {
      this.scene.remove(actor.group); actor.dispose(); this.residents.delete(id);
    }
    for (const project of data.town?.civilization?.projects ?? []) {
      const stage = `${project.status}:${project.labor}:${project.wood}:${project.food}`;
      const old = this.world.projects.get(project.id);
      if (old?.stage === stage) continue;
      const group = updateProject(this.scene, this.materials, project, old?.group);
      this.world.projects.set(project.id, { stage, group });
    }
  }
  resize = () => {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height || this.disposed) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
  zoom(factor: number) {
    const direction = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    if (direction.length() < 9 || direction.length() > 100) return;
    this.camera.position.copy(this.controls.target).add(direction); this.controls.update();
  }
  home() { this.follow = false; this.controls.target.set(0, 0, 0); this.camera.position.set(42, 48, 56); this.controls.update(); }
  followSelected() { this.follow = true; this.zoomToSelected(); }
  private zoomToSelected() {
    const actor = this.selectedId && this.residents.get(this.selectedId);
    if (!actor) return;
    const offset = new THREE.Vector3(8, 11, 13);
    this.controls.target.copy(actor.group.position); this.camera.position.copy(actor.group.position).add(offset); this.controls.update();
  }
  private stopFollowing = () => { this.follow = false; };
  private pointerDown = (event: PointerEvent) => { this.pointerStart = { x: event.clientX, y: event.clientY }; };
  private pointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.point.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.point, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.residents.values()].map(actor => actor.group).concat([...this.world.projects.values()].map(project => project.group)), true);
    for (const hit of intersections) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (typeof object.userData.residentId === "string") { this.onSelect(object.userData.residentId); return; }
        if (typeof object.userData.projectId === "string") { this.onProject(object.userData.projectId); return; }
        object = object.parent;
      }
    }
  };
  private visibility = () => {
    cancelAnimationFrame(this.frame);
    if (!document.hidden && !this.disposed && this.assets) { this.lastTime = 0; this.frame = requestAnimationFrame(this.render); }
  };
  private render = (time: number) => {
    if (this.disposed || document.hidden) return;
    const delta = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 0.016;
    this.lastTime = time;
    const data = this.data, world = data?.world;
    if (data && world) {
      const fraction = Math.min(1, Math.max(0, (Date.now() - Date.parse(world.updatedAt)) / world.tickMs));
      const minute = (world.tick + fraction) % 1440;
      const daylight = Math.max(0, Math.sin((minute - 360) / 1440 * Math.PI * 2));
      this.sun.intensity = 0.35 + daylight * 2.7;
      this.sun.color.set(daylight > 0.4 ? "#fff1d4" : "#e8be8d");
      this.sky.intensity = 0.95 + daylight * 1.1;
      this.materials.lamp.emissiveIntensity = daylight < 0.1 ? 2 : 0.3;
      this.scene.background = new THREE.Color().lerpColors(new THREE.Color("#798b9c"), new THREE.Color("#c8d1c0"), daylight);
      (this.scene.fog as THREE.Fog).color.copy(this.scene.background);
      const occupied = new Set<string>();
      for (const agent of data.agents) {
        const actor = this.residents.get(agent.id); if (!actor) continue;
        const action = actionFor(data, agent.id);
        const moving = action?.intent.kind === "MOVE" && !!action.intent.to;
        const current = worldPoint(agent.position);
        const peers = data.agents.filter(other => other.position.x === agent.position.x && other.position.y === agent.position.y);
        const slot = peers.findIndex(other => other.id === agent.id);
        const offset = new THREE.Vector3((slot % 4 - 1.5) * 0.6, 0, Math.floor(slot / 4) * 0.6);
        actor.target.copy(current).add(offset);
        if (moving && action.intent.to) {
          const progress = Math.max(0, Math.min(1, (world.tick - action.startedTick + fraction) / (action.dueTick - action.startedTick)));
          actor.target.lerpVectors(current, worldPoint(action.intent.to), progress).add(offset);
        }
        actor.interior = undefined;
        if (!moving && action?.intent.kind === "REST" && action.reason.startsWith("daily_")) {
          const building = this.world.buildings.find(row => row.entrance.distanceToSquared(current) < 0.01);
          if (building) {
            actor.target.copy(building.interior).add(new THREE.Vector3((slot % 3 - 1) * 0.7, 0, Math.floor(slot / 3) * 0.65));
            actor.interior = building.group.uuid; occupied.add(building.group.uuid);
          }
        }
        const direction = actor.target.clone().sub(actor.group.position);
        if (direction.lengthSq() > 0.002) {
          const angle = Math.atan2(direction.x, direction.z);
          actor.group.rotation.y += Math.atan2(Math.sin(angle - actor.group.rotation.y), Math.cos(angle - actor.group.rotation.y)) * Math.min(1, delta * 9);
        } else if (action?.intent.kind === "TALK") {
          const other = action.intent.targetId && this.residents.get(action.intent.targetId);
          if (other) actor.group.lookAt(other.group.position.clone().setY(actor.group.position.y));
        }
        actor.group.position.lerp(actor.target, this.reduced.matches ? 1 : Math.min(1, delta * 14));
        actor.marker.visible = agent.id === this.selectedId;
        const carrying = !!action && ((action.reason === "deliver_materials" && data.resources.some(row => row.owner === agent.id && row.kind === "wood" && row.amount >= 3))
          || (action.reason === "share_surplus" && data.resources.some(row => row.owner === agent.id && row.kind === "food" && row.amount >= 5)));
        animateResident(actor, action?.intent.kind, (moving && fraction < 0.99) || (!moving && direction.lengthSq() > 0.09), delta, this.reduced.matches, carrying);
      }
      for (const building of this.world.buildings) {
        const selected = this.selectedId && this.residents.get(this.selectedId);
        building.roof.visible = selected ? selected.interior !== building.group.uuid : true;
        building.door.rotation.y = THREE.MathUtils.damp(building.door.rotation.y, occupied.has(building.group.uuid) ? -1.2 : 0, 4, delta);
      }
      const selected = this.selectedId && this.residents.get(this.selectedId);
      if (selected) {
        if (this.follow) {
          const change = selected.group.position.clone().sub(this.controls.target).multiplyScalar(Math.min(1, delta * 4));
          this.controls.target.add(change); this.camera.position.add(change);
        }
        this.markerPoint.copy(selected.group.position).add(new THREE.Vector3(0, 2.3, 0)).project(this.camera);
        this.onLabel((this.markerPoint.x + 1) / 2 * this.host.clientWidth, (1 - this.markerPoint.y) / 2 * this.host.clientHeight, Math.abs(this.markerPoint.x) < 0.95 && Math.abs(this.markerPoint.y) < 0.95 && this.markerPoint.z < 1);
      }
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.render);
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.visibility);
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.controls.removeEventListener("start", this.stopFollowing); this.controls.dispose();
    this.residents.forEach(actor => actor.dispose());
    disposeScene(this.scene);
    if (this.assets) for (const root of [this.assets.male, this.assets.female, this.assets.short, this.assets.parted]) disposeScene(root);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
