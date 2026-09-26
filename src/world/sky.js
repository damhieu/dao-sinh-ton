// Photographic sky backdrop, sun light with player-following shadows, and custom height fog.
import * as THREE from "three";

// three.js ACESFilmicToneMapping replicated in JS (linear in -> display linear out)
const IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
function mul(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
function rrt(v) {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / b;
}
export function acesFilmic(rgb, exposure = 1) {
  let c = rgb.map((x) => (x * exposure) / 0.6);
  c = mul(IN, c).map(rrt);
  return mul(OUT, c).map((x) => Math.min(1, Math.max(0, x)));
}
// Closed-form inverse of the ACES fit: find scene-linear color that tone maps to `target` (display-linear)
const OUT_INV = invert3(OUT);
const IN_INV = invert3(IN);
function invert3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
function rrtInv(y) {
  const a = 0.983729 * y - 1;
  const b = 0.432951 * y - 0.0245786;
  const c = 0.238081 * y + 0.000090537;
  return (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
}
export function inverseAces(target, exposure = 1) {
  const t = mul(
    OUT_INV,
    target.map((x) => Math.min(0.97, Math.max(0, x))),
  );
  const v = mul(IN_INV, t.map(rrtInv));
  return v.map((x) => Math.max(0, (x * 0.6) / exposure));
}
const glslMat = (m) =>
  `mat3(${[0, 1, 2].map((col) => [0, 1, 2].map((row) => m[row][col].toFixed(6)).join(", ")).join(", ")})`;

export const FOG = { density: 0.0014, falloff: 0.011, base: 0 };

export function installFog(sunDir, sunColor) {
  const S = THREE.ShaderChunk;
  const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
  S.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  S.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  S.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  const vec3 FOG_SUN_DIR = ${v3(sunDir)};
  const vec3 FOG_SUN_COLOR = ${v3({ x: sunColor.r, y: sunColor.g, z: sunColor.b })};
#endif`;
  S.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 fogRay = vFogWorldPos - cameraPosition;
    float fogDist = length(fogRay);
    vec3 fogDir = fogRay / max(fogDist, 1e-4);
    #ifdef FOG_EXP2
      float fogD = fogDensity;
    #else
      float fogD = 2.3 / max(fogFar, 1.0);
    #endif
    const float fogB = ${FOG.falloff.toFixed(5)};
    float dCam = fogD * exp(-fogB * (cameraPosition.y - ${FOG.base.toFixed(2)}));
    float dy = fogRay.y;
    float fogAmount = abs(dy) > 0.05 ? dCam * fogDist * (1.0 - exp(-fogB * dy)) / (fogB * dy) : dCam * fogDist;
    float fogFactor = 1.0 - exp(-max(fogAmount, 0.0));
    float sunAmt = pow(max(dot(fogDir, FOG_SUN_DIR), 0.0), 6.0);
    vec3 fogCol = mix(fogColor, FOG_SUN_COLOR, sunAmt * 0.6);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFactor);
  }
#endif`;
}

const SkyShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww; // at the far plane
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSky;
    uniform vec3 uHorizon; // display-linear horizon color
    varying vec3 vDir;
    #include <common>
    // Exact inverse of three's ACESFilmicToneMapping so the photo survives the OutputPass unchanged
    vec3 rrtInv(vec3 y) {
      vec3 a = 0.983729 * y - 1.0;
      vec3 b = 0.432951 * y - 0.0245786;
      vec3 c = 0.238081 * y + 0.000090537;
      return (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
    }
    vec3 inverseAces(vec3 y) {
      y = clamp(y, 0.0, 0.97);
      vec3 t = OUT_INV * y;
      vec3 v = IN_INV * rrtInv(t);
      return max(v * 0.6, 0.0);
    }
    void main() {
      vec3 d = normalize(vDir);
      vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
      vec3 c = texture2D(tSky, uv).rgb;
      // below the horizon: repeat the haze just above it (same azimuth) so the far sea edge blends in
      vec3 haze = vec3(0.0);
      for (int k = -3; k <= 3; k++) haze += texture2D(tSky, vec2(uv.x + float(k) * 0.02, 0.5 + 0.03)).rgb;
      // mostly the flat horizon colour (what fogged distant water fades to): seen from the plane this
      // band is a few degrees tall and per-azimuth photo colours would read as vertical streaks
      haze = mix(uHorizon, haze / 7.0, 0.35);
      c = mix(haze, c, smoothstep(-0.002, 0.02, d.y));
      gl_FragColor = vec4(inverseAces(c), 1.0);
    }
  `,
};

export function createSky(ctx, assets) {
  const { scene } = ctx;
  const sunDir = assets.sunDir.clone();

  // Horizon color of the backdrop in display-linear space, and the scene-linear color that tone maps to it
  const hz = assets.fogColor; // THREE.Color, linear
  const fogLinear = inverseAces([hz.r, hz.g, hz.b]);
  const fogColor = new THREE.Color(fogLinear[0], fogLinear[1], fogLinear[2]);
  const sunFog = new THREE.Color(1.0, 0.86, 0.66).multiplyScalar(Math.max(fogLinear[0], fogLinear[1]) * 1.6);
  installFog(sunDir, sunFog);
  scene.fog = new THREE.FogExp2(fogColor, FOG.density);

  const skyMat = new THREE.ShaderMaterial({
    uniforms: { tSky: { value: assets.background }, uHorizon: { value: new THREE.Color(hz.r, hz.g, hz.b) } },
    vertexShader: SkyShader.vertexShader,
    fragmentShader:
      `const mat3 OUT_INV = ${glslMat(OUT_INV)};\nconst mat3 IN_INV = ${glslMat(IN_INV)};\n` +
      SkyShader.fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), skyMat);
  // drawn after the opaque scene at the far plane, so only uncovered pixels are shaded
  sky.renderOrder = 1000;
  sky.frustumCulled = false;
  sky.onBeforeRender = (r, s, cam) => sky.position.copy(cam.position);
  scene.add(sky);

  scene.environment = assets.env;
  scene.environmentIntensity = 1.25;

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.95, 0.86), 2.6);
  sun.castShadow = true;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const state = { range: 90, size: 4096 };

  function setShadowQuality(size, range) {
    state.range = range;
    state.size = size;
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.left = -range;
    cam.right = range;
    cam.top = range;
    cam.bottom = -range;
    cam.near = 1;
    cam.far = 1400;
    cam.updateProjectionMatrix();
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }

  // Light-space basis for texel snapping
  const lz = sunDir.clone().negate();
  const lx = new THREE.Vector3(0, 1, 0).cross(lz).normalize();
  const ly = lz.clone().cross(lx).normalize();
  const tmp = new THREE.Vector3();

  function update(focus) {
    const texel = (state.range * 2) / state.size;
    const fx = focus.x;
    const fy = focus.y;
    const fz = focus.z;
    const px = Math.round((fx * lx.x + fy * lx.y + fz * lx.z) / texel) * texel;
    const py = Math.round((fx * ly.x + fy * ly.y + fz * ly.z) / texel) * texel;
    const pz = fx * lz.x + fy * lz.y + fz * lz.z;
    tmp.set(0, 0, 0).addScaledVector(lx, px).addScaledVector(ly, py).addScaledVector(lz, pz);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(sunDir, 700);
    sun.target.updateMatrixWorld();
  }

  return { sun, sunDir, fogColor, sky, update, setShadowQuality };
}
