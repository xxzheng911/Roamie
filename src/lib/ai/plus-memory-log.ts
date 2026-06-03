import type { PlusConversationMemory } from "@/lib/ai/plus-conversation-memory";

function summarizePlusMemory(memory: PlusConversationMemory | null | undefined): Record<string, unknown> {
  if (!memory) return { empty: true };
  return {
    likesCount: memory.likes?.length ?? 0,
    dislikesCount: memory.dislikes?.length ?? 0,
    travelPace: memory.travelPace ?? null,
    budgetRange: memory.budgetRange ?? null,
    preferredTransport: memory.preferredTransport ?? null,
    savedPlacePatterns: memory.savedPlacePatterns?.slice(0, 6) ?? [],
    travelPersonality: memory.travelPersonality ?? null,
  };
}

export function logPlusMemoryLoad(params: {
  source: string;
  memory: PlusConversationMemory | null | undefined;
}): void {
  console.info("[PLUS_MEMORY_LOAD]", {
    source: params.source,
    ...summarizePlusMemory(params.memory),
  });
}

export function logPlusMemorySave(params: {
  memory: PlusConversationMemory;
  mergedFromChat?: boolean;
}): void {
  console.info("[PLUS_MEMORY_SAVE]", {
    ...summarizePlusMemory(params.memory),
    mergedFromChat: params.mergedFromChat ?? false,
  });
}

export function logPlusMemoryAppliedToChat(params: {
  traitCount?: number;
  preview?: string;
}): void {
  console.info("[PLUS_MEMORY_APPLIED_TO_CHAT]", params);
}

export function logPlusMemoryAppliedToItinerary(params: {
  destination?: string;
  preview?: string;
}): void {
  console.info("[PLUS_MEMORY_APPLIED_TO_ITINERARY]", params);
}

export function logPlusMemorySkippedFree(reason: string): void {
  console.info("[PLUS_MEMORY_SKIPPED_FREE]", { reason });
}

export function logPlusMemoryError(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[PLUS_MEMORY_ERROR]", { step, message });
}
