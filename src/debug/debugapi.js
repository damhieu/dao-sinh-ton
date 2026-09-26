// window.__game — debug/test hooks used for automated verification in the browser.
export function installDebugApi(api) {
  const target = window.__game || (window.__game = {});
  // defineProperties keeps getters live (Object.assign would snapshot them)
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(api));
  return target;
}
