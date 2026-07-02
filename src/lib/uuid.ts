const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 驗證 Supabase / Postgres UUID 字串（拒絕 undefined、null、空字串、字面 "undefined"） */
export function isValidUuid(value: string | null | undefined): value is string {
  if (value == null) return false;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return false;
  return UUID_RE.test(trimmed);
}
