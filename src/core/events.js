// Minimal synchronous event bus shared by gameplay, UI and audio.
const handlers = new Map();

export const events = {
  on(type, fn) {
    let list = handlers.get(type);
    if (!list) handlers.set(type, (list = []));
    list.push(fn);
    return () => events.off(type, fn);
  },
  off(type, fn) {
    const list = handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
  emit(type, payload) {
    const list = handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  },
  clear() {
    handlers.clear();
  },
};
