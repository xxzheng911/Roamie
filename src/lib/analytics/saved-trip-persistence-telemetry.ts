import { isValidUuid } from "@/lib/uuid";

/**
 * Client persistence stage trace for one itinerary generation.
 * Production WebViews silence informational console traces, so this uses console.warn.
 * Records only allowlisted identifiers and error categories.
 */
export const SAVED_TRIP_PERSISTENCE_TAG = "[SAVED_TRIP_PERSISTENCE]";

export const SAVED_TRIP_PERSISTENCE_EVENTS = [
  "itinerary_client_received",
  "draft_trip_save_started",
  "draft_trip_save_succeeded",
  "draft_trip_save_failed",
  "saved_trip_insert_started",
  "saved_trip_insert_attempted",
  "saved_trip_insert_succeeded",
  "saved_trip_insert_failed",
  "saved_trip_navigation_started",
  "cover_enrichment_started",
  "cover_enrichment_succeeded",
  "cover_enrichment_fallback",
  "cover_enrichment_failed",
] as const;

export type SavedTripPersistenceEventName = (typeof SAVED_TRIP_PERSISTENCE_EVENTS)[number];

export type SavedTripPersistenceStage =
  | "client_received"
  | "draft_trip_save"
  | "confirm_save_started"
  | "before_insert"
  | "insert"
  | "insert_result"
  | "navigation"
  | "cover_enrichment";

export type SavedTripPersistenceSource = "chat" | "plan";

type PersistenceFailure = {
  errorCategory: string;
  errorCode: string;
  supabaseCode?: string;
};

export type SavedTripPersistenceRecord = {
  event: SavedTripPersistenceEventName;
  generationId?: string;
  savedTripId?: string;
  source?: SavedTripPersistenceSource;
  stage: SavedTripPersistenceStage;
  insertAttempted?: boolean;
  errorCategory?: string;
  errorCode?: string;
  supabaseCode?: string;
};

type CorrelationFields = {
  generationId?: string;
  source?: SavedTripPersistenceSource;
};

export type SavedTripPersistenceEvent = CorrelationFields &
  (
    | { event: "itinerary_client_received" }
    | { event: "draft_trip_save_started" }
    | { event: "draft_trip_save_succeeded" }
    | { event: "draft_trip_save_failed"; error: unknown }
    | { event: "saved_trip_insert_started" }
    | { event: "saved_trip_insert_attempted" }
    | { event: "saved_trip_insert_succeeded"; savedTripId: string }
    | {
        event: "saved_trip_insert_failed";
        error: unknown;
        stage: "before_insert" | "insert" | "insert_result";
        insertAttempted: boolean;
      }
    | { event: "saved_trip_navigation_started"; savedTripId: string }
    | { event: "cover_enrichment_started"; savedTripId: string }
    | { event: "cover_enrichment_succeeded"; savedTripId: string }
    | { event: "cover_enrichment_fallback"; savedTripId: string }
    | { event: "cover_enrichment_failed"; savedTripId: string; error: unknown }
  );

const EVENT_STAGE: Record<SavedTripPersistenceEventName, SavedTripPersistenceStage> = {
  itinerary_client_received: "client_received",
  draft_trip_save_started: "draft_trip_save",
  draft_trip_save_succeeded: "draft_trip_save",
  draft_trip_save_failed: "draft_trip_save",
  saved_trip_insert_started: "confirm_save_started",
  saved_trip_insert_attempted: "insert",
  saved_trip_insert_succeeded: "insert",
  saved_trip_insert_failed: "insert",
  saved_trip_navigation_started: "navigation",
  cover_enrichment_started: "cover_enrichment",
  cover_enrichment_succeeded: "cover_enrichment",
  cover_enrichment_fallback: "cover_enrichment",
  cover_enrichment_failed: "cover_enrichment",
};

const DATABASE_CODE = /^[A-Z0-9]{4,12}$/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function sanitizeGenerationId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return isValidUuid(trimmed) ? trimmed.toLowerCase() : undefined;
}

function sanitizeSavedTripId(value: string | undefined): string | undefined {
  return sanitizeGenerationId(value);
}

function sanitizeSource(value: string | undefined): SavedTripPersistenceSource | undefined {
  return value === "chat" || value === "plan" ? value : undefined;
}

function readDatabaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;
  const trimmed = code.trim();
  return DATABASE_CODE.test(trimmed) ? trimmed : undefined;
}

