# ĐẢO SINH TỒN — Battle Royale phong cách PUBG (Web / Three.js)

Ngày: 2026-09-26 · Trạng thái: chờ duyệt

Quyết định đã chốt: Web Three.js · Solo đấu 49 bot AI (tổng 50 người) · Model procedural + texture/HDRI CC0 từ Poly Haven · Giao diện tiếng Việt.

Tên game và tên địa danh là tên tự đặt. Không dùng logo, âm thanh hay asset của PUBG.

## 1. Mục tiêu và tiêu chí "xong"

Game bắn súng sinh tồn góc nhìn thứ ba (có FPP) chạy trên trình duyệt. Mỗi trận khoảng 15 phút: máy bay → nhảy dù → nhặt đồ → đấu súng, lái xe → bo thu hẹp → Top 1.

Chỉ coi là xong khi đã kiểm chứng thật từng mục sau:

1. `npm run dev` chạy được. Console không có lỗi nào trong suốt một trận.
2. Chơi tay trọn một trận trong trình duyệt: sảnh → máy bay → tiếp đất → nhặt súng → hạ bot → chạy bo → màn kết quả.
3. Chế độ autopilot (debug), với người chơi do AI điều khiển, chạy hết trận ở tốc độ x4 trên ít nhất 3 seed. Mỗi lần kết thúc phải còn đúng 1 người sống và không có exception.
4. Preset "Cao" trên máy này (M4) đạt ≥ 60 FPS khi đứng trong thị trấn có bot, và không tụt dưới 45 FPS lúc đấu súng.
5. `node --test` pass cho các logic thuần: sát thương/giáp, túi đồ/sức chứa, bảng loot, lịch bo, đạn đạo, sinh địa hình tất định.

**Ngoài phạm vi:** multiplayer, bot lái xe, lặn (chỉ bơi trên mặt nước), skin/cửa hàng, nhiều map, xếp hạng online.

## 2. Công nghệ

| Hạng mục    | Chọn                                                     | Lý do                                                                                              |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Build/dev   | Vite 8, JavaScript ES modules                            | Lặp nhanh, không cần bước type-check                                                               |
| 3D          | three.js 0.186 (WebGL2) + postprocessing addons          | Ổn định, đủ PBR/shadow/instancing                                                                  |
| Vật lý      | Tự viết: heightfield + AABB + trụ + cầu                  | Nhà sinh theo lưới vuông góc nên AABB đủ chính xác. Nhẹ và kiểm soát được hoàn toàn                |
| Âm thanh    | WebAudio tổng hợp procedural                             | Không cần file âm thanh, có âm thanh 3D HRTF và độ trễ theo khoảng cách                            |
| Asset ngoài | Texture PBR 1K + HDRI trời (Poly Haven, CC0)             | Tải bằng `tools/fetch-assets.mjs`, tối ưu bằng `sips`, commit vào repo (~20–25 MB) để chơi offline |
| Test        | `node --test` + E2E qua browser pane với `window.__game` | Không thêm dependency test                                                                         |

## 3. Kiến trúc module

Mỗi file lo đúng một việc. Logic thuần (không phụ thuộc three.js) tách riêng để unit test được.

