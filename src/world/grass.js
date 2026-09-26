// GPU grass field that follows the camera. Blade positions tile every TILE meters so the field can
// snap to the camera without popping; heights come from the heightmap texture, density from a mask.
import * as THREE from "three";
import { plotBounds } from "./layout.js";

const TILE = 4;

export function createGrassDensity(data) {
  const { hm, masks, maskRes, plots } = data;
  const res = maskRes;
  const texel = hm.size / res;
  const out = new Uint8Array(res * res);
  const n = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < res; j++) {
    const z = (j + 0.5) * texel - hm.half;
    for (let i = 0; i < res; i++) {
      const x = (i + 0.5) * texel - hm.half;
      const k = j * res + i;
      const h = hm.getHeight(x, z);
      if (h < 2.4) continue;
      hm.getNormal(x, z, n);
      const slope = 1 - n.y;
      let d = 1 - Math.min(1, Math.max(0, (slope - 0.18) / 0.12));
      d *= 1 - masks.road[k] / 255;
      d *= 1 - Math.min(1, (masks.ground[k] / 255) * 1.6);
      d *= Math.min(1, (h - 2.4) / 1.2);
      out[k] = Math.round(Math.max(0, d) * 255);
    }
  }
  for (const p of plots) {
    const b = plotBounds(p, 1);
    for (let x = b.minX; x <= b.maxX; x += texel / 2) {
      for (let z = b.minZ; z <= b.maxZ; z += texel / 2) {
        const i = Math.floor((x + hm.half) / texel);
        const j = Math.floor((z + hm.half) / texel);
        if (i >= 0 && j >= 0 && i < res && j < res) out[j * res + i] = 0;
      }
    }
  }
  const t = new THREE.DataTexture(out, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return { texture: t, data: out, res };
}

function bladeGeometry() {
  // 3 segments + tip, width tapering; x across, y up (0..1)
  const segs = 3;
  const pos = [];
  const idx = [];
  for (let s = 0; s <= segs; s++) {
    const y = s / (segs + 0.5);
    const w = 0.5 * (1 - y * 0.85);
    pos.push(-w, y, 0, w, y, 0);
  }
  pos.push(0, 1, 0);
  for (let s = 0; s < segs; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const top = segs * 2;
  idx.push(top, top + 1, top + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  g.setIndex(idx);
  return g;
}

function makeField(radius, density, seed) {
  // blades per tile, repeated over the patch
  const tilesPerSide = Math.ceil((radius * 2) / TILE);
  const perTile = Math.round(TILE * TILE * density);
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const tile = [];
  for (let i = 0; i < perTile; i++) tile.push([rnd() * TILE, rnd() * TILE]);
  const offsets = [];
  const half = (tilesPerSide * TILE) / 2;
  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) {
      const ox = tx * TILE - half;
      const oz = ty * TILE - half;
      // skip tiles fully outside the circle
      const cx = ox + TILE / 2;
      const cz = oz + TILE / 2;
      if (Math.hypot(cx, cz) > radius + TILE) continue;
      for (const [x, z] of tile) offsets.push(ox + x, oz + z);
    }
  }
  return new Float32Array(offsets);
}

