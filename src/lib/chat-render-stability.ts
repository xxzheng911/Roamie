import type { ChatMsg } from "@/lib/chat-history";

export type ChatShortcutRenderBranch =
  | "hydrating"
  | "loading"
  | "recommendations"
  | "messages"
  | "empty";

/** Message identity must not depend on streamed content or recommendation count. */
export function stableChatMessageKey(message: ChatMsg, index: number): string {
  return message.id?.trim() || `${message.role}:${index}`;
}

export function resolveChatRecommendationCardCount(input: {
  hidden: boolean;
  structuredCount?: number;
  recommendationCount?: number;
}): number {
  if (input.hidden) return 0;
  return input.structuredCount ?? input.recommendationCount ?? 0;
}

export function claimChatAutoScrollTarget(previousTarget: string, nextTarget: string): boolean {
  return Boolean(nextTarget) && previousTarget !== nextTarget;
}

export function resolveChatShortcutRenderBranch(input: {
  hydrating: boolean;
  messageCount: number;
  loading: boolean;
  recommendationLoading: boolean;
  recommendationCount: number;
}): ChatShortcutRenderBranch {
  if (input.hydrating) return "hydrating";
  if (input.recommendationCount > 0) return "recommendations";
  if (input.loading || input.recommendationLoading) return "loading";
  return input.messageCount > 0 ? "messages" : "empty";
}
