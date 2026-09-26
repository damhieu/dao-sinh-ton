// Loading screen, main lobby, settings, controls help and pause menu (DOM).
import { QUALITY_PRESETS } from "../config.js";
import { saveSettings, loadStats } from "../core/settings.js";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const TIPS = [
  "Giữ chuột phải để ngắm qua ống ngắm — đạn chụm hơn rất nhiều so với bắn không ngắm.",
  "Đạn bay có độ rơi: ở cự ly xa hãy ngắm cao hơn mục tiêu một chút.",
  "Mũ và áo giáp giảm tới 55% sát thương. Mũ cấp 3 giúp bạn sống sót sau một phát Kar98k vào đầu.",
  "Vòng trắng trên bản đồ là vùng an toàn tiếp theo. Ở ngoài bo xanh bạn sẽ mất máu liên tục.",
  "Nhấn W khi rơi tự do để lao xuống nhanh hơn và tiếp đất trước đối thủ.",
  "Ngồi (C) hoặc nằm (Z) giúp giảm độ giật và khiến bạn khó bị phát hiện.",
  "Bụi cây che bạn khỏi tầm mắt đối thủ, nhưng không cản được đạn.",
  "Chảo đeo sau lưng có thể chặn đạn bắn vào mông bạn!",
  "Thùng thính có khói đỏ chứa AWM và giáp cấp 3 — nhưng cũng thu hút rất nhiều người.",
  "Nhấn Q/E để nghiêng người bắn qua góc tường.",
  "Tiếng súng hiện trên minimap bằng chấm đỏ. Hãy dùng nó để đoán vị trí đối thủ.",
  "Lái xe giúp di chuyển nhanh khi bo ở xa, nhưng tiếng động cơ sẽ làm lộ vị trí.",
];

const KEYS = [
  ["W A S D", "Di chuyển"],
  ["Shift", "Chạy nhanh"],
  ["Ctrl", "Đi bộ chậm"],
  ["Space", "Nhảy / phanh tay (khi lái xe)"],
  ["C / Z", "Ngồi / Nằm"],
  ["Q / E", "Nghiêng người trái / phải"],
  ["Chuột trái", "Bắn / ném lựu đạn (giữ để ngắm)"],
  ["Chuột phải", "Ngắm qua ống ngắm (ADS)"],
  ["R", "Nạp đạn"],
  ["B", "Đổi chế độ bắn"],
  ["1 2 3 4 5", "Chọn súng / chảo / lựu đạn"],
  ["X", "Cất súng"],
  ["F", "Nhặt đồ, mở cửa, lên xe, nhảy dù"],
  ["Tab", "Túi đồ"],
  ["M", "Bản đồ"],
  ["V", "Đổi góc nhìn thứ ba / thứ nhất"],
  ["Alt", "Nhìn tự do"],
  ["7 8 9 0", "Băng gạc / sơ cứu / hộp y tế / thuốc tăng lực"],
  ["Esc", "Tạm dừng"],
];

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class LoadingScreen {
  constructor(root) {
    this.el = el(
      "div",
      "loading on",
      root,
      `<div class="ld-inner"><div class="logo">ĐẢO SINH TỒN<small>BATTLE ROYALE · 50 NGƯỜI</small></div>
       <div class="ld-bar"><i></i></div><div class="ld-label">Đang khởi động…</div><div class="ld-tip"></div></div>`,
    );
    this.tipI = Math.floor(Math.random() * TIPS.length);
    this.nextTip();
    this.timer = setInterval(() => this.nextTip(), 4500);
  }
  nextTip() {
    this.el.querySelector(".ld-tip").textContent = `Mẹo: ${TIPS[this.tipI++ % TIPS.length]}`;
  }
  progress(p, label) {
    this.el.querySelector(".ld-bar i").style.width = `${Math.round(p * 100)}%`;
    this.el.querySelector(".ld-label").textContent = label;
  }
  hide() {
    clearInterval(this.timer);
    this.el.classList.remove("on");
  }
}