const GRASS_VERT_PARS = /* glsl */ `
  attribute vec2 aOffset;
  uniform vec2 uCenter;
  uniform vec3 uCam;
  uniform sampler2D uHeight;
  uniform sampler2D uDensity;
  uniform sampler2D uNoise;
  uniform float uHalf;
  uniform float uCell;
  uniform float uRes;
  uniform float uTime;
  uniform float uRadius;
  uniform float uBladeH;
  varying vec3 vGrassColor;
  varying float vGrassY;
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const GRASS_VERT = /* glsl */ `
  vec2 wp = uCenter + aOffset;
  float r1 = hash21(wp);
  float r2 = hash21(wp + 17.13);
  float r3 = hash21(wp - 5.71);
  wp += (vec2(r1, r2) - 0.5) * 0.35;
  float dist = length(wp - uCam.xz);
  float dens = texture2D(uDensity, (wp + uHalf) / (2.0 * uHalf)).r;
  // thin out with distance, fade at the edge
  float distKeep = mix(1.0, 0.35, smoothstep(uRadius * 0.25, uRadius, dist));
  float keep = step(r3, dens * distKeep);
  float edge = 1.0 - smoothstep(uRadius * 0.8, uRadius, dist);
  float hgt = uBladeH * (0.55 + r1 * 0.75) * (0.6 + 0.4 * dens) * keep * edge * (1.0 + smoothstep(uRadius * 0.3, uRadius, dist) * 0.6);
  float wid = 0.032 + r2 * 0.028 + smoothstep(uRadius * 0.3, uRadius, dist) * 0.07;
  vec3 p = vec3(position.x * wid, position.y * hgt, 0.0);
  // wind + natural lean
  vec4 nz = texture2D(uNoise, wp * 0.013 + vec2(uTime * 0.02, uTime * 0.013));
  float wind = sin(uTime * 1.9 + wp.x * 0.23 + wp.y * 0.17) * 0.5 + (nz.r - 0.5) * 1.4;
  float lean = (0.18 + r2 * 0.25 + wind * 0.28) * position.y * position.y * hgt;
  float ang = r1 * 6.2831;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 ldir = normalize(vec2(1.0, 0.6) + (nz.gb - 0.5) * 1.5);
  vec2 xz = dir * p.x + ldir * lean;
  vec2 huv = ((wp + uHalf) / uCell + 0.5) / uRes;
  float ground = texture2D(uHeight, huv).r;
  vec3 transformed = vec3(wp.x + xz.x, ground + p.y - 0.02, wp.y + xz.y);
  // color: match the terrain grass tint (same macro noise) and darken the base
  vec4 macro = texture2D(uNoise, wp * 0.0021);
  vec3 tint = mix(vec3(0.62, 0.92, 0.36), vec3(0.86, 0.9, 0.44), macro.r);
  vec3 base = vec3(0.1, 0.13, 0.045) * tint * 1.6;
  vec3 tip = mix(vec3(0.24, 0.31, 0.1), vec3(0.34, 0.33, 0.13), r2) * tint * 1.2;
  tip = mix(tip, vec3(0.3, 0.27, 0.12), step(0.86, r3) * 0.7);
  vGrassColor = mix(base, tip, position.y);
  vGrassY = position.y;
`;

function makeGrassMesh(radius, density, seed, uniformsBase, bladeH, ctx) {
  const geo = bladeGeometry();
  const offsets = makeField(radius, density, seed);
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 2));
  geo.instanceCount = offsets.length / 2;
  const uniforms = { ...uniformsBase, uRadius: { value: radius }, uBladeH: { value: bladeH } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + GRASS_VERT_PARS)
      .replace("#include <begin_vertex>", GRASS_VERT)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrassColor;\nvarying float vGrassY;")
      .replace("#include <map_fragment>", "diffuseColor.rgb = vGrassColor;")
      .replace(
        "#include <aomap_fragment>",
        "reflectedLight.indirectDiffuse *= mix(0.45, 1.0, vGrassY);\nreflectedLight.directDiffuse *= mix(0.55, 1.0, vGrassY);",
      );
  };
  mat.customProgramCacheKey = () => "grass-v1";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  ctx.scene.add(mesh);
  return { mesh, count: offsets.length / 2 };
}

export function createGrass(data, heightTex, noiseTex, density, ctx, quality) {
  const radius = quality.grass;
  if (!radius) return { meshes: [], blades: 0, update() {} };
  const shared = {
    uCenter: { value: new THREE.Vector2() },
    uCam: { value: new THREE.Vector3() },
    uHeight: { value: heightTex },
    uDensity: { value: density.texture },
    uNoise: { value: noiseTex },
    uHalf: { value: data.hm.half },
    uCell: { value: data.hm.cell },
    uRes: { value: data.hm.res },
    uTime: { value: 0 },
  };
  // dense field close to the camera + sparse field further out
  const near = makeGrassMesh(Math.min(22, radius), 26, 1234, shared, 0.42, ctx);
  const far = radius > 24 ? makeGrassMesh(radius, 4, 4321, shared, 0.5, ctx) : null;
  const meshes = [near.mesh, far && far.mesh].filter(Boolean);
  return {
    meshes,
    blades: near.count + (far ? far.count : 0),
    update(time, camPos) {
      shared.uTime.value = time;
      shared.uCenter.value.set(Math.floor(camPos.x / TILE) * TILE, Math.floor(camPos.z / TILE) * TILE);
      shared.uCam.value.copy(camPos);
    },
  };
}
