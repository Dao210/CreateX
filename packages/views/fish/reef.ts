import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { OCEAN_ROCKS } from "@auro/core/fish";

export const WATER_LEVEL = 9.6;

const seabedHeight = (x: number, z: number) =>
  -0.35 + Math.sin(x * 0.35 + z * 0.24) * Math.cos(z * 0.35) * 0.31
  + Math.cos(z * 0.75 + x * 0.25) * 0.13;

const waterColor = "#175866";
const worldPosition = /* glsl */ `
  vec4 reefPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    reefPosition = instanceMatrix * reefPosition;
  #endif
  vReefPosition = (modelMatrix * reefPosition).xyz;
`;

export function createReef(scene: THREE.Scene, time: { value: number }) {
  scene.background = new THREE.Color(waterColor);
  scene.fog = new THREE.FogExp2(waterColor, 0.042);
  scene.add(new THREE.HemisphereLight("#b8edf0", "#496052", 1.75));
  const sun = new THREE.DirectionalLight("#fff2d7", 2.4);
  sun.position.set(-8, 19, 3);
  scene.add(sun);

  // Project one tiled light field onto the seabed, rocks and swimming fish.
  const caustic = makeCausticTexture();
  const detail = { value: 1 };
  const tintWater = (shader: THREE.WebGLProgramParametersWithUniforms, surface: "sand" | "rock" | "grass" | "fish") => {
    shader.uniforms.reefTime = time;
    shader.uniforms.reefDetail = detail;
    shader.uniforms.reefCaustic = { value: caustic };
    shader.vertexShader = `varying vec3 vReefPosition;\n${shader.vertexShader}`
      .replace("#include <project_vertex>", `${worldPosition}\n#include <project_vertex>`);
    shader.fragmentShader = `
      uniform float reefTime;
      uniform float reefDetail;
      uniform sampler2D reefCaustic;
      varying vec3 vReefPosition;
      ${shader.fragmentShader}
    `.replace("#include <color_fragment>", /* glsl */ `
      #include <color_fragment>
      vec2 bed = vReefPosition.xz;
      ${surface === "sand" ? /* glsl */ `
        float folds = bed.y * 8.1 + bed.x * 2.2 + 3.0 * sin(bed.x * 0.57 + bed.y * 0.22)
          + 1.4 * sin(bed.x * 1.4 - bed.y * 0.57);
        float ripple = sin(folds) * (1.0 - smoothstep(0.24, 1.4, fwidth(folds)));
        float grain = sin(bed.x * 49.0 + bed.y * 38.0) * sin(bed.y * 51.0 - bed.x * 19.0);
        float distanceToBed = distance(cameraPosition, vReefPosition);
        float bank = sin(bed.x * 0.61 + bed.y * 0.38) * cos(bed.y * 0.71);
        float shade = 0.88 + 0.065 * ripple + 0.032 * grain * (1.0 - smoothstep(2.0, 7.0, distanceToBed)) + 0.12 * bank;
        vec2 sunPool = (bed - vec2(-3.0, -1.0)) * vec2(0.085, 0.11);
        diffuseColor.rgb *= mix(vec3(0.68, 0.89, 1.02), vec3(1.06, 1.00, 0.86), exp(-dot(sunPool, sunPool)));
        shade -= 0.49 * exp(-dot((bed - vec2(-5.0, -2.0)) / 2.25, (bed - vec2(-5.0, -2.0)) / 2.25));
        shade -= 0.43 * exp(-dot((bed - vec2(5.0, -4.0)) / 1.8, (bed - vec2(5.0, -4.0)) / 1.8));
        diffuseColor.rgb *= shade;
      ` : surface === "rock" ? /* glsl */ `
        vec3 p = vReefPosition * 2.9;
        float veins = sin(p.x + p.y * 3.7 + sin(p.z * 1.9)) * cos(p.z * 2.2 - p.y);
        float mineral = smoothstep(-0.65, 0.6, veins + 0.4 * sin(p.x * 4.5 + p.y * 2.3 - p.z));
        diffuseColor.rgb *= mix(vec3(0.64, 0.68, 0.62), vec3(1.26, 1.18, 1.05), mineral);
      ` : ""}
      float depth = max(0.0, ${WATER_LEVEL.toFixed(1)} - vReefPosition.y);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.48, 0.80, 0.93), min(depth * 0.073, 0.78));
      if (reefDetail > 0.0${surface === "fish" ? " && fishDetail > 0.5" : ""}) {
        vec2 lightUV = (bed + vReefPosition.y * vec2(0.39, -0.22)) * 0.22;
        float lightA = texture2D(reefCaustic, lightUV + vec2(0.029, -0.014) * reefTime).r;
        float caustics = lightA * 0.72;
        if (reefDetail > 0.5) {
          float lightB = texture2D(reefCaustic, lightUV.yx * 0.81 + vec2(-0.018, 0.026) * reefTime).r;
          caustics = min(lightA, lightB) + 0.34 * max(lightA, lightB);
        }
        float falloff = exp(-depth * 0.054 - length(bed - vec2(-5.0, 0.0)) * 0.047);
        diffuseColor.rgb *= 1.0 + caustics * falloff * ${surface === "fish" ? "0.53" : "1.02"} * reefDetail;
      }
    `);
  };

  const stage = new THREE.Group();
  const floor = new THREE.PlaneGeometry(92, 92, 76, 76).rotateX(-Math.PI / 2);
  const positions = floor.getAttribute("position");
  for (let i = 0; i < positions.count; i++) positions.setY(i, seabedHeight(positions.getX(i), positions.getZ(i)));
  floor.computeVertexNormals();
  const sand = new THREE.MeshStandardMaterial({ color: "#ad9d76", roughness: 0.96 });
  sand.onBeforeCompile = shader => tintWater(shader, "sand");
  stage.add(new THREE.Mesh(floor, sand));

  // Resolve the water surface along each view ray so it fades into open water at grazing angles.
  const water = new THREE.Mesh(
    new THREE.SphereGeometry(77, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: { reefTime: time, distantWater: { value: new THREE.Color(waterColor) } },
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vWaterPoint;
        void main() {
          vWaterPoint = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWaterPoint, 1.0);
          gl_Position.z = gl_Position.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float reefTime;
        uniform vec3 distantWater;
        varying vec3 vWaterPoint;
        void main() {
          vec3 ray = normalize(vWaterPoint - cameraPosition);
          vec3 sun = normalize(vec3(-0.64, 0.41, -0.52));
          float sunward = max(0.0, dot(ray, sun));
          float upward = smoothstep(-0.05, 0.65, ray.y);
          vec3 water = distantWater * (1.0 + 0.17 * upward);
          float angleFromSun = atan(dot(ray - sun, vec3(0.63, 0.0, -0.78)), sun.y - ray.y);
          float shafts = 0.38 + 0.62 * pow(0.5 + 0.5 * sin(angleFromSun * 19.0 + sin(angleFromSun * 6.0) + reefTime * 0.16), 5.0);
          float haze = pow(sunward, 8.0) * smoothstep(-0.06, 0.21, ray.y) * shafts;
          water += vec3(0.022, 0.11, 0.12) * haze;
          if (ray.y > 0.025) {
            float distanceToSurface = max(0.1, ${WATER_LEVEL.toFixed(1)} - cameraPosition.y) / ray.y;
            vec2 p = cameraPosition.xz + ray.xz * distanceToSurface;
            float swell = sin(p.x * 0.79 + p.y * 0.49 - reefTime * 0.55)
              + 0.4 * sin(p.x * 0.31 - p.y * 0.95 + reefTime * 0.38);
            float waves = sin(p.y * 2.5 + p.x * 1.25 + swell * 1.9 + reefTime * 0.7);
            float ripples = sin(p.x * 5.1 - p.y * 3.0 + waves * 1.15 + reefTime * 0.73);
            float glint = pow(max(0.0, 0.48 + 0.32 * waves + 0.20 * ripples), 5.0);
            float windowLight = smoothstep(0.025, 0.55, ray.y) * exp(-distanceToSurface * 0.024);
            water += (vec3(0.023, 0.13, 0.12) + vec3(0.30, 0.49, 0.38) * glint)
              * windowLight * (0.44 + haze);
          }
          gl_FragColor = vec4(water, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  water.renderOrder = 10;
  water.frustumCulled = false;
  stage.add(water);

  const facetedRock = new THREE.IcosahedronGeometry(1, 4);
  facetedRock.deleteAttribute("normal").deleteAttribute("uv");
  const rockGeometry = mergeVertices(facetedRock);
  facetedRock.dispose();
  const rockVertices = rockGeometry.getAttribute("position");
  for (let i = 0; i < rockVertices.count; i++) {
    const x = rockVertices.getX(i), y = rockVertices.getY(i), z = rockVertices.getZ(i);
    const rough = 1 + Math.sin(x * 7 + z * 3) * Math.cos(y * 5 - z * 8) * 0.13 + Math.sin(z * 16 + y * 5) * 0.045;
    rockVertices.setXYZ(i, x * rough, y * rough, z * rough);
  }
  rockGeometry.computeVertexNormals();
  const stone = new THREE.MeshStandardMaterial({ color: "#949181", roughness: 0.97 });
  stone.onBeforeCompile = shader => tintWater(shader, "rock");
  const smallRocks = [
    [-9.5, -4.2, 0.73], [-8, -3.8, 0.58], [-7.2, -4.3, 0.42], [-5.9, -3.9, 0.62],
    [-2.9, -3.7, 0.55], [-4.5, -5.6, 0.74], [-2.9, -6.1, 0.46], [-1.7, -6.3, 0.41],
    [3, -5.1, 0.57], [6.2, -5.7, 0.64], [7.8, -5.4, 0.48], [9.2, -7.7, 0.72],
    [-9, 3.7, 0.63], [-8.3, 4.5, 0.43], [6.9, 4.9, 0.58], [7.8, 4.4, 0.36],
    [-11.1, -11.1, 3.4], [-8.1, -13.5, 3.8], [-5.4, -15.4, 3.0], [-2.3, -15.5, 2.4],
    [2.8, -17.0, 2.1], [10.2, -15.9, 3.3], [13.4, -14.1, 3.8],
  ];
  const rockCount = OCEAN_ROCKS.length + smallRocks.length;
  const rocks = new THREE.InstancedMesh(rockGeometry, stone, rockCount);
  const transform = new THREE.Object3D(), color = new THREE.Color();
  [...OCEAN_ROCKS.map(r => [r.x, r.z, r.radius]), ...smallRocks].forEach(([x = 0, z = 0, size = 0.4], i) => {
    transform.position.set(x, seabedHeight(x, z) + size * 0.15, z);
    transform.rotation.set(Math.sin(i) * 0.3, i * 2.35, 0.14);
    transform.scale.set(size, size * (i < OCEAN_ROCKS.length ? 0.71 : 0.49), size * 0.82);
    transform.updateMatrix();
    rocks.setMatrixAt(i, transform.matrix);
    rocks.setColorAt(i, color.setHSL(0.15 + Math.sin(i) * 0.04, 0.13, 0.58 + Math.sin(i * 3) * 0.12));
  });
  stage.add(rocks);

  const blade = new THREE.PlaneGeometry(1, 1, 2, 8).translate(0, 0.5, 0);
  const bladePositions = blade.getAttribute("position");
  for (let i = 0; i < bladePositions.count; i++) {
    const height = bladePositions.getY(i);
    bladePositions.setX(i, bladePositions.getX(i) * (0.12 + 0.88 * Math.sin(Math.PI * height)) + height * height * 0.42);
    bladePositions.setZ(i, Math.sin(height * 6) * height * 0.11);
  }
  blade.computeVertexNormals();
  const grass = new THREE.MeshStandardMaterial({ color: "#81995c", roughness: 0.84, side: THREE.DoubleSide });
  grass.onBeforeCompile = shader => {
    tintWater(shader, "grass");
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", /* glsl */ `
      #include <begin_vertex>
      vec3 root = instanceMatrix[3].xyz;
      float sway = sin(reefTime * 1.35 + root.x * 0.44 + root.z * 0.63);
      transformed.x += position.y * position.y * sway * 0.56;
      transformed.z += position.y * position.y * (0.24 + 0.21 * sway);
    `);
    shader.vertexShader = `uniform float reefTime;\n${shader.vertexShader}`;
  };
  const patches = [[-8.3, 3.8], [6.7, 4.2], [-7.4, -2.5], [-4.5, -5.5], [4.8, -5.7], [8.2, -6.8], [-12.1, -4.1], [0.6, -8.8], [10.7, 0.1], [-8.0, -10.8, 1.65], [-5.0, -11.9, 1.8], [8.7, -11.1, 1.55]];
  const meadow = new THREE.InstancedMesh(blade, grass, patches.length * 24);
  patches.forEach(([x = 0, z = 0, scale = 1], patch) => {
    for (let j = 0; j < 24; j++) {
      const i = patch * 24 + j, angle = j * 2.39996, spread = Math.sqrt(j / 24);
      const px = x + Math.cos(angle) * spread * 1.5, pz = z + Math.sin(angle) * spread * 0.94;
      const height = (0.47 + 0.66 * (0.5 + 0.5 * Math.sin(i * 19.1))) * (1.1 - spread * 0.24) * scale;
      transform.position.set(px, seabedHeight(px, pz) - 0.02, pz);
      transform.rotation.set(Math.sin(i) * 0.16, angle + patch, Math.sin(i * 4) * 0.31);
      transform.scale.set(0.065 + height * 0.047, height, 0.22);
      transform.updateMatrix();
      meadow.setMatrixAt(i, transform.matrix);
      meadow.setColorAt(i, color.setHSL(0.16 + Math.sin(i * 1.3) * 0.058, 0.33, 0.41 + 0.11 * Math.cos(i * 2.2)));
    }
  });
  stage.add(meadow);

  const particles = new THREE.BufferGeometry();
  const specks = Array.from({ length: 330 }, (_, i) => [
    Math.sin(i * 37.7) * 24, 0.5 + (Math.sin(i * 17.1) + 1) * 4.1, Math.cos(i * 43.2) * 21,
  ]).flat();
  particles.setAttribute("position", new THREE.Float32BufferAttribute(specks, 3));
  const plankton = new THREE.Points(particles, new THREE.ShaderMaterial({
    uniforms: { reefTime: time },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float reefTime;
      varying float vOpacity;
      void main() {
        vec3 p = position + vec3(sin(reefTime * 0.18 + position.z) * 0.37,
          sin(reefTime * 0.33 + position.x) * 0.18, cos(reefTime * 0.14 + position.y) * 0.42);
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(23.0 / -view.z, 1.0, 3.0);
        vOpacity = smoothstep(1.0, 4.0, -view.z) * (1.0 - smoothstep(9.0, 29.0, -view.z));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vOpacity;
      void main() {
        float falloff = 1.0 - smoothstep(0.04, 0.24, dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5));
        gl_FragColor = vec4(0.76, 0.89, 0.83, falloff * vOpacity * 0.30);
      }
    `,
  }));
  stage.add(plankton);
  scene.add(stage);

  return {
    tintFish: (shader: THREE.WebGLProgramParametersWithUniforms) => tintWater(shader, "fish"),
    configure(preview: boolean, lowQuality: boolean, cameraPosition: THREE.Vector3) {
      stage.visible = !preview;
      plankton.visible = !lowQuality;
      detail.value = preview ? 0 : lowQuality ? 0.48 : 1;
      water.position.copy(cameraPosition);
    },
    dispose: () => caustic.dispose(),
  };
}

function makeCausticTexture() {
  const size = 128, cells = 7, data = new Uint8Array(size * size);
  const point = (x: number, y: number, salt: number) => {
    const n = Math.sin(((x + cells) % cells) * 127.1 + ((y + cells) % cells) * 311.7 + salt) * 43758.5453;
    return 0.18 + (n - Math.floor(n)) * 0.64;
  };
  const centers = Array.from({ length: cells * cells }, (_, i) => [
    point(i % cells, Math.floor(i / cells), 0.7), point(i % cells, Math.floor(i / cells), 9.4),
  ] as const);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * cells, v = y / size * cells;
    const ix = Math.floor(u), iy = Math.floor(v);
    let nearest = Infinity, next = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const [px, py] = centers[((cy + cells) % cells) * cells + (cx + cells) % cells]!;
      const distance = (u - cx - px) ** 2 + (v - cy - py) ** 2;
      if (distance < nearest) { next = nearest; nearest = distance; }
      else if (distance < next) next = distance;
    }
    const edge = Math.sqrt(next) - Math.sqrt(nearest);
    data[y * size + x] = Math.round(Math.exp(-edge * edge * 86) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
