import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import {
  formatSupabaseError,
  isMissingColumnError,
  isMissingTableError,
} from "@/lib/supabase-errors";
import type { Itinerary } from "./itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { isSavedCollectionTrip, tagUserSavedTrip } from "@/lib/saved-collection";
import {
  getTripCoverImage,
  tripCoverInputFromPayload,
  type ImageSource,
} from "@/services/placeImageService";
import { resolveTripTitle } from "@/lib/trip/trip-title";
import { resolveDisplayTitle, titleFieldsFromStored } from "@/lib/saved-trip/display";
import type { Database } from "@/integrations/supabase/types";
import { syncTripNotificationsAfterSave } from "@/services/notificationService";

type SavedTripRowUpdate = Database["public"]["Tables"]["saved_trips"]["Update"];

const GUEST_KEY = "roamie:itineraries";

export const SAVED_TRIPS_CHANGED_EVENT = "roamie:saved-trips-changed";

function broadcastTripsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SAVED_TRIPS_CHANGED_EVENT));
}

export type TripCoverMeta = {
  cover_image: string | null;
  cover_source: ImageSource | null;
  cover_query: string | null;
  destination_name?: string | null;
  normalized_destination_key?: string | null;
  ai_generated_destination_cover_url?: string | null;
};

export type StoredItinerary = {
  id: string;
  /** 自動產生的預設名稱 */
  title: string;
  custom_title: string | null;
  is_title_customized: boolean;
  mood: string | null;
  /** AI / Unsplash 生成封面 */
  cover_image: string | null;
  /** @deprecated 請用 custom_cover_image_url */
  cover_image_url: string | null;
  custom_cover_image_url: string | null;
  is_cover_customized: boolean;
  cover_source: ImageSource | null;
  cover_query: string | null;
  created_at: string;
  updated_at: string;
  payload: Itinerary | RoamiePayloadV2;
};

