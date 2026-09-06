import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sohbet — Anlık Mesajlaşma" },
      { name: "description", content: "Arkadaşlarınla gerçek zamanlı mesajlaş. iOS uyumlu, hızlı ve sade sohbet uygulaması." },
      { property: "og:title", content: "Sohbet — Anlık Mesajlaşma" },
      { property: "og:description", content: "Arkadaşlarınla gerçek zamanlı mesajlaş. iOS uyumlu, hızlı ve sade sohbet uygulaması." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});

type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
};

type Message = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles?: Profile | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return da.toDateString() === db.toDateString();
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Bugün";
  if (d.toDateString() === yesterday.toDateString()) return "Dün";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

function ChatPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!("Notification" in window)) {
      setNotifPermission("unsupported");
    } else {
      setNotifPermission(Notification.permission);
    }
  }, []);

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  function showMessageNotification(msg: Message) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const sender = profiles[msg.user_id]?.display_name ?? "Yeni mesaj";
    const notification = new Notification(sender, {
      body: msg.content,
      tag: "chat-message",
      icon: "/favicon.ico",
    });
    notification.onclick = () => {
      window.focus();
      navigate({ to: "/" });
      notification.close();
    };
  }

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/auth" });
      } else {
        setUser(data.session.user);
        setChecking(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate({ to: "/auth" });
      else setUser(session.user);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (!user) return;

    async function loadInitial() {
      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(200);
      const { data: profs } = await supabase.from("profiles").select("*");
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p) => (map[p.id] = p));
      setProfiles(map);
      setMessages(msgs ?? []);
      scrollToBottom(false);
    }
    loadInitial();

    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          setProfiles((prev) => {
            if (prev[msg.user_id]) return prev;
            supabase
              .from("profiles")
              .select("*")
              .eq("id", msg.user_id)
              .single()
              .then(({ data }) => {
                if (data) setProfiles((p) => ({ ...p, [data.id]: data }));
              });
            return prev;
          });
          scrollToBottom();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, scrollToBottom]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !user || sending) return;
    setSending(true);
    setDraft("");
    const { error } = await supabase
      .from("messages")
      .insert({ user_id: user.id, content });
    if (error) setDraft(content);
    setSending(false);
    inputRef.current?.focus();
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  if (checking || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const me = profiles[user.id];

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* iOS-style header */}
      <header className="sticky top-0 z-10 border-b border-border bg-header backdrop-blur-xl safe-top">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: me?.avatar_color ?? "#0A84FF" }}
            >
              {(me?.display_name ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h1 className="text-[17px] font-semibold leading-tight">Genel Sohbet</h1>
              <p className="text-xs text-muted-foreground">{me?.display_name ?? "…"} olarak giriş yapıldı</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="text-[15px] font-medium text-primary"
            aria-label="Çıkış yap"
          >
            Çıkış
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-3 py-4 no-scrollbar">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-muted-foreground">
                <path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.65 1.35 5.02 3.47 6.63-.11.83-.5 2.02-1.47 3.07 0 0-.19.2-.04.4.12.16.32.18.32.18 1.97.1 3.9-.62 5.02-1.34.86.18 1.76.27 2.7.27 5.52 0 10-3.94 10-8.8S17.52 2 12 2Z" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">Henüz mesaj yok.</p>
            <p className="text-sm text-muted-foreground">İlk mesajı sen gönder!</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isMine = msg.user_id === user.id;
          const profile = profiles[msg.user_id];
          const prev = messages[i - 1];
          const showDay = !prev || !sameDay(prev.created_at, msg.created_at);
          const sameSenderAsPrev = prev && prev.user_id === msg.user_id && !showDay;

          return (
            <div key={msg.id}>
              {showDay && (
                <div className="my-4 text-center">
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
                    {dayLabel(msg.created_at)}
                  </span>
                </div>
              )}
              <div
                className={`animate-bubble-pop flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"} ${
                  sameSenderAsPrev ? "mt-0.5" : "mt-3"
                }`}
              >
                {!isMine && (
                  <div className="w-7 shrink-0">
                    {!sameSenderAsPrev && (
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                        style={{ backgroundColor: profile?.avatar_color ?? "#8e8e93" }}
                      >
                        {(profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                )}
                <div className={`flex max-w-[75%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                  {!isMine && !sameSenderAsPrev && (
                    <span className="mb-0.5 ml-3 text-[11px] text-muted-foreground">
                      {profile?.display_name ?? "Kullanıcı"}
                    </span>
                  )}
                  <div
                    className={`rounded-[20px] px-3.5 py-2 text-[16px] leading-snug break-words ${
                      isMine
                        ? "bg-bubble-out text-bubble-out-foreground rounded-br-[6px]"
                        : "bg-bubble-in text-bubble-in-foreground rounded-bl-[6px]"
                    }`}
                  >
                    {msg.content}
                  </div>
                  <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </main>

      {/* iOS-style input bar */}
      <footer className="border-t border-border bg-header backdrop-blur-xl safe-bottom">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Mesaj"
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-[16px] outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <button
            onClick={sendMessage}
            disabled={!draft.trim() || sending}
            aria-label="Gönder"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-current" style={{ width: 18, height: 18 }}>
              <path d="M12 3l7 7-1.4 1.4L13 6.8V21h-2V6.8l-4.6 4.6L5 10l7-7z" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
