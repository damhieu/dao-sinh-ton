// Loads textures (Poly Haven CC0) and the HDRI sky; builds terrain texture arrays and the PMREM environment.
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

export const TEX_IDS = {
  grass: "leafy_grass",
  dirt: "forest_ground_04",
  rock: "aerial_rocks_02",
  sand: "coast_sand_01",
  asphalt: "asphalt_02",
  plaster: "painted_plaster_wall",
  brick: "red_brick_plaster_patch_02",
  concrete: "concrete_wall_003",
  wood: "wood_planks_dirt",
  floorConcrete: "concrete_floor_02",
  roof: "clay_roof_tiles_02",
  metal: "corrugated_iron_02",
  rust: "rusty_corrugated_iron",
  boulder: "rock_boulder_dry",
  bark: "pine_bark",
};

export const TERRAIN_LAYERS = ["grass", "dirt", "rock", "sand", "asphalt"];

const BASE = `${import.meta.env.BASE_URL}assets/`;
const ARRAY_SIZE = 1024;

async function fetchBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ${url} (${res.status})`);
  const blob = await res.blob();
  return createImageBitmap(blob, { imageOrientation: "flipY" });
}

function makeTexture(bitmap, srgb, anisotropy) {
  const t = new THREE.Texture(bitmap);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function bitmapPixels(bitmap, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function makeArray(layers, srgb, anisotropy) {
  const n = layers.length;
  const data = new Uint8Array(ARRAY_SIZE * ARRAY_SIZE * 4 * n);
  layers.forEach((px, i) => data.set(px, i * ARRAY_SIZE * ARRAY_SIZE * 4));
  const t = new THREE.DataArrayTexture(data, ARRAY_SIZE, ARRAY_SIZE, n);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Direction (three.js equirect convention) of the brightest pixel = the sun.
function findSunDirection(hdr) {
  const { data, width, height } = hdr.image;
  let best = -1;
  let bi = 0;
  for (let y = 0; y < height / 2; y++) {
    // HDR data row 0 is the top of the image (flipY applied at upload)
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const l = data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722;
      if (l > best) {
        best = l;
        bi = y * width + x;
      }
    }
  }
  const px = bi % width;
  const py = Math.floor(bi / width);
  const u = (px + 0.5) / width;
  const v = 1 - (py + 0.5) / height;
  const phi = (u - 0.5) * Math.PI * 2;
  const dy = Math.sin((v - 0.5) * Math.PI);
  const c = Math.sqrt(1 - dy * dy);
  return new THREE.Vector3(Math.cos(phi) * c, dy, Math.sin(phi) * c).normalize();
}

// Remove the sun disc from the environment (the directional light provides direct sun + shadows).
function clampSun(hdr, maxLum) {
  const { data } = hdr.image;
  for (let k = 0; k < data.length; k += 4) {
    const l = data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722;
    if (l > maxLum) {
      const f = maxLum / l;
      data[k] *= f;
      data[k + 1] *= f;
      data[k + 2] *= f;
    }
  }
}

// Replace the mirrored lower hemisphere of a "pure sky" HDRI with a dim ground bounce so
// downward-facing surfaces don't receive bright sky light.
function darkenLowerHemisphere(hdr) {
  const { data, width, height } = hdr.image;
  for (let y = 0; y < height; y++) {
    const v = 1 - (y + 0.5) / height; // 1 = zenith
    const elev = (v - 0.5) * Math.PI;
    if (elev >= 0) continue;
    const t = Math.min(1, -elev / 0.12); // fade over ~7 degrees below the horizon
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      data[k] = data[k] * (1 - t) + 0.16 * t;
      data[k + 1] = data[k + 1] * (1 - t) + 0.17 * t;
      data[k + 2] = data[k + 2] * (1 - t) + 0.12 * t;
    }
  }
  hdr.needsUpdate = true;
}

// Average linear color of the backdrop just above the horizon (for fog).
function horizonColor(bitmap) {
  const w = 256;
  const h = 128;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  // bitmap is flipped: row 0 = bottom (nadir), row h/2 = horizon; sample slightly above horizon
  const rows = [h / 2 + 1, h / 2 + 2, h / 2 + 3];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const y of rows) {
    const d = ctx.getImageData(0, y, w, 1).data;
    for (let x = 0; x < w; x++) {
      r += d[x * 4];
      g += d[x * 4 + 1];
      b += d[x * 4 + 2];
      n++;
    }
  }
  const c = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  return c; // THREE.Color stores linear components
}

export async function loadAssets(renderer, onProgress = () => {}) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ids = Object.entries(TEX_IDS);
  const total = ids.length * 3 + 3;
  let done = 0;
  const step = (label) => onProgress(++done / total, label);

  const bitmaps = {};
  await Promise.all(
    ids.map(async ([key, id]) => {
      const [diff, nor, arm] = await Promise.all(
        ["diff", "nor", "arm"].map(async (m) => {
          const b = await fetchBitmap(`${BASE}textures/${id}/${m}.jpg`);
          step("Tải texture");
          return b;
        }),
      );
      bitmaps[key] = { diff, nor, arm };
    }),
  );

  const tex = {};
  for (const [key] of ids) {
    const b = bitmaps[key];
    tex[key] = {
      map: makeTexture(b.diff, true, anisotropy),
      normalMap: makeTexture(b.nor, false, anisotropy),
      armMap: makeTexture(b.arm, false, anisotropy),
    };
  }

  const terrainArrays = {
    albedo: makeArray(
      TERRAIN_LAYERS.map((k) => bitmapPixels(bitmaps[k].diff, ARRAY_SIZE)),
      true,
      anisotropy,
    ),
    normal: makeArray(
      TERRAIN_LAYERS.map((k) => bitmapPixels(bitmaps[k].nor, ARRAY_SIZE)),
      false,
      anisotropy,
    ),
    arm: makeArray(
      TERRAIN_LAYERS.map((k) => bitmapPixels(bitmaps[k].arm, ARRAY_SIZE)),
      false,
      anisotropy,
    ),
  };
  step("Dựng vật liệu địa hình");

  const hdr = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(`${BASE}hdri/sky_1k.hdr`);
  const sunDir = findSunDirection(hdr);
  clampSun(hdr, 3.0);
  darkenLowerHemisphere(hdr);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  hdr.dispose();
  step("Ánh sáng môi trường");

  const bgBitmap = await fetchBitmap(`${BASE}hdri/sky_bg.jpg`);
  const background = new THREE.Texture(bgBitmap);
  background.flipY = false;
  background.mapping = THREE.EquirectangularReflectionMapping;
  background.colorSpace = THREE.SRGBColorSpace;
  background.generateMipmaps = false;
  background.minFilter = THREE.LinearFilter;
  background.needsUpdate = true;
  const fogColor = horizonColor(bgBitmap);
  step("Bầu trời");

  return { tex, terrainArrays, env, background, sunDir, fogColor };
}
