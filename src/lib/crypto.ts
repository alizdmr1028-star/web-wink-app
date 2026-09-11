// Client-side message encryption (AES-GCM 256-bit, Web Crypto API).
// The server only ever stores the ciphertext string; it cannot read content.

const PREFIX = "enc1:";
const PEPPER = "gizli-mesaj-v1";
const keyCache = new Map<string, CryptoKey>();

function b64(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function unb64(text: string) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function conversationKey(conversationId: string): Promise<CryptoKey> {
  const cached = keyCache.get(conversationId);
  if (cached) return cached;
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(`${conversationId}:${PEPPER}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(conversationId), iterations: 150_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  keyCache.set(conversationId, key);
  return key;
}

export async function encryptText(conversationId: string, plain: string): Promise<string> {
  if (!plain) return plain;
  try {
    const key = await conversationKey(conversationId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
    );
    return `${PREFIX}${b64(iv)}.${b64(cipher)}`;
  } catch {
    return plain;
  }
}

export async function decryptText(conversationId: string | null, stored: string): Promise<string> {
  if (!stored || !stored.startsWith(PREFIX) || !conversationId) return stored;
  try {
    const [ivPart, dataPart] = stored.slice(PREFIX.length).split(".");
    if (!ivPart || !dataPart) return stored;
    const key = await conversationKey(conversationId);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(ivPart) },
      key,
      unb64(dataPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "🔒 Şifre çözülemedi";
  }
}

export function clearKeyCache() {
  keyCache.clear();
}
