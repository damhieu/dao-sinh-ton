// Bullet holes: a ring buffer of small textured quads aligned to hit normals.
import * as THREE from "three";

const MAX = 160;

function holeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(10,8,6,1)");
  grad.addColorStop(0.22, "rgba(20,16,12,0.95)");
  grad.addColorStop(0.45, "rgba(60,50,40,0.5)");
  grad.addColorStop(1, "rgba(60,50,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // cracks
  g.strokeStyle = "rgba(20,16,12,0.6)";
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Decals {
  constructor(scene) {
    const mat = new THREE.MeshStandardMaterial({
      map: holeTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 1,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.next = 0;
  }

  add(x, y, z, nx, ny, nz, size = 0.12) {
    _n.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_z, _n);
    _r.setFromAxisAngle(_n, Math.random() * Math.PI * 2);
    _q.premultiply(_r);
    _m.compose(_p.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01), _q, _s.set(size, size, size));
    this.mesh.setMatrixAt(this.next, _m);
    this.next = (this.next + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? MAX : this.next);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
