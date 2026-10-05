import { getWorkerScope } from "@/lib/worker-request-scope";

export type GenerationPhase =
  | "auth"
  | "credits_reserve"
  | "input_validation"
  | "candidate_assembly"
  | "planner"
  | "validator"
  | "outfit"
  | "transit"
  | "credits_commit"
  | "credits_rollback"
  | "response";
type Settlement =
  | "not_attempted"
  | "pending"
  | "succeeded"
  | "failed"
  | "plus_bypass"
  | "rejected"
  | "unconfirmed";
type SafeException = {
  class: string;
  message: string;
  code?: string;
  stack: string[];
  cause?: SafeException;
};
type Failure = { phase: GenerationPhase; exception: SafeException };
type State = {
  requestId: string;
  generationId: string;
  phase: GenerationPhase;
  version: string;
  platform: "native" | "web" | "unknown";
  reserve: Settlement;
  commit: Settlement;
  rollback: Settlement;
  primary?: Failure;
  cleanup?: Failure;
  optional: Failure[];
  rpc: Partial<
    Record<
      "commit" | "rollback",
      { ok: boolean | null; reason: string; noop: boolean; idempotent: boolean }
    >
  >;
};
const states = new WeakMap<object, State>();
// Literal exceptions from the existing credit RPC migrations (no interpolated data).
const creditMessages = new Set([
  "not authenticated",
  "ledger_id or idempotency_key required",
  "debug override missing for debug ledger commit",
  "credits commit would go negative (debug override)",
  "credits commit would go negative",
  "credits_ensure_account: user_id required",
  "request_id required",
  "idempotency_key required",
  "invalid feature_type or amount",
]);
const uuid = (value: unknown): string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "";
function state() {
  const scope = getWorkerScope();
  return scope && states.get(scope);
}

// Arbitrary exception messages can contain prompts, provider responses and credentials.
// Retain known operational messages only; source frames/code identify unknown failures.
function safeMessage(value: unknown): string {
  if (typeof value !== "string") return "[non-string message]";
  if (value.length > 512) return "[redacted oversized message]";
  const message = value.trim().replace(/^(?:Error|TypeError): /, "");
  if (creditMessages.has(message)) return message;
  if (
    /^(?:column reference "[\w.]{1,80}" is ambiguous|relation "[\w.]{1,80}" does not exist|permission denied for (?:table|function|schema) [\w.]{1,80}|canceling statement due to (?:statement timeout|lock timeout|user request)|deadlock detected|JWT expired)$/.test(
      message,
    )
  )
    return message;
  if (
    /^(Too many subrequests\.?|Credit settlement failed|Credit reservation unavailable|rate_limited|ai_unavailable|fetch failed|Failed to fetch|Network connection lost\.?|The operation was aborted\.?|The operation timed out\.?)$/i.test(
      message,
    )
  )
    return message;
  const runtimeMessage = message.match(
    /^(Cannot read properties of (undefined|null)|Cannot convert undefined or null to object|Maximum call stack size exceeded|Converting circular structure to JSON)/,
  );
  if (runtimeMessage) return runtimeMessage[0];
  if (/^[A-Za-z_$][\w.$]{0,80} is not (a function|defined|iterable)$/.test(message)) return message;
  return "[redacted unclassified message]";
}
function field(value: unknown, key: string): unknown {
  try {
    return value && (typeof value === "object" || typeof value === "function")
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}
/** Never serialize an exception object, PostgREST details/hint or stack's message line. */
export function safeGenerationException(error: unknown, depth = 0): SafeException {
  const name = field(error, "name");
  const code = field(error, "code");
  const rawStack = field(error, "stack");
  const stack: string[] = [];
  if (typeof rawStack === "string") {
    for (const line of rawStack.slice(0, 8192).split("\n").slice(1, 25)) {
      // Retain code coordinates only, never URL hosts, query strings or local home paths.
      const match = line.match(
        /(?:^|[\s(/])((?:src|assets)\/[\w./-]+\.[cm]?[jt]sx?|[\w.-]+\.[cm]?js):(\d+):(\d+)\)?\s*$/,
      );
      if (match && !match[1].includes(".."))
        stack.push(`${match[1].slice(-120)}:${match[2].slice(0, 8)}:${match[3].slice(0, 8)}`);
      if (stack.length === 6) break;
    }
  }
  const result: SafeException = {
    class:
      typeof name === "string" &&
      /^(Error|TypeError|ReferenceError|RangeError|SyntaxError|AggregateError|AbortError|TimeoutError|ZodError|PostgrestError|CreditSettlementError)$/.test(
        name,
      )
        ? name
        : "UnknownException",
    message: safeMessage(field(error, "message")),
    stack,
  };
  if (typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code)) result.code = code;
  const cause = field(error, "cause");
  if (cause && depth < 2 && cause !== error)
    result.cause = safeGenerationException(cause, depth + 1);
  return result;
}

