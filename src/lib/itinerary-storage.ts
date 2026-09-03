import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { isMissingTableError } from "@/lib/supabase-errors";
import { isValidUuid } from "@/lib/uuid";
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

type StoredItineraryRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StoredItineraryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegacyItinerary(value: unknown): value is Itinerary {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === "string" &&
    typeof value.destination === "string" &&
    typeof value.days === "number" &&
    typeof value.mood === "string" &&
    typeof value.summary === "string" &&
    typeof value.total_estimated_cost === "string" &&
    typeof value.transport_tips === "string" &&
    Array.isArray(value.daily_plan)
  );
}

function isStoredItineraryPayload(value: unknown): value is StoredItinerary["payload"] {
  return isRoamiePayloadV2(value) || isLegacyItinerary(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" || value === null ? value : null;
}

function isImageSource(value: unknown): value is ImageSource {
  return (
    value === "google" ||
    value === "unsplash" ||
    value === "upload" ||
    value === "default" ||
    value === "roamie"
  );
}

/**
 * Normalizes top-level StoredItinerary metadata from all read boundaries.
 * The itinerary payload is validated but deliberately retained by reference and never migrated.
 */
export function normalizeStoredItinerary(
  input: unknown,
  payloadOverride?: unknown,
): StoredItinerary | null {
  if (!isRecord(input)) return null;

  const payload = payloadOverride === undefined ? input.payload : payloadOverride;
  if (!isStoredItineraryPayload(payload)) {
    console.warn("[ITINERARY_STORAGE_NORMALIZE_SKIP] reason=invalid_payload");
    return null;
  }

  if (
    typeof input.id !== "string" ||
    input.id.trim().length === 0 ||
    typeof input.title !== "string" ||
    typeof input.created_at !== "string" ||
    input.created_at.trim().length === 0
  ) {
    console.warn("[ITINERARY_STORAGE_NORMALIZE_SKIP] reason=missing_required_metadata");
    return null;
  }

  const legacyCoverImageUrl = nullableString(input.cover_image_url);
  const customCoverImageUrl =
    typeof input.custom_cover_image_url === "string" || input.custom_cover_image_url === null
      ? input.custom_cover_image_url
      : legacyCoverImageUrl;

  return {
    id: input.id,
    title: input.title,
    custom_title: nullableString(input.custom_title),
    is_title_customized:
      typeof input.is_title_customized === "boolean" ? input.is_title_customized : false,
    mood: nullableString(input.mood),
    cover_image: nullableString(input.cover_image),
    cover_image_url: legacyCoverImageUrl,
    custom_cover_image_url: customCoverImageUrl,
    is_cover_customized:
      typeof input.is_cover_customized === "boolean" ? input.is_cover_customized : false,
    cover_source:
      isImageSource(input.cover_source) || input.cover_source === null ? input.cover_source : null,
    cover_query: nullableString(input.cover_query),
    created_at: input.created_at,
    updated_at: typeof input.updated_at === "string" ? input.updated_at : input.created_at,
    payload,
  };
}

export function normalizeStoredItineraryList(input: unknown): StoredItinerary[] {
  if (!Array.isArray(input)) return [];
  const normalized: StoredItinerary[] = [];
  for (const item of input) {
    const itinerary = normalizeStoredItinerary(item);
    if (itinerary) normalized.push(itinerary);
  }
  return normalized;
}

function requireStoredItinerary(input: unknown, payloadOverride?: unknown): StoredItinerary {
  const itinerary = normalizeStoredItinerary(input, payloadOverride);
  if (!itinerary) throw new Error("invalid_saved_trip_row");
  return itinerary;
}

function readGuest(): StoredItinerary[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
    return normalizeStoredItineraryList(parsed);
  } catch {
    return [];
  }
}

function writeGuest(list: StoredItinerary[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(list));
}

const TRIP_SELECT =
  "id, title, custom_title, is_title_customized, mood, cover_image, cover_image_url, custom_cover_image_url, is_cover_customized, cover_source, cover_query, created_at, updated_at, payload";

