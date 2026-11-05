"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stepFish, type FishSceneResident } from "@auro/core/fish";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../i18n";
import { createReef, WATER_LEVEL } from "./reef";
import { createSwimPose, makeFish, type FishObject } from "./fish-visual";

interface Props { residents: FishSceneResident[]; selectedId?: string; onSelect?: (id: string) => void; follow?: boolean; reset?: number; paused?: boolean; lowQuality?: boolean; preview?: boolean }
interface SceneAPI { update: (residents: FishSceneResident[]) => void; focus: (id: string, follow: boolean) => void; reset: () => void }

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  object.traverse(child => {
    if (child instanceof THREE.InstancedMesh) child.dispose();
    if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    }
  });
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
    const scene = new THREE.Scene(), waterTime = { value: 0 };
    const reef = createReef(scene, waterTime);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    container.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.08, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.67;
    controls.enablePan = !latest.current.preview;

    const fish = new Map<string, FishObject>();
    const pose = createSwimPose();
    const focusTarget = new THREE.Vector3(), focusOffset = new THREE.Vector3(), cameraDelta = new THREE.Vector3();
    const wantedCamera = new THREE.Vector3();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let focused = "", tracking = false, approachRemaining = 0, wasPreview = !!latest.current.preview;
    const cancelApproach = () => { approachRemaining = 0; };
    controls.addEventListener("start", cancelApproach);

    const reset = () => {
      approachRemaining = 0;
      if (latest.current.preview) {
        controls.target.set(0, 3.5, 0);
        camera.position.set(1.55, 4.32, 3.1);
      } else {
        const loneFish = fish.size === 1 ? fish.values().next().value : undefined;
        if (loneFish) {
          controls.target.copy(loneFish.group.position);
          camera.position.set(3.1, 1.1, 5.3).multiplyScalar(Math.max(0.7, loneFish.length)).add(controls.target);
        } else {
          controls.target.set(-0.6, 2.7, -1.9);
          camera.position.set(9.5, 4.8, 14.3);
        }
      }
      controls.update();
    };
    api.current = {
      update(residents) {
        const ids = new Set(residents.map(r => r.id));
        for (const [id, object] of fish) if (!ids.has(id)) { scene.remove(object.group); object.dispose(); fish.delete(id); }
        controls.enablePan = !latest.current.preview;
        controls.minDistance = latest.current.preview ? 0.65 : 0.9;
        controls.maxDistance = latest.current.preview ? 8 : 28;
        for (const resident of residents) {
          const old = fish.get(resident.id); if (old?.version === `${resident.revision}:${resident.fish.contentHash}`) continue;
          const object = makeFish(resident, reef.tintFish);
          if (old) { object.state.position = old.state.position; object.state.velocity = old.state.velocity; scene.remove(old.group); old.dispose(); }
          if (latest.current.preview) { object.state.position = [0, 3.5, 0]; object.state.velocity = [0, 0, 0]; }
          object.group.position.set(...object.state.position);
          pose(object, 0, !!latest.current.preview);
          scene.add(object.group);
          fish.set(resident.id, object);
        }
        if (wasPreview !== !!latest.current.preview) {
          wasPreview = !!latest.current.preview;
          reset();
        }
      },
      focus(id, follow) {
        const object = fish.get(id);
        if (object && id !== focused) {
          const distance = Math.max(1.15, object.length * 2.9);
          focusOffset.set(0.33, object.state.spec.motion.style === "fin-glide" ? 0.32 : 0.16, 1).normalize().applyQuaternion(object.group.quaternion);
          focusOffset.y = THREE.MathUtils.clamp(focusOffset.y, 0.03, 0.36);
          focusOffset.normalize().multiplyScalar(distance);
          if (reducedMotion.matches || latest.current.preview) {
            controls.target.copy(object.group.position);
            camera.position.copy(controls.target).add(focusOffset);
          } else {
            approachRemaining = 1.2;
          }
        }
        if (!object) approachRemaining = 0;
        focused = id;
        tracking = follow;
      }, reset,
    };
    api.current.update(latest.current.residents);
    reset();
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
    const loop = (now: number) => {
      if (disposed) return; frame = requestAnimationFrame(loop);
      let elapsed = Math.min((now - last) / 1000, 0.15); last = now;
      if (document.hidden) return;
      const cameraElapsed = elapsed;
      const { paused, preview = false, lowQuality = false } = latest.current;
      if (paused) elapsed = 0;
      const densityScale = fish.size >= 32 ? 0.86 : 1;
      const pixelRatio = Math.min(window.devicePixelRatio, lowQuality ? 1 : 1.6) * densityScale;
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      const objects = [...fish.values()];
      if (!preview) {
        accumulator += elapsed;
        if (accumulator >= 0.05) {
          const states = objects.map(object => object.state);
          while (accumulator >= 0.05) { stepFish(states, 0.05, time); time += 0.05; accumulator -= 0.05; }
        }
      } else {
        time += elapsed;
        for (const object of objects) object.state.phase += elapsed * object.state.spec.motion.frequency / 1000 * Math.PI * 2;
      }
      for (const object of objects) pose(object, elapsed, preview, preview ? 0 : accumulator);
      const subject = fish.get(focused);
      if (subject && approachRemaining > 0) {
        approachRemaining -= cameraElapsed;
        focusTarget.copy(subject.group.position);
        wantedCamera.copy(focusTarget).add(focusOffset);
        const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-cameraElapsed * 4.5);
        controls.target.lerp(focusTarget, blend);
        camera.position.lerp(wantedCamera, blend);
        if (camera.position.distanceToSquared(wantedCamera) < 0.08) approachRemaining = 0;
      } else if (subject && tracking && !reducedMotion.matches) {
        cameraDelta.copy(subject.group.position).sub(controls.target).multiplyScalar(1 - Math.exp(-cameraElapsed * 4));
        controls.target.add(cameraDelta);
        camera.position.add(cameraDelta);
      }
      if (!preview) {
        controls.target.y = Math.min(controls.target.y, WATER_LEVEL - 1);
        const headroom = (WATER_LEVEL - 0.45 - controls.target.y) / Math.max(0.1, camera.position.distanceTo(controls.target));
        controls.minPolarAngle = Math.acos(THREE.MathUtils.clamp(headroom, 0, 1));
      } else {
        controls.minPolarAngle = 0.2;
      }
      if (!reducedMotion.matches) waterTime.value += elapsed;
      controls.update();
      for (const object of objects) {
        const apparentSize = object.length / Math.max(0.1, object.group.position.distanceTo(camera.position));
        object.setDetail(lowQuality ? 0 : apparentSize, preview || object === subject);
      }
      reef.configure(preview, lowQuality, camera.position);
      renderer.render(scene, camera); renderer.domElement.dataset.ready = "true";
      if (Math.floor(time) !== lastMetric) { lastMetric = Math.floor(time); renderer.domElement.dataset.geometries = String(renderer.info.memory.geometries); renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls); }
    };
    loop(last);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      api.current = null;
      observer.disconnect();
      controls.removeEventListener("start", cancelApproach);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      for (const object of fish.values()) {
        scene.remove(object.group);
        object.dispose();
      }
      disposeObject(scene);
      reef.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [generation]);
  return <div className="fish-scene" ref={host} data-testid="fish-scene" data-fish-count={props.residents.length}>{failed && <div className="fish-scene-error" role="alert"><p>{t($ => $.graphics_error)}</p><Button variant="outline" onClick={() => { setFailed(false); setGeneration(v => v + 1); }}>{t($ => $.retry)}</Button></div>}</div>;
}
