// Human input -> character controls + camera angles.
import { MOUSE_LEFT, MOUSE_RIGHT } from "../core/input.js";

const SLOT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];

export class PlayerController {
  constructor(ch, input, gameCam, settings) {
    this.ch = ch;
    this.input = input;
    this.gc = gameCam;
    this.settings = settings;
    this.viewYaw = 0;
    this.viewPitch = 0;
    this.freeLook = false;
    this.adsToggled = false;
    this.enabled = true;
  }

  setView(yaw, pitch = 0) {
    this.viewYaw = yaw;
    this.viewPitch = pitch;
  }

  update(dt) {
    const i = this.input;
    const c = this.ch.ctrl;
    const s = this.settings;
    const gc = this.gc;
    if (!this.enabled) {
      c.mx = c.mz = 0;
      c.fire = c.firePressed = c.ads = c.sprint = false;
      return;
    }
    // look
    const adsZoomFactor = gc.adsBlend > 0.5 ? (s.adsSens * gc.fov) / gc.baseFov : 1;
    const sens = 0.0021 * s.sens * adsZoomFactor;
    const alt = i.down("AltLeft") || i.down("AltRight");
    if (alt && !this.freeLook) {
      this.freeLook = true;
      this.freeYaw = this.viewYaw;
      this.freePitch = this.viewPitch;
    }
    if (!alt && this.freeLook) this.freeLook = false;
    if (i.locked) {
      const dy = i.dy * (s.invertY ? -1 : 1);
      if (this.freeLook) {
        this.freeYaw -= i.dx * sens;
        this.freePitch = Math.max(-1.4, Math.min(1.4, this.freePitch - dy * sens));
      } else {
        this.viewYaw -= i.dx * sens;
        this.viewPitch = Math.max(-1.45, Math.min(1.45, this.viewPitch - dy * sens));
      }
    }
    gc.yaw = this.freeLook ? this.freeYaw : this.viewYaw;
    gc.pitch = this.freeLook ? this.freePitch : this.viewPitch;

    // movement
    c.mx = (i.down("KeyD") ? 1 : 0) - (i.down("KeyA") ? 1 : 0);
    c.mz = (i.down("KeyW") ? 1 : 0) - (i.down("KeyS") ? 1 : 0);
    c.sprint = i.down("ShiftLeft") || i.down("ShiftRight");
    c.walk = i.down("ControlLeft");
    c.jump = c.jump || i.pressed("Space");
    c.crouch = i.pressed("KeyC");
    c.prone = i.pressed("KeyZ");
    c.leanL = i.down("KeyQ");
    c.leanR = i.down("KeyE");
    c.interact = i.pressed("KeyF");
    c.deploy = i.pressed("KeyF");
    c.reload = i.pressed("KeyR");
    c.fireMode = i.pressed("KeyB");
    c.holster = i.pressed("KeyX");
    // weapons
    c.fire = i.btn(MOUSE_LEFT);
    c.firePressed = i.btnPressed(MOUSE_LEFT);
    if (s.adsHold) c.ads = i.btn(MOUSE_RIGHT);
    else {
      if (i.btnPressed(MOUSE_RIGHT)) this.adsToggled = !this.adsToggled;
      c.ads = this.adsToggled;
    }
    c.select = -1;
    for (let k = 0; k < SLOT_KEYS.length; k++) if (i.pressed(SLOT_KEYS[k])) c.select = k;
    if (i.pressed("KeyG")) c.select = 4;
    if (i.wheel !== 0 && gc.adsBlend < 0.5) c.selectCycle = Math.sign(i.wheel);
    else c.selectCycle = 0;
    // consumables
    c.use = null;
    if (i.pressed("Digit7")) c.use = "bandage";
    if (i.pressed("Digit8")) c.use = "firstaid";
    if (i.pressed("Digit9")) c.use = "medkit";
    if (i.pressed("Digit0"))
      c.use = this.ch.inv.count("painkiller") > 0 && this.ch.boost < 40 ? "painkiller" : "energy";
    c.cancel = c.fire || c.sprint || i.pressed("Space");
    c.yaw = this.viewYaw;
  }
}
