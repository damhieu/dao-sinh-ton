// Minimap (bottom right), full map (M) and compass (top) — all canvas based.
import { events } from "../core/events.js";

const LETTERS = "ABCDEFGH";
const HEAD_LABELS = { 0: "B", 45: "ĐB", 90: "Đ", 135: "ĐN", 180: "N", 225: "TN", 270: "T", 315: "TB" };

function drawArrow(g, x, y, yaw, size, color) {
  // yaw 0 = north (-z = up on the map)
  g.save();
  g.translate(x, y);
  g.rotate(-yaw);
  g.fillStyle = color;
  g.strokeStyle = "rgba(0,0,0,0.8)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.62, size * 0.7);
  g.lineTo(0, size * 0.35);
  g.lineTo(-size * 0.62, size * 0.7);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

function drawZone(g, zone, toX, toY, scale, w, h) {
  if (!zone || zone.state === "idle") return;
  // blue outside the current circle
  g.save();
  g.fillStyle = "rgba(40, 90, 230, 0.28)";
  g.beginPath();
  g.rect(0, 0, w, h);
  g.arc(toX(zone.cur.x), toY(zone.cur.z), Math.max(0, zone.cur.r * scale), 0, Math.PI * 2, true);
  g.fill("evenodd");
  g.strokeStyle = "rgba(80, 140, 255, 0.95)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(toX(zone.cur.x), toY(zone.cur.z), Math.max(0, zone.cur.r * scale), 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(toX(zone.next.x), toY(zone.next.z), Math.max(0, zone.next.r * scale), 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

export class Maps {
  constructor(root, mapImage, world) {
    this.img = mapImage;
    this.world = world;
    this.half = world.hm.half;
    this.size = world.hm.size;
    // minimap
    this.mini = document.createElement("canvas");
    this.mini.className = "minimap";
    this.mini.width = this.mini.height = 220;
    root.appendChild(this.mini);
    // compass
    this.compass = document.createElement("canvas");
    this.compass.className = "compass";
    this.compass.width = 640;
    this.compass.height = 46;
    root.appendChild(this.compass);
    // full map
    this.full = document.createElement("div");
    this.full.className = "fullmap";
    this.fullCanvas = document.createElement("canvas");
    this.full.appendChild(this.fullCanvas);
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML =
      "<kbd>M</kbd>Đóng bản đồ · Cuộn: phóng to · Kéo: di chuyển · Chuột phải: đặt/xoá điểm đánh dấu";
    this.full.appendChild(legend);
    root.appendChild(this.full);
    this.open = false;
    this.zoom = 1;
    this.panX = 0;
    this.panZ = 0;
    this.marker = null;
    this.shots = [];
    this.bindFull();
    events.on("shot", (e) => {
      if (e.ch.isPlayer || e.suppressed) return;
      this.shots.push({ x: e.x, z: e.z, t: 2.5 });
      if (this.shots.length > 20) this.shots.shift();
    });
  }

  bindFull() {
    const c = this.fullCanvas;
    let drag = null;
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom = Math.min(6, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    });
    c.addEventListener("mousedown", (e) => {
      if (e.button === 0) drag = { x: e.clientX, y: e.clientY, px: this.panX, pz: this.panZ };
      if (e.button === 2) {
        const w = this.screenToWorld(e.offsetX, e.offsetY);
        if (this.marker && Math.hypot(this.marker.x - w.x, this.marker.z - w.z) < 30 / this.zoom)
          this.marker = null;
        else this.marker = w;
      }
    });
    addEventListener("mousemove", (e) => {
      if (!drag) return;
      const s = this.fullScale();
      this.panX = drag.px - (e.clientX - drag.x) / s;
      this.panZ = drag.pz - (e.clientY - drag.y) / s;
    });
    addEventListener("mouseup", () => (drag = null));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  fullScale() {
    const c = this.fullCanvas;
    return (Math.min(c.width, c.height) / this.size) * this.zoom;
  }

  screenToWorld(sx, sy) {
    const c = this.fullCanvas;
    const s = this.fullScale();
    return { x: (sx - c.width / 2) / s + this.panX, z: (sy - c.height / 2) / s + this.panZ };
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.full.classList.toggle("on", this.open);
    return this.open;
  }

  update(dt, m) {
    this.shots = this.shots.filter((s) => (s.t -= dt) > 0);
    const p = m.player;
    const focus = p.alive ? p : m.spectating || p;
    this.drawMini(m, focus);
    this.drawCompass(m);
    if (this.open) this.drawFull(m);
  }

  drawMini(m, focus) {
    const g = this.mini.getContext("2d");
    const W = this.mini.width;
    const view = 420; // meters across
    const scale = W / view;
    const cx = focus.body.x;
    const cz = focus.body.z;
    const toX = (x) => (x - cx) * scale + W / 2;
    const toY = (z) => (z - cz) * scale + W / 2;
    g.clearRect(0, 0, W, W);
    const ip = this.img.width / this.size;
    g.imageSmoothingEnabled = true;
    g.drawImage(
      this.img,
      (cx - view / 2 + this.half) * ip,
      (cz - view / 2 + this.half) * ip,
      view * ip,
      view * ip,
      0,
      0,
      W,
      W,
    );
    drawZone(g, m.zone, toX, toY, scale, W, W);
    if (m.plane) this.drawPlanePath(g, m.plane, toX, toY);
    for (const a of m.airdrops || []) {
      const pos = a.crate || a;
      this.drawAirdrop(g, toX(pos.x), toY(pos.z), 5);
    }
    for (const s of this.shots) {
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d > 300) continue;
      g.fillStyle = `rgba(255,70,50,${Math.min(1, s.t)})`;
      g.beginPath();
      g.arc(
        Math.max(6, Math.min(W - 6, toX(s.x))),
        Math.max(6, Math.min(W - 6, toY(s.z))),
        3.5,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    if (this.marker)
      this.drawMarker(
        g,
        Math.max(8, Math.min(W - 8, toX(this.marker.x))),
        Math.max(8, Math.min(W - 8, toY(this.marker.z))),
      );
    drawArrow(g, W / 2, W / 2, m.gcam.yaw, 7, "#ffd23a");
  }

  drawPlanePath(g, plane, toX, toY) {
    g.save();
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.setLineDash([6, 5]);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(toX(plane.start.x), toY(plane.start.z));
    g.lineTo(toX(plane.end.x), toY(plane.end.z));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(toX(plane.pos.x), toY(plane.pos.z), 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  drawAirdrop(g, x, y, s) {
    g.fillStyle = "#e03a2a";
    g.fillRect(x - s, y - s, s * 2, s * 2);
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    g.strokeRect(x - s, y - s, s * 2, s * 2);
  }

  drawMarker(g, x, y) {
    g.fillStyle = "#ffd23a";
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 6, y - 12);
    g.lineTo(x + 6, y - 12);
    g.closePath();
    g.fill();
    g.stroke();
  }

  drawCompass(m) {
    const g = this.compass.getContext("2d");
    const W = this.compass.width;
    const H = this.compass.height;
    g.clearRect(0, 0, W, H);
    const heading = ((((-m.gcam.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const pxPerDeg = W / 140;
    g.font = "600 14px 'Barlow Condensed', sans-serif";
    g.textAlign = "center";
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = 3;
    for (let d = Math.floor(heading - 75); d <= heading + 75; d++) {
      if (d % 5 !== 0) continue;
      const x = W / 2 + (d - heading) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      const big = dd % 15 === 0;
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(x - 0.5, H - (big ? 14 : 8), 1, big ? 14 : 8);
      if (HEAD_LABELS[dd] !== undefined) {
        g.fillStyle = dd % 90 === 0 ? "#ffffff" : "rgba(255,255,255,0.85)";
        g.font =
          dd % 90 === 0
            ? "700 17px 'Barlow Condensed', sans-serif"
            : "600 14px 'Barlow Condensed', sans-serif";
        g.fillText(HEAD_LABELS[dd], x, 18);
      } else if (big) {
        g.font = "500 12px 'Barlow Condensed', sans-serif";
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.fillText(String(dd), x, 18);
      }
    }
    // center readout
    g.fillStyle = "#fff";
    g.font = "700 15px 'Barlow Condensed', sans-serif";
    g.fillText(String(Math.round(heading) % 360), W / 2, H + 0 - 30 + 12);
    g.fillRect(W / 2 - 1, H - 18, 2, 18);
    // marker direction
    if (this.marker) {
      const p = m.player.body;
      const bearing =
        ((((Math.atan2(this.marker.x - p.x, -(this.marker.z - p.z)) * 180) / Math.PI) % 360) + 360) % 360;
      let rel = bearing - heading;
      if (rel > 180) rel -= 360;
      if (rel < -180) rel += 360;
      if (Math.abs(rel) < 70) {
        const x = W / 2 + rel * pxPerDeg;
        g.fillStyle = "#ffd23a";
        g.beginPath();
        g.moveTo(x, H - 20);
        g.lineTo(x - 5, H - 29);
        g.lineTo(x + 5, H - 29);
        g.closePath();
        g.fill();
      }
    }
  }

  drawFull(m) {
    const c = this.fullCanvas;
    if (c.width !== innerWidth || c.height !== innerHeight) {
      c.width = innerWidth;
      c.height = innerHeight;
    }
    const g = c.getContext("2d");
    const s = this.fullScale();
    const W = c.width;
    const H = c.height;
    const toX = (x) => (x - this.panX) * s + W / 2;
    const toY = (z) => (z - this.panZ) * s + H / 2;
    g.fillStyle = "#0b1a26";
    g.fillRect(0, 0, W, H);
    g.drawImage(this.img, toX(-this.half), toY(-this.half), this.size * s, this.size * s);
    // grid 256 m
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 1;
    g.font = "600 14px 'Barlow Condensed', sans-serif";
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.textAlign = "center";
    for (let k = 0; k <= 8; k++) {
      const v = -this.half + k * 256;
      g.beginPath();
      g.moveTo(toX(v), toY(-this.half));
      g.lineTo(toX(v), toY(this.half));
      g.moveTo(toX(-this.half), toY(v));
      g.lineTo(toX(this.half), toY(v));
      g.stroke();
      if (k < 8) {
        g.fillText(LETTERS[k], toX(v + 128), toY(-this.half) + 16);
        g.fillText(String(k + 1), toX(-this.half) + 12, toY(v + 128) + 5);
      }
    }
    drawZone(g, m.zone, toX, toY, s, W, H);
    if (m.plane) this.drawPlanePath(g, m.plane, toX, toY);
    // town names
    g.font = "700 16px 'Barlow Condensed', sans-serif";
    for (const t of this.world.data.towns) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillText(t.name.toUpperCase(), toX(t.x) + 1, toY(t.z) + 1);
      g.fillStyle = "#fff";
      g.fillText(t.name.toUpperCase(), toX(t.x), toY(t.z));
    }
    for (const a of m.airdrops || []) {
      const pos = a.crate || a;
      this.drawAirdrop(g, toX(pos.x), toY(pos.z), 7);
    }
    if (this.marker) this.drawMarker(g, toX(this.marker.x), toY(this.marker.z));
    const p = m.player;
    drawArrow(g, toX(p.body.x), toY(p.body.z), m.gcam.yaw, 10, "#ffd23a");
    // zone timer
    const z = m.zone;
    if (z && z.state !== "idle") {
      g.textAlign = "left";
      g.font = "600 18px 'Barlow Condensed', sans-serif";
      g.fillStyle = "#fff";
      g.fillText(
        z.state === "waiting"
          ? `Bo thu hẹp sau ${fmt(z.timeLeft)}`
          : z.state === "shrinking"
            ? `Bo đang thu hẹp · ${fmt(z.timeLeft)}`
            : "Bo cuối",
        24,
        36,
      );
    }
  }
}

export function fmt(t) {
  t = Math.max(0, Math.ceil(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
