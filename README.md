# ĐẢO SINH TỒN

Game battle royale phong cách PUBG chạy ngay trên trình duyệt (three.js + WebGL2). Bạn nhảy dù xuống **Đảo Hải Âu** cùng 49 bot AI, nhặt vũ khí, trang bị, luôn ở trong vùng an toàn ("bo") và cố trở thành người cuối cùng còn sống.

**▶ Chơi ngay trên trình duyệt: https://damhieu.github.io/dao-sinh-ton/** (máy tính có chuột và bàn phím; lần đầu tải khoảng 40 MB).

Toàn bộ mô hình (nhân vật, súng, nhà cửa, xe, cây cối) và âm thanh được tạo bằng code. Texture và bầu trời lấy từ Poly Haven (CC0). Game không dùng logo, nhãn hiệu hay tài nguyên nào của PUBG.

## Tính năng chính

- **Đảo 2 × 2 km, 8 địa danh:** Phố Cổ, Cảng Hải Âu, Làng Chài, Căn Cứ Quân Sự, Nhà Máy Điện, Trạm Radar, Nông Trại và Trường Học.
  - Đường sá nối các địa danh.
  - Khoảng 150 ngôi nhà thuộc 11 kiểu, vào được bên trong, có cửa đóng/mở và cầu thang.
- **Vòng trận đầy đủ:** máy bay bay qua đảo, rơi tự do, mở dù, rồi 7 giai đoạn bo co lại (trận kéo dài khoảng 13–15 phút). Có thính (airdrop) thả dù kèm khói đỏ.
- **Vũ khí:**
  - 11 loại: M416, SCAR-L, AKM, UMP45, Micro UZI, SKS, Kar98k, AWM, S1897, P92 và chảo.
  - Phụ kiện: red dot, ống ngắm 2x/4x/8x, giảm thanh, bù giật, băng đạn mở rộng, tay cầm.
  - Đạn bay theo đường đạn có độ rơi. Sát thương thay đổi theo vùng trúng (đầu, thân, tay chân).
- **Trang bị:**
  - Mũ và giáp 3 cấp (có độ bền), balo 3 cấp.
  - Đồ hồi máu: băng gạc, sơ cứu, hộp y tế. Đồ tăng lực: nước tăng lực, thuốc giảm đau.
  - Lựu đạn nổ và lựu đạn khói.
- **Xe Jeep và Buggy** lái được, có thể cán người và phát nổ.
- **Bot AI:**
  - Nghe tiếng súng, nhìn có che khuất (bụi cây, khói).
  - Biết nhặt đồ, giao tranh, nấp, hồi máu, chạy bo và ném lựu đạn.
  - Tìm đường trong nhà bằng đồ thị điều hướng, ngoài trời bằng lưới A*.
- **Giao diện tiếng Việt:**
  - Trong trận: HUD, la bàn, minimap, bản đồ lớn có đánh dấu, túi đồ (click để nhặt/dùng/gắn, chuột phải để vứt), bảng tin hạ gục.
  - Ngoài trận: màn kết quả, chế độ theo dõi, sảnh 3D, luyện tập, cài đặt, hướng dẫn và thống kê.
- **Đồ họa:**
  - Địa hình PBR 5 lớp, bầu trời HDRI, sương mù theo độ cao, nước có sóng và bọt, bóng đổ.
  - Cỏ GPU và cây có gió.
  - Hiệu ứng màn hình khi trúng đạn, khi máu thấp và khi ở ngoài bo.

## Yêu cầu

- Node.js 20.19+ hoặc 22.12+.
- Trình duyệt hỗ trợ WebGL2: Chrome, Edge, Firefox hoặc Safari bản mới.
- Chuột và bàn phím.

## Chạy game

```bash
npm install
npm run dev
```

Mở **http://localhost:5180** rồi bấm **BẮT ĐẦU**. Click vào màn hình để khoá chuột. Nhấn Esc để tạm dừng.

Các lệnh khác:

| Lệnh                   | Tác dụng                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run build`        | Build bản production vào `dist/`                                     |
| `npm run preview`      | Chạy thử bản build                                                   |
| `npm test`             | Chạy unit test (`node --test`)                                       |
| `npm run fetch-assets` | Tải lại texture/HDRI từ Poly Haven (đã có sẵn trong `public/assets`) |

Mỗi lần push lên nhánh `main`, GitHub Actions ([deploy.yml](.github/workflows/deploy.yml)) chạy test, build rồi đăng bản mới lên GitHub Pages.

## Điều khiển

| Phím       | Chức năng                                              |
| ---------- | ------------------------------------------------------ |
| W A S D    | Di chuyển                                              |
| Shift      | Chạy nhanh                                             |
| Ctrl       | Đi bộ chậm                                             |
| Space      | Nhảy / phanh tay (khi lái xe)                          |
| C / Z      | Ngồi / Nằm                                             |
| Q / E      | Nghiêng người trái / phải                              |
| Chuột trái | Bắn / ném lựu đạn (giữ để ngắm)                        |
| Chuột phải | Ngắm qua ống ngắm (ADS)                                |
| R          | Nạp đạn                                                |
| B          | Đổi chế độ bắn                                         |
| 1 2 3 4 5  | Chọn súng chính / súng phụ / súng lục / chảo / lựu đạn |
| X          | Cất súng                                               |
| F          | Nhặt đồ, mở cửa, lên xe, nhảy khỏi máy bay, mở dù      |
| Tab        | Túi đồ                                                 |
| M          | Bản đồ                                                 |
| V          | Đổi góc nhìn thứ ba / thứ nhất                         |
| Alt        | Nhìn tự do                                             |
| 7 8 9 0    | Băng gạc / sơ cứu / hộp y tế / đồ tăng lực             |
| Esc        | Tạm dừng                                               |

## Cài đặt đồ họa

Vào **CÀI ĐẶT** để chọn 1 trong 4 mức đồ họa:

| Mức            | Độ phân giải         | MSAA | Bóng đổ        | Cỏ       | Tầm nhìn         |
| -------------- | -------------------- | ---- | -------------- | -------- | ---------------- |
| Thấp           | 60%                  | tắt  | 1024 px, 60 m  | tắt      | 650 m            |
| Trung bình     | 80%                  | 2x   | 2048 px, 75 m  | có       | 900 m            |
| Cao (mặc định) | 100%                 | 4x   | 2048 px, 90 m  | dày      | 1200 m           |
| Ultra          | theo màn hình Retina | 4x   | 4096 px, 120 m | dày nhất | 1500 m, có bloom |

Tuỳ chọn **"Tự giảm độ phân giải để giữ FPS"** được bật sẵn. Khi máy không giữ nổi khoảng 60 FPS, game hạ độ phân giải một chút. Trong cài đặt còn có độ nhạy chuột, FOV, âm lượng, chế độ giữ/bật ngắm và tốc độ trận.

## Tham số URL (dành cho phát triển)

| Tham số     | Tác dụng                                                            |
| ----------- | ------------------------------------------------------------------- |
| `?play`     | Vào thẳng trận                                                      |
| `?sandbox`  | Vào thẳng bãi luyện tập                                             |
| `?seed=123` | Cố định seed của trận (vị trí đồ, bot, bo)                          |
| `?bots=20`  | Đổi số bot                                                          |
| `?debug`    | Bật `window.__game` để điều khiển/đo bằng code, phím P để bay tự do |

## Cấu trúc mã nguồn

```
src/
  core/     renderer, input, rng, noise, settings, tải asset
  world/    sinh địa hình, bầu trời, nước, nhà, cửa, cây, cỏ, va chạm, lưới dẫn đường
  actors/   nhân vật + animation, camera, người chơi, bot AI, nhận thức, điều hướng
  items/    định nghĩa vật phẩm, túi đồ, bảng loot, mô hình súng, đồ dưới đất
  combat/   vũ khí, đạn đạo, sát thương, lựu đạn
  match/    trận đấu, bo, máy bay, thính, xe
  fx/       hạt, vệt đạn, vết đạn, ánh lửa đầu nòng
  ui/       HUD, túi đồ, bản đồ, màn kết quả, menu
  audio/    âm thanh tổng hợp bằng WebAudio
tests/      unit test cho các module thuần (không cần trình duyệt)
```

## Nguồn tài nguyên và giấy phép

- **Texture:** [Poly Haven](https://polyhaven.com), giấy phép CC0.
  - Mặt đất và đá: leafy_grass, forest_ground_04, aerial_rocks_02, coast_sand_01, asphalt_02, rock_boulder_dry.
  - Tường và sàn: painted_plaster_wall, red_brick_plaster_patch_02, concrete_wall_003, wood_planks_dirt, concrete_floor_02.
  - Mái và kim loại: clay_roof_tiles_02, corrugated_iron_02, rusty_corrugated_iron.
  - Vỏ cây: pine_bark.
- **Bầu trời HDRI:** [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) của Poly Haven, giấy phép CC0.
- **Font chữ:** Barlow Condensed và Be Vietnam Pro (Google Fonts, SIL Open Font License).
- **Thư viện:** [three.js](https://threejs.org) (MIT). Công cụ build: [Vite](https://vite.dev) (MIT).
- **Tự tạo bằng code:** mô hình, âm thanh, lá cây và tên bot.
