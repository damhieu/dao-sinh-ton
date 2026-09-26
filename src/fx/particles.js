// Billboard particle system (instanced quads): dust, sparks, blood, smoke, splashes, debris.
import * as THREE from "three";

const PRESETS = {
  dust: {
    color: [0.55, 0.48, 0.38],
    alpha: 0.75,
    size: [0.25, 1.1],
    life: [0.6, 1.1],
    speed: [0.6, 2.2],
    spread: 0.8,
    grav: -0.4,
    drag: 2.5,
    add: false,
  },
  concrete: {
    color: [0.62, 0.6, 0.57],
    alpha: 0.8,
    size: [0.2, 0.9],
    life: [0.5, 0.9],
    speed: [1, 3],
    spread: 0.7,
    grav: 0.5,
    drag: 3,
    add: false,
  },
  wood: {
    color: [0.45, 0.32, 0.2],
    alpha: 0.9,
    size: [0.08, 0.14],
    life: [0.5, 0.9],
    speed: [2, 5],
    spread: 0.9,
    grav: 9,
    drag: 1,
    add: false,
  },
  blood: {
    color: [0.45, 0.02, 0.02],
    alpha: 0.85,
    size: [0.18, 0.6],
    life: [0.3, 0.6],
    speed: [0.5, 2.5],
    spread: 1,
    grav: 2,
    drag: 3,
    add: false,
  },
  water: {
    color: [0.8, 0.88, 0.92],
    alpha: 0.8,
    size: [0.15, 0.7],
    life: [0.4, 0.8],
    speed: [2, 5],
    spread: 0.35,
    grav: 12,
    drag: 0.5,
    add: false,
  },
  sparks: {
    color: [1.0, 0.75, 0.35],
    alpha: 1,
    size: [0.05, 0.02],
    life: [0.12, 0.3],
    speed: [3, 9],
    spread: 1,
    grav: 9,
    drag: 1,
    add: true,
    glow: 6,
  },
  flash: {
    color: [1.0, 0.7, 0.35],
    alpha: 1,
    size: [0.35, 0.15],
    life: [0.04, 0.06],
    speed: [0, 0.2],
    spread: 1,
    grav: 0,
    drag: 0,
    add: true,
    glow: 12,
  },
  smokeLight: {
    color: [0.6, 0.6, 0.6],
    alpha: 0.35,
    size: [0.2, 1.2],
    life: [0.6, 1.2],
    speed: [0.3, 0.8],
    spread: 0.5,
    grav: -0.6,
    drag: 1.5,
    add: false,
  },
  smoke: {
    color: [0.72, 0.72, 0.72],
    alpha: 0.6,
    size: [2.5, 6],
    life: [6, 9],
    speed: [0.3, 1.2],
    spread: 1,
    grav: -0.08,
    drag: 0.4,
    add: false,
  },
  smokeRed: {
    color: [0.8, 0.14, 0.1],
    alpha: 0.55,
    size: [1.2, 5],
    life: [4, 7],
    speed: [0.8, 1.6],
    spread: 0.25,
    grav: -1.8,
    drag: 0.3,
    add: false,
  },
  explosion: {
    color: [1.0, 0.55, 0.2],
    alpha: 1,
    size: [1.5, 4],
    life: [0.25, 0.45],
    speed: [2, 8],
    spread: 1,
    grav: -1,
    drag: 3,
    add: true,
    glow: 8,
  },
  blast: {
    color: [0.25, 0.22, 0.2],
    alpha: 0.8,
    size: [1.5, 7],
    life: [1.5, 3],
    speed: [2, 7],
    spread: 1,
    grav: -0.8,
    drag: 1.2,
    add: false,
  },
  shell: {
    color: [0.75, 0.58, 0.2],
    alpha: 1,
    size: [0.035, 0.035],
    life: [0.6, 0.9],
    speed: [1.5, 2.5],
    spread: 0.3,
    grav: 9.8,
    drag: 0.2,
    add: false,
  },
};

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec2 iSizeRot;
  varying vec2 vUv;
  varying vec4 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSizeRot.x;
    mvPosition.xy += p;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  uniform float uSoft;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float a = smoothstep(1.0, uSoft, r);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    #include <fog_fragment>
  }
`;

class Pool {
  constructor(scene, max, additive) {
    this.max = max;
    this.p = [];
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.attributes.position);
    g.setAttribute("uv", quad.attributes.uv);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.sr = new Float32Array(max * 2);
    g.setAttribute("iPos", new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute(
      "iColor",
      new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      "iSizeRot",
      new THREE.InstancedBufferAttribute(this.sr, 2).setUsage(THREE.DynamicDrawUsage),
    );
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uSoft: { value: additive ? 0.0 : 0.15 } },
      ]),
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: !additive,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 4;
    scene.add(this.mesh);
  }

  add(p) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push(p);
  }

  update(dt) {
    const P = this.p;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k;
      q.vy = q.vy * k - q.grav * dt;
      q.vz *= k;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.rot += q.spin * dt;
      const f = q.t / q.life;
      P[n++] = q;
      const o = (n - 1) * 3;
      this.pos[o] = q.x;
      this.pos[o + 1] = q.y;
      this.pos[o + 2] = q.z;
      const c = (n - 1) * 4;
      this.col[c] = q.r * q.glow;
      this.col[c + 1] = q.g * q.glow;
      this.col[c + 2] = q.b * q.glow;
      this.col[c + 3] = q.a * (1 - f) * Math.min(1, q.t * 20 + 0.3);
      this.sr[(n - 1) * 2] = q.s0 + (q.s1 - q.s0) * Math.sqrt(f);
      this.sr[(n - 1) * 2 + 1] = q.rot;
    }
    P.length = n;
    this.geo.instanceCount = n;
    if (n) {
      this.geo.attributes.iPos.needsUpdate = true;
      this.geo.attributes.iColor.needsUpdate = true;
      this.geo.attributes.iSizeRot.needsUpdate = true;
    }
  }
}

export class Particles {
  constructor(scene) {
    this.normal = new Pool(scene, 2500, false);
    this.add = new Pool(scene, 1200, true);
  }

  // Emit `count` particles of a preset at (x,y,z), biased along direction (nx,ny,nz)
  emit(type, x, y, z, nx = 0, ny = 1, nz = 0, count = 8, scale = 1) {
    const P = PRESETS[type];
    const pool = P.add ? this.add : this.normal;
    for (let i = 0; i < count; i++) {
      let dx = nx + (Math.random() * 2 - 1) * P.spread;
      let dy = ny + (Math.random() * 2 - 1) * P.spread;
      let dz = nz + (Math.random() * 2 - 1) * P.spread;
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = (P.speed[0] + Math.random() * (P.speed[1] - P.speed[0])) * scale;
      const shade = 0.85 + Math.random() * 0.3;
      pool.add({
        x,
        y,
        z,
        vx: (dx / l) * sp,
        vy: (dy / l) * sp,
        vz: (dz / l) * sp,
        t: 0,
        life: P.life[0] + Math.random() * (P.life[1] - P.life[0]),
        s0: P.size[0] * scale * (0.8 + Math.random() * 0.4),
        s1: P.size[1] * scale * (0.8 + Math.random() * 0.4),
        r: P.color[0] * shade,
        g: P.color[1] * shade,
        b: P.color[2] * shade,
        a: P.alpha,
        glow: P.glow ?? 1,
        grav: P.grav,
        drag: P.drag,
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 2,
      });
    }
  }

  update(dt) {
    this.normal.update(dt);
    this.add.update(dt);
  }
}
