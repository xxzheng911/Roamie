import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import type { ChatConversationMode } from "@/lib/ai/trip-planning-context";
import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import {
  mapCategoryIntentToNearbyIntent,
  parseChatPlaceIntents,
} from "@/lib/ai/chat-place-intent";
import { isExplicitNearbyQuery } from "@/lib/ai/chat-place-search-context";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { Locale } from "@/lib/i18n/types";
import {
  enrichChatPlaceItemFromDetails,
  hasValidPlaceCoordinates,
  logChatContextPlace,
  parseCityCountryFromAddress,
} from "@/lib/chat-place-context";

export type FetchPlaceDetailsForFocusFn = (
  placeId: string,
) => Promise<{
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  placeId?: string;
} | null>;

export type PlaceDetailFollowUpIntent =
  | "add_to_trip"
  | "nearby_cafe"
  | "nearby_late_snack"
  | "view_route"
  | "continue_chat";

export function isPlaceDetailChatActive(session: ChatPlanningSession): boolean {
  return Boolean(session.placeDetailFocus);
}

export function inferPreviousConversationMode(
  session: ChatPlanningSession,
): ChatConversationMode {
  if (session.previousConversationMode) return session.previousConversationMode;
  if (session.fromMoodFlow || session.fromMoodCard || session.homeMoodShortcutEntry) {
    return "mood_recommend";
  }
  if (session.conversationMode === "destination_planning") return "destination_planning";
  return "nearby_explore";
}

export function enterPlaceDetailChat(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): ChatPlanningSession {
  const previousMode = inferPreviousConversationMode(session);
  const focus = {
    ...place,
    displayName: place.displayName?.trim() || placeDisplayName(place),
    placeName: place.placeName?.trim() || place.displayName?.trim() || place.name,
  };
  logChatContextPlace(focus);
  return {
    ...session,
    placeDetailFocus: focus,
    selectedPlaceFromMood: focus,
    previousConversationMode: previousMode,
    conversationMode: "place_focus",
    phase: "followup",
    activeChatIntent: undefined,
    foodPreference: undefined,
  };
}

function suggestStayDuration(place: ChatPlaceItem, mood: string): string {
  const blob = `${place.type ?? ""} ${place.description ?? ""} ${place.reason ?? ""}`;
  if (/(河|步道|公園|海邊|散步|堤)/.test(blob) || /深夜散步|夜景|走走/.test(mood)) {
    return "40～60 分鐘";
  }
  if (/(咖啡|café|cafe)/i.test(blob)) return "45～75 分鐘";
  if (/(餐廳|宵夜|夜市)/.test(blob)) return "60～90 分鐘";
  if (/(博物館|展覽|美術)/.test(blob)) return "90～120 分鐘";
  return "45～60 分鐘";
}

function moodFitLine(name: string, mood: string): string {
  if (/深夜散步|夜景/.test(mood)) {
    return `「${name}」很適合你剛剛說的深夜散步。這裡比較適合慢慢走、看夜景，不太像需要排很滿的景點。`;
  }
  if (/下雨天|雨/.test(mood)) {
    return `「${name}」蠻適合下雨天想找室內或仍有氛圍的節奏，不用趕行程。`;
  }
  if (/找咖啡|咖啡/.test(mood)) {
    return `「${name}」跟你剛剛想找咖啡的狀態很合拍，適合坐下來慢慢待一會。`;
  }
  if (/想放空|放鬆/.test(mood)) {
    return `「${name}」蠻符合你想放鬆的節奏，不用排得太滿。`;
  }
  if (/看海/.test(mood)) {
    return `「${name}」適合你想看海、吹吹風的狀態。`;
  }
  return `「${name}」值得停下來感受一下，我們可以從這裡往下細排。`;
}

function followUpSuggestions(mood: string): string {
  const lines = [
    "接下來你可以跟我說：",
    "· 加入行程",
    "· 找附近咖啡廳",
    "· 找附近宵夜",
    "· 查看路線",
  ];
  if (/深夜散步|夜景/.test(mood)) {
    lines.push("· 附近還能散步去哪");
  }
  return lines.join("\n");
}

export function buildPlaceDetailReply(
  place: ChatPlaceItem,
  session: ChatPlanningSession,
): string {
  const name = placeDisplayName(place);
  const mood = session.selectedMood ?? session.mood ?? session.travelContext?.mood ?? "";
  const duration = place.estimatedTime?.trim() || suggestStayDuration(place, mood);
  const reason = place.reason?.trim();

  const lines = [moodFitLine(name, mood)];

  if (reason && !lines[0]!.includes(reason)) {
    lines.push(reason);
  }

  lines.push(
    `如果你要把它放進今晚行程，我會建議停留 ${duration}，後面可以接一間附近咖啡廳或宵夜店。`,
    "",
    followUpSuggestions(mood),
  );

  return lines.join("\n");
}

export function parsePlaceDetailFollowUp(text: string): PlaceDetailFollowUpIntent {
  const t = text.trim();
  if (!t) return "continue_chat";
  if (/(加入行程|加進行程|放進行程|列入行程)/.test(t)) return "add_to_trip";
  if (/(查看路線|看路線|怎麼去|導航)/.test(t)) return "view_route";
  if (/(附近|這附近|這一帶|周邊|周边).*(咖啡|咖啡廳|咖啡店)/.test(t)) return "nearby_cafe";
  if (/(咖啡廳|咖啡店|找咖啡|想找咖啡)/.test(t)) return "nearby_cafe";
  if (/(附近|這附近|這一帶).*(宵夜|深夜|小吃|美食|餐廳|吃)/.test(t)) return "nearby_late_snack";
  if (/(宵夜|深夜食堂|夜市)/.test(t)) return "nearby_late_snack";
  return "continue_chat";
}

