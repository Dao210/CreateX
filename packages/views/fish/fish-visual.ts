import * as THREE from "three";
import { compileFishGeometry, swimState, type FishResident, type FishSpec, type SwimState } from "@auro/core/fish";

type TintFish = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

export interface FishObject {
  group: THREE.Group;
  state: SwimState;
  version: string;
  visual: { value: THREE.Vector4 };
  length: number;
  initialized: boolean;
  setDetail: (apparentSize: number, focus: boolean) => void;
  dispose: () => void;
}

function makeGeometry(spec: FishSpec, distant: boolean) {
  const data = compileFishGeometry(spec, distant);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute("finFlex", new THREE.Float32BufferAttribute(data.finFlex, 1));
  const colors = new Float32Array(data.colors.length);
  const workingColor = new THREE.Color();
  for (let i = 0; i < data.colors.length; i += 3) {
    workingColor.setRGB(data.colors[i]!, data.colors[i + 1]!, data.colors[i + 2]!, THREE.SRGBColorSpace);
    workingColor.toArray(colors, i);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const length = spec.body.lengthMm / 1000;
  if (geometry.boundingSphere) geometry.boundingSphere.radius += length * 0.6;
  return geometry;
}

export function makeFish(resident: FishResident, tintFish: TintFish): FishObject {
  const spec = resident.fish.draft, length = spec.body.lengthMm / 1000;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: spec.appearance.opacity < 1000,
    opacity: spec.appearance.opacity / 1000,
    depthWrite: spec.appearance.opacity === 1000,
    emissive: spec.appearance.body,
    emissiveIntensity: spec.appearance.glow / 1000,
  });
  material.forceSinglePass = true;
  const visual = { value: new THREE.Vector4(0, 1, 0, length) };
  const amplitude = { value: spec.motion.amplitude / 1000 };
  const style = spec.motion.style, detail = { value: 0 };
  material.onBeforeCompile = shader => {
    tintFish(shader);
    shader.uniforms.fishVisual = visual;
    shader.uniforms.fishAmplitude = amplitude;
    shader.uniforms.fishDetail = detail;
    shader.fragmentShader = `uniform float fishDetail;
${shader.fragmentShader}`;
    shader.vertexShader = /* glsl */ `
      attribute float finFlex;
      uniform vec4 fishVisual;
      uniform float fishAmplitude;
      uniform float fishDetail;

      vec2 swimOffset(vec3 p, float flex) {
        float phase = fishVisual.x;
        float effort = fishVisual.y;
        float bend = fishVisual.z;
        float fishLength = fishVisual.w;
        float u = clamp(0.5 - p.x / fishLength, 0.0, 1.8);
        float rear = u * u;
        float turn = bend * rear * 0.10;
        ${style === "fin-glide" ? /* glsl */ `
          float travel = phase - flex * 3.5 + p.x / fishLength * 2.0;
          float flap = (0.12 + fishAmplitude * 1.75) * sin(travel);
          float lift = flex * effort * flap * (1.0 - sign(p.z) * bend * 0.22);
          return fishLength * vec2(lift, turn * 0.55 + sin(phase - u * 2.8) * rear * 0.015 * effort);
        ` : style === "body-wave" ? /* glsl */ `
          float wave = sin(phase - u * 6.4) * u * (0.36 + u * 0.38);
          return fishLength * vec2(0.0, wave * fishAmplitude * effort + turn);
        ` : /* glsl */ `
          float wave = sin(phase - u * 4.0) * rear * 0.75;
          float trim = sin(phase * 0.5 + sign(p.z) * 0.6) * flex * 0.048 * effort;
          return fishLength * vec2(trim, wave * fishAmplitude * effort + turn);
        `}
      }

      ${shader.vertexShader}
    `.replace("#include <beginnormal_vertex>", /* glsl */ `
      #include <beginnormal_vertex>
      if (fishDetail > 0.5) {
        float dx = fishVisual.w * 0.008;
        vec2 offset = swimOffset(position, finFlex);
        vec2 along = (swimOffset(position + vec3(dx, 0.0, 0.0), finFlex) - offset) / dx;
        objectNormal.x -= dot(along, objectNormal.yz);
        if (finFlex > 0.0) {
          vec2 across = (swimOffset(position, finFlex + 0.008) - offset) / dx;
          objectNormal.z -= across.x * sign(position.z) * objectNormal.y;
        }
      }
    `).replace("#include <begin_vertex>", /* glsl */ `
      #include <begin_vertex>
      transformed.yz += swimOffset(position, finFlex);
    `);
  };
  material.customProgramCacheKey = () => `reef-swim:${style}`;

  const distant = makeGeometry(spec, true);
  let near: THREE.BufferGeometry | undefined;
  const mesh = new THREE.Mesh(distant, material), group = new THREE.Group();
  group.add(mesh);
  group.userData.residentId = resident.id;
  return {
    group, visual, length, initialized: false,
    state: swimState(resident.id, spec, resident.seed),
    version: `${resident.revision}:${resident.fish.contentHash}`,
    setDetail(apparentSize, focus) {
      const close = focus || apparentSize > (detail.value ? 0.095 : 0.125);
      if (close === !!detail.value) return;
      mesh.geometry = close ? (near ??= makeGeometry(spec, false)) : distant;
      detail.value = close ? 1 : 0;
    },
    dispose() {
      distant.dispose();
      near?.dispose();
      material.dispose();
    },
  };
}

