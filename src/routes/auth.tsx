import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Giriş Yap — Sohbet" },
      { name: "description", content: "Anlık mesajlaşma uygulamasına giriş yap veya hesap oluştur." },
      { property: "og:title", content: "Giriş Yap — Sohbet" },
      { property: "og:description", content: "Anlık mesajlaşma uygulamasına giriş yap veya hesap oluştur." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setInfo("Hesabın oluşturuldu! Giriş yapmadan önce e-postana gönderdiğimiz onay bağlantısına tıkla.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("email not confirmed")) {
        setError("E-postan henüz onaylanmamış. E-postana gelen bağlantıya tıklayarak onayla.");
      } else if (msg.toLowerCase().includes("invalid login credentials")) {
        setError("E-posta veya şifre hatalı.");
      } else if (msg.toLowerCase().includes("already registered")) {
        setError("Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.");
      } else {
        setError(msg || "Bir hata oluştu");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) setError("Google ile giriş başarısız oldu.");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[22px] bg-primary shadow-lg shadow-primary/30">
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-primary-foreground">
              <path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.65 1.35 5.02 3.47 6.63-.11.83-.5 2.02-1.47 3.07 0 0-.19.2-.04.4.12.16.32.18.32.18 1.97.1 3.9-.62 5.02-1.34.86.18 1.76.27 2.7.27 5.52 0 10-3.94 10-8.8S17.52 2 12 2Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sohbet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Hesabına giriş yap" : "Yeni hesap oluştur"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Görünen ad"
              className="w-full rounded-2xl border border-input bg-secondary px-4 py-3.5 text-[16px] outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-posta"
            autoComplete="email"
            className="w-full rounded-2xl border border-input bg-secondary px-4 py-3.5 text-[16px] outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Şifre (en az 6 karakter)"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="w-full rounded-2xl border border-input bg-secondary px-4 py-3.5 text-[16px] outline-none placeholder:text-muted-foreground focus:border-ring"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-primary">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-primary py-3.5 text-[16px] font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {loading ? "Lütfen bekle…" : mode === "signin" ? "Giriş Yap" : "Hesap Oluştur"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">veya</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={handleGoogle}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-input bg-card py-3.5 text-[16px] font-medium transition-colors hover:bg-secondary"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24Z" />
            <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1Z" />
            <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.87 8.87 4.76 12 4.76Z" />
          </svg>
          Google ile devam et
        </button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Hesabın yok mu?" : "Zaten hesabın var mı?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
            className="font-semibold text-primary"
          >
            {mode === "signin" ? "Kayıt ol" : "Giriş yap"}
          </button>
        </p>
      </div>
    </div>
  );
}
