import { getWorkerScope } from "../worker-request-scope";
import { type ClimateInput, type ClimateSummary } from "./visual-crossing-contract";
import { VC_DEADLINE_MS } from "./visual-crossing-guard";

type ClimateNamespace = { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };

export async function visualCrossingTripClimate(input: ClimateInput): Promise<ClimateSummary | null> {
  const env = getWorkerScope()?.env;
  // Never read process.env/.env or use a direct-fetch escape hatch in application code.
  if (env?.VISUAL_CROSSING_ENABLED !== "true" || !env.VISUAL_CROSSING_CLIMATE) return null;
  const namespace = env.VISUAL_CROSSING_CLIMATE as ClimateNamespace;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + VC_DEADLINE_MS;
  try {
    return await Promise.race([
      (async () => {
        const response = await namespace.get(namespace.idFromName("global-v1")).fetch(new Request("https://climate.internal/query", {
          method: "POST", body: JSON.stringify({ input, deadline }), signal: controller.signal,
        }));
        return response.ok ? await response.json() as ClimateSummary | null : null;
      })(),
      new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, VC_DEADLINE_MS); }),
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); controller.abort(); }
}
