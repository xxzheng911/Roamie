import type { LongTermMemorySnapshot } from "@/lib/ai/memory/types";
import { formatLongTermMemoryForPrompt } from "@/lib/ai/memory/long-term-memory";
import { buildLongTermMemory } from "@/lib/ai/memory/long-term-memory";
import {
  logPlusMemoryAppliedToItinerary,
  logPlusMemoryError,
  logPlusMemoryLoad,
  logPlusMemorySkippedFree,
} from "@/lib/ai/plus-memory-log";
import { loadConversationContext, rowPlusMemory } from "@/lib/conversation-context-store";
import { resolveEffectivePlanTierWithProfile } from "@/lib/access/resolve";
import type { PlanTier } from "@/lib/plan-tier/types";

export type PlusItineraryMemoryResult = {
  tier: PlanTier;
  memoryBlock: string;
  snapshot: LongTermMemorySnapshot | null;
};

/** Plus：載入長期記憶並格式化成可併入 itinerary prompt 的文字 */
export async function resolvePlusMemoryForItinerary(
  destination?: string,
): Promise<PlusItineraryMemoryResult> {
  const tier = await resolveEffectivePlanTierWithProfile();
  if (tier !== "plus") {
    logPlusMemorySkippedFree("itinerary_generation");
    return { tier, memoryBlock: "", snapshot: null };
  }

  try {
    const persisted = await loadConversationContext();
    const plusMemory = persisted ? rowPlusMemory(persisted) : null;
    logPlusMemoryLoad({ source: "itinerary", memory: plusMemory });

    const snapshot = await buildLongTermMemory("client", plusMemory);
    const memoryBlock = formatLongTermMemoryForPrompt(snapshot);
    if (memoryBlock.trim()) {
      logPlusMemoryAppliedToItinerary({
        destination,
        preview: memoryBlock.slice(0, 240),
      });
    }
    return { tier, memoryBlock, snapshot };
  } catch (e) {
    logPlusMemoryError("itinerary_load", e);
    return { tier, memoryBlock: "", snapshot: null };
  }
}

export function appendPlusMemoryToSummary(
  baseSummary: string,
  memoryBlock: string,
): string {
  if (!memoryBlock.trim()) return baseSummary;
  return [
    baseSummary,
    "",
    "【Roamie Plus 長期記憶 — 行程生成必須遵守】",
    memoryBlock,
    "請勿重新詢問使用者已表達的旅行風格、節奏、預算與避開事項。",
  ]
    .filter(Boolean)
    .join("\n");
}
