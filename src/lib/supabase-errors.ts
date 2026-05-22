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
    msg.includes("saved_places")
  );
}
