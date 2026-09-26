// Turns generated buildings into merged, chunked meshes (per texture) and registers colliders.
import * as THREE from "three";
import { generateBuilding } from "./buildinggen.js";
import { F_ALL, MAT } from "./collision.js";
import { RNG, hashInts } from "../core/rng.js";

// material key -> texture key (null = plain color)
const TEX_OF = {
  plaster: "plaster",
  plasterIn: "plaster",
  brick: "brick",
  concrete: "concrete",
  trim: "concrete",
  wood: "wood",
  crate: "wood",
  floorC: "floorConcrete",
  roof: "roof",
  metal: "metal",
  rust: "rust",
  fabric: null,
};
// meters per texture repeat
const UV_SCALE = {
  plaster: 2.4,
  brick: 1.7,
  concrete: 2.8,
  wood: 2.0,
  floorConcrete: 3.0,
  roof: 2.2,
  metal: 2.4,
  rust: 2.4,
  plain: 1,
};
const COL_MAT = {
  plaster: MAT.concrete,
  plasterIn: MAT.concrete,
  brick: MAT.concrete,
  concrete: MAT.concrete,
  trim: MAT.concrete,
  floorC: MAT.concrete,
  roof: MAT.concrete,
  wood: MAT.wood,
  crate: MAT.wood,
  fabric: MAT.wood,
  metal: MAT.metal,
  rust: MAT.metal,
};