```
src/
  main.js            khởi động: loading → sảnh → trận → kết quả
  config.js          hằng số cân bằng, preset đồ họa, lịch bo
  core/     renderer (renderer, composer, resize, chất lượng) · input (phím/chuột, pointer lock)
            loop (thời gian, timescale) · rng (seeded) · noise · events · assets · settings (localStorage)
  world/    heightmap* (sinh địa hình tất định, độ cao/pháp tuyến) · layout* (địa danh, đường, lô nhà)
            terrain (mesh theo chunk + shader splat) · water · sky (HDRI, mặt trời, sương mù)
            buildings (sinh nhà: geometry + collider + điểm loot + nav graph) · doors
            vegetation (cây/bụi/đá instanced + LOD) · grass (cỏ GPU quanh camera)
            collision (lưới không gian, raycast, đẩy capsule) · world (lắp ráp)
  actors/   character (trạng thái + di chuyển dùng chung người/bot) · rig (model instanced + animation thủ tục)
            player (điều khiển, camera TPP/FPP/ADS, tương tác) · bot (AI) · perception · navigation
  combat/   weapons (bắn, giật, nạp, chế độ bắn) · ballistics (đạn bay có rơi) · damage* · grenades
  items/    itemdefs* · inventory* · loot* · pickups (đồ dưới đất, instanced) · models (model súng/đồ thủ tục)
  match/    match (state machine, xếp hạng) · plane · zone* (lịch bo) + zonewall · airdrop · vehicles
  fx/       particles · tracers · decals · muzzle · screenfx (vignette, máu, bo xanh, scope)
  audio/    engine (bus, reverb, HRTF) · sfx (súng, bước chân, môi trường, UI)
  ui/       hud · compass · minimap · mapview · inventoryui · killfeed · menu · result · icons · styles.css
  debug/    debugapi (window.__game) · autopilot
tools/fetch-assets.mjs      tests/*.test.js      public/assets/{textures,hdri}
(* = logic thuần, có unit test)
```

**Luồng dữ liệu:** `loop` gọi `match.update(dt)` → input/AI → `character` (di chuyển + va chạm) → `weapons`/`ballistics` → `damage` → sự kiện (`events`: kill, hit, pickup, zone) → UI và âm thanh lắng nghe → `rig`/`pickups`/`fx` cập nhật instance → render.

Người chơi và bot dùng chung lớp `Character`, chỉ khác nguồn điều khiển (input so với AI). Nhờ vậy vật lý và luật chơi nhất quán cho cả hai.

## 4. Thế giới — "Đảo Hải Âu"

- **Kích thước:** thế giới 2048×2048 m, đảo chính khoảng 1,8 km, quanh là biển. Heightfield lưới 4 m (513×513), render chia chunk 128 m để frustum-cull.
- **Địa hình:** FBM kết hợp ridged noise (đồi đến ~90 m), mặt nạ đảo có bờ biển nhiễu, bãi cát. Thị trấn được san phẳng, đường nối các địa danh (spline) cũng san phẳng và vẽ vào splat mask.
- **Map cố định** (seed chọn lọc để tinh chỉnh chất lượng). Mỗi trận chỉ ngẫu nhiên loot, đường bay, bo, bot và xe.
- **8 địa danh:** Cảng Hải Âu (container, nhà kho), Phố Cổ (nhà dày đặc), Làng Chài, Căn Cứ Quân Sự (loot xịn), Nhà Máy Điện, Trạm Radar (đỉnh đồi), Nông Trại, Trường Học. Rải thêm nhà lẻ dọc đường.
- **Shader địa hình:** texture array gồm 5 lớp (cỏ, đất, đá, cát, nhựa đường), chọn lớp theo độ dốc, độ cao, noise và mask đường. Mỗi lớp lấy mẫu ở 2 tỉ lệ cộng biến thiên macro để giấu vết lặp. Có normal map.
- **Nhà (procedural):** tường dày 0,2 m, tầng cao 3,2 m, cửa ra vào 1,1×2,2 m, cửa sổ ở độ cao 0,9 m.
  - Loại: nhà nhỏ, nhà 2 tầng (có cầu thang), nhà kho, chung cư 3 tầng, container, lán tôn, doanh trại.
  - Cửa mở/đóng bằng F. Người và bot đều mở được. Collider của cửa bật/tắt theo trạng thái.
  - Nội thất dạng khối (bàn, giường, kệ, thùng) dùng làm chỗ nấp và điểm loot.
  - Nhà đặt xoay theo bội số 90° nên mọi collider đều là AABB.
  - Geometry gộp theo vật liệu và theo chunk để giảm draw call.
