// Inventory screen (Tab): vicinity/crate items, backpack contents with capacity, equipment and weapons.
import { ITEMS, WEAPONS, SLOT_NAMES } from "../items/itemdefs.js";
import { magSize } from "../items/loadout.js";

const ATT_SLOTS = [
  ["sight", "Ống ngắm"],
  ["muzzle", "Nòng"],
  ["grip", "Tay cầm"],
  ["mag", "Băng đạn"],
];
const CAT_ORDER = { weapon: 0, ammo: 1, attachment: 2, heal: 3, boost: 4, throwable: 5 };
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export class InventoryUI {
  constructor(root, icons) {
    this.icons = icons;
    this.el = document.createElement("div");
    this.el.className = "inventory";
    this.el.innerHTML = `
      <div class="col vicinity"><h3>XUNG QUANH</h3><div class="list"></div></div>
      <div class="col bag"><h3>BALO <span class="cap"></span></h3><div class="capbar"><i></i></div><div class="list"></div></div>
      <div class="col equip"><h3>TRANG BỊ</h3><div class="armor"></div><div class="guns"></div></div>
      <div class="hint">Click: nhặt / dùng / gắn · Chuột phải: vứt · Tab: đóng</div>`;
    root.appendChild(this.el);
    this.open = false;
    this.key = "";
    this.match = null;
    this.crate = null;
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.el.addEventListener("mousedown", (e) => this.onClick(e));
  }

  toggle(match, force) {
    this.open = force ?? !this.open;
    this.match = match;
    this.el.classList.toggle("on", this.open);
    this.key = "";
    if (!this.open) this.crate = null;
    return this.open;
  }

  openCrate(match, crate) {
    this.crate = crate;
    this.toggle(match, true);
  }

  onClick(e) {
    const row = e.target.closest("[data-act]");
    if (!row || !this.match) return;
    e.preventDefault();
    const m = this.match;
    const p = m.player;
    const right = e.button === 2;
    const act = row.dataset.act;
    const arg = row.dataset.arg;
    if (act === "ground") {
      const pk = [...m.pickups.list].find((q) => q.uid === +arg);
      if (pk) m.takePickup(p, pk);
    } else if (act === "crate") {
      const [uid, idx] = arg.split(":").map(Number);
      const crate = [...m.pickups.list].find((q) => q.uid === uid);
      if (crate) {
        m.takeFromCrate(p, crate, idx);
        if (!crate.items.length) m.pickups.remove(crate);
      }
    } else if (act === "bag") {
      const def = ITEMS[arg];
      if (right) m.dropItem(p, arg, p.inv.count(arg));
      else if (def.cat === "heal" || def.cat === "boost") m.weapons.startUse(p, arg);
      else if (def.cat === "attachment") {
        if (p.loadout.autoAttach(arg) >= 0) p.inv.remove(arg, 1);
      } else if (def.cat === "throwable") m.weapons.switchTo(p, 4);
    } else if (act === "armor") {
      if (right) this.dropArmor(arg);
    } else if (act === "gun") {
      const slot = +arg;
      if (right) {
        const w = p.loadout.removeSlot(slot);
        if (w) m.dropWeapon(p, w);
      } else m.weapons.switchTo(p, slot);
    } else if (act === "att") {
      const [slot, attSlot] = arg.split(":");
      const id = p.loadout.detach(+slot, attSlot);
      if (id) {
        if (right || p.inv.add(id, 1) === 0) m.pickups.spawn(id, 1, p.body.x, p.body.y + 0.05, p.body.z);
      }
    }
    this.key = "";
  }

  dropArmor(kind) {
    const m = this.match;
    const p = m.player;
    const b = p.body;
    if (kind === "backpack") {
      const lvl = p.inv.backpack;
      if (!lvl || p.inv.weight() > p.inv.capacity(0)) return;
      p.inv.backpack = 0;
      m.pickups.spawn(`backpack${lvl}`, 1, b.x, b.y + 0.05, b.z);
    } else {
      const a = p.inv[kind];
      if (!a) return;
      if (kind === "vest" && !p.inv.canRemoveVest()) return;
      p.inv[kind] = null;
      m.pickups.spawn(`${kind}${a.level}`, 1, b.x, b.y + 0.05, b.z, { durability: a.durability });
    }
  }

  row(act, arg, id, name, count, extra = "") {
    return `<div class="row" data-act="${act}" data-arg="${arg}"><img src="${this.icons[id] || ""}"><span class="nm">${esc(name)}</span>${extra}<span class="ct">${count > 1 ? count : ""}</span></div>`;
  }

  update(match) {
    if (!this.open) return;
    const p = match.player;
    const inv = p.inv;
    const b = p.body;
    const near = match.pickups.near(b.x, b.y + 0.2, b.z, 3, []);
    const crates = near.filter((q) => q.crate);
    if (this.crate && !crates.includes(this.crate)) this.crate = null;
    const key =
      near.map((q) => `${q.uid}:${q.n}:${q.crate ? q.items.length : ""}`).join(",") +
      "|" +
      [...inv.items].join(",") +
      `|${JSON.stringify(inv.helmet)}|${JSON.stringify(inv.vest)}|${inv.backpack}|` +
      JSON.stringify(p.loadout.slots) +
      p.loadout.active;
    if (key === this.key) return;
    this.key = key;
    // vicinity
    let v = "";
    for (const c of crates) {
      v += `<div class="group">${c.kind === "airdrop" ? "THÙNG THÍNH" : `HÒM ĐỒ · ${esc(c.owner ? c.owner.name : "")}`}</div>`;
      c.items.forEach((it, i) => (v += this.row("crate", `${c.uid}:${i}`, it.id, ITEMS[it.id].name, it.n)));
    }
    const ground = near
      .filter((q) => !q.crate)
      .sort((a, c) => (CAT_ORDER[ITEMS[a.id].cat] ?? 9) - (CAT_ORDER[ITEMS[c.id].cat] ?? 9));
    if (ground.length) v += `<div class="group">DƯỚI ĐẤT</div>`;
    for (const q of ground) v += this.row("ground", q.uid, q.id, ITEMS[q.id].name, q.n);
    this.el.querySelector(".vicinity .list").innerHTML =
      v || `<div class="empty">Không có đồ xung quanh</div>`;
    // bag
    const cap = inv.capacity();
    const wt = inv.weight();
    this.el.querySelector(".bag .cap").textContent = `${Math.round(wt)} / ${cap}`;
    this.el.querySelector(".capbar i").style.width = `${Math.min(100, (wt / cap) * 100)}%`;
    const items = [...inv.items.entries()].sort(
      (a, c) => (CAT_ORDER[ITEMS[a[0]].cat] ?? 9) - (CAT_ORDER[ITEMS[c[0]].cat] ?? 9),
    );
    this.el.querySelector(".bag .list").innerHTML =
      items.map(([id, n]) => this.row("bag", id, id, ITEMS[id].name, n)).join("") ||
      `<div class="empty">Balo trống</div>`;
    // armor
    const armor = [
      ["helmet", inv.helmet ? `helmet${inv.helmet.level}` : null, inv.helmet],
      ["vest", inv.vest ? `vest${inv.vest.level}` : null, inv.vest],
      ["backpack", inv.backpack ? `backpack${inv.backpack}` : null, null],
    ];
    this.el.querySelector(".armor").innerHTML = armor
      .map(([k, id, a]) =>
        id
          ? `<div class="aslot" data-act="armor" data-arg="${k}"><img src="${this.icons[id]}"><span>${ITEMS[id].name}</span>${a ? `<i style="--d:${Math.round((a.durability / a.max) * 100)}%"></i>` : ""}</div>`
          : `<div class="aslot empty"><span>${k === "helmet" ? "Mũ" : k === "vest" ? "Giáp" : "Balo"}</span></div>`,
      )
      .join("");
    // weapons with attachment slots
    let gh = "";
    for (let s = 0; s < 4; s++) {
      const w = p.loadout.slots[s];
      if (!w) {
        gh += `<div class="gun empty"><span class="sl">${SLOT_NAMES[s]}</span></div>`;
        continue;
      }
      const def = WEAPONS[w.id];
      const atts = ATT_SLOTS.filter(([slot]) => def.slots.includes(slot))
        .map(([slot, label]) => {
          const a = w.att[slot];
          return a
            ? `<div class="att" data-act="att" data-arg="${s}:${slot}" title="${label}"><img src="${this.icons[a]}"></div>`
            : `<div class="att empty" title="${label}"><span>${label}</span></div>`;
        })
        .join("");
      const ammo = def.ammo ? `${w.mag}/${magSize(w)} · ${ITEMS[def.ammo].name}` : "";
      gh += `<div class="gun ${p.loadout.active === s ? "active" : ""}" data-act="gun" data-arg="${s}">
        <span class="sl">${SLOT_NAMES[s]}</span><img class="gi" src="${this.icons[w.id]}"><span class="gn">${def.name}</span>
        <span class="ga">${ammo}</span><div class="atts">${atts}</div></div>`;
    }
    this.el.querySelector(".guns").innerHTML = gh;
  }
}
