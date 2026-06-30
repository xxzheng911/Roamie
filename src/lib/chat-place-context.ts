import type { ChatPlaceItem } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import { placesRegionCodeFromCoordinates } from "@/lib/geo-region";

/** 「跟 Roamie 聊這裡」需完整保存的焦點地點上下文 */
export type ChatPlaceContext = {
  placeId: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
};

const COUNTRY_FROM_REGION: Record<string, string> = {
  TW: "台灣",
  JP: "日本",
  KR: "韓國",
  TH: "泰國",
  US: "美國",
  AU: "澳洲",
  HK: "香港",
  SG: "新加坡",
};

export function hasValidPlaceCoordinates(
  place?: Pick<ChatPlaceItem, "lat" | "lng"> | null,
): boolean {
  if (!place) return false;
  const { lat, lng } = place;
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
  );
}

export function parseCityCountryFromAddress(address?: string | null): {
  city: string;
  country: string;
} {
  const text = (address ?? "").trim();
  if (!text) return { city: "", country: "" };

  if (/日本|Japan/i.test(text)) {
    const city =
      text.match(/(東京|大阪|京都|橫濱|名古屋|福岡|札幌|沖繩|淺草)/)?.[1] ??
      text.match(/(Tokyo|Osaka|Kyoto|Yokohama)/i)?.[1] ??
      "";
    return { city, country: "日本" };
  }
  if (/台灣|台湾|Taiwan/i.test(text)) {
    const city =
      text.match(/(台北|新北|台中|台南|高雄|桃園|新竹|基隆|嘉義|屏東|花蓮|台東|宜蘭|南投|彰化|苗栗|雲林|澎湖|金門|連江)/)?.[1] ??
      "";
    return { city, country: "台灣" };
  }
  if (/Korea|韓國|韩国/i.test(text)) return { city: "", country: "韓國" };
  if (/Thailand|泰國|泰国/i.test(text)) return { city: "", country: "泰國" };
  if (/Australia|澳洲/i.test(text)) return { city: "", country: "澳洲" };
  if (/United States|USA|美國|美国/i.test(text)) return { city: "", country: "美國" };

  const twCity =
    text.match(/(台北|新北|台中|台南|高雄|桃園|新竹|基隆|嘉義|屏東|花蓮|台東|宜蘭|南投|彰化|苗栗|雲林|澎湖|金門|連江)市?/)?.[1] ??
    "";
  if (twCity) return { city: twCity, country: "台灣" };

  return { city: "", country: "" };
}

export function inferCountryFromCoordinates(lat: number, lng: number): string {
  const code = placesRegionCodeFromCoordinates(lat, lng);
  return code ? (COUNTRY_FROM_REGION[code] ?? "") : "";
}

export function buildChatPlaceContext(place: ChatPlaceItem): ChatPlaceContext | null {
  if (!hasValidPlaceCoordinates(place)) return null;
  const placeId = (place.placeId ?? place.googlePlaceId ?? "").trim();
  const displayName = place.displayName?.trim() || placeDisplayName(place);
  const parsed = parseCityCountryFromAddress(place.address);
  const city = place.city?.trim() || parsed.city;
  const country =
    place.country?.trim() ||
    parsed.country ||
    inferCountryFromCoordinates(place.lat!, place.lng!);

  return {
    placeId: placeId || `coord:${place.lat},${place.lng}`,
    name: place.name,
    displayName,
    latitude: place.lat!,
    longitude: place.lng!,
    city,
    country,
  };
}

export function applyChatPlaceContext(
  place: ChatPlaceItem,
  ctx: Partial<ChatPlaceContext>,
): ChatPlaceItem {
  const displayName = ctx.displayName?.trim() || place.displayName || placeDisplayName(place);
  return {
    ...place,
    placeId: ctx.placeId?.trim() || place.placeId || place.googlePlaceId,
    googlePlaceId: ctx.placeId?.trim() || place.googlePlaceId || place.placeId,
    displayName,
    placeName: displayName,
    name: ctx.name?.trim() || place.name,
    lat: ctx.latitude ?? place.lat ?? null,
    lng: ctx.longitude ?? place.lng ?? null,
    city: ctx.city?.trim() || place.city,
    country: ctx.country?.trim() || place.country,
  };
}

