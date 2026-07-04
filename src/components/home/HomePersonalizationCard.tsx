import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { HeartHandshake, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PlusComingSoonDialog } from "@/components/PlusComingSoonDialog";
import { useAccess } from "@/hooks/use-access";
import { useI18n } from "@/hooks/use-i18n";
import { usePlusUpgrade } from "@/hooks/use-plus-upgrade";
import { buildHomePlusInsight } from "@/lib/home-personalization-insight";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { SavedPlace } from "@/lib/places-storage";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";

const FREE_FEATURE_TAGS = [
  "長期旅行記憶",
  "收藏地點推薦",
  "更深層 AI 對話",
  "個人化行程規劃",
] as const;

type Props = {
  prefs?: TravelPreferences | null;
  savedPlaces: SavedPlace[];
  weather?: WeatherSummary | null;
  nearbyPicks?: HomeNearbyPick[];
  selectedMood?: string | null;
  latestTripTitle?: string | null;
  chatSession?: ChatPlanningSession | null;
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
  className,
}: Props) {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const {
    hasPlusAccess,
    subscriptionSource,
    subscriptionHydrated,
    disablePlusTestMode,
  } = useAccess();
  const { upgradeToPlus, comingSoonOpen, setComingSoonOpen } = usePlusUpgrade();

  useEffect(() => {
    const status = hasPlusAccess ? "plus" : "free";
    console.info(
      `[SUBSCRIPTION_STATE_RENDER] component=HomePersonalizationCard status=${status} source=${subscriptionSource ?? "unknown"} hydrated=${subscriptionHydrated ?? false}`,
    );
  }, [hasPlusAccess, subscriptionSource, subscriptionHydrated]);

  const plusInsight = useMemo(
    () =>
      buildHomePlusInsight({
        savedPlaces,
        prefs,
        selectedMood,
        weather,
        nearbyPicks,
        latestTripTitle,
        chatSession,
        locale,
      }),
    [savedPlaces, prefs, selectedMood, weather, nearbyPicks, latestTripTitle, chatSession, locale],
  );

  const handleUpgradePlus = () => {
    upgradeToPlus();
  };

  const handleDismissUpgrade = () => {
    toast.message("沒問題，你隨時可以再升級 Plus");
  };

  const handleStartPlusJourney = () => {
    void navigate({
      to: "/plan",
      search: selectedMood ? { mood: selectedMood } : {},
    });
  };

  const handleReturnFree = () => {
    disablePlusTestMode();
    toast.message("已切換回 Free 模式");
  };

  if (!subscriptionHydrated) {
    return (
      <section className={className}>
        <div className="rounded-3xl border border-border bg-card/70 p-5 shadow-soft">
          <div className="h-24 animate-pulse rounded-2xl bg-secondary/60" aria-hidden />
        </div>
      </section>
    );
  }

  if (hasPlusAccess) {
    return (
      <section className={className}>
        <div className="rounded-3xl border border-clay/25 bg-gradient-to-br from-accent/50 via-card to-secondary/40 p-5 shadow-soft">
          <p className="text-[11px] font-medium uppercase tracking-wide text-clay/90">
            個人化旅遊中心
          </p>
          <div className="mt-2 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-card shadow-soft">
              <Sparkles className="h-5 w-5 text-clay" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[19px] leading-snug">
                Roamie 正在記住你的旅行節奏
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plusInsight}</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={handleStartPlusJourney}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-[0.99]"
                >
                  開始規劃我的旅程
                </button>
                <button
                  type="button"
                  onClick={handleReturnFree}
                  className="rounded-full border border-border bg-card/80 px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                >
                  返回 Free 模式
                </button>
              </div>
            </div>
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
            <h3 className="font-display text-[19px] leading-snug">讓 Roamie 更懂你</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              讓 AI 記住你的旅行偏好、收藏地點與旅遊習慣，獲得更貼近你的行程推薦。
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {FREE_FEATURE_TAGS.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-border/80 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground/85"
                >
                  {tag}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={handleUpgradePlus}
                className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-[0.99]"
              >
                立即升級 Plus
              </button>
              <button
                type="button"
                onClick={handleDismissUpgrade}
                className="rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                稍後再說
              </button>
            </div>
          </div>
        </div>
      </div>
      <PlusComingSoonDialog open={comingSoonOpen} onOpenChange={setComingSoonOpen} />
    </section>
  );
}
