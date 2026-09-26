// Ocean: PBR water with procedural waves, depth-based color/transparency and shoreline foam.
import * as THREE from "three";

const WATER_PARS = /* glsl */ `
  uniform float uTime;
  uniform sampler2D tHeight;
  uniform sampler2D tNoise;
  uniform float uHalf;
  varying vec3 vWaterPos;
  float gWaterDepth;
  float gFoam;

  // Sum of directional sine waves -> height derivatives (dh/dx, dh/dz)
  vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    const int N = 7;
    vec2 dirs[7] = vec2[7](vec2(0.82, 0.57), vec2(-0.43, 0.9), vec2(0.99, -0.12), vec2(-0.71, -0.7),
                           vec2(0.29, 0.96), vec2(-0.93, 0.36), vec2(0.6, -0.8));
    float lens[7] = float[7](38.0, 23.0, 14.0, 9.0, 5.5, 3.3, 2.1);
    for (int i = 0; i < N; i++) {
      float k = 6.2831853 / lens[i];
      float w = sqrt(9.81 * k);
      float a = 0.0045 * lens[i] / (1.0 + float(i) * 0.35);
      float ph = dot(dirs[i], p) * k - w * t;
      g += dirs[i] * (a * k * cos(ph));
    }
    return g;
  }
`;

const WATER_MAP = /* glsl */ `
  {
    vec3 P = vWaterPos;
    vec2 huv = (P.xz + uHalf) / (2.0 * uHalf);
    float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
    float terrainH = mix(-18.0, texture2D(tHeight, huv).r, inside);
    gWaterDepth = max(0.0, -terrainH);
    vec3 shallow = vec3(0.07, 0.36, 0.36);
    vec3 deep = vec3(0.006, 0.05, 0.1);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 9.0, gWaterDepth));
    float n = texture2D(tNoise, P.xz * 0.05 + vec2(uTime * 0.01, 0.0)).r;
    float n2 = texture2D(tNoise, P.xz * 0.11 - vec2(0.0, uTime * 0.015)).g;
    float shore = 1.0 - smoothstep(0.0, 0.9, gWaterDepth);
    float band = sin(gWaterDepth * 9.0 - uTime * 1.6 + n * 6.0) * 0.5 + 0.5;
    gFoam = clamp(shore * (0.55 + band * 0.45) * smoothstep(0.35, 0.65, n2 + shore * 0.3), 0.0, 1.0);
    col = mix(col, vec3(0.85, 0.9, 0.9), gFoam * 0.85);
    diffuseColor.rgb = col;
    diffuseColor.a = clamp(mix(0.4, 0.97, smoothstep(0.0, 4.5, gWaterDepth)) + gFoam * 0.4, 0.0, 1.0);
  }
`;

const WATER_NORMAL = /* glsl */ `
  {
    float dist = length(vWaterPos - cameraPosition);
    float fade = 1.0 - smoothstep(150.0, 1400.0, dist);
    vec2 g = waveGrad(vWaterPos.xz, uTime) * mix(0.25, 1.0, fade);
    vec2 d1 = texture2D(tNoise, vWaterPos.xz * 0.21 + vec2(uTime * 0.03, uTime * 0.02)).rg - 0.5;
    vec2 d2 = texture2D(tNoise, vWaterPos.xz * 0.47 - vec2(uTime * 0.04, -uTime * 0.025)).ba - 0.5;
    g += (d1 * 0.22 + d2 * 0.12) * fade;
    vec3 nw = normalize(vec3(-g.x, 1.0, -g.y));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
`;

export function createWater(data, noiseTex, heightTex, ctx) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.045,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
  });
  const uniforms = {
    uTime: { value: 0 },
    tHeight: { value: heightTex },
    tNoise: { value: noiseTex },
    uHalf: { value: data.hm.half },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + WATER_PARS)
      .replace("#include <map_fragment>", WATER_MAP)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix(roughness, 0.6, gFoam);")
      .replace("#include <normal_fragment_maps>", WATER_NORMAL);
  };
  mat.customProgramCacheKey = () => "water-v1";

  const geo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);

  return {
    mesh,
    update(t) {
      uniforms.uTime.value = t;
    },
  };
}
