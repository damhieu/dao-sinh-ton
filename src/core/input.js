// Keyboard + mouse state with per-frame edges, pointer lock, and synthetic input for tests.

const GAME_KEYS = new Set([
  "Tab",
  "Space",
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
]);

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.buttons = 0; // bitmask: 1 left, 2 middle, 4 right
    this.pressedButtons = 0;
    this.releasedButtons = 0;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.captureKeys = false; // when true, browser shortcuts for game keys are suppressed
    this.onLockChange = null;

    addEventListener("keydown", (e) => {
      if (this.captureKeys && (GAME_KEYS.has(e.code) || e.ctrlKey)) e.preventDefault();
      if (e.repeat) return;
      this.setKey(e.code, true);
    });
    addEventListener("keyup", (e) => this.setKey(e.code, false));
    addEventListener("blur", () => this.reset());
    element.addEventListener("mousedown", (e) => this.setButton(e.button, true));
    addEventListener("mouseup", (e) => this.setButton(e.button, false));
    addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener(
      "wheel",
      (e) => {
        if (this.locked) {
          this.wheel += Math.sign(e.deltaY);
        }
      },
      { passive: true },
    );
    addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) this.reset();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  setKey(code, down) {
    if (down) {
      if (!this.keys.has(code)) this.pressedKeys.add(code);
      this.keys.add(code);
    } else {
      if (this.keys.has(code)) this.releasedKeys.add(code);
      this.keys.delete(code);
    }
  }

  setButton(button, down) {
    const bit = button === 0 ? 1 : button === 1 ? 2 : button === 2 ? 4 : 0;
    if (!bit) return;
    if (down) {
      if (!(this.buttons & bit)) this.pressedButtons |= bit;
      this.buttons |= bit;
    } else {
      if (this.buttons & bit) this.releasedButtons |= bit;
      this.buttons &= ~bit;
    }
  }

  down(code) {
    return this.keys.has(code);
  }
  pressed(code) {
    return this.pressedKeys.has(code);
  }
  released(code) {
    return this.releasedKeys.has(code);
  }
  btn(bit) {
    return (this.buttons & bit) !== 0;
  }
  btnPressed(bit) {
    return (this.pressedButtons & bit) !== 0;
  }
  btnReleased(bit) {
    return (this.releasedButtons & bit) !== 0;
  }

  lock() {
    if (!this.locked && this.element.requestPointerLock) {
      const r = this.element.requestPointerLock({ unadjustedMovement: true });
      // Some browsers reject unadjustedMovement; fall back to a plain request.
      if (r && r.catch) r.catch(() => this.element.requestPointerLock());
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  reset() {
    for (const k of this.keys) this.releasedKeys.add(k);
    this.keys.clear();
    this.releasedButtons |= this.buttons;
    this.buttons = 0;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pressedButtons = 0;
    this.releasedButtons = 0;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}

export const MOUSE_LEFT = 1;
export const MOUSE_MIDDLE = 2;
export const MOUSE_RIGHT = 4;
