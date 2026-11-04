"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { compileFishGeometry, swimState, stepFish, OCEAN_ROCKS, type FishResident, type SwimState } from "@auro/core/fish";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../i18n";

interface Props { residents: FishResident[]; selectedId?: string; onSelect?: (id: string) => void; follow?: boolean; reset?: number; paused?: boolean; lowQuality?: boolean; preview?: boolean }
interface FishObject { group: THREE.Group; state: SwimState; version: string; phase: { value: number } }
interface SceneAPI { update: (residents: FishResident[]) => void; focus: (id: string, follow: boolean) => void; reset: () => void }

function makeFish(resident: FishResident): FishObject {
  const spec = resident.fish.draft, data = compileFishGeometry(spec);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
  const colors = new Float32Array(data.colors.length), workingColor = new THREE.Color();
  for (let i = 0; i < data.colors.length; i += 3) {
    workingColor.setRGB(data.colors[i]!, data.colors[i + 1]!, data.colors[i + 2]!, THREE.SRGBColorSpace);
    colors.set([workingColor.r, workingColor.g, workingColor.b], i);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(data.indices); geometry.computeVertexNormals();
  // Animation extends beyond the undeformed body: use a conservative bound for culling.
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += spec.body.lengthMm / 1000 * 0.6;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.08, side: THREE.DoubleSide, transparent: spec.appearance.opacity < 1000, opacity: spec.appearance.opacity / 1000, depthWrite: spec.appearance.opacity === 1000, emissive: spec.appearance.body, emissiveIntensity: spec.appearance.glow / 1000 });
  const phase = { value: 0 }, length = spec.body.lengthMm / 1000;
  material.onBeforeCompile = shader => {
    shader.uniforms.fishPhase = phase;
    shader.vertexShader = `uniform float fishPhase;\n${shader.vertexShader}`.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float u = clamp(0.5 - position.x / ${length.toFixed(5)}, 0.0, 1.7);
      ${spec.motion.style === "fin-glide"
        ? `transformed.y += sin(fishPhase) * abs(position.z) * 0.22; transformed.z += sin(fishPhase + u*3.0) * pow(u,2.0) * ${(length * 0.015).toFixed(5)};`
        : `transformed.z += sin(fishPhase - u * ${spec.motion.style === "body-wave" ? "7.0" : "4.5"}) * pow(u, ${spec.motion.style === "body-wave" ? "1.0" : "2.0"}) * ${(length * spec.motion.amplitude / 1000).toFixed(5)};`}
    `);
  };
  material.customProgramCacheKey = () => JSON.stringify([length, spec.motion]);
  const group = new THREE.Group(); group.add(new THREE.Mesh(geometry, material));
  group.userData.residentId = resident.id;
  return { group, phase, state: swimState(resident.id, spec, resident.seed), version: `${resident.revision}:${resident.fish.contentHash}` };
}
function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  object.traverse(child => { if (child instanceof THREE.Mesh || child instanceof THREE.Points) { geometries.add(child.geometry); for (const m of Array.isArray(child.material) ? child.material : [child.material]) materials.add(m); } });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
export default function FishScene(props: Props) {
  const host = useRef<HTMLDivElement>(null), api = useRef<SceneAPI | null>(null), latest = useRef(props);
  const [failed, setFailed] = useState(false), [generation, setGeneration] = useState(0);
  const { t } = useT("fish");
  useEffect(() => { latest.current = props; api.current?.update(props.residents); api.current?.focus(props.selectedId ?? "", props.follow ?? false); }, [props]);
  useEffect(() => { api.current?.reset(); }, [props.reset]);
  useEffect(() => {
    const container = host.current; if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); } catch { setFailed(true); return; }
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#0C4550"); scene.fog = new THREE.FogExp2("#0C4550", 0.039);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.06; controls.minDistance = 2; controls.maxDistance = 34; controls.maxPolarAngle = Math.PI * 0.49; controls.minPolarAngle = 0.3; controls.enablePan = !latest.current.preview;
    const reset = () => { camera.position.set(15, 10, 23); controls.target.set(0, 3.5, 0); controls.update(); };
    reset();
    scene.add(new THREE.HemisphereLight("#BDEDEC", "#244B42", 2.7));
    const sun = new THREE.DirectionalLight("#FFF0C9", 3.5); sun.position.set(-8, 16, 7); scene.add(sun);
    const rim = new THREE.DirectionalLight("#5ED6D0", 2); rim.position.set(4, 8, -10); scene.add(rim);
    const seabedGeometry = new THREE.PlaneGeometry(65, 55, 34, 28); seabedGeometry.rotateX(-Math.PI / 2);
    const positions = seabedGeometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) positions.setY(i, Math.sin(positions.getX(i) * 0.4) * Math.cos(positions.getZ(i) * 0.3) * 0.18 - 0.25);
    seabedGeometry.computeVertexNormals();
    scene.add(new THREE.Mesh(seabedGeometry, new THREE.MeshStandardMaterial({ color: "#B9C9A2", roughness: 0.96 })));
    for (const rock of OCEAN_ROCKS) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(rock.radius, 1), new THREE.MeshStandardMaterial({ color: "#637D70", flatShading: true, roughness: 1 }));
      mesh.position.set(rock.x, rock.y - 0.6, rock.z); mesh.scale.set(1, 0.72, 0.9); mesh.rotation.set(0.2, rock.x, 0.3); scene.add(mesh);
    }
    const plantCount = 34 * 3;
    const plants = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshStandardMaterial({ roughness: 0.9 }), plantCount);
    plants.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const plantTransform = new THREE.Object3D(), plantColor = new THREE.Color();
    const updatePlants = (time: number) => {
      for (let i = 0; i < 34; i++) for (let blade = 0; blade < 3; blade++) {
        const height = 0.5 + (Math.sin(i + blade * 4) + 1) * 0.55;
        plantTransform.position.set(Math.sin(i * 73.1) * 11 + (blade - 1) * 0.12, height * 0.5 - 0.15, Math.cos(i * 31.7) * 7);
        plantTransform.rotation.set(0.12, i, (blade - 1) * 0.22 + Math.sin(time * 0.7 + i) * 0.07);
        plantTransform.scale.set(0.05 + blade * 0.015, height, 0.035);
        plantTransform.updateMatrix(); plants.setMatrixAt(i * 3 + blade, plantTransform.matrix);
      }
      plants.instanceMatrix.needsUpdate = true;
    };
    for (let i = 0; i < plantCount; i++) plants.setColorAt(i, plantColor.set(Math.floor(i / 3) % 3 === 0 ? "#C39473" : "#457F66"));
    updatePlants(0); plants.frustumCulled = false; scene.add(plants);
    const dustGeometry = new THREE.BufferGeometry(), dust: number[] = [];
    for (let i = 0; i < 150; i++) dust.push(Math.sin(i * 37) * 17, (Math.sin(i * 17) + 1) * 5, Math.cos(i * 43) * 12);
    dustGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dust, 3)); scene.add(new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: "#D9E7CA", size: 0.035, transparent: true, opacity: 0.32, depthWrite: false })));
    const fish = new Map<string, FishObject>(); let focused = "", tracking = false;
    api.current = {
      update(residents) {
        const ids = new Set(residents.map(r => r.id));
        for (const [id, object] of fish) if (!ids.has(id)) { scene.remove(object.group); disposeObject(object.group); fish.delete(id); }
        for (const resident of residents) {
          const old = fish.get(resident.id); if (old?.version === `${resident.revision}:${resident.fish.contentHash}`) continue;
          const object = makeFish(resident);
          if (old) { object.state.position = old.state.position; object.state.velocity = old.state.velocity; scene.remove(old.group); disposeObject(old.group); }
          if (latest.current.preview) { object.state.position = [0, 3.5, 0]; object.state.velocity = [0, 0, 0]; }
          object.group.position.set(...object.state.position); scene.add(object.group); fish.set(resident.id, object);
        }
      },
      focus(id, follow) {
        const object = fish.get(id);
        if (object && id !== focused) { const target = new THREE.Vector3(...object.state.position); const offset = camera.position.clone().sub(controls.target).normalize().multiplyScalar(6); controls.target.copy(target); camera.position.copy(target).add(offset); }
        focused = id; tracking = follow;
      }, reset,
    };
    api.current.update(latest.current.residents);
    if (latest.current.preview) { camera.position.set(1.8, 4.2, 3.5); controls.target.set(0, 3.5, 0); controls.minDistance = 1; controls.maxDistance = 8; }
    api.current.focus(latest.current.selectedId ?? "", latest.current.follow ?? false);
    const resize = () => { const { width, height } = container.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let downX = 0, downY = 0;
    const down = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...fish.values()].map(f => f.group), true); let hit: THREE.Object3D | undefined = hits[0]?.object;
      while (hit && !hit.userData.residentId) hit = hit.parent ?? undefined;
      if (hit) latest.current.onSelect?.(String(hit.userData.residentId));
    };
    renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointerup", up);
    const lost = (event: Event) => { event.preventDefault(); setFailed(true); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    let frame = 0, last = performance.now(), accumulator = 0, time = 0, disposed = false, lastMetric = -1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const loop = (now: number) => {
      if (disposed) return; frame = requestAnimationFrame(loop);
      let elapsed = Math.min((now - last) / 1000, 0.15); last = now;
      if (document.hidden) return;
      if (latest.current.paused) elapsed = 0;
      const pixelRatio = Math.min(window.devicePixelRatio, latest.current.lowQuality ? 1 : 1.75);
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      const objects = [...fish.values()];
      if (!latest.current.preview) {
        accumulator += elapsed;
        while (accumulator >= 0.05) { stepFish(objects.map(f => f.state), 0.05, time); time += 0.05; accumulator -= 0.05; }
      } else { time += elapsed; for (const object of objects) object.state.phase += elapsed * object.state.spec.motion.frequency / 1000 * Math.PI * 2; }
      for (const object of objects) {
        const target = new THREE.Vector3(...object.state.position); object.group.position.lerp(target, 1 - Math.exp(-elapsed * 16));
        if (!latest.current.preview) { const direction = new THREE.Vector3(...object.state.velocity).normalize(); if (direction.lengthSq()) object.group.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction), 1 - Math.exp(-elapsed * 5)); }
        object.phase.value = object.state.phase;
        const chosen = object.state.id === focused; object.group.scale.setScalar(chosen ? 1.04 : 1);
      }
      if (tracking && !reducedMotion.matches) { const object = fish.get(focused); if (object) { const delta = object.group.position.clone().sub(controls.target).multiplyScalar(0.05); controls.target.add(delta); camera.position.add(delta); } }
      if (!reducedMotion.matches && !latest.current.lowQuality) updatePlants(time);
      controls.update(); renderer.render(scene, camera); renderer.domElement.dataset.ready = "true";
      if (Math.floor(time) !== lastMetric) { lastMetric = Math.floor(time); renderer.domElement.dataset.geometries = String(renderer.info.memory.geometries); renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls); }
    };
    loop(last);
    return () => { disposed = true; cancelAnimationFrame(frame); api.current = null; observer.disconnect(); controls.dispose(); renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointerup", up); renderer.domElement.removeEventListener("webglcontextlost", lost); disposeObject(scene); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }, [generation]);
  return <div className="fish-scene" ref={host} data-testid="fish-scene">{failed && <div className="fish-scene-error" role="alert"><p>{t($ => $.graphics_error)}</p><Button variant="outline" onClick={() => { setFailed(false); setGeneration(v => v + 1); }}>{t($ => $.retry)}</Button></div>}</div>;
}
