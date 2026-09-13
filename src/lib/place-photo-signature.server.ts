import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const TOKEN_TTL_SECONDS = 10 * 60;

function readSecret(env?: CloudflareRuntimeEnv): string | null {
  const runtime = env?.PLACE_PHOTO_SIGNING_SECRET;
  if (typeof runtime === "string" && runtime.trim().length >= 32) return runtime.trim();
  const fallback = process.env.PLACE_PHOTO_SIGNING_SECRET;
  return typeof fallback === "string" && fallback.trim().length >= 32 ? fallback.trim() : null;
}

function tokenPayload(photo: string, width: number, expires: number): string {
  return `${photo}\n${width}\n${expires}`;
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
): Promise<{ expires: number; signature: string }> {
  const secret = readSecret(env);
  if (!secret) throw new Error("place_photo_signing_configuration_missing");
  const expires = nowSeconds + TOKEN_TTL_SECONDS;
  return { expires, signature: await hmac(secret, tokenPayload(photo, width, expires)) };
}

export async function verifyPlacePhotoSignature(
  env: CloudflareRuntimeEnv | undefined,
  photo: string,
  width: number,
  expires: number,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const secret = readSecret(env);
  if (
    !secret ||
    !Number.isInteger(expires) ||
    expires < nowSeconds ||
    expires > nowSeconds + TOKEN_TTL_SECONDS + 30
  )
    return false;
  const expected = await hmac(secret, tokenPayload(photo, width, expires));
  return constantTimeEqual(expected, signature);
}
