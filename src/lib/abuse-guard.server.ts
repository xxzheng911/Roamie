import { googleObservation, aiObservation, newGuardObservation, observeGuardDecision, observeGuardRejection, type GuardObservation } from "@/lib/abuse-guard-telemetry.server";
import { guardNow, utcDay } from "@/lib/abuse-guard-clock";
import type { GuardCommand, GuardResult } from "@/lib/abuse-guard-logic";
import {
  aiBuckets,
  aiSurfaceForMode,
  billingFamilyFromUrl,
  countsTowardGlobalBudget,
  googleGlobalBuckets,
  googleIpBuckets,
  googleUserBuckets,
  readGlobalDailyUnits,
  serverFunctionBuckets,
  type AiSurface,
  type GoogleBillingFamily,
} from "@/lib/abuse-guard-policy";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { fixedStatusResponse, isKillSwitchOn, type KillSwitchName } from "@/lib/kill-switch.server";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import {
  currentAiOperation,
  admitGuestGoogleBudget,
  getWorkerScope,
  hasGuestGoogleBudgetAdmission,
  rememberAiOperation,
  resolveTrustedIp,
  resolveTrustedUserId,
} from "@/lib/worker-request-scope";

export class PaidGuardError extends Error {
  readonly status: 429 | 503;
  readonly code: "rate_limited" | "ai_unavailable" | "google_unavailable";
  readonly retryAfterSec?: number;

