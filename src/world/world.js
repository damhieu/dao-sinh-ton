// Builds the static world (terrain, water, sky, collision, and later buildings + vegetation) from map data.
import { WORLD, PHYS } from "../config.js";
import { generateTerrainData } from "./terraingen.js";
import { createSky } from "./sky.js";
import { createTerrain, createHeightTexture } from "./terrain.js";
import { createWater } from "./water.js";
import { CollisionWorld } from "./collision.js";
import { createBuildings } from "./buildings.js";
import { Doors } from "./doors.js";
import { createVegetation } from "./vegetation.js";
import { createGrass, createGrassDensity } from "./grass.js";
import { NavGrid } from "./navgrid.js";

// setTimeout (not rAF) so loading also progresses while the tab is hidden
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export async function createWorld(ctx, assets, onProgress = () => {}) {
  onProgress(0.05, "Sinh địa hình");
  await nextFrame();
  const data = generateTerrainData();
  const collision = new CollisionWorld(data.hm, 8, WORLD.SEA, PHYS.SWIM_DEPTH);
  onProgress(0.3, "Bầu trời và ánh sáng");
  await nextFrame();
  const sky = createSky(ctx, assets);
  sky.setShadowQuality(ctx.preset.shadowSize, ctx.preset.shadowRange);
  onProgress(0.45, "Dựng địa hình");
  await nextFrame();
  const heightTex = createHeightTexture(data.hm);
  const terrain = createTerrain(data, assets, ctx);
  const water = createWater(data, terrain.noiseTex, heightTex, ctx);
  onProgress(0.6, "Dựng nhà cửa");
  await nextFrame();
  const bld = createBuildings(data, collision, assets, ctx.scene);
  const doors = new Doors(ctx.scene, collision, assets);
  doors.build(bld.buildings);
  onProgress(0.8, "Trồng cây");
  await nextFrame();
  const vegetation = createVegetation(data, collision, assets, ctx, ctx.preset);
  const grassDensity = createGrassDensity(data);
  let grass = createGrass(data, heightTex, terrain.noiseTex, grassDensity, ctx, ctx.preset);
  onProgress(0.92, "Tính đường đi cho bot");
  await nextFrame();
  const navGrid = new NavGrid(data.hm, collision);
  onProgress(1, "Xong");

  return {
    data,
    hm: data.hm,
    collision,
    sky,
    terrain,
    water,
    heightTex,
    buildings: bld.buildings,
    buildingTris: bld.tris,
    doors,
    vegetation,
    navGrid,
    grassDensity,
    get grass() {
      return grass;
    },
    // rebuild quality-dependent parts (grass radius) after a preset change
    applyQuality(preset) {
      for (const m of grass.meshes) {
        ctx.scene.remove(m);
        m.geometry.dispose();
      }
      grass = createGrass(data, heightTex, terrain.noiseTex, grassDensity, ctx, preset);
      sky.setShadowQuality(preset.shadowSize, preset.shadowRange);
    },
    isLand(x, z) {
      return data.hm.getHeight(x, z) > 1.5;
    },
    update(dt, time, focus, camPos) {
      sky.update(focus);
      water.update(time);
      doors.update(dt);
      vegetation.update(dt, time, camPos);
      grass.update(time, camPos);
    },
  };
}
