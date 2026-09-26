# Đảo Sinh Tồn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Game battle royale phong cách PUBG chạy trên trình duyệt: 1 người + 49 bot, một trận đầy đủ từ máy bay đến Top 1, chất lượng hình ảnh và cảm giác bắn tốt nhất có thể.

**Architecture:** Vite + three.js. Logic thuần (địa hình, layout, va chạm, item, sát thương, bo) tách khỏi render để unit test bằng `node --test`. Người chơi và bot dùng chung `Character` và va chạm AABB tự viết. Mỗi bộ phận nhân vật, món đồ và thực vật là một InstancedMesh dùng chung. Luồng render: EffectComposer → pass viewmodel → ShaderPass hiệu ứng màn hình.

**Tech Stack:** three@0.186, vite@8, Node 24 (`node --test`), WebAudio, texture/HDRI CC0 của Poly Haven.

**Spec:** `docs/superpowers/specs/2026-09-26-dao-sinh-ton-design.md`

**Mức chi tiết:** kế hoạch chốt interface, thuật toán then chốt và tiêu chí kiểm chứng của từng task. Code triển khai viết thẳng vào file khi thực thi (inline), vì chép toàn bộ ~15k dòng vào kế hoạch sẽ trùng với codebase. Test của logic thuần ghi dạng bảng assertion (đầu vào → kết quả mong đợi).

## Global Constraints

- Phụ thuộc runtime chỉ gồm `three@^0.186`. Dev dependency chỉ gồm `vite@^8`. Không thêm thư viện vật lý, UI hay âm thanh.
- Chữ trong game bằng tiếng Việt, comment trong code bằng tiếng Anh. Tên game là "ĐẢO SINH TỒN", tên map là "Đảo Hải Âu". Không dùng logo, tên thương hiệu hay asset của PUBG.
- Asset ngoài chỉ lấy từ Poly Haven (CC0) qua `tools/fetch-assets.mjs`, lưu trong `public/assets/`.
- Map tất định theo `MAP_SEED`. Loot, đường bay, bo và bot ngẫu nhiên theo `matchSeed`.
- Mọi collider tĩnh là AABB, cylinder hoặc sphere. Nhà chỉ xoay theo bội số 90°.
- Module logic thuần (`src/core/rng.js`, `src/core/noise.js`, `src/world/heightmap.js`, `src/world/layout.js`, `src/world/terraingen.js`, `src/world/collision.js`, `src/world/buildinggen.js`, `src/items/*.js`, `src/combat/damage.js`, `src/combat/ballistics-core.js`, `src/match/zone.js`) KHÔNG được import three.js.
- Vòng lặp nóng không được cấp phát (không `new Vector3` mỗi frame). Dùng biến tạm cấp phát sẵn và pool.
- Hiệu năng: preset Cao ≥ 60 FPS trên M4, dưới 400 draw call, dưới 3 triệu tam giác mỗi frame.
- Prettier chạy tự động sau mỗi lần ghi file (hook toàn cục) với `.prettierrc.json` là `printWidth: 110`. Trước khi Edit vùng code có thể đã bị format lại, phải Read lại vùng đó.
- Thông số cân bằng (súng, giáp, bo, tốc độ) lấy đúng theo spec mục 5–9.

## File Structure

```
package.json · vite.config.js · index.html · .gitignore · .prettierrc.json · README.md
tools/fetch-assets.mjs
public/assets/textures/<id>/{diff,nor,arm}.jpg · public/assets/hdri/{sky_1k.hdr,sky_bg.jpg}
src/main.js                    boot + state machine app (loading → lobby → match → result)
src/config.js                  WORLD, PHYS, QUALITY_PRESETS, PLAYER_COUNT, timings
src/styles.css                 toàn bộ CSS UI
src/core/{rng,noise,events,input,loop,renderer,assets,settings,pool}.js
src/world/{heightmap,layout,terraingen,collision,buildinggen}.js         (pure)
src/world/{terrain,water,sky,buildings,doors,vegetation,grass,props,world,mapimage}.js
src/actors/{character,rig,ik,player,camera,bot,perception,navigation,names}.js
src/combat/{damage,ballistics-core}.js                                   (pure)
src/combat/{weapons,ballistics,grenades,melee}.js
src/items/{itemdefs,inventory,loadout,loot}.js                           (pure)
src/items/{models,pickups,icons}.js
src/match/zone.js                                                        (pure)
src/match/{match,zonewall,plane,airdrop,vehicles}.js
src/fx/{particles,tracers,decals,muzzle,screenfx,smoke}.js
src/audio/{engine,sfx}.js
src/ui/{hud,compass,minimap,mapview,inventoryui,killfeed,menu,result,loading,pause}.js
src/debug/{debugapi,autopilot}.js
tests/*.test.js
```

## Poly Haven assets (1K JPG: Diffuse, nor_gl, arm)

| Vai trò                                            | Asset ID                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Terrain: cỏ / đất / đá / cát / đường               | `leafy_grass`, `forest_ground_04`, `aerial_rocks_02`, `coast_sand_01`, `asphalt_02`                         |
| Tường sơn (ngoài và trong, tint theo vertex color) | `painted_plaster_wall`                                                                                      |
| Gạch / bê tông tường                               | `red_brick_plaster_patch_02`, `concrete_wall_003`                                                           |
| Sàn gỗ và cửa / sàn bê tông                        | `wood_planks_dirt`, `concrete_floor_02`                                                                     |
| Mái ngói / tôn / tôn gỉ                            | `clay_roof_tiles_02`, `corrugated_iron_02`, `rusty_corrugated_iron`                                         |
| Đá tảng / vỏ cây                                   | `rock_boulder_dry`, `pine_bark`                                                                             |
| HDRI                                               | `kloofendal_48d_partly_cloudy_puresky`: file 1k `.hdr` làm env, bản tonemapped JPG thu về 6144×3072 làm nền |

---

### Task 1: Khung dự án và pipeline asset

**Files:** Create `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `.prettierrc.json`, `src/main.js`, `src/styles.css`, `tools/fetch-assets.mjs`

**Interfaces — Produces:**

- `npm run dev` (Vite, cổng 5173), `npm run build`, `npm test` (`node --test tests/`), `npm run fetch-assets`
- Asset tại `public/assets/textures/<id>/diff.jpg|nor.jpg|arm.jpg`. HDRI tại `public/assets/hdri/sky_1k.hdr` và `sky_bg.jpg`.

- [ ] Tạo `package.json` (`"type": "module"`, scripts ở trên). Chạy `npm i three@^0.186 && npm i -D vite@^8`.
- [ ] Viết `tools/fetch-assets.mjs`:
  - Với mỗi ID, gọi `GET https://api.polyhaven.com/files/<id>` và lấy các URL `Diffuse.1k.jpg`, `nor_gl.1k.jpg`, `arm.1k.jpg`.
  - Tải về đúng tên file ở trên, bỏ qua file đã có (idempotent).
  - HDRI: lấy `hdri['1k'].hdr` và `tonemapped.url`, sau đó chạy `sips -Z 6144 --setProperty formatOptions 82`.
  - In tổng dung lượng.