- **Thực vật:** khoảng 5.000 cây (thông, cây lá rộng) làm từ thân và cụm lá alpha-card có texture sinh bằng canvas. Khoảng 4.000 bụi, 800 đá (texture PBR). Tất cả dùng InstancedMesh với 2 mức LOD. Cỏ GPU trong bán kính 35–80 m quanh camera, lay theo gió, mật độ theo mask.
- **Nước:** shader tự viết gồm sóng procedural, Fresnel phản chiếu bầu trời, màu nông/sâu và bọt ven bờ (lấy mẫu heightmap để tính độ sâu). Bơi được trên mặt nước.
- **Ánh sáng:** HDRI "pure sky" 1K làm environment (PMREM). Ảnh nền tonemapped được thu về khoảng 6K. Hướng mặt trời tính từ điểm sáng nhất của HDRI. Shadow map theo người chơi, snap theo texel để không nhấp nháy. Sương mù tự viết giảm theo độ cao, ngả màu nắng về phía mặt trời. Tone mapping ACES.

## 5. Nhân vật và điều khiển

- **Model:** người procedural cao 1,8 m, khoảng 20 bộ phận: đầu, mũ (cấp 1/2/3), thân, hông, tay trên/dưới, bàn tay, đùi, cẳng, giày, áo giáp (cấp 1/2/3), balo (cấp 1/2/3).
  - Mỗi bộ phận là một InstancedMesh dùng chung cho mọi nhân vật, nên chỉ khoảng 20 draw call cho cả 50 người. Màu quần áo theo instance.
- **Animation thủ tục:** đi/chạy/nước rút (pha theo quãng đường), ngồi, nằm, nhảy, rơi tự do, dù, ngồi xe, nạp đạn, băng bó, chết (đổ người).
  - Thân trên xoay theo góc ngắm, súng gắn vào khung ngực.
- **Tốc độ (m/s):** đi 1,8 · chạy 4,7 · nước rút 6,3 · ngồi 2,8 · nằm 1,2 · ngắm 2,5 · bơi 2,5. Nhảy 4,5 m/s, trọng lực 15,7 m/s².
- **Camera:** TPP qua vai phải, co lại khi chạm tường. Alt = nhìn tự do. V = đổi TPP/FPP. Giữ chuột phải = ADS nhìn qua ống ngắm, FOV theo độ phóng (1×/2×/4×/8×). Viewmodel tay và súng được render ở pass riêng để không xuyên tường.
- **Phím điều khiển:**
  - Di chuyển: WASD · Shift nước rút · Ctrl đi bộ · C ngồi · Z nằm · Space nhảy/vượt vật cản thấp · Q/E nghiêng người.
  - Vũ khí: chuột trái bắn · R nạp · B chế độ bắn · 1/2 súng chính · 3 súng lục · 4 chảo · 5/G lựu đạn · X cất súng.
  - Tương tác và giao diện: F nhặt/mở cửa/lên xe · Tab túi đồ · M bản đồ.
  - Hồi máu: 7 băng gạc · 8 sơ cứu · 9 hộp y tế · 0 thuốc tăng lực.

## 6. Vũ khí và chiến đấu

