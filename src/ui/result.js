// End-of-match screen: win ("WINNER WINNER CHICKEN DINNER!") or defeat, with stats and actions.
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export class ResultScreen {
  constructor(root, handlers) {
    this.el = document.createElement("div");
    this.el.className = "result";
    root.appendChild(this.el);
    this.handlers = handlers;
    this.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (b && this.handlers[b.dataset.act]) this.handlers[b.dataset.act]();
    });
  }

  show({ win, rank, total, stats, killer, name, canSpectate }) {
    const mins = Math.floor(stats.timeAlive / 60);
    const secs = Math.floor(stats.timeAlive % 60);
    this.el.innerHTML = `
      <div class="res-inner ${win ? "win" : "lose"}">
        <div class="res-name">${esc(name)}</div>
        <div class="res-title">${win ? "WINNER WINNER CHICKEN DINNER!" : "CHÚC BẠN MAY MẮN LẦN SAU"}</div>
        ${!win && killer ? `<div class="res-killer">Bị hạ gục bởi <b>${esc(killer)}</b></div>` : ""}
        <div class="res-rank"><span>#${rank}</span><small>/${total}</small></div>
        <div class="res-stats">
          <div><b>${stats.kills}</b><span>Hạ gục</span></div>
          <div><b>${Math.round(stats.damage)}</b><span>Sát thương</span></div>
          <div><b>${stats.headshots}</b><span>Bắn vào đầu</span></div>
          <div><b>${(stats.distance / 1000).toFixed(2)} km</b><span>Quãng đường</span></div>
          <div><b>${mins}:${String(secs).padStart(2, "0")}</b><span>Thời gian sống</span></div>
        </div>
        <div class="res-actions">
          ${canSpectate ? `<button data-act="spectate" class="ghost">THEO DÕI</button>` : ""}
          <button data-act="lobby" class="ghost">VỀ SẢNH</button>
          <button data-act="restart">CHƠI LẠI</button>
        </div>
      </div>`;
    this.el.classList.add("on");
  }

  hide() {
    this.el.classList.remove("on");
  }

  get visible() {
    return this.el.classList.contains("on");
  }
}
