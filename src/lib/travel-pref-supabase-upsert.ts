import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { sanitizeForJsonStorage } from "@/lib/travel-pref-cache-write";
import {
  markTravelPrefSyncAttempt,
  markTravelPrefSyncSuccess,
  readTravelPrefSyncState,
} from "@/lib/travel-pref-sync-state";
import type { TravelPreferences } from "@/lib/preferences-storage";

export const TRAVEL_PREF_UPSERT_TIMEOUT_MS = 15_000;

function promiseWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function logUpsertError(error: unknown): void {
  if (error && typeof error === "object" && "message" in error) {
    const row = error as Record<string, unknown>;
    console.warn("[TRAVEL_PREF_SUPABASE_UPSERT_ERROR]", {
      code: row.code ?? "",
      message: row.message ?? String(error),
      details: row.details ?? "",
      hint: row.hint ?? "",
    });
    return;
  }
  console.warn("[TRAVEL_PREF_SUPABASE_UPSERT_ERROR]", {
    code: "",
    message: error instanceof Error ? error.message : String(error),
    details: "",
    hint: "",
  });
}

export type UpsertTravelPersonalityInput = {
  userId?: string;
  prefs: TravelPreferences;
  travelStyle?: string | null;
  aiPreferences?: Record<string, unknown> | null;
  source?: string;
};

/** Upsert profiles.travel_personality（+ 可選 ai_preferences）；不含 ensureUserProfile 以減少 round-trip */
export async function upsertTravelPersonalityToSupabase(
  input: UpsertTravelPersonalityInput,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? TRAVEL_PREF_UPSERT_TIMEOUT_MS;
  const sanitized = sanitizeForJsonStorage(input.prefs);
  if (!sanitized) {
    throw new Error("[travel-pref-upsert] invalid preferences payload");
  }

  const userId = input.userId ?? (await getAuthenticatedUserId());
  if (!userId) {
    throw new Error("[travel-pref-upsert] no authenticated user");
  }

  const syncState = readTravelPrefSyncState(userId);
  const travelStyle =
    input.travelStyle?.trim() ||
    sanitized.personalityType?.trim() ||
    syncState.travelStyleName ||
    "";

  console.info("[TRAVEL_PREF_SUPABASE_UPSERT_START]", {
    userId,
    travelStyle,
    pendingSync: syncState.pendingSync,
    source: input.source ?? "",
  });

  markTravelPrefSyncAttempt(userId);

  const row: Record<string, unknown> = {
    id: userId,
    travel_personality: sanitized,
  };
  if (input.aiPreferences && typeof input.aiPreferences === "object") {
    row.ai_preferences = input.aiPreferences;
  }

  const response = await promiseWithTimeout(
    supabase.from("profiles").upsert(row as never, { onConflict: "id" }),
    timeoutMs,
    "[prefs-sync] travel_personality upsert timeout",
  );

  const { error } = response;
  if (error) {
    logUpsertError(error);
    const msg = error.message ?? "";
    if (/record\s+\"new\"\s+has\s+no\s+field\s+\"updated_at\"/i.test(msg)) {
      console.warn("[TRAVEL_PREF_SUPABASE_UPSERT_ERROR]", {
        code: error.code ?? "SCHEMA_MISMATCH",
        message: msg,
        details: error.details ?? "",
        hint: "Run profiles updated_at migration on Supabase",
      });
      return;
    }
    throw error;
  }

  const synced = markTravelPrefSyncSuccess(userId);
  console.info("[TRAVEL_PREF_SUPABASE_UPSERT_SUCCESS]", {
    syncedAt: synced.syncedAt,
    userId,
  });
}
