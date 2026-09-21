import type { ChatPlanningSession } from "@/lib/chat-session";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { getLocalizedPlaceCategoryLabel } from "@/lib/place-category";
import type { SavedPlace } from "@/lib/places-storage";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import { t } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";
import { formatTravelPaceLabel, formatTravelVibeLabel } from "@/lib/travel-pref-display";

export type HomePersonalizationInsightInput = {
  savedPlaces: SavedPlace[];
  prefs?: TravelPreferences | null;
  selectedMood?: string | null;
  weather?: WeatherSummary | null;
  nearbyPicks?: HomeNearbyPick[];
  latestTripTitle?: string | null;
  chatSession?: ChatPlanningSession | null;
  locale?: Locale;
};

export type HomePlusCopySource = "profile" | "recent_intent" | "combined" | "fallback";

const homeSessionInsights = new Map<string, string>();

export function readHomeSessionPlusInsight(
  sessionKey: string | null,
  locale: Locale = "zh-TW",
): string | null {
  return sessionKey
    ? (homeSessionInsights.get(JSON.stringify([sessionKey, locale])) ?? null)
    : null;
}

export function writeHomeSessionPlusInsight(
  sessionKey: string,
  insight: string,
  locale: Locale = "zh-TW",
): string {
  homeSessionInsights.set(JSON.stringify([sessionKey, locale]), insight);
  return insight;
}

export function resolveHomeSessionPlusInsight(
  sessionKey: string,
  ready: boolean,
  input: HomePersonalizationInsightInput,
): string | null {
  const existing = readHomeSessionPlusInsight(sessionKey, input.locale);
  if (existing || !ready) return existing;
  return writeHomeSessionPlusInsight(sessionKey, buildHomePlusInsight(input), input.locale);
}

export function resolveHomePlusCopySource(
  input: HomePersonalizationInsightInput,
): HomePlusCopySource {
  const hasProfile = Boolean(
    input.prefs?.pace ||
    input.prefs?.vibe ||
    input.prefs?.interests?.length ||
    input.prefs?.avoid?.length,
  );
  const hasRecent = Boolean(recentChatHint(input.chatSession) || input.savedPlaces.length);
  if (hasProfile && hasRecent) return "combined";
  if (hasProfile) return "profile";
  if (hasRecent) return "recent_intent";
  return "fallback";
}

function topSavedCategories(saved: SavedPlace[], locale: Locale, limit = 2): string[] {
  const counts = new Map<string, number>();
  for (const p of saved) {
    const metadata = p.metadata ?? {};
    const types = Array.isArray(metadata.types)
      ? metadata.types.filter((value): value is string => typeof value === "string")
      : [];
    const displayLabel = getLocalizedPlaceCategoryLabel(
      {
        name: p.name,
        address: p.address,
        primaryType: typeof metadata.primaryType === "string" ? metadata.primaryType : p.category,
        types,
      },
      locale,
    );
    const key = displayLabel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, limit);
}

function recentChatHint(session?: ChatPlanningSession | null): string | null {
  const intent = session?.lastUserIntent?.trim();
  if (intent && intent.length >= 4) {
    return intent.length > 36 ? `${intent.slice(0, 36)}…` : intent;
  }
  const summary = session?.conversationSummary?.trim();
  if (summary && summary.length >= 6) {
    return summary.length > 40 ? `${summary.slice(0, 40)}…` : summary;
  }
  return null;
}