  constructor(
    status: 429 | 503,
    code: PaidGuardError["code"],
    retryAfterSec?: number,
  ) {
    super(code);
    this.name = "PaidGuardError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

type Denial = {
  status: 429 | 503;
  code: "rate_limited" | "ai_unavailable" | "google_unavailable";
  retryAfterSec?: number;
};

type GuardNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

export function runtimeGuardEnv(explicit?: CloudflareRuntimeEnv): CloudflareRuntimeEnv | undefined {
  const scoped = getWorkerScope()?.env;
  if (!explicit) return scoped;
  if (!scoped) return explicit;
  return { ...scoped, ...explicit };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function logGuard(family: "rollback" | "server_function", reason: string): Promise<void> {
  console.info("[ABUSE_GUARD]", {
    family,
    reason: reason === "guard_unavailable" ? "guard_unavailable" : "limited",
  });
}

function retrySeconds(retryAt: number): number {
  if (!retryAt) return 60;
  return Math.max(1, Math.ceil((retryAt - guardNow()) / 1000));
}

function denialFrom(result: GuardResult, code: Denial["code"]): Denial {
  if (result.ok) return { status: 429, code, retryAfterSec: 0 };
  return { status: 429, code, retryAfterSec: retrySeconds(result.retryAt) };
}

async function invoke(
  env: CloudflareRuntimeEnv | undefined,
  name: string,
  command: GuardCommand,
): Promise<GuardResult> {
  const namespace = env?.ABUSE_GUARD as GuardNamespace | undefined;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new Error("guard_unavailable");
  }
  const stub = namespace.get(namespace.idFromName(name));
  if (!stub || typeof stub.fetch !== "function") throw new Error("guard_unavailable");
  const response = await stub.fetch(
    new Request("https://abuse-guard.internal/", {
      method: "POST",
      body: JSON.stringify(command),
    }),
  );
  if (!response.ok) throw new Error("guard_unavailable");
  const result = (await response.json()) as GuardResult;
  if (!result || typeof result.ok !== "boolean" || typeof result.reason !== "string") {
    throw new Error("guard_unavailable");
  }
  return result;
}

async function chargeNamed(
  env: CloudflareRuntimeEnv | undefined,
  name: string,
  operationId: string,
  buckets: GuardCommand extends { action: "charge"; buckets: infer B } ? B : never,
): Promise<GuardResult> {
  return invoke(env, name, { action: "charge", operationId, buckets });
}

async function releaseNamed(
  env: CloudflareRuntimeEnv | undefined,
  name: string,
  operationId: string,
): Promise<void> {
  await invoke(env, name, { action: "release", operationId });
}

function unavailable(code: Denial["code"]): Denial {
  return { status: 503, code };
}

export async function googleOperationId(
  spec: { url: string; method: string; body?: unknown },
  request?: Request,
): Promise<string> {
  const pinned = getWorkerScope()?.googleOperationId;
  if (pinned) return pinned;
  const canonical = JSON.stringify({ u: spec.url, m: spec.method, b: spec.body ?? null });
  const digest = (await sha256Hex(canonical)).slice(0, 24);
  const requestId = (request ?? getWorkerScope()?.request)?.headers.get("x-roamie-request-id")?.trim();
  return `g:${utcDay()}:${digest}:${requestId || crypto.randomUUID()}`;
}

export async function authorizeGoogleBilling(input: {
  env?: CloudflareRuntimeEnv;
  family: GoogleBillingFamily;
  operationId: string;
  chargeUser: boolean;
  chargeIp: boolean;
  userId?: string | null;
  ip?: string | null;
  /** Guest public reads have no user bucket, but still count toward the global Google budget. */
  includeGlobalBudget?: boolean;
  observation?: GuardObservation;
}): Promise<Response | null> {
  const observation = input.observation ?? newGuardObservation("google", input.family);
  const env = runtimeGuardEnv(input.env);
  if (!isAbuseGuardEnforcementOn(env)) return null;
  const userId = input.userId === undefined ? resolveTrustedUserId() : input.userId;
  const ip = input.ip ?? resolveTrustedIp();
  if (isKillSwitchOn(env, "DISABLE_GOOGLE_PROXY")) {
    observeGuardRejection(observation, "kill_switch");
    return fixedStatusResponse("google_unavailable");
  }
  if ((input.chargeUser && !userId) || (input.chargeIp && !ip)) {
    observeGuardRejection(observation, "missing_principal");
    return fixedStatusResponse("google_unavailable");
  }
  const charged: string[] = [];
  try {
    if (input.chargeUser && userId) {
      const user = await chargeNamed(env, `user:${userId}`, input.operationId, googleUserBuckets(input.family));
      if (!user.ok) {
        observeGuardRejection(observation, user.reason);
        return fixedStatusResponse("rate_limited", retrySeconds(user.retryAt));
      }
      charged.push(`user:${userId}`);
    }
    if (input.chargeIp && ip) {
      const ipResult = await chargeNamed(env, `ip:${ip}`, input.operationId, googleIpBuckets(input.family));
      if (!ipResult.ok) {
        await rollback(env, charged, input.operationId);
        observeGuardRejection(observation, ipResult.reason);
        return fixedStatusResponse("rate_limited", retrySeconds(ipResult.retryAt));
      }
      charged.push(`ip:${ip}`);
    }
    const includeGlobal =
      input.includeGlobalBudget === true
        ? countsTowardGlobalBudget(input.family)
        : Boolean(input.chargeUser && input.chargeIp && countsTowardGlobalBudget(input.family));
    if (includeGlobal) {
      const global = await chargeNamed(
        env,
        "global:google",
        input.operationId,
        googleGlobalBuckets(input.family, readGlobalDailyUnits(env)),
      );
      if (!global.ok) {
        await rollback(env, charged, input.operationId);
        observeGuardRejection(observation, global.reason);
        return fixedStatusResponse("rate_limited", retrySeconds(global.retryAt));
      }
    }
    observeGuardDecision(observation, "allow", "allowed");
    return null;
  } catch {
    await rollback(env, charged, input.operationId);
    observeGuardRejection(observation, "guard_unavailable");
    return fixedStatusResponse("google_unavailable");
  }
}

async function rollback(
  env: CloudflareRuntimeEnv | undefined,
  names: string[],
  operationId: string,
): Promise<void> {
  for (const name of names) {
    try {
      await releaseNamed(env, name, operationId);
    } catch {
      await logGuard("rollback", "guard_unavailable");
    }
  }
}

export async function authorizeGoogleSpec(
  spec: { url: string; method: string; body?: unknown },
  env?: CloudflareRuntimeEnv,
  request?: Request,
  observation?: GuardObservation,
): Promise<Response | null> {
  const family = billingFamilyFromUrl(spec.url);
  const operationId = await googleOperationId(spec, request);
  return authorizeGoogleBilling({
    env,
    family,
    observation: observation ?? googleObservation(family),
    operationId,
    chargeUser: true,
    chargeIp: true,
    userId: resolveTrustedUserId(),
    ip: resolveTrustedIp(request),
  });
}

/**
 * Canonical durable budget for one Guest Google upstream.
 * Runs whether or not ABUSE_GUARD_ENFORCEMENT is set.
 * Authenticated billing stays on authorizeGoogleBilling and still follows that flag.
 * IP daily weight and global units come from the existing AbuseGuard policy.
 * A repeated operation id in this request, or a Durable Object replay, is not charged again.
 */
export async function authorizeGuestGoogleBilling(input: {
  env?: CloudflareRuntimeEnv;
  family: GoogleBillingFamily;
  operationId: string;
  request?: Request;
  observation?: GuardObservation;
}): Promise<Response | null> {
  const observation = input.observation ?? newGuardObservation("google", input.family);
  const env = runtimeGuardEnv(input.env);
  if (!input.operationId) {
    observeGuardRejection(observation, "guard_unavailable");
    return fixedStatusResponse("google_unavailable");
  }
  if (hasGuestGoogleBudgetAdmission(input.operationId)) return null;
  if (isKillSwitchOn(env, "DISABLE_GOOGLE_PROXY")) {
    observeGuardRejection(observation, "kill_switch");
    return fixedStatusResponse("google_unavailable");
  }
  const ip = resolveTrustedIp(input.request);
  if (!ip) {
    observeGuardRejection(observation, "missing_principal");
    return fixedStatusResponse("google_unavailable");
  }
  const charged: string[] = [];
  try {
    const ipResult = await chargeNamed(env, `ip:${ip}`, input.operationId, googleIpBuckets(input.family));
    if (!ipResult.ok) {
      observeGuardRejection(observation, ipResult.reason);
      return fixedStatusResponse("rate_limited", retrySeconds(ipResult.retryAt));
    }
    if (!ipResult.replay) charged.push(`ip:${ip}`);
    if (countsTowardGlobalBudget(input.family)) {
      const global = await chargeNamed(
        env,
        "global:google",
        input.operationId,
        googleGlobalBuckets(input.family, readGlobalDailyUnits(env)),
      );
      if (!global.ok) {
        if (!ipResult.replay) await rollback(env, charged, input.operationId);
        observeGuardRejection(observation, global.reason);
        return fixedStatusResponse("rate_limited", retrySeconds(global.retryAt));
      }
    }
    admitGuestGoogleBudget(input.operationId);
    observeGuardDecision(observation, "allow", "allowed");
    return null;
  } catch {
    await rollback(env, charged, input.operationId);
    observeGuardRejection(observation, "guard_unavailable");
    return fixedStatusResponse("google_unavailable");
  }
}

/** Anonymous public read. IP is the only principal. No user bucket and no client-supplied id. */
export async function authorizeGuestGoogleSpec(
  spec: { url: string; method: string; body?: unknown },
  env?: CloudflareRuntimeEnv,
  request?: Request,
  observation?: GuardObservation,
): Promise<Response | null> {
  const family = billingFamilyFromUrl(spec.url);
  const operationId = await googleOperationId(spec, request);
  return authorizeGuestGoogleBilling({
    env,
    family,
    operationId,
    request,
    observation: observation ?? googleObservation(family),
  });
}

export async function authorizePlacePhotoSign(
  photo: string,
  env: CloudflareRuntimeEnv | undefined,
  request: Request,
  userId: string,
): Promise<Response | null> {
  const digest = (await sha256Hex(photo)).slice(0, 16);
  const requestId = request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
  return authorizeGoogleBilling({
    env,
    family: "place_photos",
    operationId: `photo-sign:${utcDay()}:${digest}:${requestId}`,
    chargeUser: true,
    chargeIp: false,
    userId,
    ip: null,
  });
}

/**
 * Guest photo media fetch. Signing a URL does not call Google, so it is not an admission.
 * Each origin fetch that reaches this Worker is one upstream and is admitted once here.
 */
export async function authorizeGuestPlacePhotoFetch(
  env: CloudflareRuntimeEnv | undefined,
  request: Request,
  observation?: GuardObservation,
): Promise<Response | null> {
  const signature = new URL(request.url).searchParams.get("signature") ?? "";
  const digest = (await sha256Hex(signature || request.url)).slice(0, 16);
  return authorizeGuestGoogleBilling({
    env,
    family: "place_photos",
    observation,
    operationId: `photo-fetch:${utcDay()}:${digest}:${crypto.randomUUID()}`,
    request,
  });
}

export async function authorizePlacePhotoFetch(
  env: CloudflareRuntimeEnv | undefined,
  request: Request,
  observation?: GuardObservation,
): Promise<Response | null> {
  const signature = new URL(request.url).searchParams.get("signature") ?? "";
  const digest = (await sha256Hex(signature || request.url)).slice(0, 16);
  // Origin replay stays billable. A client request id must not collapse it.
  // Cache hits never reach the Worker, so a CDN refetch is not charged here.
  return authorizeGoogleBilling({
    env,
    family: "place_photos",
    observation,
    operationId: `photo-fetch:${utcDay()}:${digest}:${crypto.randomUUID()}`,
    chargeUser: false,
    chargeIp: true,
    userId: null,
    ip: resolveTrustedIp(request),
  });
}

async function aiOperationId(
  surface: AiSurface,
  request?: Request,
  material?: string,
): Promise<string> {
  const existing = currentAiOperation(surface);
  if (existing) return existing;
  const requestId =
    (request ?? getWorkerScope()?.request)?.headers.get("x-roamie-request-id")?.trim() ||
    crypto.randomUUID();
  // Missing material must not collapse into a client-chosen request id.
  const varied = material ?? crypto.randomUUID();
  const digest = (await sha256Hex(`${surface}\n${requestId}\n${varied}`)).slice(0, 24);
  return rememberAiOperation(surface, `ai:${surface}:${utcDay()}:${digest}`);
}

async function decideAi(
  surface: AiSurface,
  request?: Request,
  material?: string,
): Promise<Denial | null> {
  const observation = aiObservation(surface);
  const env = runtimeGuardEnv();
  if (!isAbuseGuardEnforcementOn(env)) return null;
  if (isKillSwitchOn(env, "DISABLE_AI")) {
    observeGuardRejection(observation, "kill_switch");
    return unavailable("ai_unavailable");
  }
  const userId = resolveTrustedUserId();
  if (!userId) {
    observeGuardRejection(observation, "missing_principal");
    return unavailable("ai_unavailable");
  }
  try {
    const result = await chargeNamed(
      env,
      `user:${userId}`,
      await aiOperationId(surface, request, material),
      aiBuckets(surface),
    );
    if (!result.ok) {
      observeGuardRejection(observation, result.reason);
      return denialFrom(result, "rate_limited");
    }
    observeGuardDecision(observation, "allow", "allowed");
    return null;
  } catch {
    observeGuardRejection(observation, "guard_unavailable");
    return unavailable("ai_unavailable");
  }
}

export async function authorizeAiUse(
  surface: AiSurface,
  request?: Request,
  material?: string,
): Promise<Response | null> {
  const denial = await decideAi(surface, request, material);
  if (!denial) return null;
  return fixedStatusResponse(denial.code, denial.retryAfterSec);
}

export async function assertAiUse(
  surface: AiSurface,
  request?: Request,
  material?: string,
): Promise<void> {
  const denial = await decideAi(surface, request, material);
  if (!denial) return;
  throw new PaidGuardError(denial.status, denial.code, denial.retryAfterSec);
}

export async function consumeServerFunctionSlot(userId: string): Promise<"ok" | "limited" | "unavailable"> {
  if (!isAbuseGuardEnforcementOn()) return "ok";
  try {
    const result = await chargeNamed(
      runtimeGuardEnv(),
      `user:${userId}`,
      `sf:${crypto.randomUUID()}`,
      serverFunctionBuckets(),
    );
    if (!result.ok) {
      await logGuard("server_function", result.reason);
      return "limited";
    }
    return "ok";
  } catch {
    await logGuard("server_function", "guard_unavailable");
    return "unavailable";
  }
}

/** Bootstrap keeps the pre-migration per-isolate server-function limit. Enforcement uses the DO. */
export async function admitAuthenticatedServerFunction(userId: string): Promise<void> {
  if (!isAbuseGuardEnforcementOn()) {
    const rate = checkRateLimit(
      `server-function:${userId}:minute`,
      SECURITY_RATE_LIMITS.serverFunctionPerMinute,
      60_000,
    );
    if (!rate.allowed) throw new Error("Too Many Requests");
    return;
  }
  const slot = await consumeServerFunctionSlot(userId);
  if (slot === "limited") throw new Error("Too Many Requests");
  if (slot === "unavailable") throw new Error("service_unavailable");
}

export function killSwitchResponse(
  env: CloudflareRuntimeEnv | undefined,
  name: KillSwitchName,
  code: "google_unavailable" | "ai_unavailable" | "sync_unavailable",
): Response | null {
  return isKillSwitchOn(env, name) ? fixedStatusResponse(code) : null;
}

export { aiSurfaceForMode };
