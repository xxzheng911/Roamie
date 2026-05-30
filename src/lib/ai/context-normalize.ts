import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  extractKnownDestinationFromText,
  normalizeDestination,
  resolveCleanDestination,
} from "@/lib/ai/normalize-destination";
import { inferTravelSeason, parseMonthNumber, type TravelSeasonInfo } from "@/lib/ai/travel-season";
import { buildPlaceSearchQuery } from "@/lib/ai/place-search-query";

export type NormalizedTravelContextLog = {
  rawMessage: string;
  destination?: string;
  cleanDestination?: string;
  travelMonth?: string;
  season?: string;
  seasonKey?: string;
  weatherHint?: string;
  placeSearchQuery?: string;
};

export function seasonKeyFromInfo(info: TravelSeasonInfo | undefined, month?: number): string | undefined {
  if (!info && month == null) return undefined;
  const m = info?.month ?? month;
  if (m === 3 || m === 4) return "spring";
  if (m === 11) return "late_autumn";
  if (m === 10) return "autumn";
  if (m === 12 || m === 1 || m === 2) return "winter";
  if (m === 7 || m === 8) return "summer";
  if (info?.seasonLabel === "春季") return "spring";
  if (info?.seasonLabel === "秋季") return "autumn";
  return info?.seasonLabel;
}

export function buildNormalizedTravelContextLog(
  userText: string,
  session: ChatPlanningSession,
  merged?: CanonicalTravelContext,
): NormalizedTravelContextLog {
  const rawMessage = userText.trim();
  const rawDestination =
    merged?.destination ??
    session.travelContext?.destination ??
    session.tripDestination?.city ??
    session.preferredArea;

  const cleanDestination = resolveCleanDestination(rawMessage, {
    rawDestination,
    sessionDestination: session.travelContext?.destination ?? session.tripDestination?.city,
    preferredArea: session.preferredArea,
  });

  const monthNumForLabel = parseMonthNumber({
    travelMonth: merged?.travelMonth,
    startDate: merged?.startDate,
    travelDate: session.travelDate,
    userText: rawMessage,
  });
  const travelMonth = merged?.travelMonth ?? (monthNumForLabel ? `${monthNumForLabel}月` : undefined);

  const monthNum = parseMonthNumber({
    travelMonth: merged?.travelMonth ?? travelMonth,
    startDate: merged?.startDate,
    travelDate: session.travelDate,
    userText: rawMessage,
  });

  const seasonInfo = inferTravelSeason({
    destination: cleanDestination ?? extractKnownDestinationFromText(rawMessage),
    month: monthNum,
    userText: rawMessage,
  });

  const placeSearchQuery = buildPlaceSearchQuery({
    destination: cleanDestination,
    mood: merged?.mood ?? session.mood,
    interests: merged?.interests,
    userText: rawMessage,
  });

  return {
    rawMessage,
    destination: rawDestination,
    cleanDestination,
    travelMonth: merged?.travelMonth ?? travelMonth,
    season: seasonInfo?.seasonLabel,
    seasonKey: seasonKeyFromInfo(seasonInfo, monthNum),
    weatherHint: seasonInfo?.climateNote,
    placeSearchQuery,
  };
}

export function logContextNormalized(log: NormalizedTravelContextLog): void {
  console.info(
    "[CONTEXT_NORMALIZED]",
    "rawMessage:",
    log.rawMessage.slice(0, 120),
    "destination:",
    log.destination ?? "—",
    "cleanDestination:",
    log.cleanDestination ?? "—",
    "travelMonth:",
    log.travelMonth ?? "—",
    "season:",
    log.season ?? "—",
    "seasonKey:",
    log.seasonKey ?? "—",
    "weatherHint:",
    log.weatherHint ?? "—",
    "placeSearchQuery:",
    log.placeSearchQuery ?? "—",
  );
}

/** 將 merged context 的目的地改為乾淨城市名 */
export function applyCleanDestinationToTravelContext(
  ctx: CanonicalTravelContext,
  userText: string,
  session: ChatPlanningSession,
): CanonicalTravelContext {
  const log = buildNormalizedTravelContextLog(userText, session, ctx);
  logContextNormalized(log);

  if (!log.cleanDestination) return ctx;

  const monthNum = parseMonthNumber({
    travelMonth: ctx.travelMonth,
    startDate: ctx.startDate,
    userText,
  });
  const season = inferTravelSeason({
    destination: log.cleanDestination,
    month: monthNum,
    userText,
  });

  return {
    ...ctx,
    destination: log.cleanDestination,
    travelMonth: log.travelMonth ?? ctx.travelMonth,
    outfitSuggestion: season?.outfitSuggestion ?? ctx.outfitSuggestion,
    travelSeason: season?.seasonLabel,
    seasonHighlights: season?.seasonHighlights,
  };
}
