// Trees (pine + broadleaf), bushes and boulders: instanced, distance LOD, wind, collision.
import * as THREE from "three";
import { RNG } from "../core/rng.js";
import { createNoise2D, fbm2 } from "../core/noise.js";
import { F_ALL, F_BULLET, MAT } from "./collision.js";
import { plotBounds } from "./layout.js";
import { needleTexture, needleBulkTexture, leafTexture, bushTexture, FOLIAGE_NORMAL_BEGIN } from "./foliage.js";

// ---------------------------------------------------------------- geometry assembly

class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.i = [];
    this.v = 0;
  }
  // quad with per-vertex normals derived from a center point (volumetric shading)
  quad(a, b, c, d, center, shade, uv = [0, 0, 1, 0, 1, 1, 0, 1], upBias = 0.35) {
    for (const [k, p] of [a, b, c, d].entries()) {
      this.p.push(p[0], p[1], p[2]);
      let nx = p[0] - center[0];
      let ny = p[1] - center[1] + upBias;
      let nz = p[2] - center[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      this.n.push(nx / l, ny / l, nz / l);
      this.uv.push(uv[k * 2], uv[k * 2 + 1]);
      const s = shade[k] ?? shade;
      this.c.push(s, s, s);
    }
    const v = this.v;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  addGeometry(g, shade = 1) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const base = this.v;
    for (let k = 0; k < pos.count; k++) {
      this.p.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      this.n.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      this.uv.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
      this.c.push(shade, shade, shade);
    }
    const idx = g.index;
    if (idx) for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    this.v += pos.count;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

function trunkGeometry(h, r0, r1, seg = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3, true);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.6, uv.getY(k) * (h / 1.6));
  return g;
}

// Pine: `tiers` whorls of drooping branch cards around the trunk
function pineCrown(tiers, cards, seed) {
  const r = new RNG(seed);
  const g = new Geo();
  const y0 = 2.6;
  const y1 = 11.6;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = y0 + (y1 - y0) * f;
    const rad = 2.5 * Math.pow(1 - f, 0.85) + 0.35;
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2 + t * 2.4 + r.range(-0.2, 0.2);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const len = rad * r.range(0.85, 1.1);
      const droop = len * r.range(0.25, 0.45);
      const w = len * 1.15;
      const sx = -dz * w * 0.5;
      const sz = dx * w * 0.5;
      const roll = r.range(-0.25, 0.25);
      const base = [dx * 0.1, y + 0.15, dz * 0.1];
      const tip = [dx * len, y - droop, dz * len];
      const ry = roll * w;
      const center = [0, y - 0.8, 0];
      g.quad(
        [base[0] - sx * 0.3, base[1] - ry * 0.3, base[2] - sz * 0.3],
        [base[0] + sx * 0.3, base[1] + ry * 0.3, base[2] + sz * 0.3],
        [tip[0] + sx, tip[1] + ry, tip[2] + sz],
        [tip[0] - sx, tip[1] - ry, tip[2] - sz],
        center,
        [0.55, 0.55, 1, 1],
        [0.3, 0, 0.7, 0, 1, 1, 0, 1],
      );
    }
  }
  // spire
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI * 0.5;
    const sx = Math.cos(a) * 0.45;
    const sz = Math.sin(a) * 0.45;
    g.quad(
      [-sx, y1 - 0.4, -sz],
      [sx, y1 - 0.4, sz],
      [sx * 0.2, y1 + 1.3, sz * 0.2],
      [-sx * 0.2, y1 + 1.3, -sz * 0.2],
      [0, y1, 0],
      1,
    );
  }
  return g.build();
}

// Stacked jagged cones: dense pine silhouette (inner volume for near LOD, whole crown for mid LOD)
function pineCones(tiers, radiusScale, shadeTop, seed) {
  const r = new RNG(seed);
  const g = new Geo();
  const y0 = 2.4;
  const y1 = 12.4;
  const seg = 10;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const yb = y0 + (y1 - y0) * f * 0.92;
    const yt = Math.min(y1 + 0.6, yb + (y1 - y0) / tiers * 1.9);
    const rad = (2.7 * Math.pow(1 - f, 0.85) + 0.3) * radiusScale;
    const center = [0, (yb + yt) / 2 - 1.5, 0];
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2 + t * 0.7;
      const rr = rad * (k % 2 === 0 ? 1 : 0.72) * r.range(0.9, 1.08);
      ring.push([Math.cos(a) * rr, yb - rad * 0.28, Math.sin(a) * rr]);
    }
    for (let k = 0; k < seg; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % seg];
      // triangle fan to the tip as degenerate quads (tip duplicated)
      g.quad(b, a, [0, yt, 0], [0, yt, 0], center, [0.42, 0.42, shadeTop, shadeTop], [0, 0, 1, 0, 0.5, 1, 0.5, 1], 0.6);
    }
  }
  return g.build();
}