- [ ] Chạy `npm run fetch-assets` → **kiểm chứng:** đủ 15×3 texture và 2 file HDRI, tổng dưới 40 MB (`du -sh public/assets`).
- [ ] Tạo `index.html` gồm canvas `#game`, `#ui` và `<script type="module" src="/src/main.js">`. `main.js` tạm thời chỉ render một cảnh trống.
- [ ] `npm run dev` rồi mở browser pane → **kiểm chứng:** không lỗi console.
- [ ] Commit `chore: khung Vite + three.js + script tải asset Poly Haven`.

### Task 2: Nền tảng thuần — rng, noise, config

**Files:** Create `src/core/rng.js`, `src/core/noise.js`, `src/config.js`, `src/core/events.js`, `src/core/pool.js` · Test `tests/rng.test.js`, `tests/noise.test.js`

**Interfaces — Produces:**

- `class RNG(seed:uint32)`: `next()` trả về [0,1) · `range(a,b)` · `int(a,b)` (bao cả hai đầu) · `pick(arr)` · `chance(p)` · `weighted([[v,w],…])` · `shuffle(arr)` · `fork(salt)`
- `hashString(s) → uint32`
- `createNoise2D(seed) → (x,y) ⇒ [-1,1]` (simplex) · `fbm2(n,x,y,oct=5,lac=2,gain=.5)` trả về khoảng [-1,1] · `ridged2(n,x,y,oct,lac,gain)` trả về [0,1]
- `events.on(type,fn)` · `events.off(type,fn)` · `events.emit(type,payload)`
- `config.js`:
  - `WORLD = {SIZE:2048, HALF:1024, RES:513, CELL:4, SEA:0, MAP_SEED:20260926}`
  - `PHYS = {G:15.7, STEP:0.45, R:0.35, H_STAND:1.8, H_CROUCH:1.25, H_PRONE:0.55}`
  - `SPEED = {walk:1.8, jog:4.7, sprint:6.3, crouch:2.8, prone:1.2, ads:2.5, swim:2.5, jump:4.5}`
  - `PLAYER_COUNT = 50`
  - `QUALITY_PRESETS = {low,medium,high,ultra}` theo bảng trong spec mục 13

