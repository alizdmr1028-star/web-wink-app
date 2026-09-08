export type ThemeId = "whatsapp" | "instagram-dark" | "instagram-light" | "ios";
export type SoundId = "telegram" | "beep";

export type Settings = {
  theme: ThemeId;
  visualNotifications: boolean;
  soundNotifications: boolean;
  sound: SoundId;
  lockOnBackground: boolean;
  privacyBlur: boolean;
};

const KEY = "gk_settings";

export const defaultSettings: Settings = {
  theme: "whatsapp",
  visualNotifications: true,
  soundNotifications: true,
  sound: "telegram",
  lockOnBackground: true,
  privacyBlur: true,
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export const themeLabels: Record<ThemeId, string> = {
  whatsapp: "WhatsApp",
  "instagram-dark": "Instagram (Koyu)",
  "instagram-light": "Instagram (Açık)",
  ios: "iOS Mesajlar",
};

export function playSound(sound: SoundId) {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const notes = sound === "telegram" ? [880, 1320] : [660];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = sound === "telegram" ? "sine" : "square";
      osc.frequency.value = freq;
      const start = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* ignore */
  }
}
