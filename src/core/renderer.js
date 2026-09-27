// WebGL renderer with a lean custom pipeline:
//   scene (+ viewmodel) -> HDR multisampled target -> [bloom, ultra only] -> fused post pass
//   (screen effects + ACES tone mapping + sRGB) straight to the canvas.
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { QUALITY_PRESETS } from "../config.js";

const PostShader = {
  uniforms: {
    tScene: { value: null },
    uVignette: { value: 0.3 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.05 },
    uDamage: { value: 0 }, // 0..1 red edge flash
    uLowHealth: { value: 0 }, // 0..1 desaturation + pulse
    uZone: { value: 0 }, // 0..1 blue tint when outside the zone
    uScope: { value: 0 }, // 0 = off, else radius of the scope circle (fraction of screen height)
    uFlash: { value: 0 }, // explosion / stun flash
    uFade: { value: 0 }, // fade to black (0..1)
    uAspect: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    uniform float uVignette, uSaturation, uContrast, uDamage, uLowHealth, uZone, uScope, uFlash, uFade, uAspect, uTime;
    varying vec2 vUv;
    void main() {
      vec3 col = texture2D(tScene, vUv).rgb;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation * (1.0 - uLowHealth * 0.75));
      col = max((col - 0.18) * uContrast + 0.18, 0.0);
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(p);
      col = mix(col, col * vec3(0.55, 0.75, 1.35) + vec3(0.0, 0.02, 0.08), uZone * 0.7);
      float edge = smoothstep(0.35, 0.95, r);
      float pulse = 0.65 + 0.35 * sin(uTime * 6.0);
      col = mix(col, vec3(0.45, 0.0, 0.0), clamp(edge * (uDamage * 0.9 + uLowHealth * 0.55 * pulse), 0.0, 0.85));
      col *= 1.0 - uVignette * smoothstep(0.45, 1.05, r);
      col += uFlash;
      if (uScope > 0.0) col *= smoothstep(uScope, uScope - 0.012, r);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export function createRenderer(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 15000);
  camera.rotation.order = "YXZ";

  // Viewmodel (first-person weapon) is rendered after the scene with a cleared depth buffer.
  const vmScene = new THREE.Scene();
  const vmCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 20);
  vmScene.add(vmCamera);

  const postMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(PostShader.uniforms),
    vertexShader: PostShader.vertexShader,
    fragmentShader: PostShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  quad.frustumCulled = false;
  postScene.add(quad);

  const ctx = {
    renderer,
    scene,
    camera,
    vmScene,
    vmCamera,
    vmActive: false,
    preset: QUALITY_PRESETS[settings.quality] || QUALITY_PRESETS.high,
    presetName: settings.quality,
    dynamicScale: 1,
    dynamicRes: settings.dynamicRes,
    screenFx: postMat, // .uniforms.uDamage etc.
    sceneRT: null,
    bloom: null,
    frameStats: { calls: 0, triangles: 0 },
  };

  function basePixelRatio() {
    const p = ctx.preset;
    return p.scale >= 2 ? Math.min(devicePixelRatio, 2) : p.scale;
  }

  function buildTargets() {
    if (ctx.sceneRT) ctx.sceneRT.dispose();
    if (ctx.bloom) ctx.bloom.dispose();
    ctx.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: ctx.preset.msaa,
      depthBuffer: true,
    });
    ctx.bloom = ctx.preset.bloom ? new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.55, 1.6) : null;
    resize();
  }

  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    const pr = basePixelRatio() * ctx.dynamicScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    vmCamera.aspect = w / h;
    vmCamera.updateProjectionMatrix();
    const bw = Math.max(1, Math.floor(w * pr));
    const bh = Math.max(1, Math.floor(h * pr));
    if (ctx.sceneRT) ctx.sceneRT.setSize(bw, bh);
    if (ctx.bloom) ctx.bloom.setSize(Math.max(1, bw >> 1), Math.max(1, bh >> 1));
    postMat.uniforms.uAspect.value = w / h;
  }

  ctx.setQuality = (name) => {
    ctx.preset = QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
    ctx.presetName = name;
    ctx.dynamicScale = 1;
    buildTargets();
    if (ctx.onQualityChange) ctx.onQualityChange(ctx.preset);
  };

  ctx.resize = resize;

  // Dynamic resolution: nudge the render scale to hold ~60 FPS. Uses the median frame time of each
  // second (a single hitch does not count), can scale back up on a 60 Hz display, and waits a few
  // seconds after stepping down so the resolution does not pump up and down every second.
  let accT = 0;
  const frameTimes = [];
  let fastSeconds = 0;
  let hold = 0;
  ctx.updateDynamicRes = (dt) => {
    if (!ctx.dynamicRes) return;
    accT += dt;
    frameTimes.push(dt);
    if (accT < 1) return;
    accT = 0;
    frameTimes.sort((a, b) => a - b);
    const median = frameTimes[frameTimes.length >> 1];
    frameTimes.length = 0;
    hold = Math.max(0, hold - 1);
    let s = ctx.dynamicScale;
    if (median > 1 / 50) {
      s = Math.max(0.6, s - 0.08);
      fastSeconds = 0;
      hold = 5;
    } else if (median < 1 / 57) {
      if (++fastSeconds >= 3 && hold === 0 && s < 1) {
        s = Math.min(1, s + 0.04);
        fastSeconds = 0;
      }
    } else fastSeconds = 0;
    if (Math.abs(s - ctx.dynamicScale) > 0.001) {
      ctx.dynamicScale = s;
      resize();
    }
  };

  ctx.render = (time) => {
    postMat.uniforms.uTime.value = time;
    renderer.info.autoReset = false;
    renderer.info.reset();
    renderer.setRenderTarget(ctx.sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    if (ctx.vmActive) {
      renderer.clearDepth();
      renderer.render(vmScene, vmCamera);
    }
    if (ctx.bloom) ctx.bloom.render(renderer, null, ctx.sceneRT, 0.016, false);
    postMat.uniforms.tScene.value = ctx.sceneRT.texture;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
    ctx.frameStats.calls = renderer.info.render.calls;
    ctx.frameStats.triangles = renderer.info.render.triangles;
  };

  addEventListener("resize", resize);
  buildTargets();
  return ctx;
}