| Súng                     | Loại      | Đạn  | ST                                     | Nhịp              | Băng (mở rộng) | V đạn m/s |
| ------------------------ | --------- | ---- | -------------------------------------- | ----------------- | -------------- | --------- |
| M416                     | AR        | 5.56 | 40                                     | 700 rpm, đơn/liên | 30 (40)        | 880       |
| SCAR-L                   | AR        | 5.56 | 41                                     | 625 rpm, đơn/liên | 30 (40)        | 870       |
| AKM                      | AR        | 7.62 | 47                                     | 600 rpm, đơn/liên | 30 (40)        | 715       |
| UMP45                    | SMG       | .45  | 39                                     | 670 rpm, đơn/liên | 25 (35)        | 360       |
| Micro UZI                | SMG       | 9mm  | 26                                     | 1200 rpm, liên    | 25 (35)        | 350       |
| SKS                      | DMR       | 7.62 | 53                                     | bán tự động       | 10 (20)        | 800       |
| Kar98k                   | SR        | 7.62 | 79                                     | lên đạn 1,9 s     | 5              | 760       |
| AWM (chỉ có trong thính) | SR        | .300 | 105                                    | lên đạn 1,85 s    | 5 (7)          | 945       |
| S1897                    | Shotgun   | 12G  | 9 viên × 26                            | bơm 0,75 s        | 5              | 360       |
| P92                      | Súng lục  | 9mm  | 35                                     | bán tự động       | 15 (20)        | 380       |
| Chảo                     | Cận chiến | —    | 80                                     | —                 | —              | —         |
| Lựu đạn nổ / khói        | Ném       | —    | 100 (bán kính 8 m) / khói che tầm nhìn | —                 | —              | —         |

- **Đạn đạo:** đạn là projectile có vận tốc và trọng lực, raycast theo đoạn mỗi frame. Va vào địa hình, AABB, thân cây và hitbox nhân vật. Không xuyên tường. Có vệt đạn (tracer).
- **Hitbox:** capsule theo từng bộ phận, lấy từ pose đang animate. Hệ số: đầu ×2,3 (SR ×2,5), thân ×1,0, tay/chân ×0,6.
- **Giáp:** mũ và áo cấp 1/2/3 giảm 30/40/55% sát thương vào vùng tương ứng. Độ bền mũ 80/150/230, áo 200/220/250. Độ bền trừ theo sát thương thô, về 0 thì giáp vỡ.
- **Cảm giác bắn:**
  - Mỗi súng có mẫu giật dọc/ngang riêng, hồi tâm sau khi ngừng bắn, rung camera.
  - Tâm giãn theo di chuyển. Ngồi, nằm và ADS giảm giật.
  - Có lửa đầu nòng, vỏ đạn văng, hit marker (đỏ khi hạ gục), hiệu ứng trúng vào đất/kim loại/gỗ/máu, lỗ đạn (pool decal).
- **Phụ kiện** (tự gắn khi nhặt nếu tương thích): Red Dot, 2×, 4×, 8× (8× chỉ cho DMR/SR) · bù giật (−15% giật) · giảm thanh (bot nghe được ở phạm vi ngắn hơn, không lửa đầu nòng) · băng mở rộng · tay cầm dọc (−20% giật dọc).
- **Chảo:** đánh cận chiến. Khi đeo sau lưng, chảo chặn đạn bắn trúng vùng hông từ phía sau.

## 7. Đồ nhặt và túi đồ

- **Đạn:** 5.56, 7.62, .45, 9mm, 12G, .300 Magnum (chỉ có trong thính).
- **Hồi máu:**
  - Băng gạc: +10 HP trong 4 s, tối đa đến 75.
  - Sơ cứu: hồi lên 75 trong 6 s.
  - Hộp y tế: hồi lên 100 trong 8 s.
  - Nước tăng lực: +40 boost. Thuốc giảm đau: +60 boost.
  - Boost giảm dần theo thời gian và hồi HP chậm. Boost trên 60 thì +5% tốc độ.
- **Sức chứa:** gốc 50 · balo cấp 1/2/3 +150/+200/+250 · áo giáp +50. Mỗi món có khối lượng (ví dụ đạn 5.56 là 0,5/viên, hộp y tế 20). Súng đi theo ô, không tính vào khối lượng.
- **Loot:** điểm loot sinh cùng nhà. Bảng loot có trọng số theo cấp địa danh (quân sự > thị trấn > nhà lẻ). Đồ dưới đất render instanced và hiện tên khi nhìn vào.
- **Hòm xác:** khi chết, toàn bộ đồ rơi vào một hòm nhặt được.
- **Túi đồ (Tab):** gồm ba cột.
  - Khu vực xung quanh: nhặt bằng click.
  - Balo: có thanh sức chứa, chuột phải để vứt, click để dùng.
  - Trang bị và súng: có ô phụ kiện.
  - Icon đồ được render từ chính model 3D lúc khởi động.