export function createSwimPose() {
  const forward = new THREE.Vector3(), shown = new THREE.Vector3(), target = new THREE.Vector3();
  const side = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();
  const targetRotation = new THREE.Quaternion(), roll = new THREE.Quaternion();
  const forwardAxis = new THREE.Vector3(1, 0, 0), worldUp = new THREE.Vector3(0, 1, 0);

  return (object: FishObject, elapsed: number, preview: boolean, remainder = 0) => {
    const { group, state, visual } = object;
    const [vx, vy, vz] = state.velocity;
    const glider = state.spec.motion.style === "fin-glide";
    const continuousPhase = state.phase + remainder * state.spec.motion.frequency / 1000 * Math.PI * 2;
    const cycle = continuousPhase * (glider ? 0.38 : 0.28) + state.seed * 0.013;
    const effort = THREE.MathUtils.lerp(glider ? 0.18 : 0.57, 1, THREE.MathUtils.smoothstep(Math.cos(cycle), -0.35, 0.7));
    const phase = glider ? continuousPhase * 0.57 : continuousPhase;
    let turn = 0;
    if (!preview) {
      forward.set(vx, vy, vz).normalize();
      shown.copy(forwardAxis).applyQuaternion(group.quaternion);
      // The visible heading trails the path through a turn. Bank toward the new heading.
      turn = object.initialized ? THREE.MathUtils.clamp((shown.x * forward.z - shown.z * forward.x) * 2.5, -1, 1) : 0;
      side.crossVectors(forward, worldUp);
      if (side.lengthSq() > 0.0001) {
        side.normalize();
        up.crossVectors(side, forward);
        basis.makeBasis(forward, up, side);
        roll.setFromAxisAngle(forwardAxis, turn * (glider ? 0.39 : 0.25));
        targetRotation.setFromRotationMatrix(basis).multiply(roll);
        group.quaternion.slerp(targetRotation, object.initialized ? 1 - Math.exp(-elapsed * 4.3) : 1);
      }
      const surge = Math.sin(cycle) * (glider ? 0.16 : 0.10) + Math.sin(phase) * effort * 0.018;
      target.set(...state.position).addScaledVector(forward, surge * Math.hypot(vx, vy, vz));
      group.position.lerp(target, object.initialized ? 1 - Math.exp(-elapsed * 17) : 1);
    }
    visual.value.set(phase, effort, THREE.MathUtils.lerp(visual.value.z, turn, 1 - Math.exp(-elapsed * 5)), object.length);
    object.initialized = true;
  };
}
