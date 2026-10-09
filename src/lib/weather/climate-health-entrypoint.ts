// @ts-expect-error workerd provides this runtime built-in; this project has no cloudflare:workers declarations.
import { WorkerEntrypoint } from "cloudflare:workers";

type HealthEnv = {
  VISUAL_CROSSING_CLIMATE?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};
const unavailable = () => Response.json({ kind: "visual-crossing-health-v1", status: "unavailable" }, { status: 503 });

/** Service-binding capability only; never routed by the public default Worker. */
export class ClimateHealth extends WorkerEntrypoint {
  declare protected env: HealthEnv;
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== "https://climate-health.internal" || url.pathname !== "/__health" || url.search || url.hash) {
      return new Response(null, { status: 404 });
    }
    if (request.method !== "GET" || request.body !== null) return new Response(null, { status: 405 });
    try {
      const namespace = this.env.VISUAL_CROSSING_CLIMATE;
      if (!namespace) return unavailable();
      // Neither URL, headers, body nor identity from the caller is forwarded.
      const response = await namespace.get(namespace.idFromName("global-v1")).fetch(
        new Request("https://climate.internal/__health", { method: "GET" }),
      );
      if (!response.ok) return unavailable();
      const data = await response.json() as Record<string, unknown>;
      if (data.kind !== "visual-crossing-health-v1" || data.sqlite !== "readable" || data.limit !== 900 || data.windowHours !== 24) return unavailable();
      const base = { kind: "visual-crossing-health-v1", sqlite: "readable", limit: 900, windowHours: 24 };
      if (data.budget === "uninitialized" && data.usedRecords === null) {
        return Response.json({ ...base, budget: "uninitialized", usedRecords: null });
      }
      if (data.budget !== "readable" || !Number.isSafeInteger(data.usedRecords) || (data.usedRecords as number) < 0 || typeof data.blocked !== "boolean") return unavailable();
      return Response.json({ ...base, budget: "readable", usedRecords: data.usedRecords, blocked: data.blocked });
    } catch { return unavailable(); }
  }
}