// Broadleaf: clusters of randomly oriented leaf cards
function broadCrown(cardsPerCluster, seed) {
  const r = new RNG(seed);
  const g = new Geo();
  const clusters = [
    [0, 7.4, 0, 2.6],
    [1.6, 6.3, 0.6, 2.0],
    [-1.4, 6.5, -0.9, 2.1],
    [0.4, 8.9, -0.5, 1.9],
    [-0.6, 5.8, 1.4, 1.7],
  ];
  const crownCenter = [0, 7, 0];
  for (const [cx, cy, cz, R] of clusters) {
    for (let k = 0; k < cardsPerCluster; k++) {
      const u = r.range(-1, 1);
      const th = r.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      const n = [s * Math.cos(th), u, s * Math.sin(th)];
      const rr = R * Math.cbrt(r.next()) * 0.55;
      const p = [cx + n[0] * rr, cy + n[1] * rr * 0.8, cz + n[2] * rr];
      // card basis
      const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const t1 = [n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]];
      const tl = Math.hypot(...t1);
      const a = [t1[0] / tl, t1[1] / tl, t1[2] / tl];
      const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
      const h = R * r.range(0.75, 1.05);
      const corner = (sa, sb) => [
        p[0] + a[0] * sa * h + b[0] * sb * h,
        p[1] + a[1] * sa * h + b[1] * sb * h,
        p[2] + a[2] * sa * h + b[2] * sb * h,
      ];
      const inner = rr / R;
      const shade = 0.55 + 0.45 * inner;
      g.quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), crownCenter, shade, undefined, 0.8);
    }
  }
  return g.build();
}

function bushGeometry(seed, round) {
  const r = new RNG(seed);
  const g = new Geo();
  const n = round ? 9 : 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI + r.range(-0.2, 0.2);
    const w = r.range(0.8, 1.2);
    const h = round ? w : r.range(0.9, 1.3);
    const dx = Math.cos(a) * w;
    const dz = Math.sin(a) * w;
    const tilt = r.range(-0.3, 0.3);
    const y0 = round ? 0.05 : 0;
    g.quad(
      [-dx, y0, -dz],
      [dx, y0, dz],
      [dx + tilt, y0 + h * 1.4, dz],
      [-dx + tilt, y0 + h * 1.4, -dz],
      [0, -0.3, 0],
      [0.6, 0.6, 1, 1],
      undefined,
      0.6,
    );
  }
  if (round) {
    const g2 = new Geo();
    return g.build();
  }
  return g.build();
}

function rockGeometry(seed) {
  const r = new RNG(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const noise = createNoise2D(seed);
  const sx = r.range(0.9, 1.4);
  const sy = r.range(0.45, 0.8);
  const sz = r.range(0.8, 1.2);
  for (let k = 0; k < pos.count; k++) {
    let x = pos.getX(k);
    let y = pos.getY(k);
    let z = pos.getZ(k);
    const d = 1 + noise(x * 1.7 + y, z * 1.7 - y) * 0.22 + noise(x * 4 + 7, z * 4 + y * 3) * 0.06;
    x *= d * sx;
    y *= d * sy;
    z *= d * sz;
    if (y < -0.2) y = -0.2 + (y + 0.2) * 0.3; // flattened base
    pos.setXYZ(k, x, y, z);
  }
  g.computeVertexNormals();
  // box-projected UVs
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let k = 0; k < pos.count; k++) {
    const ax = Math.abs(nor.getX(k));
    const ay = Math.abs(nor.getY(k));
    const az = Math.abs(nor.getZ(k));
    const x = pos.getX(k) * 0.5;
    const y = pos.getY(k) * 0.5;
    const z = pos.getZ(k) * 0.5;
    if (ay >= ax && ay >= az) uv.setXY(k, x, z);
    else if (ax >= az) uv.setXY(k, z, y);
    else uv.setXY(k, x, y);
  }
  return { geo: g, sx, sy, sz };
}

