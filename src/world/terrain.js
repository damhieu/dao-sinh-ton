// Chunked terrain mesh with a 5-layer PBR splat shader (grass, dirt, rock, sand, asphalt).
import * as THREE from "three";

const CHUNK_CELLS = 64; // 64 cells * 4 m = 256 m per chunk

// Tileable RGBA value-noise texture (each channel a different seed), used for macro variation.
export function createNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (seed, n) => {
    const a = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < a.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      a[i] = s / 4294967296;
    }
    return a;
  };
  const sample = (lat, n, x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => lat[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * sx;
    const b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
  for (let c = 0; c < 4; c++) {
    const octs = [8, 16, 32, 64].map((n, k) => ({ n, lat: lattice(1234 + c * 97 + k * 13, n) }));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        let amp = 0.5;
        let norm = 0;
        for (const o of octs) {
          v += amp * sample(o.lat, o.n, (x / size) * o.n, (y / size) * o.n);
          norm += amp;
          amp *= 0.5;
        }
        data[(y * size + x) * 4 + c] = Math.round((v / norm) * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createMaskTexture(masks, res) {
  const data = new Uint8Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = masks.road[i];
    data[i * 4 + 1] = masks.ground[i];
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function createHeightTexture(hm) {
  const t = new THREE.DataTexture(hm.heights, hm.res, hm.res, THREE.RedFormat, THREE.FloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function buildChunkGeometry(hm, ci, cj) {
  const n = CHUNK_CELLS + 1;
  const pos = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  const nrm = { x: 0, y: 1, z: 0 };
  let k = 0;
  for (let j = 0; j < n; j++) {
    const gj = cj * CHUNK_CELLS + j;
    for (let i = 0; i < n; i++) {
      const gi = ci * CHUNK_CELLS + i;
      const x = hm.xOf(gi);
      const z = hm.xOf(gj);
      pos[k] = x;
      pos[k + 1] = hm.get(gi, gj);
      pos[k + 2] = z;
      hm.getNormal(x, z, nrm);
      nor[k] = nrm.x;
      nor[k + 1] = nrm.y;
      nor[k + 2] = nrm.z;
      k += 3;
    }
  }
  const idx = new Uint32Array(CHUNK_CELLS * CHUNK_CELLS * 6);
  k = 0;
  for (let j = 0; j < CHUNK_CELLS; j++) {
    for (let i = 0; i < CHUNK_CELLS; i++) {
      const a = j * n + i;
      const b = (j + 1) * n + i;
      const c = (j + 1) * n + i + 1;
      const d = j * n + i + 1;
      // same diagonal as Heightmap.getHeight
      idx[k++] = a;
      idx[k++] = b;
      idx[k++] = d;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const TERRAIN_PARS = /* glsl */ `
  uniform highp sampler2DArray tAlbedoArr;
  uniform highp sampler2DArray tNormalArr;
  uniform highp sampler2DArray tArmArr;
  uniform sampler2D tMask;
  uniform sampler2D tNoise;
  uniform float uHalf;
  varying vec3 vTerrainPos;
  varying vec3 vTerrainNormal;

  vec3 gTerrainNormal;
  float gTerrainRough;
  float gTerrainAO;
  float gFar; // 0 near .. 1 far: fades texture detail to avoid distant tiling stripes

  // Planar XZ sample of one layer at two scales, blended by distance.
  void sampleXZ(float layer, vec2 wp, float fNear, float s1, float s2, out vec3 alb, out vec3 nts, out vec3 arm) {
    alb = vec3(0.0); nts = vec3(0.0); arm = vec3(0.0);
    if (fNear > 0.001) {
      vec3 uvw = vec3(wp * s1, layer);
      alb += texture(tAlbedoArr, uvw).rgb * fNear;
      nts += (texture(tNormalArr, uvw).xyz * 2.0 - 1.0) * fNear;
      arm += texture(tArmArr, uvw).rgb * fNear;
    }
    if (fNear < 0.999) {
      vec3 uvw = vec3(wp * s2, layer);
      float f = 1.0 - fNear;
      vec3 a = texture(tAlbedoArr, uvw).rgb;
      if (gFar > 0.0) a = mix(a, textureLod(tAlbedoArr, uvw, 5.0).rgb, gFar);
      alb += a * f;
      nts += (texture(tNormalArr, uvw).xyz * 2.0 - 1.0) * f * 0.7 * (1.0 - gFar * 0.7);
      arm += texture(tArmArr, uvw).rgb * f;
    }
  }

  // Triplanar rock (Whiteout blend) to avoid stretching on cliffs.
  void sampleTriplanar(float layer, vec3 p, vec3 N, float scale, out vec3 alb, out vec3 nw, out vec3 arm) {
    vec3 bw = pow(abs(N), vec3(4.0));
    bw /= (bw.x + bw.y + bw.z);
    vec3 axisSign = sign(N);
    vec2 uvX = p.zy * scale; uvX.x *= axisSign.x;
    vec2 uvY = p.xz * scale; uvY.x *= axisSign.y;
    vec2 uvZ = p.xy * scale; uvZ.x *= -axisSign.z;
    vec3 tX = texture(tNormalArr, vec3(uvX, layer)).xyz * 2.0 - 1.0;
    vec3 tY = texture(tNormalArr, vec3(uvY, layer)).xyz * 2.0 - 1.0;
    vec3 tZ = texture(tNormalArr, vec3(uvZ, layer)).xyz * 2.0 - 1.0;
    tX.x *= axisSign.x; tY.x *= axisSign.y; tZ.x *= -axisSign.z;
    tX = vec3(tX.xy + N.zy, abs(tX.z) * N.x);
    tY = vec3(tY.xy + N.xz, abs(tY.z) * N.y);
    tZ = vec3(tZ.xy + N.xy, abs(tZ.z) * N.z);
    nw = normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z);
    alb = texture(tAlbedoArr, vec3(uvX, layer)).rgb * bw.x + texture(tAlbedoArr, vec3(uvY, layer)).rgb * bw.y
        + texture(tAlbedoArr, vec3(uvZ, layer)).rgb * bw.z;
    arm = texture(tArmArr, vec3(uvX, layer)).rgb * bw.x + texture(tArmArr, vec3(uvY, layer)).rgb * bw.y
        + texture(tArmArr, vec3(uvZ, layer)).rgb * bw.z;
  }
`;

const TERRAIN_MAP = /* glsl */ `
  {
    vec3 P = vTerrainPos;
    vec3 N = normalize(vTerrainNormal);
    float dist = length(P - cameraPosition);
    float fNear = 1.0 - smoothstep(12.0, 60.0, dist);
    gFar = smoothstep(90.0, 420.0, dist);
    float slope = 1.0 - N.y;
    vec4 nzLow = texture2D(tNoise, P.xz * 0.0021);
    vec4 nzMid = texture2D(tNoise, P.xz * 0.019);
    vec2 mask = texture2D(tMask, (P.xz + uHalf) / (2.0 * uHalf)).rg;

    float wRock = smoothstep(0.24, 0.36, slope + (nzMid.r - 0.5) * 0.1);
    float wSand = 1.0 - smoothstep(1.7, 3.3, P.y + (nzMid.g - 0.5) * 1.8);
    float wDirt = clamp(mask.g * 1.3 + smoothstep(0.68, 0.84, nzLow.b + (nzMid.a - 0.5) * 0.2) * 0.8, 0.0, 1.0);
    float wRoad = mask.r;

    vec3 alb, nts, arm, a2, n2, r2;
    // grass base (always sampled)
    sampleXZ(0.0, P.xz, fNear, 0.33, 0.071, alb, nts, arm);
    vec3 grassTint = mix(vec3(0.62, 0.92, 0.36), vec3(0.86, 0.9, 0.44), nzLow.r);
    grassTint = mix(grassTint, vec3(0.5, 0.8, 0.34), smoothstep(0.55, 0.8, nzLow.g) * 0.6);
    alb *= grassTint;
    vec3 nw = normalize(vec3(nts.x + N.x, nts.z * N.y, nts.y + N.z));

    if (wDirt > 0.01) {
      sampleXZ(1.0, P.xz, fNear, 0.3, 0.07, a2, n2, r2);
      float h = r2.r; // use AO as a height proxy for crisper edges
      float w = smoothstep(0.0, 1.0, clamp(wDirt * 1.6 - 0.3 + (h - 0.5) * 0.6, 0.0, 1.0));
      alb = mix(alb, a2 * vec3(0.95, 0.92, 0.88), w);
      nw = normalize(mix(nw, vec3(n2.x + N.x, n2.z * N.y, n2.y + N.z), w));
      arm = mix(arm, r2, w);
    }
    if (wSand > 0.01) {
      sampleXZ(3.0, P.xz, fNear, 0.28, 0.06, a2, n2, r2);
      float wet = 1.0 - smoothstep(-0.2, 0.9, P.y);
      a2 *= mix(1.0, 0.62, wet);
      alb = mix(alb, a2, wSand);
      nw = normalize(mix(nw, vec3(n2.x + N.x, n2.z * N.y, n2.y + N.z), wSand));
      arm = mix(arm, vec3(r2.r, mix(r2.g, 0.35, wet), r2.b), wSand);
    }
    if (wRock > 0.01) {
      vec3 rn;
      sampleTriplanar(2.0, P, N, 0.09, a2, rn, r2);
      a2 *= vec3(0.92, 0.9, 0.86);
      alb = mix(alb, a2, wRock);
      nw = normalize(mix(nw, rn, wRock));
      arm = mix(arm, r2, wRock);
    }
    if (wRoad > 0.01) {
      sampleXZ(4.0, P.xz, fNear, 0.2, 0.05, a2, n2, r2);
      a2 *= mix(0.8, 1.05, nzMid.b);
      alb = mix(alb, a2, wRoad);
      nw = normalize(mix(nw, vec3(n2.x * 0.6 + N.x, n2.z * N.y, n2.y * 0.6 + N.z), wRoad));
      arm = mix(arm, r2, wRoad);
    }
    // underwater darkening
    alb *= mix(1.0, 0.55, smoothstep(0.0, -3.0, P.y));
    // macro brightness variation to break tiling
    alb *= mix(0.86, 1.1, nzLow.a);

    diffuseColor.rgb *= alb;
    gTerrainNormal = nw;
    gTerrainRough = clamp(arm.g * 1.05, 0.35, 1.0);
    gTerrainAO = mix(1.0, arm.r, 0.8);
  }
`;

export function createTerrain(data, assets, ctx) {
  const { hm, masks, maskRes } = data;
  const noiseTex = createNoiseTexture();
  const maskTex = createMaskTexture(masks, maskRes);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    tAlbedoArr: { value: assets.terrainArrays.albedo },
    tNormalArr: { value: assets.terrainArrays.normal },
    tArmArr: { value: assets.terrainArrays.arm },
    tMask: { value: maskTex },
    tNoise: { value: noiseTex },
    uHalf: { value: hm.half },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + TERRAIN_PARS)
      .replace("#include <map_fragment>", TERRAIN_MAP)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = gTerrainRough;")
      .replace(
        "#include <normal_fragment_maps>",
        "normal = normalize((viewMatrix * vec4(gTerrainNormal, 0.0)).xyz);",
      )
      .replace(
        "#include <aomap_fragment>",
        "reflectedLight.indirectDiffuse *= gTerrainAO;\nreflectedLight.indirectSpecular *= gTerrainAO;",
      );
  };
  mat.customProgramCacheKey = () => "terrain-v1";

  const group = new THREE.Group();
  group.name = "terrain";
  const chunks = (hm.res - 1) / CHUNK_CELLS;
  for (let cj = 0; cj < chunks; cj++) {
    for (let ci = 0; ci < chunks; ci++) {
      // skip chunks that are entirely deep ocean
      let maxH = -Infinity;
      for (let j = 0; j <= CHUNK_CELLS; j += 4) {
        for (let i = 0; i <= CHUNK_CELLS; i += 4) {
          maxH = Math.max(maxH, hm.get(ci * CHUNK_CELLS + i, cj * CHUNK_CELLS + j));
        }
      }
      if (maxH < -9) continue;
      const mesh = new THREE.Mesh(buildChunkGeometry(hm, ci, cj), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  ctx.scene.add(group);
  return { group, material: mat, noiseTex, maskTex };
}
