export type HomeTripHydrationAction = "wait" | "load" | "clear";

export function resolveHomeTripHydrationAction(
  authLoading: boolean,
  authenticatedUserId: string | null | undefined,
): HomeTripHydrationAction {
  if (authLoading) return "wait";
  return authenticatedUserId ? "load" : "clear";
}
