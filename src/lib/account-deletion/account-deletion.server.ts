import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
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

/** Fixed code for unrecognised (transient) failures inside the deletion flow. */
const ACCOUNT_DELETION_UNEXPECTED_FAILED = "account_deletion_unexpected_failed";
/** Codes this flow (and the apple / revenuecat helpers) throw on purpose. */
const KNOWN_DELETION_ERROR_CODE = /^(?:account_|apple_|revenuecat_)[a-z0-9_]+$/;

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
    state.last_error_code === ACCOUNT_DELETION_UNEXPECTED_FAILED ||
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

const TRIP_COVER_URL_FIELDS = ["custom_cover_image_url", "cover_image_url", "cover_image"] as const;
type TripCoverUrlField = (typeof TRIP_COVER_URL_FIELDS)[number];
type SurvivingTripCoverRow = { id: string; user_id: string } & Partial<
  Record<TripCoverUrlField, string | null>
>;
const PROFILE_MEDIA_PUBLIC_MARKER = `/storage/v1/object/public/${PROFILE_MEDIA_BUCKET}/`;
/** PostgREST page size (≤ Supabase db-max-rows); pagination stops on an empty page. */
const DELETION_PAGE_SIZE = 1000;
/** Ids per `.in("id", …)` cover-clear UPDATE. */
const COVER_CLEAR_BATCH_SIZE = 150;
const STORAGE_LIST_PAGE_SIZE = 100;

/**
 * Folder names directly under `<userId>/trips` (= trip ids this user stored
 * covers for), paginated. A storage error aborts (resumable); a thrown error
 * propagates (classified as account_deletion_unexpected_failed).
 */
async function listUploadedTripFolders(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; ) {
    const { data, error } = await admin.storage
      .from(PROFILE_MEDIA_BUCKET)
      .list(`${userId}/trips`, { limit: STORAGE_LIST_PAGE_SIZE, offset });
    if (error) throw new Error("account_storage_list_failed");
    const page = data ?? [];
    for (const item of page) if (!item.id && item.name) ids.add(item.name);
    if (page.length < STORAGE_LIST_PAGE_SIZE) break;
    offset += page.length;
  }
  return ids;
}