## 8. Bot AI

- **Số lượng:** 49 bot, tên kiểu game thủ Việt sinh ngẫu nhiên. Mỗi bot có kỹ năng (tân binh/trung bình/cao thủ) quyết định độ chính xác, thời gian phản ứng và độ hung hăng.
- **Ra quyết định** theo utility, tính ở 4–8 Hz, lệch pha giữa các bot. Các hành động:
  - Nhảy dù: chọn địa danh theo trọng số, lái dù tới đó.
  - Nhặt đồ: ưu tiên súng, đạn đúng loại, giáp, đồ hồi máu.
  - Chạy bo: tính thời gian còn lại và khoảng cách.
  - Giao tranh: ngắm có sai số giảm dần theo thời gian bám mục tiêu, bù chuyển động và độ rơi của đạn tùy kỹ năng, strafe, ngồi/nằm.
  - Tìm chỗ nấp, hồi máu khi an toàn, điều tra tiếng súng, giữ nhà khi cuối trận, bỏ chạy khi yếu.
- **Nhận thức:** góc nhìn 120°. Có "thanh phát hiện" tăng theo khoảng cách, tư thế (nằm khó thấy hơn), việc mục tiêu nằm trong bụi, khói và chuyển động. Tầm nhìn cần raycast LOS không bị chắn. Nghe được tiếng súng (khoảng 250 m, giảm thanh ~60 m) và bước chân gần.
- **Di chuyển:** ngoài trời dùng context steering (16 hướng, ray tránh vật cản) kèm phát hiện bị kẹt để đổi hướng. Trong nhà đi theo nav graph (cửa, phòng, cầu thang) do bộ sinh nhà xuất ra. Bot tự mở cửa.
- **LOD:** bot cách người chơi trên 350 m và không nhìn thấy được cập nhật ở tần số thấp, bắn nhau bằng hitscan xác suất (vẫn kiểm tra LOS) để trận vẫn diễn tiến mà tiết kiệm CPU.

## 9. Vòng trận

1. **Sảnh:** cảnh 3D với nhân vật và máy quay lượn, nút BẮT ĐẦU, Cài đặt, Hướng dẫn. Màn loading hiện mẹo chơi trong lúc sinh thế giới.
2. **Máy bay:** bay ngang đảo theo đường ngẫu nhiên, độ cao 500 m, 55 m/s. F để nhảy; tới cuối đường bay thì tự bị đẩy ra.
3. **Rơi tự do và dù:** rơi tự do (W để lao xuống nhanh hơn) rồi mở dù bằng F, dù tự bung ở 150 m. Bay dù xuống 5 m/s, tiến tối đa 15 m/s. Tầm với khoảng 600 m tính từ điểm nhảy.
4. **Bo:** 7 giai đoạn, tổng khoảng 15 phút. Tùy chọn "Trận nhanh" nhân thời gian ×0,6.
   - GĐ1: chờ 120 s, thu 120 s xuống bán kính 600 m, 0,5 HP/s.
   - Các giai đoạn sau: 350 → 200 → 110 → 55 → 25 → 0 m, sát thương 1 → 2 → 4 → 6 → 8 → 12 HP/s.
   - Tường bo xanh là shader năng lượng. Vòng trắng báo bo kế tiếp. Ở ngoài bo thì màn hình phủ xanh.
