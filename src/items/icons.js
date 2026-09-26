// Renders item icons from their 3D models once at startup (data URLs for the UI).
import * as THREE from "three";
import { ITEMS } from "./itemdefs.js";
import { groundGeometry } from "./models.js";

export function renderIcons(renderer, size = 128) {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(1, 2, 1.5);
  scene.add(dir);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c2d = canvas.getContext("2d");
  const img = c2d.createImageData(size, size);
  const icons = {};
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  for (const id of Object.keys(ITEMS)) {
    const geo = groundGeometry(id);
    const mesh = new THREE.Mesh(geo, mat);
    const def = ITEMS[id];
    // weapons are shown side-on; everything else in a 3/4 view
    if (def.cat === "weapon") mesh.rotation.set(-Math.PI / 2, 0, 0);
    scene.add(mesh);
    mesh.updateMatrixWorld();
    box.setFromObject(mesh);
    box.getBoundingSphere(sphere);
    const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(15))) * 0.98;
    const dirV = def.cat === "weapon" ? new THREE.Vector3(0.001, 0.02, 1) : new THREE.Vector3(0.7, 0.75, 1);
    cam.position.copy(sphere.center).addScaledVector(dirV.normalize(), d);
    cam.lookAt(sphere.center);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    // flip vertically into the canvas
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      img.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
    }
    // convert linear -> sRGB for display
    for (let i = 0; i < img.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = img.data[i + c] / 255;
        img.data[i + c] = Math.round(
          255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055),
        );
      }
    }
    c2d.putImageData(img, 0, 0);
    icons[id] = canvas.toDataURL("image/png");
    scene.remove(mesh);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  rt.dispose();
  return icons;
}
