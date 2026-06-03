import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import type { Itinerary } from "@/lib/itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import {
  formatSupabaseError,
  isMissingColumnError,
  isMissingTableError,
  isStatementTimeoutError,
} from "@/lib/supabase-errors";
import { isSupabaseConnectivityError } from "@/lib/supabase-connectivity";
import type { StoredItinerary, TripCoverMeta } from "@/lib/itinerary-storage";
import { attachDayPlansToPayload } from "@/lib/trip/build-day-plans";
import {
  buildMinimalTripShellPayload,
  slimTripPayloadForStorage,
} from "@/lib/trip/slim-trip-payload";
import { withTimeout } from "@/lib/async/with-timeout";
import { TRIP_STAGED_STEP_TIMEOUT_MS } from "@/lib/plan/plan-flow-timeouts";
import {
  logPlanTripCreateMinimalStart,
  logPlanTripCreateMinimalSuccess,
  logPlanTripSaveDaysStart,
  logPlanTripSaveError,
  logPlanTripSaveStopsStart,
  logPlanTripSaveSuccess,
  logPlanTripSaveTimeout,
  logPlanTripSubmitStart,
} from "@/lib/trip/trip-persist-log";

const INSERT_SELECT =
  "id, title, custom_title, is_title_customized, mood, cover_image, cover_image_url, custom_cover_image_url, is_cover_customized, cover_source, cover_query, created_at, updated_at";

const INSERT_SELECT_LEGACY =
  "id, title, mood, cover_image, cover_image_url, created_at, updated_at";

type InsertParams = {
  userId: string;
  autoTitle: string;
  mood: string | null;
  payload: RoamiePayloadV2;
  coverMeta: TripCoverMeta;
};

function buildInsertRow(params: InsertParams, legacy: boolean) {
  if (legacy) {
    return {
      user_id: params.userId,
      title: params.autoTitle,
      mood: params.mood,
      payload: params.payload as never,
      cover_image: params.coverMeta.cover_image,
      cover_image_url: params.coverMeta.cover_image,
    };
  }
  return {
    user_id: params.userId,
    title: params.autoTitle,
    custom_title: null,
    is_title_customized: false,
    mood: params.mood,
    payload: params.payload as never,
    cover_image: params.coverMeta.cover_image,
    cover_source: params.coverMeta.cover_source,
    cover_query: params.coverMeta.cover_query,
    destination_name: params.coverMeta.destination_name ?? null,
    normalized_destination_key: params.coverMeta.normalized_destination_key ?? null,
    ai_generated_destination_cover_url:
      params.coverMeta.ai_generated_destination_cover_url ?? params.coverMeta.cover_image,
    custom_cover_image_url: null,
    is_cover_customized: false,
    cover_image_url: null,
  };
}

async function insertTripShell(params: InsertParams): Promise<{ id: string; row: Record<string, unknown> }> {
  const full = await supabase
    .from("saved_trips")
    .insert(buildInsertRow(params, false))
    .select(INSERT_SELECT)
    .single();

  if (!full.error && full.data) {
    return { id: full.data.id, row: full.data as Record<string, unknown> };
  }

  if (full.error && isMissingColumnError(full.error)) {
    const legacy = await supabase
      .from("saved_trips")
      .insert(buildInsertRow(params, true))
      .select(INSERT_SELECT_LEGACY)
      .single();
    if (legacy.error) throw legacy.error;
    if (!legacy.data) throw new Error("insert returned no row");
    return { id: legacy.data.id, row: legacy.data as Record<string, unknown> };
  }

  throw full.error ?? new Error("insert failed");
}

async function updateTripPayload(tripId: string, payload: RoamiePayloadV2): Promise<void> {
  const { error } = await supabase
    .from("saved_trips")
    .update({ payload: payload as never, updated_at: new Date().toISOString() })
    .eq("id", tripId);

  if (error) throw error;
}

function rowToStored(row: Record<string, unknown>, payload: Itinerary | RoamiePayloadV2): StoredItinerary {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    custom_title: (row.custom_title as string | null) ?? null,
    is_title_customized: Boolean(row.is_title_customized),
    mood: (row.mood as string | null) ?? null,
    cover_image: (row.cover_image as string | null) ?? null,
    cover_image_url: (row.cover_image_url as string | null) ?? null,
    custom_cover_image_url: (row.custom_cover_image_url as string | null) ?? null,
    is_cover_customized: Boolean(row.is_cover_customized),
    cover_source: (row.cover_source as StoredItinerary["cover_source"]) ?? null,
    cover_query: (row.cover_query as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    payload,
  };
}