5. **Thính:** 2–3 lần mỗi trận. Máy bay thả hòm dù có khói đỏ, trong có AWM, giáp cấp 3, 8×, hộp y tế. Bot ở gần sẽ bị hòm thu hút.
6. **Kết thúc:**
   - Top 1 thắng: màn "WINNER WINNER CHICKEN DINNER!".
   - Chết: màn "CHÚC BẠN MAY MẮN LẦN SAU", kèm lựa chọn theo dõi kẻ hạ gục.
   - Màn kết quả có hạng #/50, số hạ gục, sát thương gây ra, quãng đường, thời gian sống, và hai nút CHƠI LẠI / VỀ SẢNH.

## 10. Xe cộ và lựu đạn

- **Xe:** 2 loại, xe Jeep (bền, chậm) và Buggy (nhanh, yếu), khoảng 20 chiếc dọc đường.
  - Vật lý: rigid body với 4 bánh raycast lên địa hình, treo lò xo, lái arcade, phanh tay Space.
  - Va chạm vật cản bằng vòng tròn đẩy; tông người thì gây sát thương theo tốc độ.
  - Xe trúng đạn bị hỏng, hết máu thì nổ.
  - Camera xe quay quanh bằng chuột. Bot không lái xe.
- **Lựu đạn:** giữ chuột trái để ném theo quỹ đạo có vạch preview. Lựu đạn nảy trên bề mặt, nổ sau 5 s, sát thương giảm theo khoảng cách và có kiểm tra che chắn. Khói tạo khối hạt che tầm nhìn bot. Bot ném lựu đạn vào mục tiêu đang nấp.

## 11. Âm thanh (procedural)

- **Tiếng súng:** 4 lớp là transient, burst noise lọc, thump tần số thấp và đuôi reverb (IR sinh bằng code). Mỗi loại súng có đặc tính riêng. Ở xa thì bị lọc thấp và trễ theo khoảng cách/343 m/s. Giảm thanh thì nhỏ và "phụt".
- **Âm 3D:** HRTF panner. Nghe được tiếng đạn rít và nổ gần tai khi đạn bay sượt, cùng bước chân theo bề mặt (cỏ/đường/sàn gỗ).
- **Môi trường:** tiếng gió, sóng biển gần bờ, chim thỉnh thoảng hót, động cơ máy bay/xe, gió lúc rơi tự do, tiếng dù, còi báo bo, âm UI, nhạc chiến thắng ngắn.

## 12. Giao diện (tiếng Việt, phong cách PUBG)

- **La bàn** trên cùng, có độ và điểm đánh dấu.
- **Góc phải trên:** số người còn sống, số hạ gục, trạng thái bo.
- **Góc trái trên:** kill feed.
- **Minimap** góc phải dưới: vòng bo, đường bay, đánh dấu, thính.
- **Giữa dưới:** thanh máu (đỏ dần khi yếu), thanh boost, icon mũ/áo/balo kèm độ bền. Góc phải dưới có ô súng, đạn trong băng/dự trữ, chế độ bắn.
- **Giữa màn hình:** tâm động, hit marker, gợi ý "[F] Nhặt M416", thông báo "Bạn đã hạ gục …", chỉ báo hướng bị bắn, màn đỏ khi máu thấp.
- **Bản đồ (M):** ảnh map sinh từ heightmap (hillshade, màu địa hình, đường, nhà, tên địa danh), lưới ô chữ-số, zoom/kéo được, click để đặt điểm đánh dấu.
- **Cài đặt** (lưu localStorage): độ nhạy chuột (thường/ADS), FOV, preset đồ họa, âm lượng, tốc độ trận, tên người chơi.

## 13. Đồ họa và hiệu năng

| Preset     | Render scale  | Shadow        | Cỏ   | Tầm nhìn | Post               |
| ---------- | ------------- | ------------- | ---- | -------- | ------------------ |
| Thấp       | 0,6           | 1024 / ±60 m  | tắt  | 600 m    | FXAA               |
| Trung bình | 0,8           | 2048 / ±80 m  | 35 m | 900 m    | SMAA               |
| Cao        | 1,0           | 4096 / ±90 m  | 60 m | 1200 m   | MSAA 4×, bloom nhẹ |
| Ultra      | theo DPR (≤2) | 4096 / ±120 m | 80 m | 1500 m   | + GTAO             |