/** Plus 首頁「個人化旅遊中心」動態一句描述 */
export function buildHomePlusInsight(input: HomePersonalizationInsightInput): string {
  const {
    savedPlaces,
    prefs,
    selectedMood,
    weather,
    nearbyPicks = [],
    latestTripTitle,
    chatSession,
    locale = "zh-TW",
  } = input;

  const savedCats = topSavedCategories(savedPlaces, locale);
  const nearbyTypes = [
    ...new Set(
      nearbyPicks
        .slice(0, 5)
        .map((p) => getLocalizedPlaceCategoryLabel(p, locale))
        .filter(Boolean),
    ),
  ].slice(0, 2);
  const chatHint = recentChatHint(chatSession);
  const rainy = weather?.condition?.includes("雨");
  const hour = new Date().getHours();
  const evening = hour >= 18 || hour < 5;

  const paceLabel = prefs?.pace ? formatTravelPaceLabel(locale, prefs.pace) : "";
  const vibeLabel = prefs?.vibe ? formatTravelVibeLabel(locale, prefs.vibe) : "";
  const interests = (prefs?.interests ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
  const avoids = (prefs?.avoid ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (chatHint && (paceLabel || vibeLabel || interests.length || avoids.length)) {
    const profileFacts = [
      paceLabel ? t(locale, "uiCoverage.paceFact", { value: paceLabel }) : "",
      vibeLabel ? t(locale, "uiCoverage.vibeFact", { value: vibeLabel }) : "",
      interests.length ? t(locale, "uiCoverage.likeFact", { value: interests.join(", ") }) : "",
      avoids.length ? t(locale, "uiCoverage.avoidFact", { value: avoids.join(", ") }) : "",
    ].filter(Boolean);
    return t(locale, "uiCoverage.insightProfile", {
      chat: chatHint,
      facts: profileFacts.join(", "),
    });
  }

  if (interests.length || avoids.length) {
    const liked = interests.length
      ? t(locale, "uiCoverage.likeFact", { value: interests.join(", ") })
      : "";
    const avoided = avoids.length
      ? t(locale, "uiCoverage.avoidFact", { value: avoids.join(", ") })
      : "";
    return t(locale, "uiCoverage.insightPreferences", {
      facts: [liked, avoided].filter(Boolean).join(", "),
    });
  }

  if (selectedMood && savedCats.length) {
    return t(locale, "uiCoverage.insightMoodSaved", {
      mood: selectedMood,
      categories: savedCats.join(", "),
    });
  }

  if (savedCats.length >= 2) {
    return t(locale, "uiCoverage.insightSaved", { categories: savedCats.join(", ") });
  }

  if (savedCats.length === 1 && nearbyTypes.length) {
    return t(locale, "uiCoverage.insightNearbySaved", {
      saved: savedCats[0],
      nearby: nearbyTypes.join(", "),
    });
  }

  if (chatHint && selectedMood) {
    return t(locale, "uiCoverage.insightChatMood", { chat: chatHint, mood: selectedMood });
  }

  if (chatHint) {
    return t(locale, "uiCoverage.insightChat", { chat: chatHint });
  }

  if (prefs?.vibe && prefs.pace) {
    if (paceLabel && vibeLabel) {
      return t(locale, "home.plusInsightPaceVibe", { pace: paceLabel, vibe: vibeLabel });
    }
  }

  if (prefs?.personalitySummary?.trim()) {
    const short =
      prefs.personalitySummary.length > 28
        ? `${prefs.personalitySummary.slice(0, 28)}…`
        : prefs.personalitySummary;
    return t(locale, "uiCoverage.insightPersonality", { summary: short });
  }

  if (latestTripTitle?.trim()) {
    return t(locale, "uiCoverage.insightTrip", { title: latestTripTitle });
  }

  if (rainy) {
    return t(locale, "uiCoverage.insightRain");
  }

  if (evening && nearbyTypes.length) {
    return t(locale, "uiCoverage.insightEvening", { categories: nearbyTypes.join(", ") });
  }

  if (selectedMood) {
    return t(locale, "uiCoverage.insightMood", { mood: selectedMood });
  }

  if (nearbyTypes.length) {
    return t(locale, "uiCoverage.insightNearby", { categories: nearbyTypes.join(", ") });
  }

  return t(locale, "uiCoverage.insightDefault");
}
