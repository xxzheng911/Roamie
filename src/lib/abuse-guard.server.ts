import { aiObservation, newGuardObservation, observeGuardDecision, observeGuardRejection, type GuardObservation } from "@/lib/abuse-guard-telemetry.server";
import { guardNow, utcDay } from "@/lib/abuse-guard-clock";
import type { GuardCommand, GuardResult } from "@/lib/abuse-guard-logic";
import {
  aiBuckets,
  aiSurfaceForMode,
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
  getWorkerScope,
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
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: GuardResult;
  try {
    result = await Promise.race([
      (async () => {
        const response = await stub.fetch(new Request("https://abuse-guard.internal/", {
          method: "POST", body: JSON.stringify(command), signal: controller.signal,
        }));
        if (!response.ok) throw new Error("guard_unavailable");
        return await response.json() as GuardResult;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("guard_unavailable")); }, 2000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const denialReasons = new Set(command.action === "charge" ? command.buckets.map(b => b.reason) : []);
  if (!result || typeof result.ok !== "boolean" || typeof result.replay !== "boolean" ||
      !Number.isFinite(result.retryAt) || result.retryAt < 0 ||
      (result.ok
        ? result.reason !== (command.action === "release" ? "released" : "allowed") || result.retryAt !== 0
        : !denialReasons.has(result.reason))) {
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

export async function authorizeGoogleBilling(input: {
  env?: CloudflareRuntimeEnv;
  family: GoogleBillingFamily;
  operationId: string;
  /** A newly owned upstream attempt must never consume a replayed admission. */
  freshAttempt?: boolean;
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
  // Google cost safety is mandatory, independently of the broader AI/bootstrap flag.
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
      if (input.freshAttempt && user.replay) throw new Error("guard_unavailable");
      charged.push(`user:${userId}`);
    }
    if (input.chargeIp && ip) {
      const ipResult = await chargeNamed(env, `ip:${ip}`, input.operationId, googleIpBuckets(input.family));
      if (!ipResult.ok) {
        await rollback(env, charged, input.operationId);
        observeGuardRejection(observation, ipResult.reason);
        return fixedStatusResponse("rate_limited", retrySeconds(ipResult.retryAt));
      }
      if (input.freshAttempt && ipResult.replay) throw new Error("guard_unavailable");
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
      if (input.freshAttempt && global.replay) throw new Error("guard_unavailable");
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

/** Low-level Guest reservation, also used by policy verifiers. Never dispatches Google.
 * Production dispatch must use runGoogleUpstreamAttempt, which owns fresh attempt identity.
 */
export async function authorizeGuestGoogleBilling(input: {
  env?: CloudflareRuntimeEnv;
  family: GoogleBillingFamily;
  operationId: string;
  request?: Request;
  observation?: GuardObservation;
}): Promise<Response | null> {
  return authorizeGoogleBilling({
    ...input, chargeUser: false, chargeIp: true, includeGlobalBudget: true,
    userId: null, ip: resolveTrustedIp(input.request),
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
