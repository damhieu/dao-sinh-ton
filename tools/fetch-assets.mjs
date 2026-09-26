// Downloads the CC0 textures + HDRI sky used by the game from Poly Haven (https://polyhaven.com).
// Idempotent: files that already exist are skipped. Requires macOS `sips` for resizing the sky backdrop.
import { mkdir, stat, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "assets");
const UA = { "User-Agent": "DaoSinhTon-asset-fetch/1.0" };

const TEXTURES = [
  "leafy_grass",
  "forest_ground_04",
  "aerial_rocks_02",
  "coast_sand_01",
  "asphalt_02",
  "painted_plaster_wall",
  "red_brick_plaster_patch_02",
  "concrete_wall_003",
  "wood_planks_dirt",
  "concrete_floor_02",
  "clay_roof_tiles_02",
  "corrugated_iron_02",
  "rusty_corrugated_iron",
  "rock_boulder_dry",
  "pine_bark",
];
const MAPS = { Diffuse: "diff.jpg", nor_gl: "nor.jpg", arm: "arm.jpg" };
const HDRI = "kloofendal_48d_partly_cloudy_puresky";

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, dest) {
  if (await exists(dest)) return 0;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

let total = 0;
for (const id of TEXTURES) {
  const files = await getJSON(`https://api.polyhaven.com/files/${id}`);
  for (const [key, name] of Object.entries(MAPS)) {
    const url = files[key]?.["1k"]?.jpg?.url;
    if (!url) throw new Error(`Missing ${key} 1k jpg for ${id}`);
    total += await download(url, path.join(OUT, "textures", id, name));
  }
  console.log("texture", id);
}

const sky = await getJSON(`https://api.polyhaven.com/files/${HDRI}`);
total += await download(sky.hdri["1k"].hdr.url, path.join(OUT, "hdri", "sky_1k.hdr"));
const bg = path.join(OUT, "hdri", "sky_bg.jpg");
if (!(await exists(bg))) {
  const tmp = path.join(OUT, "hdri", "_tonemapped_full.jpg");
  await download(sky.tonemapped.url, tmp);
  execFileSync("sips", ["-Z", "6144", "--setProperty", "formatOptions", "82", tmp, "--out", bg], {
    stdio: "ignore",
  });
  await rm(tmp);
  total += (await stat(bg)).size;
}
console.log("hdri", HDRI);
console.log(`Downloaded ${(total / 1048576).toFixed(1)} MB`);
