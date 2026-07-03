/** PostgREST / Supabase errors when schema is not migrated yet. */
export function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("Could not find the table") ||
    msg.includes("schema cache") ||
    msg.includes("saved_trips") ||
    msg.includes("saved_places") ||
    msg.includes("trip_invites") ||
    msg.includes("trip_members")
  );
}

export const TRIP_INVITE_CREATE_FAILED_MESSAGE = "邀請連結建立失敗，請稍後再試";

/** Map Supabase / PostgREST errors to user-facing Chinese for trip collab. */
export function formatTripCollabError(
  error: unknown,
  fallback = TRIP_INVITE_CREATE_FAILED_MESSAGE,
): string {
  if (isMissingTableError(error)) return fallback;
  const msg = error instanceof Error ? error.message : String(error);
  if (
    msg.includes("schema cache") ||
    msg.includes("trip_invites") ||
    msg.includes("trip_members") ||
    msg.includes("permission denied") ||
    msg.includes("row-level security")
  ) {
    return fallback;
  }
  if (/[\u4e00-\u9fff]/.test(msg)) return msg;
  return fallback;
}
