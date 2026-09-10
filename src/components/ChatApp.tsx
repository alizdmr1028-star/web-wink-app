import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeImage } from "@/lib/media";
import { playSound, themeLabels, type Settings, type SoundId, type ThemeId } from "@/lib/settings";
import { useVoiceCall } from "@/lib/voice";

type Profile = { id: string; username: string; display_name: string; avatar_color: string };

type Message = {
  id: string;
  conversation_id: string | null;
  user_id: string;
  content: string;
  created_at: string;
  media_path: string | null;
  media_type: string | null;
  view_once: boolean;
  liked_by: string[] | null;
  read_at: string | null;
};

type Invite = {
  id: string;
  conversation_id: string;
  from_user: string;
  to_user: string;
  status: string;
  created_at: string;
};

type ConversationItem = { id: string; other: Profile | null; updated_at: string };

type Props = {
  user: User;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onLock: () => void;
  onPanic: () => void;
};

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatApp({ user, settings, onSettings, onLock, onPanic }: Props) {
  const [screen, setScreen] = useState<"list" | "chat" | "settings">("list");
  const [me, setMe] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteProfiles, setInviteProfiles] = useState<Record<string, Profile>>({});
  const [active, setActive] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [searchNick, setSearchNick] = useState("");
  const [searchState, setSearchState] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openOnce, setOpenOnce] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<ConversationItem | null>(null);
  activeRef.current = active;
  const call = useVoiceCall(user.id, active?.id ?? null);


  const notify = useCallback(
    (text: string) => {
      if (settings.soundNotifications) playSound(settings.sound);
      if (settings.visualNotifications) {
        setBanner(text);
        setTimeout(() => setBanner(null), 3500);
      }
    },
    [settings],
  );

  const loadConversations = useCallback(async () => {
    const { data: memberships } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);
    const ids = (memberships ?? []).map((m) => m.conversation_id);
    if (ids.length === 0) {
      setConversations([]);
      return;
    }
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    const { data: others } = await supabase
      .from("conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", ids)
      .neq("user_id", user.id);
    const otherIds = [...new Set((others ?? []).map((o) => o.user_id))];
    const { data: profs } = otherIds.length
      ? await supabase.from("profiles").select("*").in("id", otherIds)
      : { data: [] as Profile[] };
    const pmap: Record<string, Profile> = {};
    (profs ?? []).forEach((p) => (pmap[p.id] = p as Profile));
    setConversations(
      (convs ?? []).map((c) => {
        const link = (others ?? []).find((o) => o.conversation_id === c.id);
        return { id: c.id, updated_at: c.updated_at, other: link ? (pmap[link.user_id] ?? null) : null };
      }),
    );
  }, [user.id]);

  const loadInvites = useCallback(async () => {
    const { data } = await supabase
      .from("invites")
      .select("*")
      .eq("to_user", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setInvites((data ?? []) as Invite[]);
    const froms = [...new Set((data ?? []).map((i) => i.from_user))];
    if (froms.length) {
      const { data: profs } = await supabase.from("profiles").select("*").in("id", froms);
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p) => (map[p.id] = p as Profile));
      setInviteProfiles(map);
    }
  }, [user.id]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setMe((data as Profile) ?? null));
    void loadConversations();
    void loadInvites();
  }, [user.id, loadConversations, loadInvites]);

  // realtime: invites + incoming messages
  useEffect(() => {
    const channel = supabase
      .channel("gizli-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "invites" }, () => {
        void loadInvites();
        void loadConversations();
        notify("Sistem Güncellemesi mevcut");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        void loadConversations();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        if (msg.user_id === user.id) return;
        if (activeRef.current && msg.conversation_id === activeRef.current.id) {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
        notify("Sistem Güncellemesi mevcut");
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        const old = payload.old as { id: string };
        setMessages((prev) => prev.filter((m) => m.id !== old.id));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user.id, loadInvites, loadConversations, notify]);

  // messages of the open conversation
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", active.id)
        .order("created_at", { ascending: true })
        .limit(300);
      if (!cancelled) setMessages((data ?? []) as Message[]);
      await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("conversation_id", active.id)
        .neq("user_id", user.id)
        .is("read_at", null);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, user.id]);

  useEffect(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, [messages.length]);

  // signed urls for normal photos
  useEffect(() => {
    const missing = messages.filter((m) => m.media_path && !m.view_once && !urls[m.id]);
    if (!missing.length) return;
    (async () => {
      const entries: Record<string, string> = {};
      for (const m of missing) {
        const { data } = await supabase.storage.from("media").createSignedUrl(m.media_path!, 3600);
        if (data?.signedUrl) entries[m.id] = data.signedUrl;
      }
      if (Object.keys(entries).length) setUrls((prev) => ({ ...prev, ...entries }));
    })();
  }, [messages, urls]);

  async function startChat() {
    const nick = searchNick.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    setSearchState(null);
    if (!nick) return;
    const { data: target } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", nick)
      .maybeSingle();
    if (!target) {
      setSearchState("Bu takma adla bir kullanıcı bulunamadı.");
      return;
    }
    if (target.id === user.id) {
      setSearchState("Kendine davet gönderemezsin.");
      return;
    }
    const convId = crypto.randomUUID();
    const { error } = await supabase.from("conversations").insert({ id: convId, created_by: user.id });
    if (error) {
      setSearchState("Sohbet başlatılamadı.");
      return;
    }
    await supabase.from("conversation_members").insert({ conversation_id: convId, user_id: user.id });
    await supabase.from("invites").insert({ conversation_id: convId, from_user: user.id, to_user: target.id });
    setSearchNick("");
    setSearchState(`Davet gönderildi: @${target.username}`);
    void loadConversations();
  }

  async function acceptInvite(inv: Invite) {
    await supabase.from("conversation_members").insert({ conversation_id: inv.conversation_id, user_id: user.id });
    await supabase.from("invites").update({ status: "accepted" }).eq("id", inv.id);
    await loadInvites();
    await loadConversations();
  }

  async function rejectInvite(inv: Invite) {
    await supabase.from("invites").update({ status: "rejected" }).eq("id", inv.id);
    await loadInvites();
  }

  async function sendText() {
    const content = draft.trim();
    if (!content || !active) return;
    setDraft("");
    const { data } = await supabase
      .from("messages")
      .insert({ conversation_id: active.id, user_id: user.id, content })
      .select()
      .single();
    if (data) setMessages((prev) => [...prev, data as Message]);
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", active.id);
  }

  async function sendPhoto(file: File) {
    if (!active) return;
    setUploading(true);
    try {
      const blob = await sanitizeImage(file);
      const path = `${active.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = await supabase
        .from("messages")
        .insert({
          conversation_id: active.id,
          user_id: user.id,
          content: "",
          media_path: path,
          media_type: "image/jpeg",
          view_once: viewOnceMode,
        })
        .select()
        .single();
      if (data) setMessages((prev) => [...prev, data as Message]);
    } catch {
      setBanner("Fotoğraf gönderilemedi");
      setTimeout(() => setBanner(null), 2500);
    } finally {
      setUploading(false);
    }
  }

  async function openViewOnce(m: Message) {
    if (!m.media_path) return;
    const { data } = await supabase.storage.from("media").createSignedUrl(m.media_path, 300);
    if (data?.signedUrl) setOpenOnce({ id: m.id, url: data.signedUrl });
  }

  async function destroyViewOnce() {
    if (!openOnce) return;
    const msg = messages.find((m) => m.id === openOnce.id);
    setOpenOnce(null);
    if (!msg) return;
    if (msg.media_path) await supabase.storage.from("media").remove([msg.media_path]);
    await supabase.from("messages").delete().eq("id", msg.id);
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }

  async function toggleLike(m: Message) {
    const liked = m.liked_by ?? [];
    const next = liked.includes(user.id) ? liked.filter((id) => id !== user.id) : [...liked, user.id];
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, liked_by: next } : x)));
    await supabase.from("messages").update({ liked_by: next }).eq("id", m.id);
  }

  async function deleteConversation(conv: ConversationItem) {
    await supabase.from("conversations").delete().eq("id", conv.id);
    setActive(null);
    setScreen("list");
    void loadConversations();
  }

  const ig = settings.theme.startsWith("instagram");
  const outBubble = ig
    ? "bg-gradient-to-br from-[#8A3AB9] via-[#E1306C] to-[#F77737] text-white rounded-br-[8px]"
    : "bg-bubble-out text-bubble-out-foreground rounded-br-[6px]";

  const header = (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-header px-4 py-3 backdrop-blur-xl safe-top">
      {screen !== "list" && (
        <button
          onClick={() => {
            setScreen("list");
            setActive(null);
          }}
          className="text-primary"
          aria-label="Geri"
        >
          ‹
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold">
          {screen === "chat"
            ? (active?.other?.display_name ?? "Sohbet")
            : screen === "settings"
              ? "Ayarlar"
              : "Sohbetler"}
        </h1>
        {screen === "list" && me && <p className="text-xs text-muted-foreground">@{me.username}</p>}
      </div>
      {screen === "list" && (
        <>
          <button onClick={() => setScreen("settings")} className="text-[15px] font-medium text-primary">
            Ayarlar
          </button>
          <button onClick={onLock} className="text-[15px] font-medium text-primary">
            Kilitle
          </button>
        </>
      )}
      {screen === "chat" && active && (
        <>
          <button
            onClick={() => void call.startCall()}
            aria-label="Şifreli sesli arama"
            className="text-[19px] text-primary"
          >
            📞
          </button>
          <button onClick={() => void deleteConversation(active)} className="text-[15px] font-medium text-destructive">
            Sil
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className={`theme-${settings.theme} flex h-dvh flex-col bg-background text-foreground`}>
      {banner && (
        <div className="fixed left-1/2 top-3 z-50 w-[92%] max-w-sm -translate-x-1/2 rounded-2xl bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-[13px] font-semibold">Sistem Güncellemesi</p>
          <p className="text-xs text-muted-foreground">{banner}</p>
        </div>
      )}
      {header}

      {screen === "list" && (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-5 rounded-2xl border border-border bg-card p-3">
            <p className="mb-2 text-[13px] font-semibold">Kullanıcı adıyla ara / davet et</p>
            <div className="flex gap-2">
              <input
                value={searchNick}
                onChange={(e) => setSearchNick(e.target.value)}
                placeholder="takma_ad"
                className="min-w-0 flex-1 rounded-xl border border-input bg-secondary px-3 py-2.5 text-[16px] outline-none"
              />
              <button
                onClick={() => void startChat()}
                className="rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground"
              >
                Sohbet Başlat
              </button>
            </div>
            {searchState && <p className="mt-2 text-xs text-muted-foreground">{searchState}</p>}
          </div>

          {invites.length > 0 && (
            <div className="mb-5 space-y-2">
              <p className="text-[13px] font-semibold">Gelen davetler</p>
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <span className="flex-1 truncate text-[15px]">
                    @{inviteProfiles[inv.from_user]?.username ?? "kullanıcı"} seninle sohbet etmek istiyor
                  </span>
                  <button onClick={() => void acceptInvite(inv)} className="text-[15px] font-semibold text-primary">
                    Kabul
                  </button>
                  <button onClick={() => void rejectInvite(inv)} className="text-[15px] text-muted-foreground">
                    Yok say
                  </button>
                </div>
              ))}
            </div>
          )}

          {conversations.length === 0 && (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              Henüz sohbet yok. Bir takma ad yazıp davet gönder.
            </p>
          )}
          <div className="space-y-1">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setActive(c);
                  setScreen("chat");
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-secondary"
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: c.other?.avatar_color ?? "#8e8e93" }}
                >
                  {(c.other?.display_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium">
                    {c.other?.display_name ?? "Bekleyen davet"}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    @{c.other?.username ?? "…"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {screen === "chat" && active && (
        <>
          <main className={`chat-surface flex-1 overflow-y-auto px-3 py-4 ${settings.privacyBlur ? "privacy-target" : ""}`}>
            {messages.map((m) => {
              const mine = m.user_id === user.id;
              const liked = (m.liked_by ?? []).length > 0;
              return (
                <div key={m.id} className={`mt-2 flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    onDoubleClick={() => ig && void toggleLike(m)}
                    className={`relative max-w-[78%] rounded-[20px] px-3.5 py-2 text-[16px] leading-snug break-words ${
                      mine ? outBubble : "bg-bubble-in text-bubble-in-foreground rounded-bl-[6px]"
                    }`}
                  >
                    {m.media_path && m.view_once && (
                      <button
                        onClick={() => void openViewOnce(m)}
                        className="flex items-center gap-2 text-[15px] font-medium"
                      >
                        <span>◉</span> Tek seferlik fotoğraf — dokun ve gör
                      </button>
                    )}
                    {m.media_path && !m.view_once && (
                      <img
                        src={urls[m.id]}
                        alt="Paylaşılan fotoğraf"
                        loading="lazy"
                        className="mb-1 max-h-72 rounded-xl object-cover"
                      />
                    )}
                    {m.content && <span>{m.content}</span>}
                    <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-70">
                      {timeOf(m.created_at)}
                      {mine && settings.theme === "whatsapp" && (
                        <span className={m.read_at ? "text-[#34B7F1]" : ""}>✓✓</span>
                      )}
                    </span>
                    {liked && <span className="absolute -bottom-2 right-2 text-[13px]">❤️</span>}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </main>

          <footer className="border-t border-border bg-header safe-bottom">
            {viewOnceMode && (
              <p className="px-4 pt-2 text-[11px] font-medium text-primary">
                Tek seferlik gönderim açık — fotoğraf açıldıktan sonra silinecek
              </p>
            )}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                onClick={() => setViewOnceMode((v) => !v)}
                className={`h-9 w-9 shrink-0 rounded-full border border-input text-[13px] ${
                  viewOnceMode ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                aria-label="Tek seferlik görüntüleme"
              >
                1x
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="h-9 w-9 shrink-0 rounded-full border border-input bg-background"
                aria-label="Galeriden fotoğraf"
              >
                📎
              </button>
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-9 w-9 shrink-0 rounded-full border border-input bg-background"
                aria-label="Kamera"
              >
                📷
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendPhoto(f);
                }}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendPhoto(f);
                }}
              />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendText();
                  }
                }}
                placeholder={uploading ? "Fotoğraf gönderiliyor…" : "Mesaj"}
                enterKeyHint="send"
                className="min-w-0 flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-[16px] outline-none"
              />
              <button
                onClick={() => void sendText()}
                disabled={!draft.trim()}
                aria-label="Gönder"
                className="h-9 w-9 shrink-0 rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                ↑
              </button>
            </div>
          </footer>
        </>
      )}

      {screen === "settings" && (
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
          <section>
            <p className="mb-2 text-[13px] font-semibold">Sohbet teması</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(themeLabels) as ThemeId[]).map((t) => (
                <button
                  key={t}
                  onClick={() => onSettings({ ...settings, theme: t })}
                  className={`rounded-2xl border px-3 py-3 text-[15px] ${
                    settings.theme === t ? "border-primary bg-secondary font-semibold" : "border-border bg-card"
                  }`}
                >
                  {themeLabels[t]}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-[13px] font-semibold">Bildirimler</p>
            <Toggle
              label="Görsel bildirim (gizli afiş)"
              value={settings.visualNotifications}
              onChange={(v) => onSettings({ ...settings, visualNotifications: v })}
            />
            <Toggle
              label="Sesli bildirim"
              value={settings.soundNotifications}
              onChange={(v) => onSettings({ ...settings, soundNotifications: v })}
            />
            {settings.soundNotifications && (
              <div className="flex gap-2">
                {(["telegram", "beep"] as SoundId[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      onSettings({ ...settings, sound: s });
                      playSound(s);
                    }}
                    className={`flex-1 rounded-2xl border px-3 py-3 text-[15px] ${
                      settings.sound === s ? "border-primary bg-secondary font-semibold" : "border-border bg-card"
                    }`}
                  >
                    {s === "telegram" ? "Telegram tonu" : "Nötr bip"}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-[13px] font-semibold">Gizlilik</p>
            <Toggle
              label="Arka plana atılınca kilitle"
              value={settings.lockOnBackground}
              onChange={(v) => onSettings({ ...settings, lockOnBackground: v })}
            />
            <Toggle
              label="Ekran görüntüsüne karşı bulanıklaştır"
              value={settings.privacyBlur}
              onChange={(v) => onSettings({ ...settings, privacyBlur: v })}
            />
          </section>

          <button
            onClick={onPanic}
            className="w-full rounded-2xl bg-destructive px-4 py-3.5 text-[16px] font-semibold text-destructive-foreground"
          >
            Panik Butonu — tüm verileri sil
          </button>
        </div>
      )}

      {openOnce && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <img src={openOnce.url} alt="Tek seferlik fotoğraf" className="min-h-0 flex-1 object-contain" />
          <button
            onClick={() => void destroyViewOnce()}
            className="bg-black px-6 py-5 text-[16px] font-semibold text-white safe-bottom"
          >
            Kapat ve kalıcı olarak sil
          </button>
        </div>
      )}

      {call.state !== "idle" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/95 px-6 text-white">
          <p className="text-[15px] opacity-70">Şifreli sesli arama</p>
          <p className="text-[24px] font-semibold">{active?.other?.display_name ?? "Sohbet"}</p>
          <p className="mt-1 text-[14px] opacity-70">
            {call.state === "calling"
              ? "Aranıyor…"
              : call.state === "incoming"
                ? "Gelen arama"
                : "Bağlandı — uçtan uca şifreli, aracı sunucu üzerinden"}
          </p>
          {call.error && <p className="mt-1 text-[13px] text-[#FF453A]">{call.error}</p>}
          <div className="mt-8 flex gap-4">
            {call.state === "incoming" && (
              <button
                onClick={() => void call.accept()}
                className="rounded-full bg-[#30D158] px-8 py-4 text-[16px] font-semibold"
              >
                Cevapla
              </button>
            )}
            <button
              onClick={() => (call.state === "incoming" ? call.reject() : call.hangup())}
              className="rounded-full bg-[#FF453A] px-8 py-4 text-[16px] font-semibold"
            >
              {call.state === "incoming" ? "Reddet" : "Bitir"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left"
    >
      <span className="text-[15px]">{label}</span>
      <span className={`relative h-7 w-12 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted"}`}>
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
            value ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