const CHUNK = 256;

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.n = 0;
  }
  quad(p0, p1, p2, p3, n, uvs, c) {
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of uvs) this.uv.push(t[0], t[1]);
    for (let k = 0; k < 4; k++) this.col.push(c.r, c.g, c.b);
    const b = this.n;
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  tri(p0, p1, p2, n, uvs, c) {
    for (const p of [p0, p1, p2]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 3; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of uvs) this.uv.push(t[0], t[1]);
    for (let k = 0; k < 3; k++) this.col.push(c.r, c.g, c.b);
    const b = this.n;
    this.idx.push(b, b + 1, b + 2);
    this.n += 3;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(
      this.n > 65535
        ? new THREE.Uint32BufferAttribute(this.idx, 1)
        : new THREE.Uint16BufferAttribute(this.idx, 1),
    );
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _c = new THREE.Color();
function faceColor(bx, face) {
  const tint = bx.faceTint && bx.faceTint[face] !== undefined ? bx.faceTint[face] : bx.tint;
  const shade = bx.faceShade && bx.faceShade[face] !== undefined ? bx.faceShade[face] : bx.shade;
  _c.set(tint);
  _c.r *= shade;
  _c.g *= shade;
  _c.b *= shade;
  return _c;
}

// Emit the 6 faces of a box into per-texture builders
function emitBox(bx, getBuilder, groundY) {
  const [x0, y0, z0] = bx.min;
  const [x1, y1, z1] = bx.max;
  const faces = [
    ["px", [1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], "zy"],
    ["nx", [-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], "zy"],
    ["py", [0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], "xz"],
    ["ny", [0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], "xz"],
    ["pz", [0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], "xy"],
    ["nz", [0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], "xy"],
  ];
  for (const [label, n, a, b, c, d, plane] of faces) {
    if (label === "ny" && y0 <= groundY + 0.01) continue; // never visible
    const mat = (bx.faces && bx.faces[label]) || bx.mat;
    const texKey = TEX_OF[mat] ?? null;
    const s = UV_SCALE[texKey ?? "plain"];
    const uvOf = (p) =>
      plane === "zy" ? [p[2] / s, p[1] / s] : plane === "xz" ? [p[0] / s, p[2] / s] : [p[0] / s, p[1] / s];
    getBuilder(texKey).quad(a, b, c, d, n, [uvOf(a), uvOf(b), uvOf(c), uvOf(d)], faceColor(bx, label));
  }
}

function emitPrism(pr, getBuilder) {
  const gableBuilder = getBuilder(TEX_OF[pr.gableMat] ?? null);
  const gs = UV_SCALE[TEX_OF[pr.gableMat] ?? "plain"];
  const [x0, y0, z0] = pr.min;
  const [x1, y1, z1] = pr.max;
  _c.set(pr.tint);
  const roofCol = _c.clone();
  const roofTex = TEX_OF[pr.mat] ?? null;
  const s = UV_SCALE[roofTex ?? "plain"];
  const gable = new THREE.Color(pr.gableTint);
  const B = getBuilder(roofTex);
  if (!pr.alongZ) {
    // ridge along X at z = mid
    const zm = (z0 + z1) / 2;
    const slope = Math.hypot(zm - z0, y1 - y0);
    const n1 = new THREE.Vector3(0, zm - z0, -(y1 - y0)).normalize();
    const n2 = new THREE.Vector3(0, zm - z0, y1 - y0).normalize();
    B.quad(
      [x0, y0, z0],
      [x0, y1, zm],
      [x1, y1, zm],
      [x1, y0, z0],
      n1.toArray(),
      [
        [x0 / s, 0],
        [x0 / s, slope / s],
        [x1 / s, slope / s],
        [x1 / s, 0],
      ],
      roofCol,
    );
    B.quad(
      [x1, y0, z1],
      [x1, y1, zm],
      [x0, y1, zm],
      [x0, y0, z1],
      n2.toArray(),
      [
        [x1 / s, 0],
        [x1 / s, slope / s],
        [x0 / s, slope / s],
        [x0 / s, 0],
      ],
      roofCol,
    );
    gableBuilder.tri(
      [x0, y0, z1],
      [x0, y1, zm],
      [x0, y0, z0],
      [-1, 0, 0],
      [
        [z1 / gs, y0 / gs],
        [zm / gs, y1 / gs],
        [z0 / gs, y0 / gs],
      ],
      gable,
    );
    gableBuilder.tri(
      [x1, y0, z0],
      [x1, y1, zm],
      [x1, y0, z1],
      [1, 0, 0],
      [
        [z0 / gs, y0 / gs],
        [zm / gs, y1 / gs],
        [z1 / gs, y0 / gs],
      ],
      gable,
    );
  } else {
    const xm = (x0 + x1) / 2;
    const slope = Math.hypot(xm - x0, y1 - y0);
    const n1 = new THREE.Vector3(-(y1 - y0), xm - x0, 0).normalize();
    const n2 = new THREE.Vector3(y1 - y0, xm - x0, 0).normalize();
    B.quad(
      [x0, y0, z1],
      [xm, y1, z1],
      [xm, y1, z0],
      [x0, y0, z0],
      n1.toArray(),
      [
        [z1 / s, 0],
        [z1 / s, slope / s],
        [z0 / s, slope / s],
        [z0 / s, 0],
      ],
      roofCol,
    );
    B.quad(
      [x1, y0, z0],
      [xm, y1, z0],
      [xm, y1, z1],
      [x1, y0, z1],
      n2.toArray(),
      [
        [z0 / s, 0],
        [z0 / s, slope / s],
        [z1 / s, slope / s],
        [z1 / s, 0],
      ],
      roofCol,
    );
    gableBuilder.tri(
      [x0, y0, z0],
      [xm, y1, z0],
      [x1, y0, z0],
      [0, 0, -1],
      [
        [x0 / gs, y0 / gs],
        [xm / gs, y1 / gs],
        [x1 / gs, y0 / gs],
      ],
      gable,
    );
    gableBuilder.tri(
      [x1, y0, z1],
      [xm, y1, z1],
      [x0, y0, z1],
      [0, 0, 1],
      [
        [x1 / gs, y0 / gs],
        [xm / gs, y1 / gs],
        [x0 / gs, y0 / gs],
      ],
      gable,
    );
  }
}

function makeMaterial(texKey, assets) {
  if (!texKey) return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const t = assets.tex[texKey];
  const metal = texKey === "metal" || texKey === "rust";
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.armMap,
    metalnessMap: metal ? t.armMap : null,
    aoMap: t.armMap,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: metal ? 1 : 0,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  return m;
}

export function createBuildings(data, collision, assets, scene) {
  const buildings = [];
  const chunkBuilders = new Map(); // `${cx},${cz}` -> Map(texKey -> GeoBuilder)
  const getChunk = (x, z) => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let m = chunkBuilders.get(key);
    if (!m) chunkBuilders.set(key, (m = new Map()));
    return m;
  };
  data.plots.forEach((plot, i) => {
    const rng = new RNG(hashInts(data.seed, i + 1000));
    const b = generateBuilding(plot, rng);
    b.index = i;
    buildings.push(b);
    const cx = (b.bounds.min[0] + b.bounds.max[0]) / 2;
    const cz = (b.bounds.min[2] + b.bounds.max[2]) / 2;
    const chunk = getChunk(cx, cz);
    const getBuilder = (texKey) => {
      const k = texKey ?? "plain";
      let gb = chunk.get(k);
      if (!gb) chunk.set(k, (gb = new GeoBuilder()));
      return gb;
    };
    for (const bx of b.boxes) {
      emitBox(bx, getBuilder, plot.y);
      if (bx.solid)
        collision.addBox(
          bx.min[0],
          bx.min[1],
          bx.min[2],
          bx.max[0],
          bx.max[1],
          bx.max[2],
          F_ALL,
          COL_MAT[bx.mat] ?? MAT.concrete,
        );
    }
    for (const pr of b.prisms) {
      emitPrism(pr, getBuilder);
      // approximate the roof volume for bullets / camera with two stacked boxes
      const [x0, y0, z0] = pr.min;
      const [x1, y1, z1] = pr.max;
      const h = y1 - y0;
      const inset = 0.3;
      if (pr.alongZ) {
        const w = x1 - x0;
        collision.addBox(x0 + w * 0.1, y0, z0, x1 - w * 0.1, y0 + h * 0.55, z1, F_ALL, MAT.concrete);
        collision.addBox(
          x0 + w * 0.32,
          y0 + h * 0.55,
          z0,
          x1 - w * 0.32,
          y1 - inset,
          z1,
          F_ALL,
          MAT.concrete,
        );
      } else {
        const d = z1 - z0;
        collision.addBox(x0, y0, z0 + d * 0.1, x1, y0 + h * 0.55, z1 - d * 0.1, F_ALL, MAT.concrete);
        collision.addBox(
          x0,
          y0 + h * 0.55,
          z0 + d * 0.32,
          x1,
          y1 - inset,
          z1 - d * 0.32,
          F_ALL,
          MAT.concrete,
        );
      }
    }
  });

  const materials = new Map();
  const group = new THREE.Group();
  group.name = "buildings";
  let tris = 0;
  for (const chunk of chunkBuilders.values()) {
    for (const [texKey, gb] of chunk) {
      const key = texKey === "plain" ? null : texKey;
      if (!materials.has(texKey)) materials.set(texKey, makeMaterial(key, assets));
      const mesh = new THREE.Mesh(gb.build(), materials.get(texKey));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      tris += gb.idx.length / 3;
      group.add(mesh);
    }
  }
  scene.add(group);
  return { buildings, group, materials, tris };
}