export function enrichChatPlaceItemFromDetails(
  place: ChatPlaceItem,
  details: {
    lat: number;
    lng: number;
    name?: string;
    address?: string;
    placeId?: string;
  },
): ChatPlaceItem {
  const parsed = parseCityCountryFromAddress(details.address ?? place.address);
  const country =
    place.country?.trim() ||
    parsed.country ||
    inferCountryFromCoordinates(details.lat, details.lng);
  const city = place.city?.trim() || parsed.city;
  const displayName = details.name?.trim() || place.displayName || placeDisplayName(place);
  const placeId = details.placeId?.trim() || place.placeId || place.googlePlaceId || "";

  return applyChatPlaceContext(
    {
      ...place,
      address: details.address?.trim() || place.address,
      lat: details.lat,
      lng: details.lng,
    },
    {
      placeId,
      name: displayName,
      displayName,
      latitude: details.lat,
      longitude: details.lng,
      city,
      country,
    },
  );
}

export function logChatContextPlace(place: ChatPlaceItem): void {
  const ctx = buildChatPlaceContext(place);
  console.info("[CHAT_CONTEXT_PLACE]", {
    name: ctx?.displayName ?? placeDisplayName(place),
    placeId: ctx?.placeId ?? place.placeId ?? place.googlePlaceId ?? "",
    lat: ctx?.latitude ?? place.lat ?? "",
    lng: ctx?.longitude ?? place.lng ?? "",
    country: ctx?.country ?? place.country ?? "",
    city: ctx?.city ?? place.city ?? "",
  });
}

export function logChatNearbyRequest(params: {
  center: { lat: number; lng: number };
  radius: number;
  category: string;
}): void {
  console.info("[CHAT_NEARBY_REQUEST]", {
    center: `${params.center.lat},${params.center.lng}`,
    radius: params.radius,
    category: params.category,
  });
}

export function logChatNearbyResponse(params: {
  status: "ok" | "empty" | "error";
  count: number;
  firstResultName?: string;
  error?: string;
  rawCount?: number;
  filteredCount?: number;
}): void {
  console.info("[CHAT_NEARBY_RESPONSE]", {
    status: params.status,
    count: params.count,
    firstResultName: params.firstResultName ?? "",
    error: params.error ?? "",
    rawCount: params.rawCount ?? "",
    filteredCount: params.filteredCount ?? "",
  });
}

export function logChatNearbyError(params: { message: string; rawResponse?: string }): void {
  console.warn("[CHAT_NEARBY_ERROR]", {
    message: params.message,
    rawResponse: (params.rawResponse ?? "").slice(0, 500),
  });
}

const placeDetailNearbyInflight = new Map<string, Promise<unknown>>();

export function buildPlaceDetailNearbySearchKey(
  lat: number,
  lng: number,
  category: string,
  placeId?: string,
): string {
  const pid = placeId?.trim() || "";
  return `${pid}|${lat.toFixed(5)}|${lng.toFixed(5)}|${category}`;
}

/** 同一焦點地點 + category 搜尋進行中時共用 Promise，避免重複打 API */
export async function runPlaceDetailNearbySingleFlight<T>(
  key: string,
  runner: () => Promise<T>,
): Promise<T> {
  const existing = placeDetailNearbyInflight.get(key);
  if (existing) {
    console.info("[CHAT_NEARBY_SINGLE_FLIGHT] joined", { key });
    return existing as Promise<T>;
  }
  const promise = runner().finally(() => {
    placeDetailNearbyInflight.delete(key);
  });
  placeDetailNearbyInflight.set(key, promise);
  return promise;
}
