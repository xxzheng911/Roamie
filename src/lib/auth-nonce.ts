/** 產生 Apple / Supabase OIDC 用的 nonce（raw 給 Supabase，hex(SHA-256) 給 Apple SDK） */

export async function createAppleSignInNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = generateRandomString(32);
  // Supabase GoTrue 以 hex(SHA-256(raw)) 比對 ID token 的 nonce claim；
  // 須與傳入 Apple 的 nonce 一致（勿用 base64url，否則 Nonces mismatch）。
  const hashed = await sha256Hex(raw);
  return { raw, hashed };
}

function generateRandomString(length: number): string {
  const charset =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._";
  const random = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(random, (b) => charset[b % charset.length]).join("");
}

/** 小寫 hex，與 Supabase Flutter / GoTrue 驗證一致 */
async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
