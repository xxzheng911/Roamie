import { createClient, type User } from "@supabase/supabase-js";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { revokeAppleAuthorization } from "./apple-revoke.server";
import { deleteRevenueCatCustomerV2 } from "./revenuecat-customer-delete.server";

const RECENT_AUTH_MAX_AGE_SECONDS = 10 * 60;
const PROFILE_MEDIA_BUCKET = "profile-media";
const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

type DeleteRequest = {
  requestId: string;
  apple?: { identityToken: string; authorizationCode: string };
};

type RecentAuthEvidence = {
  authenticatedAt: number | null;
  source: "jwt_amr" | "missing";
};

type DeletionRequestState = {
  request_id: string;
  status: string;
  attempt_count: number;
  last_error_code: string | null;
  apple_revoke_completed_at: string | null;
  storage_completed_at: string | null;
  analytics_completed_at: string | null;
  external_cleanup_completed_at: string | null;
};

function readEnv(env: CloudflareRuntimeEnv, name: string): string | undefined {
  const runtime = env[name];
  if (typeof runtime === "string" && runtime.trim()) return runtime.trim();
  const fallback = process.env[name];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

function logDeletionStage(
  requestId: string,
  stage: string,
  detail: Readonly<Record<string, string | number | boolean | undefined>> = {},
): void {
  console.info("ACCOUNT_DELETION_STAGE", { requestId, stage, ...detail });
}

function sanitizedDatabaseErrorMessage(message: string | undefined): string {
  if (!message) return "unknown";
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[redacted-id]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]")
    .slice(0, 240);
}

function logCollaborationCleanupError(
  requestId: string,
  operation: string,
  table: string,
  error: { code?: string; message?: string; details?: string; hint?: string },
): void {
  console.info("ACCOUNT_DELETION_COLLABORATION_CLEANUP", {
    requestId,
    operation,
    table,
    postgresCode: error.code ?? "unknown",
    sanitizedMessage: sanitizedDatabaseErrorMessage(error.message),
    sanitizedDetails: sanitizedDatabaseErrorMessage(error.details),
    sanitizedHint: sanitizedDatabaseErrorMessage(error.hint),
  });
}

export function assertAllowedSupabaseTarget(env: CloudflareRuntimeEnv, supabaseUrl: string): void {
  const runtimeAllowedRef = env.ACCOUNT_DELETION_ALLOWED_SUPABASE_REF;
  const allowedRef =
    typeof runtimeAllowedRef === "string" ? runtimeAllowedRef.trim().toLowerCase() : "";
  let actualRef: string | null = null;
  try {
    const target = new URL(supabaseUrl);
    const match = target.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/);
    if (target.protocol !== "https:" || target.username || target.password || target.port || !match)
      throw new Error("invalid_target");
    actualRef = match[1];
  } catch {
    console.info("ACCOUNT_DELETION_ENV_GUARD", {
      configured: Boolean(allowedRef),
      refMatch: false,
    });
    throw new Error("account_deletion_target_invalid");
  }
  const configured = SUPABASE_PROJECT_REF_PATTERN.test(allowedRef);
  const refMatch = configured && actualRef === allowedRef;
  console.info("ACCOUNT_DELETION_ENV_GUARD", { configured, refMatch });
  if (!refMatch) throw new Error("account_deletion_target_not_allowed");
}

function providerFor(user: User): "apple" | "google" | "email" {
  const provider = user.app_metadata?.provider;
  if (provider === "apple" || provider === "google") return provider;
  const identity = user.identities?.find(
    (item) => item.provider === "apple" || item.provider === "google",
  );
  return identity?.provider === "apple"
    ? "apple"
    : identity?.provider === "google"
      ? "google"
      : "email";
}

