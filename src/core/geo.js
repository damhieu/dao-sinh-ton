// Small helpers for building procedural meshes: vertex-colored primitives merged into one geometry.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const _c = new THREE.Color();

// Non-indexed, position+normal+color only (uniform attribute set so everything merges)
export function prep(geo, color = 0xffffff) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// Apply position / euler rotation (radians) / scale to a geometry in place
export function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, "XYZ");
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return place(prep(new THREE.BoxGeometry(w, h, d), color), x, y, z, rx, ry, rz);
}

export function rbox(w, h, d, radius, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  return place(prep(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, r)), color), x, y, z, rx, ry, rz);
}

// Cylinder along Y by default
export function cyl(rTop, rBottom, h, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
  return place(prep(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color), x, y, z, rx, ry, rz);
}

export function sphere(r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, wSeg = 12, hSeg = 9) {
  return place(prep(new THREE.SphereGeometry(r, wSeg, hSeg), color), x, y, z, 0, 0, 0, sx, sy, sz);
}

// Partial sphere (dome) — phi/theta as in THREE.SphereGeometry
export function dome(r, color, thetaLength = Math.PI / 2, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, thetaLength);
  return place(prep(g, color), x, y, z, 0, 0, 0, sx, sy, sz);
}

// Capsule spanning from the origin down to -len along -Y
export function limb(r, len, color) {
  const g = prep(new THREE.CapsuleGeometry(r, len, 4, 10), color);
  g.translate(0, -len / 2, 0);
  return g;
}