- Có tùy chọn độ phân giải động để giữ FPS mục tiêu.
- Ngân sách: dưới 400 draw call, dưới 3 triệu tam giác mỗi frame, không cấp phát object trong vòng lặp nóng (dùng pool vector/particle).
- Hiệu ứng màn hình gộp vào một ShaderPass (vignette, màu, độ bão hòa theo máu, phủ xanh bo, viền đen scope).

## 14. Kiểm thử và kiểm chứng

- **Unit** (`node --test`): damage/giáp · inventory/sức chứa/phụ kiện · loot có trọng số · lịch bo (bán kính, thời điểm) · đạn đạo (độ rơi ở 100/300 m) · heightmap tất định theo seed.
- **Debug API `window.__game`:** seed, teleport, give item, timescale, bỏ qua máy bay, spawn bot, bật/tắt autopilot, đọc FPS và thống kê render.
- **E2E qua browser pane:**
  - Chụp màn hình từng milestone để soát hình ảnh.
  - Autopilot chạy trọn trận x4 trên 3 seed.
  - Đọc console lỗi.
  - Đo FPS và draw call ở 3 vị trí: thị trấn, rừng, bờ biển.
- **Cuối cùng:** subagent code-reviewer soát độc lập, subagent QA chạy regression.

## 15. Rủi ro và cách giảm

| Rủi ro                                      | Giảm thiểu                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| FPS thấp (map lớn, 50 bot, cỏ, bóng)        | Instancing toàn diện, chunk + frustum cull, LOD cây, bot LOD, preset + độ phân giải động, đo ở mỗi milestone   |
| Bot kẹt trong nhà/địa hình                  | Nav graph trong nhà, phát hiện kẹt, đổi hướng, dịch chuyển nhẹ khi kẹt lâu (chỉ khi ngoài tầm nhìn người chơi) |
| Trận không kết thúc (bot tránh nhau)        | Bo ép hội tụ, bot LOD vẫn bắn nhau, autopilot kiểm chứng                                                       |
| Va chạm xuyên tường khi chạy nhanh/xe       | Substep, giới hạn vận tốc/frame, collider tường dày tối thiểu 0,2 m                                            |
| Texture Poly Haven thay đổi URL             | Script dùng API chính thức, asset được commit vào repo                                                         |
| Pointer lock trong một số trình duyệt nhúng | Có thông báo "Click để chơi" và xử lý khi mất khóa chuột (tự mở menu tạm dừng)                                 |

## 16. Thứ tự triển khai (mỗi bước đều có kiểm chứng)

1. Khung dự án, tải asset, renderer, địa hình, bầu trời, nước, sương mù → ảnh chụp đảo đẹp, FPS ổn.
2. Va chạm, nhân vật, rig, animation, camera TPP/FPP, điều khiển → đi, chạy, nhảy, ngồi, nằm trên địa hình.
3. Bố cục địa danh, đường, nhà (cửa, cầu thang, nội thất), thực vật, cỏ → vào nhà, lên tầng, ảnh chụp thị trấn.
4. Item, loot, túi đồ, súng, đạn đạo, phụ kiện, ADS/scope, hiệu ứng bắn, HUD cơ bản → nhặt súng và bắn bia.
5. Sát thương/giáp, bot AI (nhặt, di chuyển, giao tranh), hòm xác, kill feed → đấu với bot.
6. Máy bay, dù, bo, thính, vòng trận, bản đồ/minimap/la bàn, màn kết quả → trọn một trận.
7. Xe, lựu đạn/khói, chảo.
8. Âm thanh.
9. Sảnh, cài đặt, hướng dẫn, đánh bóng hình ảnh (post FX, LOD), cân bằng.
10. Kiểm chứng tổng: unit test, autopilot 3 seed, chơi tay, đo FPS, code review, README.
