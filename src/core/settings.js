// Persistent user settings (localStorage).
const KEY = "dst_settings_v1";

export const DEFAULT_SETTINGS = {
  name: "Người chơi",
  quality: "high",
  dynamicRes: true,
  sens: 1.0,
  adsSens: 0.8,
  fov: 80,
  invertY: false,
  adsHold: true,
  masterVol: 0.8,
  sfxVol: 1.0,
  matchSpeed: "normal", // "normal" | "fast"
  showFps: false,
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode) — settings just won't persist
  }
}

const STATS_KEY = "dst_stats_v1";

export function loadStats() {
  try {
    return {
      matches: 0,
      wins: 0,
      kills: 0,
      bestRank: 0,
      ...JSON.parse(localStorage.getItem(STATS_KEY) || "{}"),
    };
  } catch {
    return { matches: 0, wins: 0, kills: 0, bestRank: 0 };
  }
}

export function saveStats(s) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
