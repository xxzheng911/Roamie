import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { PlaceResult } from "@/lib/place-result";
import { isExplicitCampingPlace } from "@/lib/camping-place-classification";

const CAMPING_REQUEST_RE =
  /(露營|營區|營地|campground|campsite|camping|glamping|豪華露營|野營|車宿)/i;

export function isCampingRequestText(text: string): boolean {
  return CAMPING_REQUEST_RE.test(text.trim());
}

export function isCampingPlace(place: {
  name?: string;
  type?: string;
  description?: string;
  types?: string[];
}): boolean {
  return isExplicitCampingPlace({
    name: place.name,
    primaryType: place.type,
    types: place.types,
  });
}

export function filterCampingPlaces<T extends PlaceResult>(places: T[]): T[] {
  return places.filter((place) => isCampingPlace(place));
}

export function campingSearchAttempts(): Array<{
  query: string;
  mode: "nearby" | "text";
  includedTypes?: string[];
}> {
  return [
    { query: "露營區 campground", mode: "text", includedTypes: ["campground", "rv_park", "lodging"] },
    { query: "campsite glamping 露營", mode: "text" },
    { query: "營區 豪華露營", mode: "text" },
    { query: "campground", mode: "nearby", includedTypes: ["campground", "rv_park"] },
  ];
}

export function buildCampingIntroReply(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): string {
  const hasLocation = Boolean(
    session?.location?.lat != null &&
      session?.location?.lng != null &&
      (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001),
  );
  const nearLabel = ctx.currentLocation ?? session?.location?.city;

  const lines = [
    "想露營的話，我會先看你想要山區、海邊，還是比較新手友善的營區。",
    hasLocation && nearLabel
      ? `如果以你目前${nearLabel}附近來找，我可以先幫你推薦幾個評價高、交通不要太麻煩的露營地。`
      : "如果以你目前附近來找，我可以先幫你推薦幾個評價高、交通不要太麻煩的露營地。",
    "你想找北部、中部、南部，還是離你現在近一點？",
  ];

  return lines.join("\n");
}

export function buildCampingRecommendationSummary(
  picks: Array<{ name: string }>,
  ctx: CanonicalTravelContext,
): string {
  const list = picks
    .slice(0, 5)
    .map((place, index) => `${index + 1}. ${place.name}`)
    .join("\n");

  const nearLabel = ctx.currentLocation ?? ctx.destination ?? "附近";

  return [
    "想露營的話，我先幫你挑了幾個比較像真正營區的選擇：",
    "",
    list,
    "",
    `這些都在${nearLabel}一帶，評價和交通相對好安排。`,
    "你比較想山區、海邊，還是新手友善的營區？我可以再幫你縮小。",
  ].join("\n");
}

export function applyCampingContextFromText(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  if (!isCampingRequestText(text)) return session;

  const prev = session.travelContext ?? { interests: [] };
  return {
    ...session,
    activeChatIntent: "camping",
    conversationMode: "nearby_explore",
    travelContext: {
      ...prev,
      activity: "camping",
      tripPurpose: "recommend_places",
      interests: [...new Set([...prev.interests, "露營"])],
      mood: prev.mood,
    },
  };
}

export function parseCampingRegionHint(text: string): string | undefined {
  const t = text.trim();
  if (/北部|北台灣|北臺灣/.test(t)) return "北部";
  if (/中部|中台灣|中臺灣/.test(t)) return "中部";
  if (/南部|南台灣|南臺灣/.test(t)) return "南部";
  if (/東部|東台灣|東臺灣|花東/.test(t)) return "東部";
  if (/離我近|附近|近一點|不要太遠/.test(t)) return "nearby";
  return undefined;
}
