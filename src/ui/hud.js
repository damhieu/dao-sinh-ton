// In-game HUD (DOM): crosshair, hit markers, vitals, weapon/ammo, prompts, kill feed, counters,
// damage direction, action progress, scope overlay.
import { WEAPONS, ITEMS, ATTACHMENTS } from "../items/itemdefs.js";
import { magSize } from "../items/loadout.js";
import { events } from "../core/events.js";

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

const MODE_LABEL = { auto: "LIÊN THANH", single: "BẮN PHÁT MỘT" };
const USE_LABEL = {
  bandage: "Đang băng bó",
  firstaid: "Đang sơ cứu",
  medkit: "Đang dùng hộp y tế",
  energy: "Đang uống nước tăng lực",
  painkiller: "Đang uống thuốc giảm đau",
};

export class HUD {
  constructor(root, icons) {
    this.icons = icons;
    this.root = el("div", "hud", root);
    this.crosshair = el("div", "crosshair", this.root, "<i></i><i></i><i></i><i></i><b></b>");
    this.hitmarker = el("div", "hitmarker", this.root, "<i></i><i></i><i></i><i></i>");
    this.redDot = el("div", "reddot", this.root);
    this.scope = el("canvas", "scope", this.root);
    this.dmgDirs = el("div", "dmgdirs", this.root);
    this.prompt = el("div", "prompt", this.root);
    this.notice = el("div", "notice", this.root);
    this.subnotice = el("div", "subnotice", this.root);
    this.killfeed = el("div", "killfeed", this.root);
    this.counters = el("div", "counters", this.root);
    this.aliveBox = el(
      "div",
      "counter",
      this.counters,
      '<span class="n">0</span><span class="l">CÒN SỐNG</span>',
    );
    this.killBox = el(
      "div",
      "counter",
      this.counters,
      '<span class="n">0</span><span class="l">HẠ GỤC</span>',
    );
    this.zoneInfo = el("div", "zoneinfo", this.root);
    this.action = el(
      "div",
      "actionbar",
      this.root,
      '<div class="lbl"></div><div class="track"><div class="fill"></div></div>',
    );
    // vitals
    const vit = el("div", "vitals", this.root);
    this.gear = el("div", "gear", vit);
    this.gearHelmet = el("div", "gearitem", this.gear);
    this.gearVest = el("div", "gearitem", this.gear);
    this.gearPack = el("div", "gearitem", this.gear);
    const bars = el("div", "bars", vit);
    this.boost = el("div", "boost", bars, "<i></i><i></i><i></i><i></i>");
    this.health = el("div", "health", bars, '<div class="fill"></div><div class="ghost"></div>');
    this.consumables = el("div", "consumables", vit);
    // weapons
    this.weaponsBox = el("div", "weapons", this.root);
    this.ammo = el(
      "div",
      "ammo",
      this.weaponsBox,
      '<span class="mag">0</span><span class="sep">/</span><span class="res">0</span>',
    );
    this.wname = el("div", "wname", this.weaponsBox);
    this.wmode = el("div", "wmode", this.weaponsBox);
    this.slots = el("div", "slots", this.root);
    this.slotEls = [0, 1, 2, 3, 4].map((i) =>
      el("div", "slot", this.slots, `<span class="k">${i + 1}</span><img alt=""><span class="nm"></span>`),
    );
    this.cache = {};
    this.hitT = 0;
    this.dirs = [];
    this.noticeT = 0;
    this.subT = 0;
    this.feed = [];
    this.lastHealth = 100;
    this.ghostHealth = 100;
    this.bind();
    this.drawScope();
    addEventListener("resize", () => this.drawScope());
  }

  bind() {
    events.on("hit", (e) => {
      if (e.attacker && e.attacker.isPlayer) this.showHit(e.headshot ? "head" : "body");
    });
    events.on("kill", (e) => {
      if (e.killer && e.killer.isPlayer && !e.victim.isPlayer) {
        this.showHit("kill");
        this.showNotice(
          `BẠN ĐÃ HẠ GỤC <b>${esc(e.victim.name)}</b>`,
          e.headshot ? "BẰNG PHÁT BẮN VÀO ĐẦU" : `CÒN LẠI ${e.rank - 1} NGƯỜI`,
        );
      }
      this.addFeed(e);
    });
    events.on("damage", (e) => {
      if (e.target.isPlayer && (e.dirX || e.dirZ)) this.dirs.push({ x: e.dirX, z: e.dirZ, t: 1.2 });
    });
    events.on("pickupFail", (e) => {
      if (e.ch.isPlayer)
        this.showSub(e.reason === "heavy" ? "Balo mới không chứa đủ đồ đang mang" : "Túi đồ đã đầy");
    });
  }