export function appleSubjectFor(user: User): string | null {
  const identity = user.identities?.find((item) => item.provider === "apple");
  const identityData = identity?.identity_data;
  const subject =
    identityData && typeof identityData === "object" && "sub" in identityData
      ? identityData.sub
      : null;
  if (typeof subject === "string" && subject.length > 0) return subject;
  return typeof identity?.id === "string" && identity.id.length > 0 ? identity.id : null;
}

export function recentAuthEvidenceFromBearer(request: Request): RecentAuthEvidence {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const encoded = token?.split(".")[1];
  if (!encoded) return { authenticatedAt: null, source: "missing" };
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const value = JSON.parse(atob(padded)) as {
      amr?: Array<{ method?: unknown; timestamp?: unknown }>;
    };
    const timestamps = (value.amr ?? [])
      .map((entry) => entry.timestamp)
      .filter(
        (timestamp): timestamp is number =>
          typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0,
      );
    return timestamps.length
      ? { authenticatedAt: Math.max(...timestamps), source: "jwt_amr" }
      : { authenticatedAt: null, source: "missing" };
  } catch {
    return { authenticatedAt: null, source: "missing" };
  }
}

export function evaluateRecentAuthentication(
  request: Request,
  nowSeconds = Date.now() / 1000,
): RecentAuthEvidence & { sessionAgeSeconds: number | null; pass: boolean } {
  const evidence = recentAuthEvidenceFromBearer(request);
  const sessionAgeSeconds =
    evidence.authenticatedAt === null
      ? null
      : Math.max(0, Math.floor(nowSeconds - evidence.authenticatedAt));
  return {
    ...evidence,
    sessionAgeSeconds,
    pass:
      sessionAgeSeconds !== null &&
      evidence.authenticatedAt! <= nowSeconds + 30 &&
      sessionAgeSeconds <= RECENT_AUTH_MAX_AGE_SECONDS,
  };
}

export function isPreflightOnlyState(state: DeletionRequestState | null): boolean {
  return Boolean(
    state &&
    state.status === "authenticated" &&
    !state.apple_revoke_completed_at &&
    !state.storage_completed_at &&
    !state.analytics_completed_at &&
    !state.external_cleanup_completed_at &&
    (state.last_error_code === "recent_auth_required" ||
      state.last_error_code === "apple_recent_auth_required"),
  );
}

function hasCompletedExternalStep(state: DeletionRequestState): boolean {
  return Boolean(
    state.status !== "authenticated" ||
    state.apple_revoke_completed_at ||
    state.storage_completed_at ||
    state.analytics_completed_at ||
    state.external_cleanup_completed_at,
  );
}

export function canResumeFailedExternalRequest(state: DeletionRequestState): boolean {
  if (!state.last_error_code || isPreflightOnlyState(state)) return false;
  if (state.last_error_code === "account_deletion_already_in_progress") return false;
  return (
    hasCompletedExternalStep(state) ||
    state.last_error_code.startsWith("account_storage_") ||
    state.last_error_code.startsWith("account_collaboration_") ||
    state.last_error_code.startsWith("account_analytics_") ||
    state.last_error_code.startsWith("revenuecat_") ||
    state.last_error_code.startsWith("apple_") ||
    state.last_error_code === "account_deletion_state_failed" ||
    state.last_error_code === "account_auth_delete_failed"
  );
}

function subjectFromBearer(authorization: string): string | null {
  const encoded = authorization.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!encoded) return null;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const value = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof value.sub === "string" ? value.sub : null;
  } catch {
    return null;
  }
}

async function hashUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isDeletedUserAuthError(error: { message?: string; code?: string } | null): boolean {
  return Boolean(
    error &&
    /user(?:_not_found| not found)|no user/i.test(`${error.code ?? ""} ${error.message ?? ""}`),
  );
}

