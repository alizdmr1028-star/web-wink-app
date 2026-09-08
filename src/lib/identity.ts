import { supabase } from "@/integrations/supabase/client";

const NICK_KEY = "gk_nick";
const PIN_KEY = "gk_pin_hash";

export function normalizeNick(n: string) {
  return n.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function emailFor(nick: string) {
  return `${normalizeNick(nick)}@gizli.local`;
}

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(digest);
}

export async function derivePassword(nick: string, pin: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(`gizli:${normalizeNick(nick)}`), iterations: 120000, hash: "SHA-256" },
    key,
    256,
  );
  return `Gz1!${toHex(bits)}`;
}

export function storedNick() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NICK_KEY);
}

export async function rememberIdentity(nick: string, pin: string) {
  localStorage.setItem(NICK_KEY, normalizeNick(nick));
  localStorage.setItem(PIN_KEY, await sha256Hex(`${normalizeNick(nick)}:${pin}`));
}

export async function checkPin(pin: string) {
  const nick = storedNick();
  const hash = localStorage.getItem(PIN_KEY);
  if (!nick || !hash) return false;
  return (await sha256Hex(`${nick}:${pin}`)) === hash;
}

export async function createIdentity(nick: string, pin: string) {
  const username = normalizeNick(nick);
  const password = await derivePassword(username, pin);
  const { error } = await supabase.auth.signUp({
    email: emailFor(username),
    password,
    options: { data: { username, display_name: nick.trim() || username } },
  });
  if (error) throw error;
  await rememberIdentity(username, pin);
}

export async function signInWithPin(nick: string, pin: string) {
  const username = normalizeNick(nick);
  const password = await derivePassword(username, pin);
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(username), password });
  if (error) throw error;
}

export async function wipeLocal() {
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
  localStorage.clear();
  sessionStorage.clear();
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    dbs.forEach((db) => db.name && indexedDB.deleteDatabase(db.name));
  }
}
