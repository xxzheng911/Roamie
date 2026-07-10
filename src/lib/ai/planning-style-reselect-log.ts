import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";

export function logAiStyleReselectDetected(
  fromStyle: TripStyleKey | "unknown",
  toStyle: TripStyleKey,
): void {
  logAiPipeline("[AI_STYLE_RESELECT_DETECTED]", `fromStyle=${fromStyle}`, `toStyle=${toStyle}`);
}

export function logAiStyleReselectSessionReset(planVersion: number, sessionId: string): void {
  logAiPipeline(
    "[AI_STYLE_RESELECT_SESSION_RESET]",
    `planVersion=${planVersion}`,
    `sessionId=${sessionId}`,
  );
}

export function logAiStyleReselectGenerateStart(
  destination: string,
  style: TripStyleKey,
  days: number,
  planVersion: number,
): void {
  logAiPipeline(
    "[AI_STYLE_RESELECT_GENERATE_START]",
    `destination=${destination}`,
    `style=${style}`,
    `days=${days}`,
    `planVersion=${planVersion}`,
  );
}

export function logAiStyleReselectGenerateSuccess(itemCount: number, planVersion: number): void {
  logAiPipeline(
    "[AI_STYLE_RESELECT_GENERATE_SUCCESS]",
    `items=${itemCount}`,
    `planVersion=${planVersion}`,
  );
}

export function logAiStyleReselectGenerateFail(reason: string, planVersion: number): void {
  logAiPipeline(
    "[AI_STYLE_RESELECT_GENERATE_FAIL]",
    `reason=${reason}`,
    `planVersion=${planVersion}`,
  );
}