// ---------------------------------------------------------------- materials

function windify(mat, uniforms, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          float h = max(0.0, position.y - 1.0);
          float ph = ip.x * 0.071 + ip.z * 0.053;
          float w = sin(uTime * 1.4 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7 + position.x) * 0.25;
          transformed.x += w * h * ${strength.toFixed(4)};
          transformed.z += cos(uTime * 1.1 + ph) * h * ${(strength * 0.6).toFixed(4)};
        }`,
      );
  };
}

// ---------------------------------------------------------------- vegetation system

const LOD_NEAR = 110;
const LOD_MID = 480;

export function createVegetation(data, collision, assets, ctx, quality) {
  const { hm, masks, maskRes, plots, towns } = data;
  const rng = new RNG(data.seed ^ 0x51ed);
  const nForest = createNoise2D(data.seed + 101);
  const nSpecies = createNoise2D(data.seed + 102);
  const nBush = createNoise2D(data.seed + 103);
  const texel = hm.size / maskRes;
  const maskAt = (arr, x, z) => {
    const i = Math.min(maskRes - 1, Math.max(0, Math.floor((x + hm.half) / texel)));
    const j = Math.min(maskRes - 1, Math.max(0, Math.floor((z + hm.half) / texel)));
    return arr[j * maskRes + i] / 255;
  };
  // building exclusion grid (4 m)
  const exGrid = new Uint8Array(512 * 512);
  for (const p of plots) {
    const b = plotBounds(p, 4);
    for (let x = b.minX; x <= b.maxX; x += 2) {
      for (let z = b.minZ; z <= b.maxZ; z += 2) {
        const i = Math.floor((x + hm.half) / 4);
        const j = Math.floor((z + hm.half) / 4);
        if (i >= 0 && j >= 0 && i < 512 && j < 512) exGrid[j * 512 + i] = 1;
      }
    }
  }
  const excluded = (x, z) =>
    exGrid[Math.floor((z + hm.half) / 4) * 512 + Math.floor((x + hm.half) / 4)] === 1;
  const townFactor = (x, z) => {
    let f = 1;
    for (const t of towns) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < t.radius) f = Math.min(f, 0.12 + 0.88 * Math.pow(d / t.radius, 3));
    }
    return f;
  };

  const trees = { pine: [], broad: [] };
  const bushes = [];
  const rocks = [];
  const CELL = 7;
  for (let z = -hm.half + CELL; z < hm.half - CELL; z += CELL) {
    for (let x = -hm.half + CELL; x < hm.half - CELL; x += CELL) {
      const px = x + rng.range(-CELL * 0.45, CELL * 0.45);
      const pz = z + rng.range(-CELL * 0.45, CELL * 0.45);
      const h = hm.getHeight(px, pz);
      if (h < 2.6) continue;
      if (maskAt(masks.road, px, pz) > 0.02 || excluded(px, pz)) continue;
      const slope = hm.slopeAt(px, pz);
      const forest = Math.max(0, Math.min(1, (fbm2(nForest, px * 0.0042, pz * 0.0042, 4) - 0.02) * 2.4));
      let p = 0.016 + Math.pow(forest, 1.5) * 0.62;
      p *= townFactor(px, pz);
      if (slope > 0.4) p *= 0.3;
      if (maskAt(masks.ground, px, pz) > 0.3) p *= 0.3;
      if (rng.next() < p) {
        const pine = h > 30 || fbm2(nSpecies, px * 0.006, pz * 0.006, 2) > 0.05;
        const s = rng.range(0.75, 1.25);
        trees[pine ? "pine" : "broad"].push({ x: px, y: h - 0.15, z: pz, s, rot: rng.range(0, Math.PI * 2) });
        collision.addCylinder(
          px,
          pz,
          (pine ? 0.24 : 0.3) * s,
          h - 1,
          h + (pine ? 9 : 5.5) * s,
          F_ALL,
          MAT.wood,
        );
        continue;
      }
      // bushes
      const bp =
        (0.04 + forest * 0.25 + Math.max(0, nBush(px * 0.02, pz * 0.02)) * 0.15) * townFactor(px, pz);
      if (rng.next() < bp && slope < 0.5) {
        bushes.push({
          x: px,
          y: h,
          z: pz,
          s: rng.range(0.7, 1.3),
          rot: rng.range(0, Math.PI * 2),
          round: rng.chance(0.5),
        });
        continue;
      }
      // boulders: more on slopes
      const rp = 0.004 + Math.max(0, slope - 0.15) * 0.08;
      if (rng.next() < rp) {
        const s = rng.range(0.6, 2.6);
        rocks.push({ x: px, y: h - 0.2 * s, z: pz, s, rot: rng.range(0, Math.PI * 2), v: rng.int(0, 3) });
      }
    }
  }

  // ---- materials & meshes
  const uniforms = { uTime: { value: 0 } };
  const alpha2c = quality.msaa > 0;
  const barkTex = assets.tex.bark;
  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTex.map,
    normalMap: barkTex.normalMap,
    roughnessMap: barkTex.armMap,
    roughness: 1,
    color: 0xb8a898,
  });
  windify(barkMat, uniforms, 0.004);
  const leafMat = (map, color) => {
    const m = new THREE.MeshStandardMaterial({
      map,
      color,
      vertexColors: true,
      alphaTest: 0.45,
      alphaToCoverage: alpha2c,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
    });
    windify(m, uniforms, 0.012);
    const wind = m.onBeforeCompile;
    m.onBeforeCompile = (shader) => {
      wind(shader);
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", FOLIAGE_NORMAL_BEGIN);
    };
    return m;
  };
  const needleMat = leafMat(needleTexture(), 0xb8c8a0);
  const broadMat = leafMat(leafTexture(256, 0), 0xc8d0a0);
  const bushMat = leafMat(bushTexture(), 0xb0c090);
  const bushMat2 = leafMat(leafTexture(256, 1), 0xb8c090);
  const farMat = new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 1, flatShading: false });
  // solid needle cones: inner core of near pines and the whole crown of mid-distance pines
  const pineConeMat = new THREE.MeshStandardMaterial({
    map: needleBulkTexture(),
    color: 0xd0dcc0,
    vertexColors: true,
    roughness: 1,
  });
  windify(pineConeMat, uniforms, 0.012);
  const farBroadMat = new THREE.MeshStandardMaterial({ color: 0x3c5a26, roughness: 1 });
  const boulder = assets.tex.boulder;
  const rockMat = new THREE.MeshStandardMaterial({
    map: boulder.map,
    normalMap: boulder.normalMap,
    roughnessMap: boulder.armMap,
    aoMap: boulder.armMap,
    roughness: 1,
    color: 0xc8c4bc,
  });

  const pineTrunk = trunkGeometry(11.2, 0.3, 0.06);
  const broadTrunk = (() => {
    const g = new Geo();
    g.addGeometry(trunkGeometry(6.5, 0.34, 0.16, 8));
    const b1 = trunkGeometry(3.2, 0.14, 0.06, 5);
    b1.rotateZ(-0.7).translate(0.3, 4.2, 0);
    g.addGeometry(b1);
    const b2 = trunkGeometry(3, 0.13, 0.06, 5);
    b2.rotateZ(0.8).rotateY(1.9).translate(-0.2, 4.6, -0.2);
    g.addGeometry(b2);
    return g.build();
  })();
  const pineFar = (() => {
    const g = new THREE.ConeGeometry(2.6, 10.5, 7, 1);
    g.translate(0, 7.3, 0);
    return g;
  })();
  const broadFar = (() => {
    const g = new THREE.IcosahedronGeometry(3.2, 1);
    g.scale(1, 0.85, 1);
    g.translate(0, 7.2, 0);
    return g;
  })();
  const trunkFar = trunkGeometry(3, 0.3, 0.2, 5);

  const layers = [];
  const addLayer = (list, geo, mat, lod, shadow, near = 0, far = Infinity) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.count = 0;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    ctx.scene.add(mesh);
    layers.push({ list, mesh, near, far });
    return mesh;
  };
  const view = quality.view;
  addLayer(trees.pine, pineTrunk, barkMat, 0, true, 0, LOD_MID);
  addLayer(trees.pine, pineCrown(10, 7, 1), needleMat, 0, true, 0, LOD_NEAR);
  addLayer(trees.pine, pineCones(4, 0.49, 0.6, 7), pineConeMat, 0, false, 0, LOD_NEAR);
  addLayer(trees.pine, pineCones(4, 1.0, 1.0, 8), pineConeMat, 1, false, LOD_NEAR, LOD_MID);
  addLayer(trees.pine, pineFar, farMat, 2, false, LOD_MID, view);
  addLayer(trees.pine, trunkFar, barkMat, 2, false, LOD_MID, view * 0.6);
  addLayer(trees.broad, broadTrunk, barkMat, 0, true, 0, LOD_MID);
  addLayer(trees.broad, broadCrown(15, 3), broadMat, 0, true, 0, LOD_NEAR);
  addLayer(trees.broad, broadCrown(6, 4), broadMat, 1, false, LOD_NEAR, LOD_MID);
  addLayer(trees.broad, broadFar, farBroadMat, 2, false, LOD_MID, view);
  const bushA = bushes.filter((b) => !b.round);
  const bushB = bushes.filter((b) => b.round);
  addLayer(bushA, bushGeometry(5, false), bushMat, 0, false, 0, 220);
  addLayer(bushB, bushGeometry(6, true), bushMat2, 0, false, 0, 260);
  const rockVariants = [0, 1, 2, 3].map((v) => rockGeometry(900 + v));
  for (let v = 0; v < 4; v++) {
    const list = rocks.filter((r) => r.v === v);
    addLayer(list, rockVariants[v].geo, rockMat, 0, true, 0, view);
    for (const r of list) {
      const rv = rockVariants[v];
      const rad = Math.min(rv.sx, rv.sz) * r.s * 0.95;
      collision.addSphere(r.x, r.y + rv.sy * r.s * 0.2, r.z, Math.max(0.4, rad * 0.9), F_ALL, MAT.concrete);
    }
  }

  // per-instance matrices & colors, precomputed
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (const L of layers) {
    L.matrices = new Float32Array(L.list.length * 16);
    L.colors = new Float32Array(L.list.length * 3);
    L.list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot);
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s, it.s, it.s));
      m.toArray(L.matrices, i * 16);
      const v = 0.85 + (((i * 7919) % 100) / 100) * 0.3;
      col.setRGB(v, v * (0.95 + ((i * 104729) % 50) / 500), v * 0.92);
      col.toArray(L.colors, i * 3);
    });
    if (L.mesh.instanceColor === null)
      L.mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(Math.max(1, L.list.length) * 3),
        3,
      );
  }

  let timer = 0;
  function updateLod(camPos, force) {
    for (const L of layers) {
      const arr = L.mesh.instanceMatrix.array;
      const carr = L.mesh.instanceColor.array;
      let n = 0;
      const near2 = L.near * L.near;
      const far2 = L.far * L.far;
      for (let i = 0; i < L.list.length; i++) {
        const it = L.list[i];
        const dx = it.x - camPos.x;
        const dz = it.z - camPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < near2 || d2 >= far2) continue;
        arr.set(L.matrices.subarray(i * 16, i * 16 + 16), n * 16);
        carr[n * 3] = L.colors[i * 3];
        carr[n * 3 + 1] = L.colors[i * 3 + 1];
        carr[n * 3 + 2] = L.colors[i * 3 + 2];
        n++;
      }
      L.mesh.count = n;
      L.mesh.instanceMatrix.needsUpdate = true;
      L.mesh.instanceColor.needsUpdate = true;
    }
  }

  // bush lookup grid for perception (8 m cells)
  const bushGrid = new Map();
  for (const b of bushes) {
    const key = `${Math.floor(b.x / 8)},${Math.floor(b.z / 8)}`;
    if (!bushGrid.has(key)) bushGrid.set(key, []);
    bushGrid.get(key).push(b);
  }

  return {
    trees,
    bushes,
    rocks,
    counts: {
      pine: trees.pine.length,
      broad: trees.broad.length,
      bushes: bushes.length,
      rocks: rocks.length,
    },
    update(dt, time, camPos) {
      uniforms.uTime.value = time;
      timer -= dt;
      if (timer <= 0) {
        timer = 0.25;
        updateLod(camPos);
      }
    },
    forceUpdate(camPos) {
      updateLod(camPos, true);
    },
    // true if the point is inside a bush (for visibility checks)
    inBush(x, y, z) {
      const list = bushGrid.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
      if (!list) return false;
      for (const b of list) if (Math.hypot(b.x - x, b.z - z) < 1.1 * b.s && y - b.y < 1.5 * b.s) return true;
      return false;
    },
  };
}