  showHit(kind) {
    this.hitT = kind === "kill" ? 0.5 : 0.22;
    this.hitmarker.className = `hitmarker on ${kind}`;
  }

  showNotice(html, sub = "") {
    this.notice.innerHTML = `${html}${sub ? `<small>${sub}</small>` : ""}`;
    this.notice.classList.add("on");
    this.noticeT = 3;
  }

  showSub(text, t = 2.2) {
    this.subnotice.textContent = text;
    this.subnotice.classList.add("on");
    this.subT = t;
  }

  addFeed(e) {
    const killer = e.killer && e.killer !== e.victim ? e.killer.name : null;
    const how =
      e.kind === "zone"
        ? "chết trong bo"
        : e.kind === "fall"
          ? "ngã từ trên cao"
          : e.kind === "vehicle"
            ? "bị xe tông"
            : e.kind === "explosion"
              ? "[Lựu đạn]"
              : e.weapon
                ? `[${e.weapon.name}]`
                : "";
    const item = el("div", "feeditem");
    const kCls = e.killer && e.killer.isPlayer ? "me" : "";
    const vCls = e.victim.isPlayer ? "me" : "";
    item.innerHTML = killer
      ? `<span class="${kCls}">${esc(killer)}</span> <span class="w">${how}${e.headshot ? " ✦" : ""}</span> <span class="${vCls}">${esc(e.victim.name)}</span>`
      : `<span class="${vCls}">${esc(e.victim.name)}</span> <span class="w">${how}</span>`;
    this.killfeed.prepend(item);
    this.feed.push({ item, t: 7 });
    while (this.killfeed.children.length > 5) this.killfeed.lastChild.remove();
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  drawScope() {
    const c = this.scope;
    c.width = innerWidth;
    c.height = innerHeight;
    const g = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    const r = h * 0.44;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#000";
    g.beginPath();
    g.rect(0, 0, w, h);
    g.arc(w / 2, h / 2, r, 0, Math.PI * 2, true);
    g.fill();
    const grad = g.createRadialGradient(w / 2, h / 2, r * 0.8, w / 2, h / 2, r);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    g.fill();
    // reticle
    g.strokeStyle = "rgba(10,10,10,0.95)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w / 2 - r, h / 2);
    g.lineTo(w / 2 - 14, h / 2);
    g.moveTo(w / 2 + 14, h / 2);
    g.lineTo(w / 2 + r, h / 2);
    g.moveTo(w / 2, h / 2 - r);
    g.lineTo(w / 2, h / 2 - 14);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(w / 2 - r, h / 2);
    g.lineTo(w / 2 - r * 0.55, h / 2);
    g.moveTo(w / 2 + r * 0.55, h / 2);
    g.lineTo(w / 2 + r, h / 2);
    g.moveTo(w / 2, h / 2 + r * 0.55);
    g.lineTo(w / 2, h / 2 + r);
    g.stroke();
    // bullet drop marks (100 m steps)
    g.lineWidth = 2;
    for (let i = 1; i <= 5; i++) {
      const y = h / 2 + i * r * 0.065;
      const hw = 9 - i;
      g.beginPath();
      g.moveTo(w / 2 - hw, y);
      g.lineTo(w / 2 + hw, y);
      g.stroke();
    }
    g.fillStyle = "rgba(220,30,20,0.95)";
    g.beginPath();
    g.arc(w / 2, h / 2, 2.2, 0, Math.PI * 2);
    g.fill();
  }

  update(dt, m) {
    const p = m.player;
    const gc = m.gcam;
    const w = p.loadout.current();
    const def = w ? WEAPONS[w.id] : null;
    const zoom = w && w.att.sight ? ATTACHMENTS[w.att.sight].zoom : 1;
    const ads = gc.adsBlend > 0.6 && p.alive;
    const scoped = ads && zoom >= 4;
    const dotSight = ads && w && (w.att.sight === "reddot" || w.att.sight === "scope2x");
    // crosshair: hidden when aiming through sights
    const showCross = p.alive && p.mode === "ground" && !ads && def && def.cls !== "MELEE";
    this.set("cross", showCross, (v) => this.crosshair.classList.toggle("on", v));
    if (showCross) {
      const ws = p.ws || { bloom: 0 };
      const spread =
        (def.spread.hip + ws.bloom) *
        (1 + p.moveSpeed * 0.22) *
        (p.stance === "crouch" ? 0.82 : p.stance === "prone" ? 0.65 : 1);
      const px = Math.round(Math.min(90, 6 + spread * 7));
      this.set("gap", px, (v) => this.crosshair.style.setProperty("--gap", `${v}px`));
    }
    this.set("dot", !!dotSight, (v) => this.redDot.classList.toggle("on", v));
    this.set("scope", scoped, (v) => {
      this.scope.classList.toggle("on", v);
      m.ctx.screenFx.uniforms.uScope.value = 0;
    });
    // hit marker
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitmarker.classList.remove("on");
    }
    // damage direction arcs
    this.updateDirs(dt, p, gc);
    // interaction prompt
    const it = p.alive && p.mode === "ground" ? m.interactionTarget(p) : null;
    let prompt = "";
    if (it) {
      if (it.type === "door") prompt = m.world.doors.list[it.target].target > 0.5 ? "Đóng cửa" : "Mở cửa";
      else if (it.type === "crate")
        prompt =
          it.target.kind === "airdrop"
            ? "Mở thùng thính"
            : `Lục đồ ${esc(it.target.owner ? it.target.owner.name : "")}`;
      else {
        const d = ITEMS[it.target.id];
        prompt = `Nhặt ${d.name}${it.target.n > 1 ? ` (${it.target.n})` : ""}`;
      }
    }
    if (m.vehiclePrompt) prompt = m.vehiclePrompt;
    if (p.mode === "plane" && m.canJump) prompt = "Nhảy dù";
    if (p.mode === "freefall") prompt = "Mở dù";
    this.set("prompt", prompt, (v) => {
      this.prompt.innerHTML = v ? `<kbd>F</kbd>${v}` : "";
      this.prompt.classList.toggle("on", !!v);
    });
    // notices
    if (this.noticeT > 0 && (this.noticeT -= dt) <= 0) this.notice.classList.remove("on");
    if (this.subT > 0 && (this.subT -= dt) <= 0) this.subnotice.classList.remove("on");
    for (const f of this.feed) {
      f.t -= dt;
      if (f.t <= 0) f.item.classList.add("out");
    }
    this.feed = this.feed.filter((f) => f.t > -1);
    // counters
    this.set("alive", m.aliveCount, (v) => (this.aliveBox.firstChild.textContent = v));
    this.set("kills", p.stats.kills, (v) => (this.killBox.firstChild.textContent = v));
    // vitals
    const hp = Math.max(0, Math.round(p.health));
    this.set("hp", hp, (v) => {
      const fill = this.health.firstChild;
      fill.style.width = `${v}%`;
      this.health.classList.toggle("low", v <= 25);
      this.health.classList.toggle("mid", v > 25 && v <= 50);
    });
    this.ghostHealth = Math.max(hp, this.ghostHealth - dt * 25);
    this.set("ghost", Math.round(this.ghostHealth), (v) => (this.health.lastChild.style.width = `${v}%`));
    this.set("boost", Math.ceil(p.boost / 25), (v) => {
      [...this.boost.children].forEach((b, i) => {
        const seg = Math.min(1, Math.max(0, p.boost / 25 - i));
        b.style.setProperty("--f", seg.toFixed(2));
      });
    });
    [...this.boost.children].forEach((b, i) =>
      b.style.setProperty("--f", Math.min(1, Math.max(0, p.boost / 25 - i)).toFixed(2)),
    );
    const inv = p.inv;
    const gearHtml = (it, lvl, dur, max, id) =>
      lvl
        ? `<img src="${this.icons[id]}"><span class="lv">${lvl}</span><i style="--d:${Math.round((dur / max) * 100)}%"></i>`
        : "";
    this.set("helmet", inv.helmet ? `${inv.helmet.level}:${Math.round(inv.helmet.durability)}` : "", () => {
      this.gearHelmet.innerHTML = inv.helmet
        ? gearHtml("h", inv.helmet.level, inv.helmet.durability, inv.helmet.max, `helmet${inv.helmet.level}`)
        : "";
    });
    this.set("vest", inv.vest ? `${inv.vest.level}:${Math.round(inv.vest.durability)}` : "", () => {
      this.gearVest.innerHTML = inv.vest
        ? gearHtml("v", inv.vest.level, inv.vest.durability, inv.vest.max, `vest${inv.vest.level}`)
        : "";
    });
    this.set("pack", inv.backpack, (v) => {
      this.gearPack.innerHTML = v
        ? `<img src="${this.icons[`backpack${v}`]}"><span class="lv">${v}</span>`
        : "";
    });
    const cons = ["bandage", "firstaid", "medkit", "energy", "painkiller"]
      .map((id) => `${id}:${inv.count(id)}`)
      .join(",");
    this.set("cons", cons, () => {
      const keys = { bandage: "7", firstaid: "8", medkit: "9", energy: "0", painkiller: "0" };
      this.consumables.innerHTML = ["bandage", "firstaid", "medkit", "energy", "painkiller"]
        .filter((id) => inv.count(id) > 0)
        .map(
          (id) =>
            `<div class="cons"><img src="${this.icons[id]}"><span class="c">${inv.count(id)}</span><span class="k">${keys[id]}</span></div>`,
        )
        .join("");
    });
    // weapon + ammo
    const ammoRes = def && def.ammo ? inv.count(def.ammo) : 0;
    const wKey = w ? `${w.id}:${w.mag}:${ammoRes}:${w.mode}` : "";
    this.set("weapon", wKey, () => {
      this.weaponsBox.classList.toggle("on", !!w && def.cls !== "MELEE");
      if (!w) return;
      this.wname.textContent = def.name;
      this.ammo.querySelector(".mag").textContent = w.mag;
      this.ammo.querySelector(".mag").classList.toggle("low", w.mag <= Math.ceil(magSize(w) * 0.2));
      this.ammo.querySelector(".res").textContent = ammoRes;
      this.wmode.textContent = def.modes.length > 1 ? MODE_LABEL[w.mode] : "";
    });
    const slotKey =
      p.loadout.slots.map((s) => (s ? s.id : "-")).join(",") +
      `|${p.loadout.active}|${inv.count("frag")}|${inv.count("smoke")}`;
    this.set("slots", slotKey, () => {
      p.loadout.slots.forEach((s, i) => {
        const e = this.slotEls[i];
        let id = s ? s.id : null;
        if (i === 4) id = inv.count("frag") > 0 ? "frag" : inv.count("smoke") > 0 ? "smoke" : null;
        e.classList.toggle("has", !!id);
        e.classList.toggle("active", p.loadout.active === i);
        e.querySelector("img").src = id ? this.icons[id] : "";
        e.querySelector(".nm").textContent = id ? ITEMS[id].name : "";
      });
    });
    // action progress
    const a = p.action;
    const showAct = a && (a.type === "use" || a.type === "reload");
    this.set("act", showAct ? a.type + (a.item || "") : "", (v) => {
      this.action.classList.toggle("on", !!v);
      if (v)
        this.action.querySelector(".lbl").textContent = a.type === "use" ? USE_LABEL[a.item] : "Đang nạp đạn";
    });
    if (showAct) {
      this.action.querySelector(".fill").style.width = `${Math.min(100, (a.t / a.dur) * 100)}%`;
      this.action.querySelector(".lbl").dataset.t = Math.max(0, a.dur - a.t).toFixed(1);
    }
    // hide most HUD when the player is dead or spectating
    this.set("mode", `${p.alive}:${p.mode}`, () => this.root.classList.toggle("dead", !p.alive));
  }

  updateDirs(dt, p, gc) {
    // keep up to 4 arcs
    this.dirs = this.dirs.filter((d) => (d.t -= dt) > 0).slice(-4);
    while (this.dmgDirs.children.length < this.dirs.length) el("div", "dir", this.dmgDirs);
    [...this.dmgDirs.children].forEach((e, i) => {
      const d = this.dirs[i];
      if (!d) {
        e.style.opacity = 0;
        return;
      }
      // angle of the incoming direction relative to the view
      const ang = Math.atan2(d.x, -d.z) + gc.yaw;
      e.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
      e.style.opacity = Math.min(1, d.t);
    });
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