export function resolvePlaceDetailNearbyIntent(text: string): NearbyPlaceIntent | null {
  const t = text.trim();
  if (!t) return null;

  const followUp = parsePlaceDetailFollowUp(t);
  if (followUp === "nearby_cafe") return "cafe";
  if (followUp === "nearby_late_snack") return "restaurant";

  const explicitNearby =
    isExplicitNearbyQuery(t) || /(這附近|附近|這一帶|周邊|周边)/.test(t);
  if (!explicitNearby) return null;

  const categories = parseChatPlaceIntents(t);
  if (categories.includes("cafe")) return "cafe";
  if (categories.includes("restaurant") || categories.includes("night_market")) {
    return "restaurant";
  }
  if (categories.includes("bar")) return "restaurant";
  if (categories.length === 1) {
    return mapCategoryIntentToNearbyIntent(categories[0]!);
  }
  if (/(咖啡)/.test(t)) return "cafe";
  if (/(美食|餐廳|宵夜|吃)/.test(t)) return "restaurant";
  if (/(酒吧)/.test(t)) return "restaurant";
  if (/(景點|逛逛|散步)/.test(t)) return "attraction";
  return null;
}

export async function ensurePlaceDetailFocusCoordinates(
  session: ChatPlanningSession,
  geocodeFn: GeocodeDestinationFn,
  locale: Locale,
  fetchDetailsFn?: FetchPlaceDetailsForFocusFn,
): Promise<ChatPlanningSession> {
  const focus = session.placeDetailFocus;
  if (!focus) return session;

  if (hasValidPlaceCoordinates(focus)) {
    logChatContextPlace(focus);
    return session;
  }

  const placeId = (focus.placeId ?? focus.googlePlaceId ?? "").trim();
  if (placeId && fetchDetailsFn) {
    console.info("[CHAT_NEARBY_GEOCODE]", { place: placeDisplayName(focus), source: "place_details", placeId });
    const details = await fetchDetailsFn(placeId);
    if (details && hasValidPlaceCoordinates(details)) {
      const updated = enrichChatPlaceItemFromDetails(focus, details);
      logChatContextPlace(updated);
      return {
        ...session,
        placeDetailFocus: updated,
        selectedPlaceFromMood: updated,
      };
    }
    console.warn("[CHAT_NEARBY_GEOCODE] place_details failed", { placeId });
  }

  const parsed = parseCityCountryFromAddress(focus.address);
  const query = [placeDisplayName(focus), focus.address, parsed.country]
    .filter(Boolean)
    .join(", ");
  if (!query.trim()) return session;

  console.info("[CHAT_NEARBY_GEOCODE]", { place: placeDisplayName(focus), query, source: "geocode" });
  const geocoded = await geocodeFn({ data: { query, locale } });
  if (geocoded.location?.lat == null || geocoded.location?.lng == null) {
    console.warn("[CHAT_NEARBY_GEOCODE] failed", { place: placeDisplayName(focus) });
    return session;
  }

  const updated = enrichChatPlaceItemFromDetails(focus, {
    lat: geocoded.location.lat,
    lng: geocoded.location.lng,
    name: placeDisplayName(focus),
    address: focus.address || geocoded.location.address,
    placeId: placeId || undefined,
  });
  console.info("[CHAT_NEARBY_GEOCODE] ok", {
    place: placeDisplayName(updated),
    lat: updated.lat,
    lng: updated.lng,
  });
  return {
    ...session,
    placeDetailFocus: updated,
    selectedPlaceFromMood: updated,
  };
}

export function sessionWithPlaceDetailSearchCenter(
  session: ChatPlanningSession,
): ChatPlanningSession {
  const focus = session.placeDetailFocus;
  if (!hasValidPlaceCoordinates(focus)) return session;
  const parsed = parseCityCountryFromAddress(focus?.address);
  return {
    ...session,
    location: {
      lat: focus!.lat!,
      lng: focus!.lng!,
      city: focus?.city?.trim() || parsed.city || session.location?.city,
    },
    preferredArea: placeDisplayName(focus!),
  };
}

export function buildPlaceDetailFollowUpReply(
  intent: PlaceDetailFollowUpIntent,
  session: ChatPlanningSession,
): string | null {
  const name = session.placeDetailFocus
    ? placeDisplayName(session.placeDetailFocus)
    : "這個地點";

  switch (intent) {
    case "add_to_trip":
      return `好的，我先把「${name}」記下來。你還想再接咖啡、宵夜，或直接排成今晚的小路線？`;
    case "view_route":
      return `你可以點上方「${name}」卡片裡的查看路線；若要我幫你串下一站，跟我說想接咖啡、宵夜或散步。`;
    case "nearby_cafe":
      return `好，我以「${name}」為中心幫你找附近咖啡廳。`;
    case "nearby_late_snack":
      return `好，我以「${name}」為中心幫你找附近宵夜或小吃。`;
    default:
      return null;
  }
}
