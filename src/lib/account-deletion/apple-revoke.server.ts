import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

type AppleRuntimeConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  clientId: string;
};

type JwtClaims = { sub?: string; aud?: string | string[]; exp?: number };

function readEnv(env: CloudflareRuntimeEnv, name: string): string | undefined {
  const runtime = env[name];
  if (typeof runtime === "string" && runtime.trim()) return runtime.trim();
  const fallback = process.env[name];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

function configFrom(env: CloudflareRuntimeEnv): AppleRuntimeConfig {
  const teamId = readEnv(env, "APPLE_TEAM_ID");
  const keyId = readEnv(env, "APPLE_KEY_ID");
  const privateKey = readEnv(env, "APPLE_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  const clientId = readEnv(env, "APPLE_CLIENT_ID");
  if (!teamId || !keyId || !privateKey || !clientId)
    throw new Error("apple_revoke_configuration_missing");
  return { teamId, keyId, privateKey, clientId };
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeClaims(token: string): JwtClaims {
  const encoded = token.split(".")[1];
  if (!encoded) throw new Error("apple_identity_token_invalid");
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as JwtClaims;
  } catch {
    throw new Error("apple_identity_token_invalid");
  }
}

export function evaluateAppleIdentityToken(
  identityToken: string,
  expectedAppleSubject: string,
  clientId: string,
  now = Math.floor(Date.now() / 1000),
): {
  hasSupabaseAppleIdentity: boolean;
  hasFreshAppleSubject: boolean;
  subjectMatch: boolean;
  valid: boolean;
} {
  const presented = decodeClaims(identityToken);
  const audience = Array.isArray(presented.aud) ? presented.aud : [presented.aud];
  const hasSupabaseAppleIdentity = expectedAppleSubject.length > 0;
  const hasFreshAppleSubject = typeof presented.sub === "string" && presented.sub.length > 0;
  const subjectMatch = hasFreshAppleSubject && presented.sub === expectedAppleSubject;
  return {
    hasSupabaseAppleIdentity,
    hasFreshAppleSubject,
    subjectMatch,
    valid:
      hasSupabaseAppleIdentity &&
      subjectMatch &&
      audience.includes(clientId) &&
      typeof presented.exp === "number" &&
      presented.exp > now,
  };
}

function pemToDer(pem: string): Uint8Array {
  const value = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!value) throw new Error("apple_private_key_invalid");
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function createClientSecret(config: AppleRuntimeConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = base64Url(
    JSON.stringify({
      iss: config.teamId,
      iat: now,
      exp: now + 300,
      aud: "https://appleid.apple.com",
      sub: config.clientId,
    }),
  );
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

export async function revokeAppleAuthorization(params: {
  runtimeEnv: CloudflareRuntimeEnv;
  identityToken: string;
  authorizationCode: string;
  expectedAppleSubject: string;
}): Promise<void> {
  const config = configFrom(params.runtimeEnv);
  const identity = evaluateAppleIdentityToken(
    params.identityToken,
    params.expectedAppleSubject,
    config.clientId,
  );
  console.info("ACCOUNT_DELETION_APPLE_IDENTITY", {
    provider: "apple",
    hasSupabaseAppleIdentity: identity.hasSupabaseAppleIdentity,
    hasFreshAppleSubject: identity.hasFreshAppleSubject,
    subjectMatch: identity.subjectMatch,
  });
  if (!identity.valid) throw new Error("apple_identity_mismatch");

  const clientSecret = await createClientSecret(config);
  const tokenResponse = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code: params.authorizationCode,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok) {
    if (tokenPayload.error === "invalid_grant") throw new Error("apple_authorization_replayed");
    throw new Error("apple_token_exchange_failed");
  }
  const exchangedClaims = tokenPayload.id_token ? decodeClaims(tokenPayload.id_token) : null;
  if (exchangedClaims?.sub !== params.expectedAppleSubject)
    throw new Error("apple_identity_mismatch");
  const token = tokenPayload.refresh_token ?? tokenPayload.access_token;
  if (!token) throw new Error("apple_revoke_token_missing");

  const revokeResponse = await fetch(APPLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokenPayload.refresh_token ? "refresh_token" : "access_token",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  // Apple's revoke endpoint is idempotent for a valid client/token contract.
  if (!revokeResponse.ok) throw new Error("apple_revoke_failed");
}
