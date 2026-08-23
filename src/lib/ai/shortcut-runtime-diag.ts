/**
 * Shortcut / nearby runtime checkpoints for Debug device Xcode console.
 *
 * Always emits via console.info — not gated by VITE_VERBOSE_LOG /
 * VITE_DEBUG_DIAGNOSTICS. Previous SHORTCUT_NORMALIZED / SHORTCUT_ROUTE
 * lines were invisible on device because they used the verbose logger.
 */

export type RtShortcutSource = "home_mood" | "chat_shortcut" | "free_text";

export type RtResponseBranch =
  | "nearby_cards"
  | "destination_clarification"
  | "trip_duration_question"
  | "no_more"
  | "general_chat"
  | "other";

function formatParts(
  parts: Record<string, string | number | boolean | null | undefined>,
): string[] {
  return Object.entries(parts).map(([key, value]) => {
    if (value === undefined || value === null) return `${key}=`;
    return `${key}=${value}`;
  });
}

export function logShortcutRuntime(
  tag: string,
  parts: Record<string, string | number | boolean | null | undefined> = {},
): void {
  console.info(tag, ...formatParts(parts));
}

export function logRtResponseBranch(branch: RtResponseBranch): void {
  logShortcutRuntime("[RT_RESPONSE_BRANCH]", { branch });
}

export function logRtContinuationBranch(
  branch: "nearby_cards" | "refinement_message" | "no_more" | "other",
): void {
  logShortcutRuntime("[RT_CONTINUATION_BRANCH]", { branch });
}