function classifyDatabaseCode(code: string): PersistenceFailure {
  if (code === "42P01" || code === "PGRST205") {
    return { errorCategory: "missing_table", errorCode: code, supabaseCode: code };
  }
  if (code === "42501" || code === "PGRST301") {
    return { errorCategory: "rls", errorCode: code, supabaseCode: code };
  }
  if (code === "23505") {
    return { errorCategory: "unique_violation", errorCode: code, supabaseCode: code };
  }
  if (code === "23502" || code === "23503" || code === "23514" || code.startsWith("23")) {
    return { errorCategory: "constraint", errorCode: code, supabaseCode: code };
  }
  if (code === "PGRST116") {
    return { errorCategory: "row_shape", errorCode: code, supabaseCode: code };
  }
  if (code.startsWith("22")) {
    return { errorCategory: "constraint", errorCode: code, supabaseCode: code };
  }
  if (code.startsWith("28") || code.startsWith("08")) {
    return { errorCategory: "auth", errorCode: code, supabaseCode: code };
  }
  return { errorCategory: "database", errorCode: code, supabaseCode: code };
}

export function sanitizeSavedTripPersistenceFailure(error: unknown): PersistenceFailure {
  const databaseCode = readDatabaseCode(error);
  if (databaseCode) return classifyDatabaseCode(databaseCode);

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === "請先登入") {
    return { errorCategory: "unauthenticated", errorCode: "unauthenticated" };
  }
  if (message === "invalid_saved_trip_row") {
    return { errorCategory: "invalid_row", errorCode: "invalid_saved_trip_row" };
  }
  if (message.includes("行程收藏尚未就緒")) {
    return { errorCategory: "missing_table", errorCode: "missing_table" };
  }
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return { errorCategory: "storage_quota", errorCode: "storage_quota" };
  }
  if (name === "AbortError") {
    return { errorCategory: "aborted", errorCode: "aborted" };
  }
  if (name === "TypeError" && /fetch|network|load failed/i.test(message)) {
    return { errorCategory: "network", errorCode: "network" };
  }
  return {
    errorCategory: "unknown",
    errorCode: SAFE_ERROR_NAME.test(name) ? name : "unknown",
  };
}

export function buildSavedTripPersistenceRecord(
  input: SavedTripPersistenceEvent,
): SavedTripPersistenceRecord | null {
  if (!(SAVED_TRIP_PERSISTENCE_EVENTS as readonly string[]).includes(input.event)) return null;
  const generationId = sanitizeGenerationId(input.generationId);
  const source = sanitizeSource(input.source);
  const stage =
    input.event === "saved_trip_insert_failed" ? input.stage : EVENT_STAGE[input.event];
  const record: SavedTripPersistenceRecord = {
    event: input.event,
    stage,
    ...(generationId ? { generationId } : {}),
    ...(source ? { source } : {}),
  };

  if (
    input.event === "saved_trip_insert_succeeded" ||
    input.event === "saved_trip_navigation_started" ||
    input.event === "cover_enrichment_started" ||
    input.event === "cover_enrichment_succeeded" ||
    input.event === "cover_enrichment_fallback" ||
    input.event === "cover_enrichment_failed"
  ) {
    const savedTripId = sanitizeSavedTripId(input.savedTripId);
    if (savedTripId) record.savedTripId = savedTripId;
  }

  if (input.event === "saved_trip_insert_started") record.insertAttempted = false;
  if (input.event === "saved_trip_insert_attempted") record.insertAttempted = true;
  if (input.event === "saved_trip_insert_failed") record.insertAttempted = input.insertAttempted;

  if (
    input.event === "draft_trip_save_failed" ||
    input.event === "saved_trip_insert_failed" ||
    input.event === "cover_enrichment_failed"
  ) {
    const failure = sanitizeSavedTripPersistenceFailure(input.error);
    record.errorCategory = failure.errorCategory;
    record.errorCode = failure.errorCode;
    if (failure.supabaseCode) record.supabaseCode = failure.supabaseCode;
  }

  return record;
}

export function formatSavedTripPersistenceLine(record: SavedTripPersistenceRecord): string {
  return [
    SAVED_TRIP_PERSISTENCE_TAG,
    `event=${record.event}`,
    `generationId=${record.generationId ?? ""}`,
    `savedTripId=${record.savedTripId ?? ""}`,
    `source=${record.source ?? ""}`,
    `stage=${record.stage}`,
    `insertAttempted=${record.insertAttempted === undefined ? "" : String(record.insertAttempted)}`,
    `errorCategory=${record.errorCategory ?? ""}`,
    `errorCode=${record.errorCode ?? ""}`,
    `supabaseCode=${record.supabaseCode ?? ""}`,
  ].join(" ");
}

export function emitSavedTripPersistenceEvent(input: SavedTripPersistenceEvent): void {
  try {
    const record = buildSavedTripPersistenceRecord(input);
    if (!record) return;
    console.warn(formatSavedTripPersistenceLine(record));
  } catch {
    // Observation must not change persistence control flow.
  }
}