- [ ] Viết test trước:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RNG, hashString } from "../src/core/rng.js";
test("deterministic per seed", () => {
  const a = new RNG(42),
    b = new RNG(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});
test("bounds", () => {
  const r = new RNG(7);
  for (let i = 0; i < 2000; i++) {
    const f = r.range(-2, 3);
    assert.ok(f >= -2 && f < 3);
    const n = r.int(1, 6);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 6);
  }
});
test("weighted never returns zero-weight entries", () => {
  const r = new RNG(1);
  for (let i = 0; i < 500; i++)
    assert.equal(
      r.weighted([
        ["a", 1],
        ["b", 0],
      ]),
      "a",
    );
});
test("fork differs from parent but is deterministic", () => {
  assert.equal(new RNG(5).fork(1).next(), new RNG(5).fork(1).next());
  assert.notEqual(new RNG(5).fork(1).next(), new RNG(5).fork(2).next());
  assert.equal(hashString("abc"), hashString("abc"));
});
```

`noise.test.js`:

- Cùng seed thì cùng giá trị.
- 10.000 mẫu `createNoise2D` đều nằm trong [-1,1].
- Tính liên tục: |n(x,y) − n(x+0.001,y)| < 0.01.
- `ridged2` nằm trong [0,1].
- [ ] Chạy `npm test` → FAIL (module chưa có). Triển khai (mulberry32, simplex 2D kiểu Gustavson). Chạy lại → PASS.
- [ ] Commit `feat: rng, noise, config, events`.

### Task 3: Sinh địa hình, địa danh, đường, lô nhà (thuần)

**Files:** Create `src/world/heightmap.js`, `src/world/layout.js`, `src/world/terraingen.js` · Test `tests/terrain.test.js`

**Interfaces — Produces:**

- `class Heightmap(size, res)`: các trường `size, res, cell, half, heights:Float32Array`
  - `getHeight(x,z)`: bilinear, clamp ở biên
  - `getNormal(x,z,out)`
  - `slopeAt(x,z)` = 1 − n.y
  - `raycast(ox,oy,oz,dx,dy,dz,maxDist)`: trả về t, hoặc −1 nếu không trúng
- `TOWNS` là 8 định nghĩa `{id,name,kind,tier,u,v,radius}`, trong đó `u,v` là tọa độ chuẩn hóa. Bảng `kind`:

  | kind       | tier | Địa danh       |
  | ---------- | ---- | -------------- |
  | `port`     | 2    | Cảng Hải Âu    |
  | `oldtown`  | 2    | Phố Cổ         |
  | `fishing`  | 1    | Làng Chài      |
  | `military` | 3    | Căn Cứ Quân Sự |
  | `factory`  | 2    | Nhà Máy Điện   |
  | `radar`    | 2    | Trạm Radar     |
  | `farm`     | 1    | Nông Trại      |
  | `school`   | 2    | Trường Học     |

- `generateTerrainData(seed)` → `{hm, towns, roads, plots, masks:{road:Uint8Array, ground:Uint8Array}, maskRes:1024}`
  - `roads[i] = {points:[{x,y,z}], width}`
  - `plots[i] = {x,z,w,d,rot:0..3,type,townId,tier}`
  - Các `type` gồm `house_small`, `house_two`, `warehouse`, `apartment`, `container`, `shed`, `barracks`, `school`, `tower`, `factory_hall`.
- **Thuật toán:**
  - **Nền:** mask đảo = smoothstep theo bán kính cộng fbm để bờ biển nhiễu. Đất liền = 1,5 + hills(fbm) × 45 + ridged × 40 × mountainMask. Biển sâu −18 m. Cạnh bờ có dải bãi cát thấp 0–2 m.
  - **Địa danh:** đặt ở (u,v), rồi dò trong bán kính 120 m tìm chỗ trên đất liền có độ dốc thấp nhất.
  - **San phẳng địa danh:** độ cao được blend về độ cao trung bình của vùng, dùng smoothstep từ `radius` đến `radius+40`.
  - **Đường:** nối các địa danh bằng cây khung nhỏ nhất (MST) cộng thêm 2 cạnh. Tìm đường bằng A* trên lưới 16 m với chi phí = độ dài + dốc² × 40 + nước ∞. Làm mượt bằng Chaikin ×2. Độ cao dọc đường làm mượt bằng moving average 7 điểm. Đỉnh terrain trong khoảng `width/2 + 6` m quanh đường được blend về mặt đường.
  - **Lô nhà:** theo `kind`, trên lưới phố của mỗi địa danh cộng nhà lẻ dọc đường (~40 lô). Loại lô chồng lấn (lề 3 m), lô đè lên đường và lô nằm dưới nước.
  - **Mask:** raster đường và nền sân (ground) vào lưới 1024² với mép mềm.
- [ ] Viết test `tests/terrain.test.js`, dùng `const T = generateTerrainData(20260926)`, gọi một lần ở đầu file:

| Assertion                                       | Kỳ vọng                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Hai lần gọi cùng seed                           | checksum `heights` bằng nhau                                                 |
| `hm.getHeight(±1000, ±1000)` (4 góc)            | < −5 (biển)                                                                  |
| Tỷ lệ đỉnh > 2 m                                | nằm trong khoảng 25–60%                                                      |
| Mỗi town: `getHeight(center)`                   | > 1,5                                                                        |
| Mỗi town: độ lệch chuẩn độ cao trong 0,6·radius | < 1,2 m                                                                      |
| Mỗi road: 2 đầu cách tâm một town               | < radius + 20 m                                                              |
| Mọi điểm road                                   | y > 0,3 và dốc giữa 2 điểm liên tiếp < 0,18                                  |
| Các plot                                        | không cặp nào giao nhau (AABB có lề 2 m), tâm mọi plot > 1 m so với mực biển |
| `plots.length`                                  | nằm trong khoảng 150–260                                                     |
| `hm.raycast(0,500,0, 0,-1,0, 1000)`             | ≈ 500 − getHeight(0,0), sai số < 0,05                                        |

- [ ] FAIL → triển khai → PASS. Commit `feat: sinh địa hình, địa danh, đường, lô nhà`.

### Task 4: Renderer, terrain mesh, bầu trời, nước, sương mù, camera bay debug

**Files:** Create `src/core/renderer.js`, `src/core/assets.js`, `src/core/settings.js`, `src/core/loop.js`, `src/core/input.js`, `src/world/terrain.js`, `src/world/water.js`, `src/world/sky.js`, `src/world/world.js`, `src/debug/debugapi.js` · Modify `src/main.js`

**Interfaces — Produces:**

- `createRenderer(canvas, settings)` → `{renderer, scene, camera, vmScene, vmCamera, composer, screenFx, setQuality(name), resize(), render(dt), info()}`
- `loadAssets(onProgress)` → `{tex:{[id]:{map,normalMap,armMap}}, terrainArrays:{albedo,normal}, env:Texture, background:Texture, sunDir:{x,y,z}}`
  - `terrainArrays` là `DataArrayTexture` 5 lớp, 1024², có mipmap.
- `createTerrain(data, assets, quality)` → `{group, material, update(camera)}`
  - Chunk 128 m.
  - Shader là `MeshStandardMaterial.onBeforeCompile`. Chọn lớp theo độ dốc/độ cao/noise/mask. Mỗi lớp lấy mẫu ở 2 tỉ lệ (4 m và 17 m), blend theo khoảng cách.
- `createWater(hm, assets)` → `{mesh, update(t)}` với sóng procedural, Fresnel, bọt bờ đọc từ heightmap DataTexture.
- `createSky(scene, assets, renderer)` → `{sun:DirectionalLight, sunDir, update(focusPos)}`.
  - Shadow ortho quanh `focusPos`, snap theo texel.
  - Fog tự viết: `ShaderChunk.fog_fragment` được thay bằng exp theo khoảng cách × giảm theo độ cao + inscatter về phía mặt trời.
- `input`: `down(code)`, `pressed(code)`, `released(code)`, `mouse:{dx,dy,buttons,wheel}`, `lock()`, `isLocked()`, `endFrame()`.
- `window.__game`: `{fly(x,y,z,yaw,pitch), stats() → {fps,calls,tris}, shot(), ...}`. API này được mở rộng dần ở các task sau.

- [ ] Triển khai renderer:
  - `ACESFilmicToneMapping`, `SRGBColorSpace`, `PCFSoftShadowMap`.
  - Composer gồm RenderPass (MSAA qua `samples`) → viewmodel pass (clearDepth) → ShaderPass screenFx (vignette, saturation, tint) → OutputPass.
  - Resize theo render scale của preset.
- [ ] Terrain, nước, trời, fog. Thêm camera bay debug (WASD + chuột, phím P bật/tắt) để soát cảnh.
- [ ] **Kiểm chứng** trong browser pane qua `__game.fly()` ở 3 góc: toàn cảnh đảo từ trên cao 600 m, ngang tầm bờ biển, trong thị trấn (đang là nền phẳng):
  - Không lỗi console. Chụp màn hình và soát bằng mắt: bờ biển tự nhiên, không lộ vết lặp texture, fog đúng màu.
  - `__game.stats().fps` ≥ 60 ở preset Cao.
- [ ] Commit `feat: renderer, địa hình PBR splat, trời HDRI, nước, sương mù`.

### Task 5: Collision world (thuần)

**Files:** Create `src/world/collision.js` · Test `tests/collision.test.js`

**Interfaces — Produces:**

- Hằng: `F_SOLID=1, F_BULLET=2, F_VISION=4, F_ALL=7`. Vật liệu: `MAT = {terrain:0, wood:1, metal:2, concrete:3, flesh:4, foliage:5, glass:6}`.
- `class CollisionWorld(hm, cellSize=8)`:
  - `addBox(minX,minY,minZ,maxX,maxY,maxZ,flags=F_ALL,mat=3) → id`
  - `setBox(id, …6)`
  - `setEnabled(id,bool)`
  - `addCylinder(x,z,r,y0,y1,flags,mat) → id`
  - `addSphere(x,y,z,r,flags,mat) → id`
  - `raycast(ox,oy,oz,dx,dy,dz,maxDist,mask,hit) → bool`, trong đó `hit={t,x,y,z,nx,ny,nz,kind,id,mat}` và `kind` ∈ `terrain|box|cyl|sphere`. Duyệt lưới bằng DDA 2D, có stamp để không kiểm tra trùng.
  - `groundAt(x,z,r,maxY) → y`: cao nhất trong số terrain và các mặt trên của box có đỉnh ≤ maxY chồng lên vòng tròn.
  - `ceilingAt(x,z,r,minY) → y|Infinity`
  - `moveBody(b, dt)`, với `b={x,y,z,vx,vy,vz,r,h,onGround,inWater,stepUp}`:
    - Chia substep sao cho mỗi bước ≤ 0,5·r.
    - Đẩy ra theo phương ngang khi box chồng khoảng [y+stepUp, y+h].
    - Snap xuống đất, xử lý trần.
    - Nước: nếu `groundAt < SEA−1.3` thì cho nổi ở `y = SEA−1.3` và đặt `inWater = true`.
- [ ] Test, dùng heightmap phẳng 0 kích thước 256/65:

| Case                                                | Kỳ vọng                                  |
| --------------------------------------------------- | ---------------------------------------- |
| Box [4,0,−1]–[5,3,1]; ray từ (0,1,0) theo +x        | trúng, t≈4, n=(−1,0,0), kind `box`       |
| Ray từ (0,10,0) theo −y                             | trúng terrain, t≈10                      |
| Body r=.35 ở (0,0,0), vx=5, 2 s trước box tường x=4 | x cuối ≈ 3,65 ± 0,02                     |
| Bậc cao 0,3 ở x∈[2,3] (và 0,3 ≤ stepUp)             | body đi qua, y lên 0,3 khi ở trên bậc    |
| Bậc cao 1,0                                         | chặn, x ≤ 1,66                           |
| Box trần ở y∈[2,2.2]; nhảy vy=6                     | vy ≤ 0 khi đầu chạm trần, đỉnh đầu ≤ 2,0 |
| `setEnabled(id,false)` với tường                    | body đi xuyên qua                        |
| Cylinder r=.5 tại (3,0)                             | ray từ (0,1,0) +x trúng t≈2,5            |
| 20.000 box ngẫu nhiên, 10.000 raycast 100 m         | < 150 ms                                 |

- [ ] FAIL → triển khai → PASS. Commit `feat: collision world (AABB/trụ/cầu, raycast DDA, di chuyển thân)`.

### Task 6: Nhân vật, rig instanced, camera TPP/FPP, điều khiển người chơi

**Files:** Create `src/actors/character.js`, `src/actors/rig.js`, `src/actors/ik.js`, `src/actors/camera.js`, `src/actors/player.js` · Modify `src/main.js`, `src/debug/debugapi.js`

**Interfaces — Produces:**

- `class Character({id,name,isPlayer,colors})`:
  - Trường: `pos:{x,y,z}` (chân), `vel`, `yaw`, `pitch`, `stance` (`stand|crouch|prone`), `mode` (`plane|freefall|chute|ground|vehicle|dead`), `health`, `boost`, `alive`, `lean`, `ads`, `sprinting`, `onGround`, `inWater`, `inv:Inventory`, `loadout:Loadout`, `anim` (trạng thái animation), `ctrl` (input điều khiển: `{mx,mz,sprint,walk,jump,crouch,prone,fire,ads,reload,interact,leanL,leanR,yaw,pitch}`)
  - Phương thức: `update(dt, world)`, `eyePos(out)`, `muzzle(out)`
- `class RigRenderer(scene)`:
  - `add(character)`, `remove(character)`
  - `update(dt, camera)`: tính pose rồi ghi instance matrix
  - `hitboxes(character) → [{part,ax,ay,az,bx,by,bz,r}]`, lấy capsule từ pose đã cache của frame
  - `attach(character,'weapon'|'hand_r'|'chest', outMatrix)`
  - Bộ phận: `head, hair|cap, helmet1..3, torso, pelvis, uarmL/R, farmL/R, handL/R, thighL/R, shinL/R, bootL/R, vest1..3, pack1..3`
- `solveTwoBone(rootPos, len1, len2, targetPos, poleDir, outMid)` trong `ik.js`, dùng cho tay cầm súng.
- `class GameCamera`: `mode` (`tpp|fpp|ads`), `update(dt, player, world)`, `aimRay(outOrigin,outDir)`, `aimPoint(out)`. TPP qua vai phải (0,55; 0,25; 2,6), raycast lùi khi chạm tường.
- `class PlayerController(character, input, camera)`: `update(dt)` điền `character.ctrl`, xử lý F tương tác (phát sự kiện `interact`).
- **Animation thủ tục:**
  - Pha bước chân tăng theo quãng đường đi. Biên độ theo tốc độ.
  - Tư thế ngồi/nằm nội suy mượt 0,25 s.
  - Thân trên xoay theo `pitch`. Nghiêng người theo `lean`.
  - Pose riêng cho rơi tự do, dù và chết (đổ người 0,5 s).
  - Súng gắn ở khung ngực; tay trái/phải nắm súng qua IK.

- [ ] Triển khai và nối vào `main.js` với chế độ debug: người chơi đứng ở thị trấn đầu tiên.
- [ ] **Kiểm chứng** trong browser. Giả lập phím bằng `__game.input(code, down)`, rồi chụp ảnh sau mỗi hành động:
  - Đi, chạy nhanh, nhảy, ngồi, nằm, nghiêng. Đi trên dốc và leo đồi.
  - Camera co lại khi áp sát vách đá.
  - Chuyển FPP bằng V.
  - Tiêu chí: không rung camera, chân không lún xuống địa hình.
- [ ] Commit `feat: nhân vật procedural, animation, camera TPP/FPP, điều khiển`.

### Task 7: Nhà, cửa, nội thất, lắp vào thị trấn

**Files:** Create `src/world/buildinggen.js` (thuần), `src/world/buildings.js` (mesh), `src/world/doors.js`, `src/world/props.js` · Test `tests/buildings.test.js`

**Interfaces — Produces:**

- `generateBuilding(plot, rng)` → object gồm các trường sau:
  - `boxes:[{min:[x,y,z],max:[x,y,z],mat,tint,interior:boolean,solid:boolean}]`, với `mat` ∈ `plaster|brick|concrete|wood|floorConcrete|roof|metal|rust|trim|furniture|crate`
  - `prisms:[{…}]` cho mái dốc
  - `doors:[{x,y,z,axis:'x'|'z',w,h,hinge:-1|1,swing:-1|1}]`
  - `loot:[{x,y,z}]`
  - `nav:{nodes:[{x,y,z,room}],edges:[[a,b]]}`
  - `bounds:{min,max}`, `floors`
- **Tường:** chia đoạn quanh các lỗ mở (cửa 1,1×2,2; cửa sổ 1,2×1,1 cao 0,9).
- **Phòng:** chia BSP, mỗi vách ngăn có một cửa.
- **Cầu thang:** thẳng, 16 bậc, mỗi bậc cao 0,2 m, sâu 0,28 m. Sàn tầng trên chừa lỗ cầu thang.
- **Mái:** mái dốc (prism) cho nhà nhỏ, mái bằng có lan can cho các loại còn lại.
- **Mặt trong:** tối đi qua vertex color 0,6–0,7 để giả ambient occlusion.
- `buildBuildingMeshes(list, assets)`: gộp theo (chunk 256 m × vật liệu). UV theo tọa độ thế giới / mật độ texture.
- `Doors`:
  - `add(door) → id`
  - `toggle(id)`: animation xoay 90° trong 0,35 s, collider đổi sang AABB của trạng thái mở
  - `nearest(pos, maxDist) → id|-1`
  - Render bằng InstancedMesh.
- [ ] Test cho từng `type`, mỗi loại 10 seed:
  - Tia ngang qua tâm mỗi cửa (cao 1,0 m, vuông góc tường, dài 1 m mỗi phía) không trúng box `solid` nào.
  - Mọi điểm loot nằm trong `bounds` và không nằm trong box solid.
  - Mọi bậc cầu thang cao ≤ 0,45.
  - Nav graph liên thông (BFS phủ hết).
  - Không box nào có kích thước âm.
- [ ] FAIL → triển khai → PASS.
- [ ] Nối vào `world.js`: sinh toàn bộ plot, đăng ký collider, gộp mesh.
- [ ] **Kiểm chứng** trong browser:
  - Chụp ảnh Phố Cổ, Cảng, Căn Cứ từ trên cao và ngang tầm.
  - Đi vào nhà, mở cửa bằng F, lên tầng 2.
  - Draw call building < 120. FPS ≥ 60.
- [ ] Commit `feat: nhà procedural, cửa, cầu thang, nội thất`.

### Task 8: Thực vật, đá, cỏ

**Files:** Create `src/world/vegetation.js`, `src/world/grass.js` · Modify `src/world/world.js`

**Interfaces — Produces:**

- `createVegetation(data, collision, assets, quality)` → `{update(camera), bushes:[{x,y,z,r}]}`
  - Cây thông: thân + tầng lá alpha-card, texture lá kim sinh bằng canvas.
  - Cây lá rộng: cụm card.
  - Bụi: card. Đá: icosahedron biến dạng dùng texture `rock_boulder_dry`.
  - LOD 2 mức, cập nhật danh sách instance theo ô mỗi 0,3 s.
  - Đăng ký thân cây là cylinder, đá là sphere (vừa chặn đạn vừa chặn tầm nhìn).
  - Bụi chỉ chặn tầm nhìn, lưu trong `bushes` để `perception` dùng.
- `createGrass(data, quality)` → `{mesh, update(camera, t)}`:
  - Một mesh lưới cọng cỏ quanh camera, snap theo ô.
  - Vertex shader đọc độ cao từ heightmap texture và mật độ từ mask (không mọc trên đường, cát, đá, nhà). Gió bằng sin + noise. Mờ dần ở biên bán kính.
- [ ] **Kiểm chứng:**
  - Chụp ảnh rừng, đồng cỏ, ven đường.
  - Thân cây chặn đạn: raycast qua `__game.ray()`.
  - FPS ≥ 60 ở preset Cao khi nhìn vào rừng dày.
- [ ] Commit `feat: cây, bụi, đá, cỏ GPU`.

### Task 9: Item, túi đồ, loadout, bảng loot (thuần)

**Files:** Create `src/items/itemdefs.js`, `src/items/inventory.js`, `src/items/loadout.js`, `src/items/loot.js` · Test `tests/items.test.js`

**Interfaces — Produces:**

- `ITEMS[id]`: `{id,name,cat,weight,stack,…}`. `cat` ∈ `weapon|ammo|attachment|heal|boost|throwable|helmet|vest|backpack|melee`.
- `WEAPONS[id]`: `{id,name,cls,ammo,dmg,rpm,mag,extMag,speed,modes,reload,recoil:{v,h},spread:{hip,ads,move},headMult,falloff:[d0,d1,min],pellets?,bolt?}` cho 10 súng trong spec.
- `ATTACHMENTS[id]`: `{slot:'sight'|'muzzle'|'mag'|'grip', fits:[cls], zoom?, recoilMul?, vRecoilMul?, suppressed?}`
- `attachmentFits(attId, weaponId) → bool`
- `class Inventory`:
  - Trường: `items: Map`, `helmet`, `vest`, `backpack`
  - Phương thức: `capacity()`, `weight()`, `count(id)`, `maxAddable(id)`, `add(id,n) → added`, `remove(id,n) → removed`, `equipArmor(kind,level,durability) → old|null`, `equipBackpack(level) → oldLevel`
- `class Loadout`:
  - Trường: `slots[5]`, với mỗi phần tử là `{id,mag,att:{sight,muzzle,mag,grip},mode}` hoặc null. `active` từ 0 đến 4, hoặc −1 khi cầm tay không.
  - Phương thức: `addWeapon(id, mag) → {slot, dropped}`, `autoAttach(attId) → slot|-1`, `detach(slot,attSlot) → attId`, `current()`
- `rollLoot(rng, tier) → [{id,n}]`, trong đó tier 1–3 và 4 là thính. `LOOT_TABLES`.
- [ ] Test:

| Case                                                       | Kỳ vọng                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `Inventory.capacity()` mặc định / balo cấp 2 + áo          | 50 / 300                                                         |
| `add('ammo556', 200)` khi trống (0,5/viên, cap 50)         | 100 viên được thêm                                               |
| `remove` quá số đang có                                    | chỉ bỏ đúng số đang có                                           |
| Balo cấp 3 → cấp 1 khi đang chở 180                        | từ chối (trả về −1), giữ nguyên                                  |
| `addWeapon('m416')` khi trống / thêm `akm` / thêm `kar98k` | slot 0 / slot 1 / thay slot đang active, trả `dropped`           |
| `autoAttach('scope8x')` khi chỉ có M416                    | −1 (không vừa)                                                   |
| `autoAttach('scope4x')` với M416                           | 0 và gắn vào `att.sight`                                         |
| `rollLoot(rng,3)` 2000 lần                                 | mọi id đều có trong ITEMS; tần suất giáp cấp 3 ở tier 3 > tier 1 |
| `rollLoot(rng,4)`                                          | luôn có `awm` hoặc giáp cấp 3                                    |

- [ ] FAIL → triển khai → PASS. Commit `feat: item, túi đồ, loadout, bảng loot`.

### Task 10: Model súng/đồ, đồ dưới đất, icon

**Files:** Create `src/items/models.js`, `src/items/pickups.js`, `src/items/icons.js`

**Interfaces — Produces:**

- `buildItemGeometry(id) → BufferGeometry`: gộp nhiều khối, màu vật liệu qua vertex color. Các loại:
  - Súng có silhouette riêng từng khẩu: báng, thân, nòng, băng đạn, tay cầm, ray.
  - Phụ kiện, đạn (hộp màu theo loại), đồ hồi máu, mũ, áo, balo, lựu đạn, chảo.
- `buildWeaponMesh(weaponState) → Group`: súng kèm phụ kiện đang gắn, dùng cho tay nhân vật và viewmodel.
- `class Pickups(scene)`:
  - `spawn(id,n,pos,opts) → pid`, `remove(pid)`
  - `near(pos,r,out[])`: dùng lưới không gian
  - `update(camera)`: InstancedMesh theo id, chỉ render các món trong 120 m
  - `crate(pos, items) → pid`: hòm xác
- `renderIcons(renderer, ids) → {[id]: dataURL}`: render offscreen 128² lúc boot.
- [ ] **Kiểm chứng:** trang debug `__game.showcase()` bày đủ mọi item trên mặt đất, chụp ảnh soát từng khẩu súng, và soát icon trong túi đồ (sau Task 12).
- [ ] Commit `feat: model súng/đồ procedural, đồ dưới đất, icon`.

### Task 11: Vũ khí, đạn đạo, sát thương, hiệu ứng bắn

**Files:**

- Create `src/combat/damage.js`, `src/combat/ballistics-core.js` (thuần) · Test `tests/combat.test.js`
- Create `src/combat/weapons.js`, `src/combat/ballistics.js`, `src/fx/particles.js`, `src/fx/tracers.js`, `src/fx/decals.js`, `src/fx/muzzle.js`
- Modify `src/actors/camera.js` (ADS/scope), `src/fx/screenfx`

**Interfaces — Produces:**

- `computeHit({weapon, part, distance, helmet, vest})` → `{damage, helmetDmg, vestDmg}`.
  - `part` ∈ `head|torso|pelvis|limb`. Hệ số: head = weapon.headMult (AR/SMG 2,3; SR/DMR 2,5); torso 1; pelvis 1; limb 0,6.
  - Giảm sát thương theo cấp giáp [0; 0,3; 0,4; 0,55]. Falloff tuyến tính từ d0 đến d1, xuống còn `min`.
- `stepBullet(b, dt)`: tích phân bán ẩn với g=9,81. `dropAt(speed, dist)` = 0,5·g·(dist/speed)².
- `WeaponSystem`:
  - `update(character, dt, ctx)`: bắn/nạp/đổi chế độ, giật (cộng vào pitch/yaw camera, hồi 50% sau 0,25 s không bắn), độ loang theo tư thế và di chuyển
  - `onFire` phát sự kiện `shot {shooter, weapon, pos, suppressed}`
- `Ballistics`:
  - `spawn(shooter, ox,oy,oz, dx,dy,dz, weaponDef)`
  - `update(dt, world, characters)`: chọn va chạm gần nhất giữa world và hitbox. Phát sự kiện `hit {target,part,damage,pos,...}` và `impact {pos,normal,mat}`.
- **Hiệu ứng:**
  - Lửa đầu nòng: sprite cộng một PointLight nhấp nháy dùng chung.
  - Tracer: ribbon mỏng, pool 64.
  - Particle GPU: pool bụi, tia lửa, máu, mảnh gỗ, vỏ đạn.
  - Decal lỗ đạn: pool 128 quad bám theo normal.
- **ADS:** tâm ngắm Red Dot/2× hiện trên viewmodel. Scope 4×/8× dùng overlay DOM (viền đen, vạch chữ thập có vạch bù đạn), FOV = 2·atan(tan(40°)/zoom).
- [ ] Test:

| Case                                  | Kỳ vọng                       |
| ------------------------------------- | ----------------------------- |
| M416, torso, không giáp, 50 m         | 40                            |
| M416, head, không mũ                  | 92                            |
| M416, head, mũ cấp 2                  | 55,2 và `helmetDmg` = 92      |
| AWM, head, mũ cấp 2                   | ≥ 150                         |
| Kar98k, head, mũ cấp 3                | ≈ 88,9 (< 100)                |
| AKM, limb, áo cấp 3                   | 28,2 (áo không giảm tay chân) |
| UMP45 ở 200 m                         | < 39·0,8 (falloff)            |
| `dropAt(880,100)` / `dropAt(880,300)` | ≈ 0,063 / ≈ 0,570 (±2%)       |
| Tích phân `stepBullet` 300 m, dt=1/60 | lệch so với giải tích < 3 cm  |

- [ ] FAIL → triển khai → PASS.
- [ ] Nối vào game với phím debug `__game.give('m416')` và bia (bot đứng yên).
- [ ] **Kiểm chứng:**
  - Chụp ảnh lúc bắn: có lửa nòng, tracer, lỗ đạn, bụi.
  - Chụp ảnh lúc ADS: red dot khớp tâm, scope 4× có overlay.
  - Bắn bia ở 100 m và 300 m: đạn rơi đúng, khớp vạch bù.
  - Giật M416 nhẹ hơn AKM: đo độ lệch pitch sau 10 viên.
- [ ] Commit `feat: súng, đạn đạo, sát thương, hiệu ứng, ADS/scope`.

### Task 12: HUD, túi đồ UI, tương tác nhặt đồ, hồi máu

**Files:** Create `src/ui/hud.js`, `src/ui/inventoryui.js`, `src/ui/killfeed.js`, `src/ui/compass.js` · Modify `src/actors/player.js`, `src/styles.css`

**Interfaces — Produces:**

- `HUD.update(state)`:
  - Máu, boost, giáp (độ bền), súng/đạn/chế độ bắn.
  - Gợi ý tương tác, hit marker, chỉ báo hướng bị bắn, số người còn sống và số hạ gục.
  - Thông báo ở giữa màn hình, tiến trình dùng đồ (vòng tròn đếm giây).
- `InventoryUI` (Tab):
  - Cột khu vực xung quanh (`pickups.near` 3 m + hòm xác), balo, trang bị/súng.
  - Click để nhặt/dùng, chuột phải để vứt. Kéo phụ kiện giữa các súng.
- Hồi máu: `Character.useItem(id)` với thời gian dùng; bị huỷ khi nước rút, nhảy hoặc bắn.
- Tự nhặt: người chơi phải bấm F. Món nhặt được đi vào `inv` hoặc `loadout`, giáp tự thay nếu tốt hơn.
- [ ] **Kiểm chứng:** chơi thử trong browser: nhặt súng, đạn, phụ kiện (tự gắn), giáp, balo, vứt đồ, dùng băng gạc. Chụp ảnh HUD và túi đồ. Tiêu chí: chữ tiếng Việt có dấu hiển thị đúng, không tràn chữ.
- [ ] Commit `feat: HUD, túi đồ, nhặt/vứt/dùng đồ`.

### Task 13: Bot AI

**Files:** Create `src/actors/bot.js`, `src/actors/perception.js`, `src/actors/navigation.js`, `src/actors/names.js` · Modify `src/match/match.js` (tạo mới nếu chưa có)

**Interfaces — Produces:**

- `class BotController(character, {skill:0..1, aggression:0..1})`:
  - `think(ctx)` chạy ở 5 Hz, lệch pha giữa các bot. Chọn `goal` ∈ `drop|loot|zone|engage|cover|heal|investigate|hold|flee|airdrop` theo utility.
  - `update(dt, ctx)`: steering, ngắm, bắn, rồi điền `character.ctrl`.
- `Perception.update(bot, ctx)`:
  - Thanh phát hiện theo khoảng cách, tư thế, bụi, khói, chuyển động. LOS qua `collision.raycast` (mask VISION).
  - Nghe sự kiện `shot`: 250 m, giảm thanh 60 m.
  - `known: Map<id,{pos,t,aware,visible}>`
- `Navigation`:
  - `steer(char, target, ctx) → {dx,dz}`: context steering 16 hướng, ray tránh vật cản ở 0,5 m và 1,2 m, tránh nước sâu.
  - `buildingPath(bIndex, fromNode, toNode) → nodes[]`: A* trên nav graph của nhà.
  - Phát hiện kẹt: di chuyển < 0,5 m trong 2 s thì né ngẫu nhiên 1,5 s; kẹt > 8 s và ngoài tầm nhìn người chơi thì dịch chuyển về node gần nhất.
- **Ngắm:**
  - Điểm ngắm = ngực (cao thủ đôi khi chọn đầu) + đón đầu × skill + bù rơi × skill + sai số.
  - Sai số = base(skill) × khoảng cách × (1 + tốc độ mục tiêu/5) × tracking. Tracking giảm từ 2,5 về 1 trong 1,5 s.
  - Tốc độ xoay có giới hạn. Phản xạ 0,25–0,7 s.
  - Bắn loạt 3–5 viên khi ở xa.
- **LOD:** bot cách người chơi > 350 m và ngoài tầm nhìn chỉ `think` ở 1 Hz và di chuyển ở 5 Hz. Giao tranh dùng hitscan xác suất nhưng vẫn kiểm tra LOS.
- **Hòm xác:** khi chết, `match` gom `inv` và `loadout` thành `pickups.crate`. Phát sự kiện `kill {killer, victim, weapon, headshot}`.
- [ ] **Kiểm chứng** qua `__game.spawnBots(n, near)`:
  - Quan sát 5 phút ở tốc độ x2: bot nhặt đồ trong nhà (đi qua cửa, lên tầng), bắn nhau, bắn trả người chơi, nấp, hồi máu.
  - Log số bot kẹt > 8 s phải < 5%.
  - Người chơi đứng lộ ở 100 m bị bot tầm trung phát hiện trong < 3 s.
- [ ] Commit `feat: bot AI (nhận thức, di chuyển, giao tranh, nhặt đồ)`.

### Task 14: Bo (thuần) và hiển thị bo

**Files:** Create `src/match/zone.js` · Test `tests/zone.test.js` · Create `src/match/zonewall.js` · Modify `src/fx/screenfx.js`

**Interfaces — Produces:**

- `ZONE_PHASES = [{wait:120,shrink:120,r:600,dps:.5},{90,90,350,1},{75,60,200,2},{60,45,110,4},{45,35,55,6},{35,30,25,8},{25,25,0,12}]`
- `class ZoneSchedule(rng, {center, r0, isLand, startDelay=60, speed=1})`:
  - `update(t)` cập nhật `{phase, state:'idle'|'waiting'|'shrinking'|'done', cur:{x,z,r}, next:{x,z,r}, timeLeft, dps}`
  - `outside(x,z) → bool`
  - Tâm bo mới được chọn ngẫu nhiên nằm trong bo cũ, ưu tiên đất liền (`isLand` thử 30 lần).
- `ZoneWall`: trụ lớn với shader năng lượng xanh (sọc chạy + Fresnel, hai mặt). Vòng tròn trắng vẽ trên minimap/map.
- [ ] Test:

| Case                             | Kỳ vọng                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| t = 30                           | `idle`, `cur.r` = r0                                         |
| t = 60 + 60                      | `waiting`, `next.r` = 600, `dist(cur,next) + next.r ≤ cur.r` |
| t = 60 + 120 + 60 (giữa lúc thu) | 600 < `cur.r` < r0                                           |
| Hết lịch                         | `done`, `cur.r` ≈ 0                                          |
| Mọi next lồng nhau               | đúng với 20 seed                                             |
| `speed=0.6`                      | các mốc thời gian nhân 0,6                                   |

- [ ] FAIL → triển khai → PASS. Commit `feat: lịch bo + tường bo`.

### Task 15: Máy bay, rơi tự do, dù, vòng trận, kết quả

**Files:** Create `src/match/plane.js`, `src/match/match.js` (hoàn thiện), `src/ui/result.js` · Modify `src/actors/character.js` (freefall/chute), `src/actors/bot.js` (drop)

**Interfaces — Produces:**

- `Plane`: đường bay ngẫu nhiên qua gần tâm đảo (lệch ±300 m), độ cao 500 m, 60 m/s. Có model (thân, cánh, đuôi, 4 cánh quạt quay), `update(dt)`, `pos`, `dir`, `progress`.
- `Match`:
  - `state` ∈ `plane|playing|ended`, `time`, `characters`, `player`, `alive()`, `rankOf(char)`, `stats{kills,damage,distance,timeAlive}`.
  - `update(dt)`: điều phối bo, sát thương bo, thính, xe, ballistics, bot, pickups.
  - Kết thúc khi `alive()==1`, phát sự kiện `matchEnd {winner, playerRank}`.
- **Rơi tự do:** ngang 0–30 m/s, dọc 45–60 m/s (W để lao). F mở dù, tự bung ở 150 m so với mặt đất.
- **Dù:** ngang 5–16 m/s, rơi 4–8 m/s. Tiếp đất khi còn cách mặt đất < 1 m.
- **Bot nhảy:** nhảy khi điểm đến cách hình chiếu vị trí máy bay ≤ 450 m. Tới cuối đường bay thì mọi bot bắt buộc nhảy.
- `ResultScreen`:
  - Thắng: "WINNER WINNER CHICKEN DINNER!". Thua: "CHÚC BẠN MAY MẮN LẦN SAU".
  - Hiện hạng, số hạ gục, sát thương, quãng đường, thời gian sống.
  - Nút CHƠI LẠI, VỀ SẢNH. Khi chết có thêm nút "Theo dõi" để xem kẻ hạ gục.
- [ ] **Kiểm chứng:** chơi thử trong browser một trận ở chế độ nhanh: nhảy, lái dù tới thị trấn, tiếp đất, chạy bo, xem màn kết quả. Chụp ảnh máy bay, rơi tự do, dù, bo.
- [ ] Commit `feat: máy bay, dù, vòng trận, màn kết quả`.

### Task 16: Bản đồ, minimap, la bàn

**Files:** Create `src/world/mapimage.js`, `src/ui/minimap.js`, `src/ui/mapview.js` · Modify `src/ui/compass.js`

**Interfaces — Produces:**

- `renderMapImage(data, buildings) → HTMLCanvasElement` (2048²):
  - Nền màu địa hình, hillshade, nước theo độ sâu, đường, nhà (khối xám đậm).
  - Tên địa danh vẽ lúc hiển thị, không vẽ sẵn vào ảnh.
- `Minimap.update(player, zone, markers)`: bản đồ hướng Bắc lên trên, vùng nhìn 400 m, có vòng bo xanh, vòng trắng, mũi tên người chơi, thính, điểm đánh dấu, hướng tiếng súng (PUBG hiện tiếng súng trên minimap).
- `MapView` (M): zoom bằng con lăn, kéo để di chuyển, lưới 8×8 đánh A–H/1–8, tên địa danh, đường bay (giai đoạn máy bay), vòng bo, chuột phải để đặt điểm đánh dấu.
- `Compass`: độ 0–359 kèm N/NE/E…, marker hướng tới điểm đánh dấu.
- [ ] **Kiểm chứng:** chụp ảnh map (M) và minimap. Vị trí người chơi trên map phải khớp tọa độ thật: teleport tới tâm Phố Cổ thì mũi tên nằm trên nhãn Phố Cổ.
- [ ] Commit `feat: bản đồ, minimap, la bàn`.

### Task 17: Xe

**Files:** Create `src/match/vehicles.js` · Modify `src/actors/player.js`, `src/actors/camera.js`, `src/match/match.js`

**Interfaces — Produces:**

- `class Vehicle(type:'jeep'|'buggy', pos, rot)`:
  - Rigid body 6-DoF đơn giản: `pos`, `quat`, `vel`, `angVel`.
  - 4 bánh raycast xuống heightmap và box. Lò xo và giảm chấn. Lực kéo, phanh, phanh tay, lái theo tốc độ.
  - `health`, `occupant`, `update(dt, world)`, `enter(char)`, `exit()`.
  - Model procedural: thân, 4 bánh xoay theo tốc độ/lái, đèn.
- Va chạm với box/cylinder/sphere: xấp xỉ 3 vòng tròn dọc thân; đẩy ra và giảm vận tốc theo pháp tuyến. Tông người khi > 5 m/s gây sát thương = (tốc độ − 5) × 6.
- Đạn trúng xe: kiểm tra OBB, trừ máu xe. Máu xe về 0 thì nổ (bán kính 6 m, 100 sát thương) và để lại xác xe.
- Khoảng 20 xe ở `vehicleSpawns` dọc đường.
- [ ] **Kiểm chứng:** lái xe qua đường, đồi, bãi cát, đâm tường; không lật vô cớ và không xuyên nhà. Bắn nổ xe. Chụp ảnh.
- [ ] Commit `feat: xe Jeep/Buggy`.

### Task 18: Lựu đạn, khói, chảo, thính

**Files:** Create `src/combat/grenades.js`, `src/fx/smoke.js`, `src/combat/melee.js`, `src/match/airdrop.js`

**Interfaces — Produces:**

- `Grenades`:
  - `throw(char, power)`: quỹ đạo có vạch preview khi giữ chuột. Nảy trên terrain/box (hệ số hồi 0,35).
  - Lựu đạn nổ: nổ sau 5 s, sát thương 100·(1 − d/8)^1,3 nếu có LOS, rung màn hình. Lựu đạn khói: khối khói 25 s, bán kính 7 m, chặn VISION trong `perception`.
- `Melee`: chảo cận chiến 80 sát thương, tầm 1,6 m. Chảo đeo sau lưng chặn đạn trúng `pelvis` từ phía sau (góc > 120°).
- `Airdrop`:
  - 2–3 lần mỗi trận, thời điểm ngẫu nhiên sau GĐ1.
  - Máy bay nhỏ bay qua, thả hòm dù xuống 8 m/s tại điểm ngẫu nhiên trong bo trắng.
  - Khói đỏ 60 s. Đồ trong hòm lấy từ `rollLoot(rng,4)`.
- [ ] **Kiểm chứng:**
  - Ném lựu đạn vào bot và thấy sát thương. Ném khói, bot mất dấu.
  - Chảo chặn đạn, xác nhận qua test tay có log.
  - Thính rơi và mở được.
- [ ] Commit `feat: lựu đạn, khói, chảo, thính`.

### Task 19: Âm thanh procedural

**Files:** Create `src/audio/engine.js`, `src/audio/sfx.js` · Modify các module phát sự kiện

**Interfaces — Produces:**

- `audio.init()` (sau cú click đầu tiên) · `audio.setListener(camera)`
- `audio.play(name, {x,y,z, vol, rate, delayByDistance})` · `audio.loop(name, opts) → handle{setPos, setRate, setVol, stop}`
- Kênh: master → compressor; reverb bus (IR sinh bằng code); panner HRTF cho âm 3D.
- Tên âm thanh:
  - Súng: `gun_ar, gun_akm, gun_smg, gun_pistol, gun_dmr, gun_sniper, gun_shotgun, gun_suppressed, gun_distant`
  - Thao tác súng: `reload_out, reload_in, bolt, pump, dry`
  - Đạn: `impact_dirt, impact_metal, impact_wood, impact_flesh, helmet_ding, whiz, crack`
  - Bước chân: `step_grass, step_hard, step_wood`
  - Hành động: `jump, land, pickup, door, bandage, heal_done`
  - Hệ thống và phương tiện: `zone_alarm, plane_loop, engine_loop, wind_loop, ocean_loop, bird`
  - Nổ và dù: `explosion, pin, bounce, chute_open`
  - Giao diện: `ui_click, victory, death`
- Buffer tổng hợp một lần lúc init (noise lọc + oscillator + đường bao). Tiếng súng xa bị lọc thấp và trễ `dist/343` s.
- [ ] Triển khai. Có thể giao cho subagent vì module này độc lập: chỉ cần interface ở trên, không import module game.
- [ ] Nối các sự kiện: `shot`, `hit`, `impact`, `step`, `kill`, `zone`, `pickup`, `door`, xe, máy bay.
- [ ] **Kiểm chứng:** trang debug `__game.sound(name)` phát thử từng âm; console không có lỗi AudioContext. Đo tổng thời gian tổng hợp buffer < 400 ms.
- [ ] Commit `feat: âm thanh procedural 3D`.

### Task 20: Sảnh, cài đặt, loading, tạm dừng, hướng dẫn

**Files:** Create `src/ui/menu.js`, `src/ui/loading.js`, `src/ui/pause.js` · Modify `src/main.js`, `src/core/settings.js`, `src/styles.css`

**Interfaces — Produces:**

- **Loading:** thanh tiến trình theo từng bước sinh thế giới, kèm mẹo chơi luân phiên.
- **Sảnh:**
  - Nền 3D: camera lượn quanh nhân vật người chơi đứng trên đồi nhìn ra biển.
  - Tên game "ĐẢO SINH TỒN". Nút BẮT ĐẦU, CÀI ĐẶT, HƯỚNG DẪN. Ô nhập tên.
  - Thống kê (số trận, Top 1, hạ gục) lưu trong localStorage.
- **Cài đặt:** độ nhạy chuột / độ nhạy ADS, FOV 70–100, preset đồ họa, độ phân giải động, âm lượng tổng / hiệu ứng, ADS giữ hoặc bật, tốc độ trận (Chuẩn / Nhanh), hiện FPS.
- **Tạm dừng (Esc hoặc mất pointer lock):** Tiếp tục, Cài đặt, Thoát trận.
- **Hướng dẫn:** bảng phím.
- [ ] **Kiểm chứng:** chụp ảnh sảnh, cài đặt, hướng dẫn. Đổi preset thì FPS/hình thay đổi. Cài đặt còn nguyên sau khi reload.
- [ ] Commit `feat: sảnh, cài đặt, loading, tạm dừng`.

### Task 21: Đánh bóng hình ảnh và hiệu năng, cân bằng

**Files:** Modify `src/core/renderer.js`, `src/world/*`, `src/actors/rig.js`, `config.js`

- [ ] Đo 3 vị trí (thị trấn, rừng, bờ biển) × 4 preset → bảng FPS, draw call, số tam giác. Tối ưu cho tới khi đạt mục tiêu:
  - LOD, cull rig ở xa, gộp mesh.
  - Giới hạn shadow caster.
  - Độ phân giải động.
- [ ] Post FX:
  - Bloom nhẹ cho lửa nòng và mặt trời (preset Cao trở lên), GTAO cho Ultra.
  - Color grading: tăng tương phản nhẹ, ấm ở vùng sáng.
- [ ] Cân bằng:
  - Chạy 3 trận autopilot rồi xem phân bố thời lượng trận (mục tiêu 12–17 phút ở chế độ Chuẩn), số hạ gục của bot, và tỷ lệ bot chết vì bo (< 30%).
- [ ] Commit `perf/polish: tối ưu hiệu năng, post FX, cân bằng`.

### Task 22: Autopilot, kiểm chứng tổng, README, review

**Files:** Create `src/debug/autopilot.js`, `README.md` · Modify `src/debug/debugapi.js`

- [ ] `__game.autopilot(true)`: gắn `BotController` cho nhân vật người chơi. `__game.timescale(4)`.
- [ ] Chạy trọn trận autopilot với 3 seed. Với mỗi seed ghi lại: thời lượng, người thắng, số exception (phải bằng 0), FPS trung bình.
- [ ] Chơi tay một trận đầy đủ trong browser pane, chụp ảnh các mốc.
- [ ] `npm test` phải pass hết. `npm run build` không có cảnh báo lỗi.
- [ ] Dispatch subagent code-reviewer (soát độc lập) → sửa các lỗi có thật.
- [ ] Viết `README.md` (tiếng Việt): cách chạy, điều khiển, tính năng, nguồn asset CC0, ghi chú kỹ thuật.
- [ ] Commit `chore: autopilot, README, kiểm chứng cuối`.

---

## Self-review

- **Độ phủ spec:**

  | Mục spec                  | Task                     |
  | ------------------------- | ------------------------ |
  | §4 thế giới               | T3, T4, T7, T8           |
  | §5 nhân vật và điều khiển | T6                       |
  | §6 vũ khí                 | T10, T11, T18            |
  | §7 đồ và túi              | T9, T10, T12             |
  | §8 bot                    | T13                      |
  | §9 vòng trận              | T14, T15, T18            |
  | §10 xe và lựu đạn         | T17, T18                 |
  | §11 âm thanh              | T19                      |
  | §12 giao diện             | T12, T16, T20            |
  | §13 đồ họa và hiệu năng   | T4, T21                  |
  | §14 kiểm thử              | các test ở T2–T14 và T22 |

- **Placeholder:** không có. Các task hình ảnh dùng tiêu chí kiểm chứng cụ thể thay cho test code.
- **Nhất quán tên:** `Character.ctrl`, `CollisionWorld.moveBody`, `Loadout.addWeapon`, `ZoneSchedule.update`, `Pickups.crate`, và các sự kiện `shot|hit|impact|kill|matchEnd` được dùng thống nhất giữa các task.