async function listStorageFiles(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<string[]> {
  const files: string[] = [];
  const pending = [userId];
  while (pending.length) {
    const prefix = pending.shift()!;
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(PROFILE_MEDIA_BUCKET).list(prefix, {
        limit: 100,
        offset,
      });
      if (error) throw new Error("account_storage_list_failed");
      for (const item of data ?? []) {
        const path = `${prefix}/${item.name}`;
        if (item.id) files.push(path);
        else pending.push(path);
      }
      if (!data || data.length < 100) break;
      offset += data.length;
    }
  }
  return files;
}

export async function deleteAuthenticatedAccount(params: {
  request: Request;
  runtimeEnv: CloudflareRuntimeEnv;
  body: DeleteRequest;
}): Promise<{ completed: true }> {
  const supabaseUrl = readEnv(params.runtimeEnv, "SUPABASE_URL")
    ?.replace(/\/(rest|auth)\/v1\/?$/i, "")
    .replace(/\/$/, "");
  assertAllowedSupabaseTarget(params.runtimeEnv, supabaseUrl ?? "");
  const publishableKey =
    readEnv(params.runtimeEnv, "SUPABASE_PUBLISHABLE_KEY") ??
    readEnv(params.runtimeEnv, "SUPABASE_ANON_KEY");
  const serviceKey = readEnv(params.runtimeEnv, "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = params.request.headers.get("authorization");
  if (!supabaseUrl || !publishableKey || !serviceKey)
    throw new Error("account_deletion_configuration_missing");
  if (!authorization?.startsWith("Bearer ")) throw new Error("account_deletion_unauthorized");
  if (!/^[-0-9a-f]{36}$/i.test(params.body.requestId))
    throw new Error("account_deletion_request_invalid");

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    // getUser has already verified the token. Only a verified, now-deleted subject
    // may use the short-lived receipt; malformed/expired tokens remain unauthorized.
    const subject = isDeletedUserAuthError(authError) ? subjectFromBearer(authorization) : null;
    if (subject) {
      const userIdHash = await hashUserId(subject);
      const { data: receipt } = await admin
        .from("account_deletion_receipts")
        .select("status,expires_at")
        .eq("request_id", params.body.requestId)
        .eq("user_id_hash", userIdHash)
        .maybeSingle();
      if (receipt && new Date(receipt.expires_at).getTime() > Date.now())
        return { completed: true };
    }
    throw new Error("account_deletion_unauthorized");
  }
  const user = authData.user;
  const provider = providerFor(user);
  logDeletionStage(params.body.requestId, "authenticated", { provider });

  const { data: existing } = await admin
    .from("account_deletion_requests")
    .select(
      "request_id,status,attempt_count,last_error_code,apple_revoke_completed_at,storage_completed_at,analytics_completed_at,external_cleanup_completed_at",
    )
    .eq("user_id", user.id)
    .maybeSingle<DeletionRequestState>();

  if (existing) {
    console.info("ACCOUNT_DELETION_STATE", {
      requestId: params.body.requestId,
      stage: "existing_request_inspected",
      state: existing.status,
      lastErrorCode: existing.last_error_code ?? "none",
      appleRevokeCompleted: Boolean(existing.apple_revoke_completed_at),
      storageCompleted: Boolean(existing.storage_completed_at),
      analyticsCompleted: Boolean(existing.analytics_completed_at),
      externalCleanupCompleted: Boolean(existing.external_cleanup_completed_at),
      sameRequest: existing.request_id === params.body.requestId,
    });
  }

  // All authentication preflight runs before creating durable deletion state.
  // A legacy row left by the old ordering is releasable only when no external
  // cleanup stage ever began.
  if (provider === "apple") {
    const appleSubject = appleSubjectFor(user);
    if (
      !appleSubject ||
      !params.body.apple?.identityToken ||
      !params.body.apple.authorizationCode
    ) {
      if (isPreflightOnlyState(existing)) {
        const { error: releaseError } = await admin
          .from("account_deletion_requests")
          .delete()
          .eq("user_id", user.id)
          .eq("status", "authenticated");
        if (releaseError) throw new Error("account_deletion_state_failed");
        console.info("ACCOUNT_DELETION_STATE", {
          requestId: params.body.requestId,
          stage: "released",
          reason: "apple_recent_auth_required",
        });
      }
      throw new Error("apple_recent_auth_required");
    }
  } else {
    const recentAuth = evaluateRecentAuthentication(params.request);
    console.info("ACCOUNT_DELETION_RECENT_AUTH", {
      provider,
      sessionAgeSeconds: recentAuth.sessionAgeSeconds,
      recentAuthPass: recentAuth.pass,
      source: recentAuth.source,
    });
    if (!recentAuth.pass) {
      if (isPreflightOnlyState(existing)) {
        const { error: releaseError } = await admin
          .from("account_deletion_requests")
          .delete()
          .eq("user_id", user.id)
          .eq("status", "authenticated");
        if (releaseError) throw new Error("account_deletion_state_failed");
        console.info("ACCOUNT_DELETION_STATE", {
          requestId: params.body.requestId,
          stage: "released",
          reason: "recent_auth_required",
        });
      }
      throw new Error("recent_auth_required");
    }
  }

  let canonicalRequestId = params.body.requestId;
  if (
    existing &&
    existing.request_id !== params.body.requestId &&
    !isPreflightOnlyState(existing) &&
    !canResumeFailedExternalRequest(existing)
  )
    throw new Error("account_deletion_already_in_progress");
  if (!existing || isPreflightOnlyState(existing)) {
    if (existing) {
      console.info("ACCOUNT_DELETION_STATE", {
        requestId: params.body.requestId,
        stage: "legacy_preflight_detected",
        state: existing.status,
      });
      const { error } = await admin
        .from("account_deletion_requests")
        .update({
          request_id: params.body.requestId,
          provider,
          status: "authenticated",
          attempt_count: existing.attempt_count + 1,
          last_error_code: null,
        })
        .eq("user_id", user.id)
        .eq("status", "authenticated");
      if (error) throw new Error("account_deletion_state_failed");
      console.info("ACCOUNT_DELETION_STATE", {
        requestId: params.body.requestId,
        stage: "legacy_preflight_released",
        state: "authenticated",
      });
    } else {
      const { error } = await admin.from("account_deletion_requests").insert({
        user_id: user.id,
        request_id: params.body.requestId,
        provider,
        status: "authenticated",
      });
      if (error) throw new Error("account_deletion_state_failed");
    }
    console.info("ACCOUNT_DELETION_STATE", {
      requestId: params.body.requestId,
      stage: "request_created",
      state: "authenticated",
    });
  } else {
    canonicalRequestId = existing.request_id;
    const { error } = await admin
      .from("account_deletion_requests")
      .update({ attempt_count: existing.attempt_count + 1, last_error_code: null })
      .eq("user_id", user.id);
    if (error) throw new Error("account_deletion_state_failed");
    console.info("ACCOUNT_DELETION_STATE", {
      requestId: canonicalRequestId,
      stage: "resumed_existing_request",
      state: existing.status,
    });
  }
  let status = existing?.status ?? "authenticated";

  try {
    if (provider === "apple" && status === "authenticated") {
      const appleSubject = appleSubjectFor(user);
      await revokeAppleAuthorization({
        runtimeEnv: params.runtimeEnv,
        expectedAppleSubject: appleSubject!,
        identityToken: params.body.apple!.identityToken,
        authorizationCode: params.body.apple!.authorizationCode,
      });
      const { error } = await admin
        .from("account_deletion_requests")
        .update({
          status: "apple_revoke_complete",
          apple_revoke_completed_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
      if (error) throw new Error("account_deletion_state_failed");
      status = "apple_revoke_complete";
      logDeletionStage(canonicalRequestId, "apple_revoke_complete");
    }
    if (status === "authenticated" || status === "apple_revoke_complete") {
      console.info("ACCOUNT_DELETION_STATE", {
        requestId: canonicalRequestId,
        stage: "external_cleanup_started",
      });
      const files = await listStorageFiles(admin, user.id);
      if (files.length) {
        const { error } = await admin.storage.from(PROFILE_MEDIA_BUCKET).remove(files);
        if (error) throw new Error("account_storage_delete_failed");
      }
      const { error } = await admin
        .from("account_deletion_requests")
        .update({ status: "storage_complete", storage_completed_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (error) throw new Error("account_deletion_state_failed");
      status = "storage_complete";
      logDeletionStage(canonicalRequestId, "storage_complete");
    }

    if (status === "storage_complete") {
      const { error: inviteUserError } = await admin
        .from("trip_invites")
        .delete()
        .eq("invitee_user_id", user.id);
      if (inviteUserError) {
        logCollaborationCleanupError(
          canonicalRequestId,
          "delete_invitee_user_invites",
          "trip_invites",
          inviteUserError,
        );
        throw new Error("account_collaboration_cleanup_failed");
      }
      if (user.email) {
        const { error: inviteEmailError } = await admin
          .from("trip_invites")
          .delete()
          .eq("invitee_email", user.email);
        if (inviteEmailError) {
          logCollaborationCleanupError(
            canonicalRequestId,
            "delete_invitee_email_invites",
            "trip_invites",
            inviteEmailError,
          );
          throw new Error("account_collaboration_cleanup_failed");
        }
      }
      const { error: analyticsError } = await admin
        .from("analytics_events")
        .update({ user_id: null, session_id: null, metadata: {} })
        .eq("user_id", user.id);
      if (analyticsError) throw new Error("account_analytics_anonymization_failed");
      const { error } = await admin
        .from("account_deletion_requests")
        .update({ status: "analytics_complete", analytics_completed_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (error) throw new Error("account_deletion_state_failed");
      status = "analytics_complete";
      logDeletionStage(canonicalRequestId, "analytics_complete");
    }

    if (status === "analytics_complete") {
      await deleteRevenueCatCustomerV2(params.runtimeEnv, user.id, {
        diagnostic: ({ stage: revenueCatStage, status: revenueCatStatus }) =>
          logDeletionStage(canonicalRequestId, `revenuecat_${revenueCatStage}`, {
            status: revenueCatStatus,
          }),
      });
      const { error } = await admin
        .from("account_deletion_requests")
        .update({
          status: "external_cleanup_complete",
          external_cleanup_completed_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
      if (error) throw new Error("account_deletion_state_failed");
      logDeletionStage(canonicalRequestId, "external_cleanup_complete");
    }

    // Create a non-identifying, short-lived retry receipt before the final step.
    // A pending receipt is accepted only after getUser confirms the user is gone.
    const userIdHash = await hashUserId(user.id);
    const { error: receiptError } = await admin.from("account_deletion_receipts").upsert({
      request_id: canonicalRequestId,
      user_id_hash: userIdHash,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (receiptError) throw new Error("account_deletion_state_failed");

    // Final irreversible step: auth deletion triggers the reviewed FK cascade.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError && !/not found/i.test(deleteError.message))
      throw new Error("account_auth_delete_failed");
    logDeletionStage(canonicalRequestId, "auth_user_deleted");
    await admin
      .from("account_deletion_receipts")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("request_id", canonicalRequestId)
      .eq("user_id_hash", userIdHash);
    console.info("ACCOUNT_DELETION_STATE", {
      requestId: canonicalRequestId,
      stage: "completed",
    });
    return { completed: true };
  } catch (error) {
    const code = error instanceof Error ? error.message : "account_deletion_failed";
    logDeletionStage(canonicalRequestId, "failed", { errorCode: code });
    await admin
      .from("account_deletion_requests")
      .update({ last_error_code: code })
      .eq("user_id", user.id);
    throw error;
  }
}
