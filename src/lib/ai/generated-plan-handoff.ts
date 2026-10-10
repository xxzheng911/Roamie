import { logGeneratedPlanHandoff, type PlanCorrelation } from "./generated-plan-handoff-diagnostic";
import { isCreateItineraryIntent } from "@/lib/ai/chat-context-intent";

export type TripCreationAuthority = {
  generationId: string;
  intentSource: "plan_ai_create" | "direct_itinerary_create" | "confirmed_create" | "advice_create";
  explicitCreate: true;
};

/** Called at an action boundary, never inferred from historical chat at delivery. */
export function beginTripCreation<T extends { tripCreationAuthority?: TripCreationAuthority }>(
  session: T, intentSource: TripCreationAuthority["intentSource"], generationId?: string,
): T & { tripCreationAuthority: TripCreationAuthority } {
  return { ...session, tripCreationAuthority: session.tripCreationAuthority ?? {
    generationId: generationId || crypto.randomUUID(), intentSource, explicitCreate: true,
  } };
}

/** Capture the explicit action on the request/result envelope, independently of UI state. */
export function bindTripCreationAuthority(
  authority: (Omit<TripCreationAuthority, "generationId"> & { generationId?: string }) | undefined,
  generationId: string,
): TripCreationAuthority | undefined {
  if (!authority?.explicitCreate || !generationId ||
    (authority.generationId && authority.generationId !== generationId)) return undefined;
  return Object.freeze({ ...authority, generationId });
}

/** A new explicit handoff takes precedence over a cached/previous Chat mount. */
export function hasPendingTripCreationHandoff(
  session: { pendingHandoff?: boolean; tripCreationAuthority?: TripCreationAuthority },
  consumedGenerationId?: string,
): boolean {
  const authority = session.tripCreationAuthority;
  return session.pendingHandoff === true && authority?.explicitCreate === true &&
    Boolean(authority.generationId) && authority.generationId !== consumedGenerationId;
}

/** Interpret only the current action/turn at entry; never scan chat history. */
export function isExplicitTripCreationTurn(text: string): boolean {
  if (/(預覽|预览|preview|プレビュー|미리보기)/i.test(text)) return false;
  return isCreateItineraryIntent(text) || /(?:用|使用)\s*AI\s*建立行程/i.test(text);
}

export function shouldPersistGeneratedPlan(input: {
  diagnostic?: PlanCorrelation;
  authority?: TripCreationAuthority;
  generationId?: string;
  styleReselect?: boolean;
  explicitCreate?: boolean;
}): boolean {
  let reason: "persist_explicit_build" | "preview_only" | "recommendation_only" | "stale_generation" | "missing_generation_id";
  let shouldPersist = false;
  if (input.authority?.explicitCreate) {
    if (!input.authority.generationId || !input.generationId) reason = "missing_generation_id";
    else if (input.authority.generationId !== input.generationId) reason = "stale_generation";
    else { reason = "persist_explicit_build"; shouldPersist = true; }
  } else if (input.explicitCreate) {
    reason = "persist_explicit_build"; shouldPersist = true;
  } else reason = input.styleReselect ? "preview_only" : "recommendation_only";
  logGeneratedPlanHandoff("decision", { ...input.diagnostic, sourceStage: "handoff_policy", shouldPersist, reason });
  if (!shouldPersist) logGeneratedPlanHandoff("handoff_skipped", { ...input.diagnostic, sourceStage: "handoff_policy", shouldPersist, reason });
  return shouldPersist;
}

/** One attempt per generated result, including save/navigation failures. A retry
 * must have a new generation identity; it must never replay an uncertain save. */
export function createGeneratedPlanHandoff() {
  const attempts = new Map<string, Promise<void>>();
  return (generationId: string, persist: () => Promise<void>): Promise<void> => {
    const existing = attempts.get(generationId);
    if (existing) {
      logGeneratedPlanHandoff("handoff_skipped", { reason: "duplicate_generation", hasGenerationId: Boolean(generationId) });
      return existing;
    }
    const pending = Promise.resolve().then(persist);
    attempts.set(generationId, pending);
    return pending;
  };
}

export function generatedPlanIdentity(session: { planningSessionId?: string; planVersion?: number; tripCreationAuthority?: TripCreationAuthority }, fallback: string): string {
  if (session.tripCreationAuthority?.generationId) return session.tripCreationAuthority.generationId;
  return session.planningSessionId
    ? `plan_${session.planningSessionId}_${session.planVersion ?? 1}`
    : fallback;
}

export type GeneratedPlanOwnership = {
  generationId: string;
  isCurrent: () => boolean;
};
