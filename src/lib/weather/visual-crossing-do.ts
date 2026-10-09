import { VisualCrossingGuard, type ClimateStorage, VC_DEADLINE_MS } from "./visual-crossing-guard";
import type { ClimateInput } from "./visual-crossing-contract";

/** Internal binding only; no public route and no RPC accepting a user-selected URL/key. */
export class VisualCrossingClimate {
  private guard: VisualCrossingGuard;
  constructor(ctx: { storage: ClimateStorage }, env: Record<string, unknown>) {
    this.guard = new VisualCrossingGuard(ctx.storage,
      typeof env.VISUAL_CROSSING_API_KEY === "string" ? env.VISUAL_CROSSING_API_KEY : "");
  }
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const { input, deadline } = await request.json() as { input: ClimateInput; deadline: number };
      if (!Number.isFinite(deadline)) return Response.json(null);
      return Response.json(await this.guard.request(input, Math.min(deadline, Date.now() + VC_DEADLINE_MS)));
    } catch { return Response.json(null); }
  }
}