function readGuest(): StoredItinerary[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeGuest(list: StoredItinerary[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(list));
}

function rowToStored(
  row: {
    id: string;
    title: string;
    custom_title?: string | null;
    is_title_customized?: boolean | null;
    mood: string | null;
    cover_image: string | null;
    cover_image_url?: string | null;
    custom_cover_image_url?: string | null;
    is_cover_customized?: boolean | null;
    cover_source?: string | null;
    cover_query?: string | null;
    created_at: string;
    updated_at?: string;
  },
  payload: Itinerary | RoamiePayloadV2,
): StoredItinerary {
  return {
    id: row.id,
    title: row.title,
    custom_title: row.custom_title ?? null,
    is_title_customized: Boolean(row.is_title_customized),
    mood: row.mood,
    cover_image: row.cover_image,
    cover_image_url: row.cover_image_url ?? null,
    custom_cover_image_url: row.custom_cover_image_url ?? row.cover_image_url ?? null,
    is_cover_customized: Boolean(row.is_cover_customized),
    cover_source: (row.cover_source as ImageSource | null) ?? null,
    cover_query: row.cover_query ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    payload,
  };
}

const TRIP_SELECT =
  "id, title, custom_title, is_title_customized, mood, cover_image, cover_image_url, custom_cover_image_url, is_cover_customized, cover_source, cover_query, created_at, updated_at, payload";

/** 舊版 saved_trips（尚未套用 cover_query / custom_title 等 migration） */
const TRIP_SELECT_LEGACY =
  "id, title, mood, cover_image, cover_image_url, created_at, updated_at, payload";

type TripInsertParams = {
  userId: string;
  autoTitle: string;
  mood: string | null;
  payload: Itinerary | RoamiePayloadV2;
  coverMeta: TripCoverMeta;
};

function buildFullTripInsertRow(params: TripInsertParams) {
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

function buildLegacyTripInsertRow(params: TripInsertParams) {
  return {
    user_id: params.userId,
    title: params.autoTitle,
    mood: params.mood,
    payload: params.payload as never,
    cover_image: params.coverMeta.cover_image,
    cover_image_url: params.coverMeta.cover_image,
  };
}

async function insertSavedTripRow(params: TripInsertParams) {
  const full = await supabase
    .from("saved_trips")
    .insert(buildFullTripInsertRow(params))
    .select(TRIP_SELECT)
    .single();

  if (!full.error) return full;

  if (isMissingColumnError(full.error)) {
    console.warn("[CORE_TRIP] insert fallback legacy schema", formatSupabaseError(full.error));
    return supabase
      .from("saved_trips")
      .insert(buildLegacyTripInsertRow(params))
      .select(TRIP_SELECT_LEGACY)
      .single();
  }

  return full;
}

async function selectSavedTrips() {
  const full = await supabase.from("saved_trips").select(TRIP_SELECT).order("updated_at", {
    ascending: false,
  });
  if (!full.error) return full;
  if (isMissingColumnError(full.error)) {
    console.warn("[CORE_TRIP] select fallback legacy schema", formatSupabaseError(full.error));
    return supabase.from("saved_trips").select(TRIP_SELECT_LEGACY).order("created_at", {
      ascending: false,
    });
  }
  return full;
}

async function selectSavedTripById(id: string) {
  const full = await supabase.from("saved_trips").select(TRIP_SELECT).eq("id", id).maybeSingle();
  if (!full.error) return full;
  if (isMissingColumnError(full.error)) {
    console.warn("[CORE_TRIP] select one fallback legacy schema", formatSupabaseError(full.error));
    return supabase.from("saved_trips").select(TRIP_SELECT_LEGACY).eq("id", id).maybeSingle();
  }
  return full;
}

function stripUnsupportedTripPatch(patch: SavedTripRowUpdate): SavedTripRowUpdate {
  const {
    custom_title: _a,
    is_title_customized: _b,
    custom_cover_image_url: _c,
    is_cover_customized: _d,
    cover_source: _e,
    cover_query: _f,
    ...legacy
  } = patch;
  return legacy;
}

async function updateSavedTripRow(id: string, patch: SavedTripRowUpdate) {
  const full = await supabase
    .from("saved_trips")
    .update(patch)
    .eq("id", id)
    .select(TRIP_SELECT)
    .single();
  if (!full.error) return full;
  if (isMissingColumnError(full.error)) {
    console.warn("[CORE_TRIP] update fallback legacy schema", formatSupabaseError(full.error));
    return supabase
      .from("saved_trips")
      .update(stripUnsupportedTripPatch(patch))
      .eq("id", id)
      .select(TRIP_SELECT_LEGACY)
      .single();
  }
  return full;
}

async function resolveCoverForSave(itinerary: Itinerary | RoamiePayloadV2): Promise<TripCoverMeta> {
  if (!isRoamiePayloadV2(itinerary)) {
    return { cover_image: null, cover_source: null, cover_query: null };
  }
  const cover = await getTripCoverImage(tripCoverInputFromPayload(itinerary));
  const unsplashUrl = cover.unsplashDestinationCoverUrl ?? cover.url;
  return {
    cover_image: unsplashUrl,
    cover_source: cover.source,
    cover_query: cover.query ?? cover.normalizedDestinationKey,
    destination_name: cover.destinationName,
    normalized_destination_key: cover.normalizedDestinationKey,
    ai_generated_destination_cover_url: unsplashUrl,
  };
}

/** 僅新建行程：寫入自動標題到 title 欄（不標記為自訂） */
function withAutoTitle(itinerary: Itinerary | RoamiePayloadV2): Itinerary | RoamiePayloadV2 {
  if (!isRoamiePayloadV2(itinerary)) return itinerary;
  const autoTitle = resolveTripTitle(itinerary);
  return { ...itinerary, title: autoTitle };
}

function payloadTitleForSave(
  existing: StoredItinerary | null,
  payload: Itinerary | RoamiePayloadV2,
): Itinerary | RoamiePayloadV2 {
  if (!isRoamiePayloadV2(payload)) return payload;
  if (existing?.is_title_customized) {
    const display = resolveDisplayTitle(titleFieldsFromStored(existing));
    return { ...payload, title: display };
  }
  const autoTitle = resolveTripTitle(payload);
  return { ...payload, title: autoTitle };
}

async function persistItinerary(itinerary: Itinerary | RoamiePayloadV2): Promise<StoredItinerary> {
  const withTitle = withAutoTitle(itinerary);
  const userId = await getAuthenticatedUserId();
  const mood = isRoamiePayloadV2(withTitle) ? withTitle.moodTag : (withTitle as Itinerary).mood;
  const coverMeta = await resolveCoverForSave(withTitle);
  const autoTitle = isRoamiePayloadV2(withTitle) ? withTitle.title : (withTitle as Itinerary).title;

  if (userId) {
    const { data, error } = await insertSavedTripRow({
      userId,
      autoTitle,
      mood: mood ?? null,
      payload: withTitle,
      coverMeta,
    });
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("行程收藏尚未就緒，請稍後再試或聯絡管理員套用資料庫 migration。");
      }
      throw new Error(formatSupabaseError(error));
    }
    const stored = rowToStored(data, withTitle);
    console.info("[CORE_TRIP] created", stored.id);
    return stored;
  }

  throw new Error("請先登入");
}

function afterTripMutation(result: StoredItinerary | null): StoredItinerary | null {
  if (result) broadcastTripsChanged();
  return result;
}

/** 使用者確認「儲存行程」後才寫入收藏（saved_trips） */
export async function confirmSaveTrip(
  itinerary: Itinerary | RoamiePayloadV2,
  source: "chat" | "plan" = "chat",
): Promise<StoredItinerary> {
  const saved = await persistItinerary(tagUserSavedTrip(itinerary, source));
  broadcastTripsChanged();
  void syncTripNotificationsAfterSave(saved).catch((e) => {
    console.warn("[NOTIFICATION] sync after save failed", e);
  });
  return saved;
}

/** @deprecated 請改用 confirmSaveTrip；保留給內部相容 */
export async function saveItinerary(
  itinerary: Itinerary | RoamiePayloadV2,
): Promise<StoredItinerary> {
  return confirmSaveTrip(itinerary, "plan");
}