export type StagedTripPersistOptions = {
  source: "plan" | "chat";
  coverMeta: TripCoverMeta;
  /** 空白手動行程：跳過 stops / dayPlans 第二階段 */
  shellOnly?: boolean;
};

/**
 * 分階段寫入 saved_trips，避免單次 upsert 過大 jsonb 觸發 statement timeout。
 * 1) insert 空殼  2) update itinerary  3) update dayPlans + 其餘欄位
 */
export async function persistTripStaged(
  itinerary: Itinerary | RoamiePayloadV2,
  options: StagedTripPersistOptions,
): Promise<StoredItinerary> {
  logPlanTripSubmitStart(options.source);

  if (!isRoamiePayloadV2(itinerary)) {
    throw new Error("僅支援 RoamiePayloadV2 分階段儲存");
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  const shellPayload = buildMinimalTripShellPayload(itinerary);
  const autoTitle = itinerary.title;
  const mood = itinerary.moodTag ?? null;

  logPlanTripCreateMinimalStart();
  let tripId: string;
  let row: Record<string, unknown>;
  try {
    const inserted = await withTimeout(
      insertTripShell({
        userId,
        autoTitle,
        mood,
        payload: shellPayload,
        coverMeta: options.coverMeta,
      }),
      TRIP_STAGED_STEP_TIMEOUT_MS,
      "trip_staged_insert_shell",
    );
    tripId = inserted.id;
    row = inserted.row;
    logPlanTripCreateMinimalSuccess(tripId);
  } catch (e) {
    if (isStatementTimeoutError(e) || isSupabaseConnectivityError(e)) {
      logPlanTripSaveTimeout("insert_shell");
    }
    logPlanTripSaveError("insert_shell", e);
    if (isMissingTableError(e)) {
      throw new Error("行程收藏尚未就緒，請稍後再試或聯絡管理員套用資料庫 migration。");
    }
    throw new Error(formatSupabaseError(e));
  }

  if (options.shellOnly || (itinerary.itinerary?.length ?? 0) < 1) {
    logPlanTripSaveSuccess(tripId, autoTitle);
    return rowToStored(row, shellPayload);
  }

  const stopCount = itinerary.itinerary?.length ?? 0;
  logPlanTripSaveStopsStart(tripId, stopCount);
  try {
    const withStops = slimTripPayloadForStorage({
      ...itinerary,
      itinerary: itinerary.itinerary ?? [],
      recommendations: [],
    });
    await withTimeout(
      updateTripPayload(tripId, withStops),
      TRIP_STAGED_STEP_TIMEOUT_MS,
      "trip_staged_update_stops",
    );
  } catch (e) {
    if (isStatementTimeoutError(e) || isSupabaseConnectivityError(e)) {
      logPlanTripSaveTimeout("update_stops");
    }
    logPlanTripSaveError("update_stops", e);
    throw new Error(formatSupabaseError(e));
  }

  logPlanTripSaveDaysStart(tripId);
  try {
    const withDays = attachDayPlansToPayload(slimTripPayloadForStorage(itinerary));
    await withTimeout(
      updateTripPayload(tripId, slimTripPayloadForStorage(withDays)),
      TRIP_STAGED_STEP_TIMEOUT_MS,
      "trip_staged_update_days",
    );
  } catch (e) {
    if (isStatementTimeoutError(e) || isSupabaseConnectivityError(e)) {
      logPlanTripSaveTimeout("update_days");
    }
    logPlanTripSaveError("update_days", e);
    /** stops 已寫入則仍可進詳情頁 */
    console.warn("[PLAN_TRIP] dayPlans update skipped, using stops-only payload", e);
    logPlanTripSaveSuccess(tripId, autoTitle);
    return rowToStored(row, slimTripPayloadForStorage(itinerary));
  }

  const finalPayload = attachDayPlansToPayload(slimTripPayloadForStorage(itinerary));
  logPlanTripSaveSuccess(tripId, autoTitle);
  return rowToStored(row, finalPayload);
}