/** Same parsing rule as trip-media-storage.ts storagePathFromPublicUrl. */
function profileMediaPathFromPublicUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  const idx = value.indexOf(PROFILE_MEDIA_PUBLIC_MARKER);
  if (idx < 0) return null;
  const raw = value.slice(idx + PROFILE_MEDIA_PUBLIC_MARKER.length).split(/[?#]/)[0]?.trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function logCoverRelocationIssue(requestId: string, operation: string, message?: string): void {
  console.info("ACCOUNT_DELETION_COVER_RELOCATION", {
    requestId,
    operation,
    sanitizedMessage: sanitizedDatabaseErrorMessage(message),
  });
}

/**
 * Copies a cover unless the destination already exists (resume-safe).
 * "source_missing": the source file is already gone (storage purged by an earlier
 * attempt, or exists(from) reports false) — the caller clears the column instead
 * of aborting. "failed": the source exists (or could not be checked) but the copy
 * failed — the caller aborts so the deletion stays resumable.
 */
async function copyTripCoverIfNeeded(
  admin: SupabaseClient,
  requestId: string,
  fromPath: string,
  toPath: string,
  storageAlreadyPurged: boolean,
): Promise<"copied" | "source_missing" | "failed"> {
  const bucket = admin.storage.from(PROFILE_MEDIA_BUCKET);
  // storage-js exists(): 400/404 → { data: false, error }; 5xx / network errors
  // throw. A throw is "failed" (resumable abort), never a raw error code.
  try {
    const { data: alreadyCopied } = await bucket.exists(toPath);
    if (alreadyCopied) return "copied";
    if (storageAlreadyPurged) return "source_missing";
    const { data: sourceExists } = await bucket.exists(fromPath);
    if (sourceExists === false) return "source_missing";
    const { error } = await bucket.copy(fromPath, toPath);
    if (!error) return "copied";
    logCoverRelocationIssue(requestId, "copy_failed", error.message);
    return "failed";
  } catch (error) {
    logCoverRelocationIssue(
      requestId,
      "copy_threw",
      error instanceof Error ? error.message : undefined,
    );
    return "failed";
  }
}

/**
 * Trips that survive deleteUser (user_id is someone else) and whose cover file
 * is that trip's own cover under the deleted user's prefix
 * (`<deletedId>/trips/<tripId>/…`) get the file copied to
 * `<ownerId>/trips/<tripId>/<file>` (trip-media-storage.ts path rule) and the
 * cover URL columns repointed. Cover columns pointing anywhere else under the
 * deleted user's prefix (e.g. their avatar) are cleared to null (default cover
 * by mood), never copied. A failed copy / update aborts the deletion with an
 * account_collaboration_ code (resumable) so no file has to be kept under the
 * deleted user's prefix. Rows already repointed or cleared no longer match, so
 * resumes skip them; copies are resume-safe. When the source file no longer
 * exists (storage already purged by an earlier attempt, or exists(from) is
 * false — e.g. the trip became shared after storage_complete), the column is
 * cleared to null instead of aborting, so resumes cannot get stuck.
 *
 * Scope: only trips the deleted user is a member of (trip_members read before
 * the transfer RPC on every attempt). A trip outside that set (e.g. on a resume
 * after the transfer already removed the membership) is handled only when the
 * cover is that trip's own file under `<deletedId>/trips/<tripId>/`: when the
 * deleted user's storage has that `<tripId>` folder (one paginated list, not a
 * call per row) it is probed and relocated when the file really exists;
 * otherwise (no folder, or storage purged) it is cleared to null in batched
 * `.in("id", …)` updates without any storage call. Other rows are left
 * untouched, so an unrelated owner cannot block, steer or exhaust the deletion
 * with crafted cover URLs.
 */
async function relocateSurvivingTripCovers(
  admin: SupabaseClient,
  userId: string,
  requestId: string,
  storageAlreadyPurged: boolean,
  memberTripIds: ReadonlySet<string>,
): Promise<void> {
  const userPrefix = `${userId}/`;
  // No PostgREST reserved characters (, . : ( )) in the pattern: uuid + slashes only.
  const likePattern = `*${PROFILE_MEDIA_PUBLIC_MARKER}${userPrefix}*`;
  // Read every matching row first, then act. Keyset pages (id > last id of the
  // previous page, ordered by id) until an empty page: max-rows cannot push
  // member trips out of the result, and rows deleted mid-read (e.g. by another
  // owner) cannot shift later rows past an offset and make them skipped.
  const rows: SurvivingTripCoverRow[] = [];
  for (let lastId: string | null = null; ; ) {
    let query = admin
      .from("saved_trips")
      .select("id,user_id,custom_cover_image_url,cover_image_url,cover_image")
      .neq("user_id", userId)
      .or(TRIP_COVER_URL_FIELDS.map((field) => `${field}.like.${likePattern}`).join(","));
    if (lastId !== null) query = query.gt("id", lastId);
    const { data, error } = await query
      .order("id", { ascending: true })
      .limit(DELETION_PAGE_SIZE);
    if (error) {
      logCollaborationCleanupError(requestId, "lookup_surviving_trip_covers", "saved_trips", error);
      throw new Error("account_collaboration_cover_lookup_failed");
    }
    const page = (data ?? []) as SurvivingTripCoverRow[];
    if (!page.length) break;
    rows.push(...page);
    lastId = page[page.length - 1].id;
  }

  // Trip ids the deleted user really stored covers for (`<deletedId>/trips/<tripId>/`):
  // evidence that a non-member trip was transferred / uploaded to by this user.
  // Listed lazily (bounded by the user's own storage, not by other users' rows);
  // never listed once storage is purged.
  let uploadedTripIds: Set<string> | null = null;
  const hasUploadedCover = async (tripId: string): Promise<boolean> => {
    if (storageAlreadyPurged) return false;
    uploadedTripIds ??= await listUploadedTripFolders(admin, userId);
    return uploadedTripIds.has(tripId);
  };

  const relocatedUrls = new Map<string, string>();
  // Non-member own-trip covers without an uploaded folder: cleared in batches.
  const batchClear = new Map<TripCoverUrlField, string[]>();
  let relocatedTrips = 0;
  let clearedCovers = 0;
  let skippedUnrelated = 0;
  for (const trip of rows) {
    const patch: Partial<Record<TripCoverUrlField, string | null>> = {};
    const tripCoverPrefix = `${userId}/trips/${trip.id}/`;
    const isMemberTrip = memberTripIds.has(trip.id);
    for (const field of TRIP_COVER_URL_FIELDS) {
      const oldPath = profileMediaPathFromPublicUrl(trip[field]);
      if (!oldPath?.startsWith(userPrefix)) continue;
      const isOwnTripCover = oldPath.startsWith(tripCoverPrefix) && !oldPath.includes("..");
      if (!isMemberTrip) {
        // Not (or no longer) a member, e.g. a resume after the transfer removed
        // the membership: act only on this trip's own cover under
        // `<deletedId>/trips/<tripId>/`. Anything else was not put there by
        // this deletion flow and is left untouched (never aborts).
        if (!isOwnTripCover) {
          skippedUnrelated += 1;
          continue;
        }
        if (!(await hasUploadedCover(trip.id))) {
          // No such folder in the deleted user's storage (or storage purged):
          // the URL is broken, clear it in a batch without probing storage.
          const ids = batchClear.get(field) ?? [];
          ids.push(trip.id);
          batchClear.set(field, ids);
          clearedCovers += 1;
          continue;
        }
        let sourceExists: boolean | null | undefined = false;
        if (!storageAlreadyPurged) {
          try {
            sourceExists = (await admin.storage.from(PROFILE_MEDIA_BUCKET).exists(oldPath)).data;
          } catch (error) {
            // 5xx / network error: outcome unknown → leave the row untouched
            // (counted as skipped below), never abort the deletion.
            logCoverRelocationIssue(
              requestId,
              "exists_threw",
              error instanceof Error ? error.message : undefined,
            );
            sourceExists = null;
          }
        }
        if (sourceExists === false) {
          // This trip's own cover file is gone (storage purged / exists false):
          // the URL is already broken, clear it so the default cover is used.
          patch[field] = null;
          clearedCovers += 1;
          continue;
        }
        if (sourceExists !== true) {
          skippedUnrelated += 1;
          continue;
        }
      }
      if (!isOwnTripCover) {
        // Not this trip's cover (avatar, another trip, …): never copy it out.
        patch[field] = null;
        clearedCovers += 1;
        continue;
      }
      let newUrl = relocatedUrls.get(oldPath);
      if (!newUrl) {
        const fileName = oldPath.split("/").pop() || "cover.jpg";
        const newPath = `${trip.user_id}/trips/${trip.id}/${fileName}`;
        const outcome = await copyTripCoverIfNeeded(
          admin,
          requestId,
          oldPath,
          newPath,
          storageAlreadyPurged,
        );
        if (outcome === "failed") throw new Error("account_collaboration_cover_copy_failed");
        if (outcome === "source_missing") {
          // Source already deleted (e.g. trip became shared after storage purge):
          // clear the column so the default cover is used, and keep going.
          patch[field] = null;
          clearedCovers += 1;
          continue;
        }
        newUrl = admin.storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(newPath).data.publicUrl;
        relocatedUrls.set(oldPath, newUrl);
      }
      patch[field] = newUrl;
    }
    if (!Object.keys(patch).length) continue;
    const { error: updateError } = await admin
      .from("saved_trips")
      .update(patch)
      .eq("id", trip.id)
      .neq("user_id", userId);
    if (updateError) {
      logCoverRelocationIssue(requestId, "repoint_failed", updateError.message);
      throw new Error("account_collaboration_cover_repoint_failed");
    }
    relocatedTrips += 1;
  }
  // Narrower than the lookup (`<deletedId>/trips/` only): a column changed to
  // e.g. the deleted user's avatar between lookup and update stays untouched.
  const tripCoverLikePattern = `*${PROFILE_MEDIA_PUBLIC_MARKER}${userId}/trips/*`;
  for (const [field, ids] of batchClear) {
    for (let i = 0; i < ids.length; i += COVER_CLEAR_BATCH_SIZE) {
      const { error: clearError } = await admin
        .from("saved_trips")
        .update({ [field]: null })
        .in("id", ids.slice(i, i + COVER_CLEAR_BATCH_SIZE))
        .neq("user_id", userId)
        .or(`${field}.like.${tripCoverLikePattern}`);
      if (clearError) {
        logCoverRelocationIssue(requestId, "batch_clear_failed", clearError.message);
        throw new Error("account_collaboration_cover_repoint_failed");
      }
    }
  }
  logDeletionStage(requestId, "trip_covers_relocated", {
    relocatedTrips,
    clearedCovers,
    skippedUnrelated,
  });
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
    // Trips this user is a member of, read before the transfer RPC removes the
    // memberships of transferred trips. Scopes cover relocation so an unrelated
    // owner cannot interfere by pointing a cover URL into this user's prefix.
    // Re-read on every attempt (see relocateSurvivingTripCovers for resumes).
    // Keyset-paginated (id > last id of the previous page, ordered by id, until
    // an empty page) so max-rows never turns member trips into non-member
    // trips, and rows deleted mid-read cannot shift later rows past an offset.
    const memberTripIds = new Set<string>();
    for (let lastMembershipId: string | null = null; ; ) {
      let membershipQuery = admin
        .from("trip_members")
        .select("id,trip_id")
        .eq("user_id", user.id);
      if (lastMembershipId !== null) {
        membershipQuery = membershipQuery.gt("id", lastMembershipId);
      }
      const { data: membershipRows, error: membershipError } = await membershipQuery
        .order("id", { ascending: true })
        .limit(DELETION_PAGE_SIZE);
      if (membershipError) {
        logCollaborationCleanupError(
          canonicalRequestId,
          "lookup_memberships",
          "trip_members",
          membershipError,
        );
        throw new Error("account_collaboration_membership_lookup_failed");
      }
      const page = (membershipRows ?? []) as { id: string; trip_id: string | null }[];
      if (!page.length) break;
      for (const row of page) if (row.trip_id) memberTripIds.add(row.trip_id);
      lastMembershipId = page[page.length - 1].id;
    }

    // Shared trips this user owns are handed to the earliest accepted member so
    // the deleteUser cascade only removes solo trips. Runs on every attempt
    // (including resumed ones) before storage cleanup and deleteUser; it is
    // idempotent and a failure aborts deletion (resumable).
    const { data: transferredTrips, error: transferError } = await admin.rpc(
      "transfer_owned_shared_trips_for_deletion",
      { p_user_id: user.id },
    );
    if (transferError) {
      logCollaborationCleanupError(
        canonicalRequestId,
        "transfer_owned_shared_trips",
        "saved_trips",
        transferError,
      );
      throw new Error("account_collaboration_transfer_failed");
    }
    logDeletionStage(canonicalRequestId, "shared_trips_transferred", {
      count: typeof transferredTrips === "number" ? transferredTrips : 0,
    });

    // Covers of surviving trips (transferred, or uploaded by this user into
    // someone else's trip) still live under this user's storage prefix. Copy
    // them to the trip owner's prefix and repoint the row (other paths are
    // cleared); a failure aborts here, before any storage is deleted.
    await relocateSurvivingTripCovers(
      admin,
      user.id,
      canonicalRequestId,
      status !== "authenticated" && status !== "apple_revoke_complete",
      memberTripIds,
    );

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
      // Shared expenses are intentionally NOT cleaned up here. trip_expenses /
      // trip_expense_payers / trip_expense_shares store user ids without an FK to
      // auth.users, so this user's payer/share rows in other people's trips survive
      // deleteUser (shown as "deleted user" in settlement) and other members' ledgers
      // stay balanced. Expenses of trips this user owns are removed by the
      // saved_trips -> trip_expenses ON DELETE CASCADE.
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
    // Only known codes are stored; raw messages (storage 5xx, network errors, …)
    // become a fixed resumable code so a transient failure cannot leave the
    // request stuck on account_deletion_already_in_progress.
    const code =
      error instanceof Error && KNOWN_DELETION_ERROR_CODE.test(error.message)
        ? error.message
        : ACCOUNT_DELETION_UNEXPECTED_FAILED;
    logDeletionStage(canonicalRequestId, "failed", { errorCode: code });
    await admin
      .from("account_deletion_requests")
      .update({ last_error_code: code })
      .eq("user_id", user.id);
    throw error;
  }
}