export async function listItineraries(): Promise<StoredItinerary[]> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await selectSavedTrips();
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(formatSupabaseError(error));
    }
    return (data ?? [])
      .map((row) => rowToStored(row, row.payload as unknown as Itinerary | RoamiePayloadV2))
      .filter((row) => isSavedCollectionTrip(row.payload));
  }
  return [];
}

export async function getItinerary(id: string): Promise<StoredItinerary | null> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await selectSavedTripById(id);
    if (error) {
      if (isMissingTableError(error)) return null;
      throw new Error(formatSupabaseError(error));
    }
    if (!data) return null;
    const payload = data.payload as unknown as Itinerary | RoamiePayloadV2;
    if (!isSavedCollectionTrip(payload)) return null;
    return rowToStored(data, payload);
  }
  return null;
}

export type TripMetaUpdate = {
  /** 僅更新自動標題（未自訂時） */
  title?: string;
  custom_title?: string | null;
  is_title_customized?: boolean;
  /** AI 封面（重新生成時） */
  cover_image?: string | null;
  cover_image_url?: string | null;
  custom_cover_image_url?: string | null;
  is_cover_customized?: boolean;
  cover_source?: ImageSource | null;
  cover_query?: string | null;
};

export async function updateTripMeta(
  id: string,
  meta: TripMetaUpdate,
  payload?: RoamiePayloadV2 | Itinerary,
): Promise<StoredItinerary | null> {
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  const patch: SavedTripRowUpdate = {};
  if (meta.title != null) patch.title = meta.title;
  if (meta.custom_title !== undefined) patch.custom_title = meta.custom_title;
  if (meta.is_title_customized !== undefined) {
    patch.is_title_customized = meta.is_title_customized;
  }
  if (meta.cover_image !== undefined) patch.cover_image = meta.cover_image;
  if (meta.cover_image_url !== undefined) patch.cover_image_url = meta.cover_image_url;
  if (meta.custom_cover_image_url !== undefined) {
    patch.custom_cover_image_url = meta.custom_cover_image_url;
  }
  if (meta.is_cover_customized !== undefined) {
    patch.is_cover_customized = meta.is_cover_customized;
  }
  if (meta.cover_source !== undefined) patch.cover_source = meta.cover_source;
  if (meta.cover_query !== undefined) patch.cover_query = meta.cover_query;
  if (payload) patch.payload = payload as never;

  const { data, error } = await updateSavedTripRow(id, patch);

  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(formatSupabaseError(error));
  }

  const resolvedPayload = payload ?? (data.payload as unknown as Itinerary | RoamiePayloadV2);
  return afterTripMutation(rowToStored(data, resolvedPayload));
}

export async function updateItinerary(
  id: string,
  payload: Itinerary | RoamiePayloadV2,
): Promise<StoredItinerary | null> {
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  const existing = await getItinerary(id);
  const resolvedPayload = payloadTitleForSave(existing, payload);
  const mood = isRoamiePayloadV2(resolvedPayload)
    ? resolvedPayload.moodTag
    : (resolvedPayload as Itinerary).mood;

  const patch: SavedTripRowUpdate = {
    mood: mood ?? null,
    payload: resolvedPayload as never,
  };

  if (!existing?.is_title_customized && isRoamiePayloadV2(resolvedPayload)) {
    patch.title = resolveTripTitle(resolvedPayload);
  }

  const { data, error } = await updateSavedTripRow(id, patch);

  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(formatSupabaseError(error));
  }

  const updated = rowToStored(data, resolvedPayload);
  console.info("[CORE_TRIP] updated", updated.id);
  return afterTripMutation(updated);
}

export async function deleteItinerary(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { error } = await supabase
      .from("saved_trips")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      if (isMissingTableError(error)) {
        const prev = readGuest();
        writeGuest(prev.filter((t) => t.id !== id));
        broadcastTripsChanged();
        return;
      }
      throw new Error(error.message);
    }
    broadcastTripsChanged();
    return;
  }

  const prevGuest = readGuest();
  const nextGuest = prevGuest.filter((t) => t.id !== id);
  if (nextGuest.length !== prevGuest.length) {
    writeGuest(nextGuest);
    broadcastTripsChanged();
    return;
  }

  throw new Error("請先登入");
}

/** 使用者主動重新生成 AI 封面；不影響 is_cover_customized / custom_cover_image_url */
export async function regenerateTripCover(
  id: string,
  payload: RoamiePayloadV2,
): Promise<StoredItinerary | null> {
  const cover = await getTripCoverImage(tripCoverInputFromPayload(payload));
  const unsplashUrl = cover.unsplashDestinationCoverUrl ?? cover.url;
  return updateTripMeta(id, {
    cover_image: unsplashUrl,
    cover_source: cover.source,
    cover_query: cover.query ?? cover.normalizedDestinationKey,
    destination_name: cover.destinationName,
    normalized_destination_key: cover.normalizedDestinationKey,
    ai_generated_destination_cover_url: unsplashUrl,
  } as SavedTripRowUpdate);
}