export function startGenerationDiagnostics(request: Request, requestId: string): void {
  const scope = getWorkerScope();
  if (!scope || states.has(scope)) return;
  const origin = request.headers.get("origin");
  states.set(scope, {
    requestId: uuid(requestId) || crypto.randomUUID(),
    generationId: uuid(requestId),
    phase: "auth",
    version: uuid(field(scope.env?.WORKER_VERSION_METADATA, "id")),
    platform:
      origin === "capacitor://localhost"
        ? "native"
        : origin?.startsWith("https://")
          ? "web"
          : "unknown",
    reserve: "not_attempted",
    commit: "not_attempted",
    rollback: "not_attempted",
    optional: [],
    rpc: {},
  });
}
export function correlateGeneration(value: unknown): void {
  const current = state();
  if (current) current.generationId = uuid(value) || current.requestId;
}
export function setGenerationPhase(phase: GenerationPhase): void {
  const current = state();
  if (current) current.phase = phase;
}
/** Nested synchronous validators restore their caller phase only on success. */
export function inGenerationPhase<T>(phase: GenerationPhase, fn: () => T): T {
  const previous = state()?.phase;
  setGenerationPhase(phase);
  const result = fn();
  if (previous) setGenerationPhase(previous);
  return result;
}
export function generationSettlement(
  operation: "reserve" | "commit" | "rollback",
  result: Settlement,
): void {
  const current = state();
  if (current) current[operation] = result;
}
/** Observe JSON-level rejections/noops without changing the existing billing behavior. */
export function generationSettlementResponse(
  operation: "commit" | "rollback",
  data: unknown,
  error: unknown,
): void {
  const current = state();
  if (!current) return;
  const ok = field(data, "ok");
  const reason = field(data, "reason");
  current[operation] = error
    ? "failed"
    : ok === true
      ? "succeeded"
      : ok === false
        ? "rejected"
        : "unconfirmed";
  current.rpc[operation] = {
    ok: typeof ok === "boolean" ? ok : null,
    reason:
      typeof reason === "string" &&
      ["not_found", "already_committed", "already_rolled_back"].includes(reason)
        ? reason
        : "",
    noop: field(data, "noop") === true,
    idempotent: field(data, "idempotent") === true,
  };
}
export function captureGenerationException(
  error: unknown,
  kind: "primary" | "cleanup" | "optional" = "primary",
): void {
  const current = state();
  if (!current) return;
  const failure = { phase: current.phase, exception: safeGenerationException(error) };
  if (kind === "primary") current.primary ??= failure;
  else if (kind === "cleanup") current.cleanup ??= failure;
  else if (current.optional.length < 2) current.optional.push(failure);
  emitGenerationDiagnostic(kind);
}
export function creditSettlementException(cause: unknown): Error {
  const error = new Error("Credit settlement failed", { cause });
  error.name = "CreditSettlementError";
  // The first frame should be the settlement call site, not this constructor helper.
  Error.captureStackTrace?.(error, creditSettlementException);
  return error;
}

/** Already sanitized; a copy prevents a consumer from changing phase authority. */
export function generationDiagnosticSnapshot(): State | undefined {
  const current = state();
  return current ? (JSON.parse(JSON.stringify(current)) as State) : undefined;
}

/** No fetch/await: capture survives a failed network/analytics/rollback operation. */
export function emitGenerationDiagnostic(
  event: "primary" | "cleanup" | "optional" | "settled" | "response",
): void {
  const current = state();
  if (!current) return;
  const snapshot = JSON.stringify({ schema: 1, event, ...current });
  try {
    const binding = getWorkerScope()?.env?.ABUSE_GUARD_ANALYTICS as
      | {
          writeDataPoint(point: { blobs: string[]; indexes: string[]; doubles: number[] }): void;
        }
      | undefined;
    if (!binding) throw new Error("diagnostic sink unavailable");
    binding.writeDataPoint({
      // Separate schema/namespace: never impersonate a Cost Guard metric/provider.
      blobs: [
        "itinerary_diagnostic_v1",
        "",
        "",
        event,
        current.primary?.phase ?? current.phase,
        "",
        current.version,
        current.generationId || current.requestId,
        snapshot,
      ],
      indexes: [`itinerary:${current.generationId || current.requestId}`],
      doubles: [1],
    });
  } catch {
    // Diagnostic delivery is best effort and must never change generation/settlement.
    console.error("[ITINERARY_DIAGNOSTIC_SINK_UNAVAILABLE]", snapshot);
  }
}
