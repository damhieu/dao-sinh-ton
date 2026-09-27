// The blue zone wall: a huge open cylinder with an animated energy-field shader.
import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uRadius;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vLocal;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float facing = abs(dot(V, normalize(vNormalW)));
    float fres = pow(1.0 - facing, 1.5);
    // vertical streaks drifting sideways (arc length in meters)
    float ang = atan(vLocal.z, vLocal.x);
    float u = ang * uRadius;
    float s1 = 0.5 + 0.5 * sin(u * 0.35 - uTime * 1.2);
    float s2 = 0.5 + 0.5 * sin(u * 0.9 + vWorld.y * 0.04 + uTime * 0.8);
    float cell = floor(u * 0.25);
    // slow per-cell shimmer with a random phase (a random value per half second made the wall twinkle)
    float flicker = (0.5 + 0.5 * sin(uTime * 0.9 + hash(cell) * 6.2831)) * 0.35;
    float streaks = s1 * 0.55 + s2 * 0.3 + flicker;
    float dist = length(cameraPosition - vWorld);
    float nearFade = smoothstep(1.0, 30.0, dist);
    float heightFade = 1.0 - smoothstep(150.0, 480.0, vWorld.y);
    float a = (0.1 + fres * 0.32 + streaks * 0.09) * heightFade * mix(0.5, 1.0, nearFade);
    gl_FragColor = vec4(uColor * (1.0 + streaks * 0.9), clamp(a, 0.0, 0.7));
  }
`;

export class ZoneWall {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0.18, 0.42, 1.0) },
      uRadius: { value: 1000 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const geo = new THREE.CylinderGeometry(1, 1, 600, 160, 1, true);
    geo.translate(0, 280, 0);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(time, zone) {
    if (!zone || zone.state === "idle") {
      this.mesh.visible = false;
      return;
    }
    const r = Math.max(0.5, zone.cur.r);
    this.mesh.visible = true;
    this.mesh.position.set(zone.cur.x, -40, zone.cur.z);
    this.mesh.scale.set(r, 1, r);
    this.uniforms.uTime.value = time;
    this.uniforms.uRadius.value = r;
  }
}