export class Menus {
  constructor(root, app, handlers) {
    this.app = app;
    this.h = handlers;
    // lobby
    this.lobby = el("div", "lobby", root);
    // modal layer (settings / help)
    this.modal = el("div", "modal", root);
    // pause
    this.pause = el(
      "div",
      "pause",
      root,
      `<div class="pz-inner"><h2>TẠM DỪNG</h2>
        <button data-a="resume">TIẾP TỤC</button>
        <button data-a="settings" class="ghost">CÀI ĐẶT</button>
        <button data-a="help" class="ghost">HƯỚNG DẪN</button>
        <button data-a="quit" class="ghost">THOÁT TRẬN</button></div>`,
    );
    this.pause.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "resume") this.h.resume();
      if (a === "settings") this.showSettings();
      if (a === "help") this.showHelp();
      if (a === "quit") this.h.quit();
    });
    this.fps = el("div", "fpscounter", root);
  }

  showLobby() {
    const s = this.app.settings;
    const st = loadStats();
    this.lobby.innerHTML = `
      <div class="lb-left">
        <div class="logo big">ĐẢO SINH TỒN<small>BATTLE ROYALE · ĐẢO HẢI ÂU</small></div>
        <label class="lb-name">Tên người chơi<input maxlength="18" value="${esc(s.name)}"></label>
        <button data-a="play" class="play">BẮT ĐẦU</button>
        <button data-a="training" class="ghost">LUYỆN TẬP</button>
        <button data-a="settings" class="ghost">CÀI ĐẶT</button>
        <button data-a="help" class="ghost">HƯỚNG DẪN</button>
        <div class="lb-mode">Solo · 50 người · Bo 7 giai đoạn${s.matchSpeed === "fast" ? " · Trận nhanh" : ""}</div>
      </div>
      <div class="lb-stats">
        <div><b>${st.matches}</b><span>Trận</span></div>
        <div><b>${st.wins}</b><span>Top 1</span></div>
        <div><b>${st.kills}</b><span>Hạ gục</span></div>
        <div><b>${st.bestRank ? "#" + st.bestRank : "—"}</b><span>Hạng cao nhất</span></div>
      </div>
      <div class="lb-credit">Texture &amp; bầu trời: Poly Haven (CC0) · Âm thanh tổng hợp bằng code</div>`;
    this.lobby.classList.add("on");
    const input = this.lobby.querySelector("input");
    input.addEventListener("change", () => {
      s.name = input.value.trim() || "Người chơi";
      saveSettings(s);
    });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    this.lobby.onclick = (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      s.name = input.value.trim() || "Người chơi";
      saveSettings(s);
      if (a === "play") this.h.play();
      if (a === "training") this.h.training();
      if (a === "settings") this.showSettings();
      if (a === "help") this.showHelp();
    };
  }

  hideLobby() {
    this.lobby.classList.remove("on");
  }

  showPause() {
    this.pause.classList.add("on");
  }

  hidePause() {
    this.pause.classList.remove("on");
    this.closeModal();
  }

  closeModal() {
    this.modal.classList.remove("on");
    this.modal.innerHTML = "";
  }

  showHelp() {
    this.modal.innerHTML = `<div class="md-inner"><h2>HƯỚNG DẪN</h2>
      <p class="md-goal">Nhảy dù xuống Đảo Hải Âu, nhặt vũ khí và trang bị, luôn ở trong vùng an toàn và trở thành người cuối cùng còn sống.</p>
      <table class="keys">${KEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join("")}</table>
      <button data-a="close">ĐÓNG</button></div>`;
    this.modal.classList.add("on");
    this.modal.onclick = (e) => e.target.closest("[data-a=close]") && this.closeModal();
  }

  showSettings() {
    const s = this.app.settings;
    const q = Object.entries(QUALITY_PRESETS)
      .map(([k, p]) => `<option value="${k}" ${s.quality === k ? "selected" : ""}>${p.label}</option>`)
      .join("");
    this.modal.innerHTML = `<div class="md-inner settings"><h2>CÀI ĐẶT</h2>
      <div class="grid">
        <label>Độ nhạy chuột <input type="range" name="sens" min="0.2" max="3" step="0.05" value="${s.sens}"><output>${s.sens}</output></label>
        <label>Độ nhạy khi ngắm <input type="range" name="adsSens" min="0.2" max="2" step="0.05" value="${s.adsSens}"><output>${s.adsSens}</output></label>
        <label>Góc nhìn (FOV) <input type="range" name="fov" min="70" max="100" step="1" value="${s.fov}"><output>${s.fov}</output></label>
        <label>Chất lượng đồ họa <select name="quality">${q}</select></label>
        <label class="chk"><input type="checkbox" name="dynamicRes" ${s.dynamicRes ? "checked" : ""}> Tự giảm độ phân giải để giữ FPS</label>
        <label class="chk"><input type="checkbox" name="showFps" ${s.showFps ? "checked" : ""}> Hiện FPS</label>
        <label>Âm lượng tổng <input type="range" name="masterVol" min="0" max="1" step="0.05" value="${s.masterVol}"><output>${Math.round(s.masterVol * 100)}</output></label>
        <label>Âm lượng hiệu ứng <input type="range" name="sfxVol" min="0" max="1" step="0.05" value="${s.sfxVol}"><output>${Math.round(s.sfxVol * 100)}</output></label>
        <label>Ngắm (chuột phải) <select name="adsHold"><option value="1" ${s.adsHold ? "selected" : ""}>Giữ</option><option value="0" ${!s.adsHold ? "selected" : ""}>Bật / tắt</option></select></label>
        <label class="chk"><input type="checkbox" name="invertY" ${s.invertY ? "checked" : ""}> Đảo trục chuột dọc</label>
        <label>Tốc độ trận <select name="matchSpeed"><option value="normal" ${s.matchSpeed === "normal" ? "selected" : ""}>Chuẩn (~15 phút)</option><option value="fast" ${s.matchSpeed === "fast" ? "selected" : ""}>Nhanh (~9 phút)</option></select></label>
      </div>
      <button data-a="close">XONG</button></div>`;
    this.modal.classList.add("on");
    this.modal.oninput = (e) => {
      const t = e.target;
      if (!t.name) return;
      let v = t.type === "checkbox" ? t.checked : t.type === "range" ? +t.value : t.value;
      if (t.name === "adsHold") v = t.value === "1";
      s[t.name] = v;
      const out = t.parentElement.querySelector("output");
      if (out) out.textContent = t.name.endsWith("Vol") ? Math.round(v * 100) : v;
      saveSettings(s);
      this.h.applySettings(t.name);
    };
    this.modal.onclick = (e) => e.target.closest("[data-a=close]") && this.closeModal();
  }

  updateFps(fps, show) {
    this.fps.style.display = show ? "block" : "none";
    if (show) this.fps.textContent = `${fps} FPS`;
  }
}