async function resolveCoverForSave(itinerary: Itinerary | RoamiePayloadV2): Promise<TripCoverMeta> {
  if (!isRoamiePayloadV2(itinerary)) {
    return { cover_image: null, cover_source: null, cover_query: null };
  }
  const cover = await getTripCoverImage(tripCoverInputFromPayload(itinerary));
  return {
    cover_image: cover.url,
    cover_source: cover.source,
    cover_query: cover.query,
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

async function persistItinerary(
  itinerary: Itinerary | RoamiePayloadV2,
  options?: { coverMeta?: TripCoverMeta },
): Promise<StoredItinerary> {
  const withTitle = withAutoTitle(itinerary);
  const userId = await getAuthenticatedUserId();
  const mood = isRoamiePayloadV2(withTitle) ? withTitle.moodTag : (withTitle as Itinerary).mood;
  const coverMeta = options?.coverMeta ?? await resolveCoverForSave(withTitle);
  const autoTitle = isRoamiePayloadV2(withTitle) ? withTitle.title : (withTitle as Itinerary).title;

  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .insert({
        user_id: userId,
        title: autoTitle,
        custom_title: null,
        is_title_customized: false,
        mood: mood ?? null,
        payload: withTitle as never,
        cover_image: coverMeta.cover_image,
        cover_source: coverMeta.cover_source,
        cover_query: coverMeta.cover_query,
        custom_cover_image_url: null,
        is_cover_customized: false,
        cover_image_url: null,
      })
      .select(TRIP_SELECT)
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("行程收藏尚未就緒，請稍後再試或聯絡管理員套用資料庫 migration。");
      }
      throw new Error(error.message);
    }
    const stored = requireStoredItinerary(data, withTitle);
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
  options?: { coverMeta?: TripCoverMeta },
): Promise<StoredItinerary> {
  const saved = await persistItinerary(tagUserSavedTrip(itinerary, source), options);
  broadcastTripsChanged();
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
    const { data, error } = await supabase
      .from("saved_trips")
      .select(TRIP_SELECT)
      .order("updated_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? [])
      .map((row) => normalizeStoredItinerary(row))
      .filter((row): row is StoredItinerary => row !== null)
      .filter((row) => isSavedCollectionTrip(row.payload));
  }
  return [];
}

export async function getItinerary(id: string): Promise<StoredItinerary | null> {
  if (!isValidUuid(id)) {
    console.warn("[ITINERARY_GET_SKIP] invalid trip id", id);
    return null;
  }
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .select(TRIP_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return null;
      throw new Error(error.message);
    }
    if (!data) return null;
    const stored = normalizeStoredItinerary(data);
    if (!stored || !isSavedCollectionTrip(stored.payload)) return null;
    return stored;
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

  const { data, error } = await supabase
    .from("saved_trips")
    .update(patch)
    .eq("id", id)
    .select(TRIP_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message);
  }

  const stored = normalizeStoredItinerary(data, payload);
  return afterTripMutation(stored);
}

export async function updateItinerary(
  id: string,
  payload: Itinerary | RoamiePayloadV2,
): Promise<StoredItinerary | null> {
  if (!isValidUuid(id)) {
    console.warn("[ITINERARY_UPDATE_SKIP] invalid trip id", id);
    return null;
  }
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

  const { data, error } = await supabase
    .from("saved_trips")
    .update(patch)
    .eq("id", id)
    .select(TRIP_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message);
  }

  const updated = requireStoredItinerary(data, resolvedPayload);
  console.info("[CORE_TRIP] updated", updated.id);
  return afterTripMutation(updated);
}

export async function deleteItinerary(id: string): Promise<void> {
  if (!isValidUuid(id)) {
    console.warn("[ITINERARY_DELETE_SKIP] invalid trip id", id);
    return;
  }
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
  return updateTripMeta(id, {
    cover_image: cover.url,
    cover_source: cover.source,
    cover_query: cover.query,
  });
}
