import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { HeartHandshake, Sparkles } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { usePlusUpgrade } from "@/hooks/use-plus-upgrade";
import {
  readHomeSessionPlusInsight,
  resolveHomeSessionPlusInsight,
  resolveHomePlusCopySource,
} from "@/lib/home-personalization-insight";
import { resolveHomePersonalizationVariant } from "@/lib/home-personalization-visibility";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { SavedPlace } from "@/lib/places-storage";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";

const FREE_FEATURE_TAGS = ["plusMemory", "plusPersonal", "plusUnlimited"] as const;

type Props = {
  prefs?: TravelPreferences | null;
  savedPlaces: SavedPlace[];
  weather?: WeatherSummary | null;
  nearbyPicks?: HomeNearbyPick[];
  selectedMood?: string | null;
  latestTripTitle?: string | null;
  chatSession?: ChatPlanningSession | null;
  personalizationReady?: boolean;
  className?: string;
};

export function HomePersonalizationCard({
  prefs,
  savedPlaces,
  weather,
  nearbyPicks = [],
  selectedMood,
  latestTripTitle,
  chatSession = null,
  personalizationReady = false,
  className,
}: Props) {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const { hasPlusAccess, subscriptionSource, entitlementDisplayStable } = useAccess();
  const { user } = useAuth();
  const { upgradeToPlus } = usePlusUpgrade();
  const sessionKey = user?.id ?? null;
  const insightKey = JSON.stringify([sessionKey, locale]);
  const [insightState, setInsightState] = useState(() => ({
    key: insightKey,
    text: readHomeSessionPlusInsight(sessionKey, locale),
  }));
  const plusInsight = insightState.key === insightKey ? insightState.text : null;
  const plusInsightReady = !hasPlusAccess || plusInsight !== null;
  const variant = resolveHomePersonalizationVariant(
    entitlementDisplayStable === true && plusInsightReady,
    hasPlusAccess,
  );

  useEffect(() => {
    const status = hasPlusAccess ? "plus" : "free";
    console.info(
      `[SUBSCRIPTION_STATE_RENDER] component=HomePersonalizationCard status=${status} source=${subscriptionSource ?? "unknown"} hydrated=${entitlementDisplayStable ?? false}`,
    );
  }, [hasPlusAccess, subscriptionSource, entitlementDisplayStable]);

  useEffect(() => {
    const cached = readHomeSessionPlusInsight(sessionKey, locale);
    setInsightState({ key: insightKey, text: cached });
  }, [sessionKey, locale, insightKey]);

  useEffect(() => {
    if (
      !sessionKey ||
      !hasPlusAccess ||
      entitlementDisplayStable !== true ||
      !personalizationReady ||
      plusInsight
    ) {
      return;
    }
    setInsightState({
      key: insightKey,
      text: resolveHomeSessionPlusInsight(sessionKey, true, {
        savedPlaces,
        prefs,
        selectedMood,
        weather,
        nearbyPicks,
        latestTripTitle,
        chatSession,
        locale,
      }),
    });
  }, [
    sessionKey,
    insightKey,
    hasPlusAccess,
    entitlementDisplayStable,
    personalizationReady,
    savedPlaces,
    prefs,
    selectedMood,
    weather,
    nearbyPicks,
    latestTripTitle,
    chatSession,
    locale,
    plusInsight,
  ]);

  useEffect(() => {
    if (!hasPlusAccess) return;
    console.info(
      `[PLUS_CENTER_COPY_SOURCE] ${resolveHomePlusCopySource({
        savedPlaces,
        prefs,
        selectedMood,
        weather,
        nearbyPicks,
        latestTripTitle,
        chatSession,
        locale,
      })}`,
    );
  }, [
    hasPlusAccess,
    savedPlaces,
    prefs,
    selectedMood,
    weather,
    nearbyPicks,
    latestTripTitle,
    chatSession,
    locale,
  ]);

  const handleUpgradePlus = () => {
    upgradeToPlus();
  };

  const handleStartPlusJourney = () => {
    void navigate({
      to: "/plan",
      search: selectedMood ? { mood: selectedMood } : {},
    });
  };

  if (variant === "skeleton") {
    return (
      <section className={className}>
        <div className="rounded-3xl border border-border bg-card/70 p-5 shadow-soft">
          <div className="h-24 animate-pulse rounded-2xl bg-secondary/60" aria-hidden />
        </div>
      </section>
    );
  }

  if (variant === "plus") {
    return (
      <section className={className}>
        <div className="rounded-3xl border border-clay/25 bg-gradient-to-br from-accent/50 via-card to-secondary/40 p-5 shadow-soft">
          <p className="text-[11px] font-medium uppercase tracking-wide text-clay/90">
            {t("uiCoverage.plusCenter")}
          </p>
          <div className="mt-2 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-card shadow-soft">
              <Sparkles className="h-5 w-5 text-clay" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[19px] leading-snug">
                {t("uiCoverage.plusLearning")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plusInsight}</p>
            </div>
          </div>
          <div className="mt-4 flex w-full justify-center">
            <button
              type="button"
              onClick={handleStartPlusJourney}
              className="mx-auto w-full rounded-full bg-primary px-3 py-3 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-[0.99]"
            >
              {t("uiCoverage.plusStart")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={className}>
      <div className="rounded-3xl border border-border bg-card/70 p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary">
            <HeartHandshake className="h-5 w-5 text-clay" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[19px] leading-snug">{t("uiCoverage.plusTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("uiCoverage.plusBody")}
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {FREE_FEATURE_TAGS.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-border/80 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground/85"
                >
                  {t(`uiCoverage.${tag}`)}
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <button
                type="button"
                onClick={handleUpgradePlus}
                className="w-full rounded-full bg-primary px-3 py-3 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-[0.99]"
              >
                {t("uiCoverage.plusUpgrade")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
