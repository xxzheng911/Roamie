function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message ?? error);
  }
  return String(error);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code ?? "");
  }
  return "";
}

/** PostgREST：資料表尚未建立（與「缺少欄位」不同） */
export function isMissingTableError(error: unknown): boolean {
  const msg = errorMessage(error);
  const code = errorCode(error);
  if (isMissingColumnError(error)) return false;
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /Could not find the table/i.test(msg)
  );
}

/** PostgREST schema cache 或 Postgres：migration 尚未套用（custom_title、cover_query 等） */
export function isMissingColumnError(error: unknown): boolean {
  const msg = errorMessage(error);
  const code = errorCode(error);
  return (
    code === "42703" ||
    /Could not find the '[^']+' column/i.test(msg) ||
    /column\s+[\w.]+\s+does not exist/i.test(msg)
  );
}

export function isStatementTimeoutError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return (
    /statement timeout/i.test(msg) ||
    /canceling statement due to statement timeout/i.test(msg) ||
    /query timeout/i.test(msg) ||
    errorCode(error) === "57014"
  );
}

export function formatSupabaseError(error: unknown): string {
  return errorMessage(error) || "未知錯誤";
}
