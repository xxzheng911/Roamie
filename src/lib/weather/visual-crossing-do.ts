import { VisualCrossingGuard, type ClimateStorage, VC_DEADLINE_MS, VC_RECORD_LIMIT, VC_GUARD_VERSION } from "./visual-crossing-guard";
import type { ClimateInput } from "./visual-crossing-contract";

type HealthStorage = ClimateStorage & { sql?: { exec(query: string): { toArray(): unknown[] } } };
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Internal binding only; no public route and no RPC accepting a user-selected URL/key. */
export class VisualCrossingClimate {
  private guard: VisualCrossingGuard;
  private storage: HealthStorage;
  constructor(ctx: { storage: HealthStorage }, env: Record<string, unknown>) {
    this.storage = ctx.storage;
    this.guard = new VisualCrossingGuard(ctx.storage,
      typeof env.VISUAL_CROSSING_API_KEY === "string" ? env.VISUAL_CROSSING_API_KEY : "");
  }
  // Capability-protected: only a server-side DO binding can reach this fetch handler.
  // No public Worker route forwards this path. Never call guard.request or write storage here.
  private async health(): Promise<Response> {
    try {
      const rows = this.storage.sql?.exec("SELECT 1 AS ok").toArray();
      if (!rows || (rows[0] as { ok?: number } | undefined)?.ok !== 1) throw new Error("sqlite_unavailable");
      const state = await this.storage.get<Record<string, unknown>>("state");
      const base = { kind: "visual-crossing-health-v1", sqlite: "readable", limit: VC_RECORD_LIMIT, windowHours: 24, guardVersion: VC_GUARD_VERSION };
      if (state === undefined) return Response.json({ ...base, budget: "uninitialized", usedRecords: null });
      if (!state || !Array.isArray(state.charges) || !finiteNonnegative(state.leaseUntil) ||
        typeof state.blocked !== "boolean" || !state.cache || typeof state.cache !== "object" || Array.isArray(state.cache) ||
        !state.charges.every(c => c && finiteNonnegative(c.at) && Number.isInteger(c.records) && finiteNonnegative(c.records)) ||
        !Object.values(state.cache).every(c => c && typeof c === "object" && finiteNonnegative((c as { until?: unknown }).until))) {
        throw new Error("invalid_budget_state");
      }
      const cutoff = Date.now() - 24 * 60 * 60_000;
      const usedRecords = state.charges.reduce((sum, c) => sum + (c.at > cutoff ? c.records : 0), 0);
      if (!Number.isSafeInteger(usedRecords)) throw new Error("invalid_budget_total");
      return Response.json({ ...base, budget: "readable", usedRecords, blocked: state.blocked });
    } catch {
      // Do not serialize storage exceptions, payloads, credentials, or URLs.
      return Response.json({ kind: "visual-crossing-health-v1", status: "unavailable" }, { status: 503 });
    }
  }
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/__health") {
      return request.method === "GET" ? this.health() : new Response(null, { status: 405 });
    }
    try {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const { input, deadline } = await request.json() as { input: ClimateInput; deadline: number };
      if (!Number.isFinite(deadline)) return Response.json(null);
      return Response.json(await this.guard.request(input, Math.min(deadline, Date.now() + VC_DEADLINE_MS)));
    } catch { return Response.json(null); }
  }
}
