import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import WeatherApp from "@/components/WeatherApp";
import ChatApp from "@/components/ChatApp";
import { checkPin, createIdentity, signInWithPin, storedNick, wipeLocal } from "@/lib/identity";
import { defaultSettings, loadSettings, saveSettings, type Settings } from "@/lib/settings";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hava Durumu — Anlık Tahmin" },
      { name: "description", content: "Anlık sıcaklık, 7 günlük tahmin ve şehir arama. Hızlı ve reklamsız hava durumu." },
      { property: "og:title", content: "Hava Durumu — Anlık Tahmin" },
      { property: "og:description", content: "Anlık sıcaklık, 7 günlük tahmin ve şehir arama." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const [nick, setNick] = useState("");
  const [nickError, setNickError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const lock = useCallback(() => {
    setUnlocked(false);
    setUser(null);
  }, []);

  // lock when app goes to background
  useEffect(() => {
    if (!settings.lockOnBackground) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") lock();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [settings.lockOnBackground, lock]);

  // blur content when the app loses focus (screenshot / app switcher privacy)
  useEffect(() => {
    if (!settings.privacyBlur) {
      document.body.classList.remove("app-obscured");
      return;
    }
    const obscure = () => document.body.classList.add("app-obscured");
    const reveal = () => document.body.classList.remove("app-obscured");
    const onVis = () => (document.visibilityState === "hidden" ? obscure() : reveal());
    window.addEventListener("blur", obscure);
    window.addEventListener("focus", reveal);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", obscure);
      window.removeEventListener("focus", reveal);
      document.removeEventListener("visibilitychange", onVis);
      reveal();
    };
  }, [settings.privacyBlur]);

  // shake / flip to lock and wipe
  useEffect(() => {
    if (!unlocked) return;
    const handler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const force = Math.abs(a.x ?? 0) + Math.abs(a.y ?? 0) + Math.abs(a.z ?? 0);
      if (force > 45) void panic();
    };
    window.addEventListener("devicemotion", handler);
    return () => window.removeEventListener("devicemotion", handler);
  });

  async function panic() {
    if (user) {
      const { data: memberships } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user.id);
      const ids = (memberships ?? []).map((m) => m.conversation_id);
      if (ids.length) await supabase.from("conversations").delete().in("id", ids);
    }
    await wipeLocal();
    lock();
  }

  const failsKey = "gk_fails";

  async function handleEquals(pin: string) {
    const nickname = storedNick();
    if (!nickname) {
      setOnboarding(pin);
      return true;
    }
    const ok = await checkPin(pin);
    if (!ok) {
      const fails = Number(sessionStorage.getItem(failsKey) ?? "0") + 1;
      sessionStorage.setItem(failsKey, String(fails));
      if (fails >= 3) {
        sessionStorage.removeItem(failsKey);
        await wipeLocal();
      }
      return false;
    }
    sessionStorage.removeItem(failsKey);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) await signInWithPin(nickname, pin);
      const { data: after } = await supabase.auth.getSession();
      if (!after.session) return false;
      setUser(after.session.user);
      setUnlocked(true);
      return true;
    } catch {
      return false;
    }
  }

  async function finishOnboarding() {
    if (!onboarding) return;
    setNickError(null);
    setBusy(true);
    try {
      await createIdentity(nick, onboarding);
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        await signInWithPin(nick, onboarding);
      }
      const { data: after } = await supabase.auth.getSession();
      if (!after.session) throw new Error("session");
      setUser(after.session.user);
      setUnlocked(true);
      setOnboarding(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      setNickError(
        msg.includes("already") || msg.includes("registered") || msg.includes("duplicate")
          ? "Bu takma ad alınmış, başka bir tane dene."
          : "Kimlik oluşturulamadı, tekrar dene.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (onboarding) {
    return (
      <div className="flex min-h-dvh flex-col justify-center bg-black px-6 safe-top safe-bottom">
        <h1 className="text-[22px] font-semibold text-white">Takma adını belirle</h1>
        <p className="mt-1 text-sm text-[#8e8e93]">
          E-posta yok, telefon yok. Girdiğin kod bundan sonra giriş şifren olacak.
        </p>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="takma_ad"
          autoCapitalize="none"
          className="mt-5 w-full rounded-2xl border border-[#333] bg-[#1c1c1e] px-4 py-3.5 text-[16px] text-white outline-none"
        />
        {nickError && <p className="mt-2 text-sm text-[#FF453A]">{nickError}</p>}
        <button
          onClick={() => void finishOnboarding()}
          disabled={busy || nick.trim().length < 3}
          className="mt-4 w-full rounded-2xl bg-[#0A84FF] py-3.5 text-[16px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Oluşturuluyor…" : "Devam et"}
        </button>
        <button
          onClick={() => {
            setOnboarding(null);
            setNick("");
          }}
          className="mt-3 text-center text-sm text-[#8e8e93]"
        >
          Vazgeç
        </button>
      </div>
    );
  }

  if (!unlocked || !user) {
    return <Calculator onEquals={handleEquals} />;
  }

  return (
    <ChatApp
      user={user}
      settings={settings}
      onSettings={updateSettings}
      onLock={lock}
      onPanic={() => void panic()}
    />
  );
}
