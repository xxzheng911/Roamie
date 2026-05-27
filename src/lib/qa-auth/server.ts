import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { QA_AUTH_EMAIL_DOMAIN, QA_USER_METADATA_KEY } from "./constants";

function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

export function isQaAuthEnabledOnServer(): boolean {
  return process.env.ROAMIE_QA_AUTH_ENABLED === "1";
}

function hashDeviceId(deviceId: string): string {
  let h = 2166136261;
  for (let i = 0; i < deviceId.length; i++) {
    h ^= deviceId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function qaEmailForDevice(deviceId: string): string {
  const safe = deviceId.trim().slice(0, 64) || "anonymous";
  return `qa.${hashDeviceId(safe)}@${QA_AUTH_EMAIL_DOMAIN}`;
}

function isExistingUserError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("already") || m.includes("registered") || m.includes("exists");
}

async function ensureQaAuthUser(email: string): Promise<void> {
  const password =
    process.env.ROAMIE_QA_AUTH_SECRET?.trim() ||
    `roamie-qa-${process.env.SUPABASE_URL?.slice(-8) ?? "dev"}-not-for-prod`;

  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      [QA_USER_METADATA_KEY]: true,
      full_name: "QA Test",
      display_name: "QA 測試帳號",
    },
    app_metadata: {
      provider: "email",
      providers: ["email"],
    },
  });

  if (error && !isExistingUserError(error.message)) {
    throw new Error(error.message);
  }
}

export type QaAuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: {
    id: string;
    email: string | null;
  };
};

/**
 * 建立或登入裝置專屬 QA 帳號（無 Google / Apple OAuth）。
 * 僅在 server 且 ROAMIE_QA_AUTH_ENABLED=1 時呼叫。
 */
export async function createQaAuthSession(deviceId: string): Promise<QaAuthSessionPayload> {
  const email = qaEmailForDevice(deviceId);
  await ensureQaAuthUser(email);

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    throw new Error(linkError?.message ?? "Failed to generate QA auth link");
  }

  const url = process.env.SUPABASE_URL;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) {
    throw new Error("Missing Supabase URL or publishable key");
  }

  const anon = createClient(normalizeSupabaseUrl(url), publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: hashedToken,
    type: "email",
  });

  const session = verified?.session;
  const user = verified?.user;
  if (verifyError || !session || !user) {
    throw new Error(verifyError?.message ?? "Failed to create QA session");
  }

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in ?? 3600,
    token_type: session.token_type ?? "bearer",
    user: { id: user.id, email: user.email ?? null },
  };
}
