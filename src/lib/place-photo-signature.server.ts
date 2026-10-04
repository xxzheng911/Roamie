import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const TOKEN_TTL_SECONDS = 10 * 60;

function readSecret(env?: CloudflareRuntimeEnv): string | null {
  const runtime = env?.PLACE_PHOTO_SIGNING_SECRET;
  if (typeof runtime === "string" && runtime.trim().length >= 32) return runtime.trim();
  const fallback = process.env.PLACE_PHOTO_SIGNING_SECRET;
  return typeof fallback === "string" && fallback.trim().length >= 32 ? fallback.trim() : null;
}

function tokenPayload(photo: string, width: number, expires: number, audience?: "guest" | "authenticated", principal?: string): string {
  const base = `${photo}\n${width}\n${expires}`;
  return audience === "authenticated" ? `${base}\nauthenticated\n${principal ?? ""}` : audience === "guest" ? `${base}\nguest` : base;
}

async function hmac(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signPlacePhoto(
  env: CloudflareRuntimeEnv,
  photo: string,
  width: number,
  nowSeconds = Math.floor(Date.now() / 1000),
  audience?: "guest" | "authenticated",
  principal?: string,
): Promise<{ expires: number; signature: string }> {
  const secret = readSecret(env);
  if (!secret) throw new Error("place_photo_signing_configuration_missing");
  const expires = nowSeconds + TOKEN_TTL_SECONDS;
  return { expires, signature: await hmac(secret, tokenPayload(photo, width, expires, audience, principal)) };
}

export async function verifyPlacePhotoSignature(
  env: CloudflareRuntimeEnv | undefined,
  photo: string,
  width: number,
  expires: number,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  audience?: "guest" | "authenticated",
  principal?: string,
): Promise<boolean> {
  const secret = readSecret(env);
  if (
    !secret ||
    !Number.isInteger(expires) ||
    expires < nowSeconds ||
    expires > nowSeconds + TOKEN_TTL_SECONDS + 30
  )
    return false;
  const expected = await hmac(secret, tokenPayload(photo, width, expires, audience, principal));
  return constantTimeEqual(expected, signature);
}

/** Opaque, authenticated budget subject; never put a user ID in a photo URL or telemetry. */
async function principalKey(env?: CloudflareRuntimeEnv): Promise<CryptoKey> {
  const secret = readSecret(env);
  if (!secret) throw new Error("place_photo_signing_configuration_missing");
  const key = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`roamie-photo-principal-v1:${secret}`));
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealPlacePhotoPrincipal(env: CloudflareRuntimeEnv, userId: string): Promise<string> {
  if (!userId || userId.length > 128) throw new Error("invalid_photo_principal");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await principalKey(env), new TextEncoder().encode(userId),
  ));
  return btoa(String.fromCharCode(...iv, ...encrypted)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function openPlacePhotoPrincipal(env: CloudflareRuntimeEnv | undefined, value: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{38,512}$/.test(value)) return null;
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await principalKey(env), bytes.slice(12));
    const userId = new TextDecoder().decode(plain);
    return userId && userId.length <= 128 ? userId : null;
  } catch { return null; }
}
