import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { HeartHandshake, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlusComingSoonDialog } from "@/components/PlusComingSoonDialog";
import { useAccess } from "@/hooks/use-access";
import { usePlusUpgrade } from "@/hooks/use-plus-upgrade";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import { buildHomePlusInsight } from "@/lib/home-personalization-insight";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { openSubscriptionManagement } from "@/lib/open-subscription-settings";
import { preparePlusHomeChatSession } from "@/lib/plus-chat-handoff";
import { loadChatSession, saveChatSession } from "@/lib/chat-session";
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
  className?: string;
};

export function HomePersonalizationCard({
  prefs,
  savedPlaces,
  weather,
  nearbyPicks = [],
  selectedMood,
  latestTripTitle,
  className,
}: Props) {
  const navigate = useNavigate();
  const {
    hasPlusAccess,
    devPlusMode,
    devSubscriptionMode,
    testModeOverride,
    disablePlusTestMode,
  } = useAccess();
  const { upgradeToPlus, comingSoonOpen, setComingSoonOpen, canInstantUpgrade } = usePlusUpgrade();

  const [manageSubOpen, setManageSubOpen] = useState(false);
  const [accessTick, setAccessTick] = useState(0);

  const isDevSubscriptionMode = canInstantUpgrade || devPlusMode || testModeOverride !== "none";

  useEffect(() => {
    const onAccess = () => setAccessTick((n) => n + 1);
    window.addEventListener(ACCESS_CHANGED_EVENT, onAccess);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, onAccess);
  }, []);

  const chatSession = useMemo(
    () => loadChatSession(),
    [accessTick, savedPlaces.length, selectedMood, latestTripTitle, prefs?.vibe, prefs?.pace],
  );

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
      }),
    [savedPlaces, prefs, selectedMood, weather, nearbyPicks, latestTripTitle, chatSession],
  );

  const handleUpgradePlus = () => {
    upgradeToPlus();
  };

  const handleDismissUpgrade = () => {
    toast.message("沒問題，你隨時可以再升級 Plus");
  };

  const handleStartPlusJourney = () => {
    const session = preparePlusHomeChatSession({
      mood: selectedMood,
      prefs: prefs ?? undefined,
      insightInput: {
        savedPlaces,
        prefs,
        selectedMood,
        weather,
        nearbyPicks,
        latestTripTitle,
        chatSession: loadChatSession(),
      },
    });
    saveChatSession(session);
    navigate({
      to: "/chat",
      search: {
        from: "plus-home",
        mood: selectedMood ?? undefined,
      },
    });
  };

  const handleReturnFreeDev = () => {
    disablePlusTestMode();
    toast.message("已切換回 Free 模式（收藏、偏好與行程仍保留）");
  };

  const handleReturnFreeProd = () => {
    if (isDevSubscriptionMode) {
      console.info("[SUBSCRIPTION_MODAL] skipped_in_dev");
      handleReturnFreeDev();
      return;
    }
    setManageSubOpen(true);
  };

  const handleOpenSubscriptionManagement = async () => {
    if (isDevSubscriptionMode) {
      console.info("[SUBSCRIPTION_MODAL] skipped_in_dev");
      return;
    }
    const ok = await openSubscriptionManagement();
    if (!ok) {
      toast.message("請至 App Store 或 Google Play 的「訂閱」管理 Roamie Plus");
    }
    setManageSubOpen(false);
  };

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
              {devPlusMode ? (
                <p className="mt-2 text-xs font-medium text-clay">目前為 Plus 開發／測試模式</p>
              ) : null}
              {isDevSubscriptionMode ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  開發訂閱狀態：{devSubscriptionMode === "plus" ? "Plus" : "Free"}
                </p>
              ) : null}
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
                  onClick={isDevSubscriptionMode ? handleReturnFreeDev : handleReturnFreeProd}
                  className="rounded-full border border-border bg-card/80 px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                >
                  返回 Free 模式
                </button>
              </div>
            </div>
          </div>
        </div>

        <AlertDialog open={manageSubOpen} onOpenChange={setManageSubOpen}>
          <AlertDialogContent className="max-w-[min(100%,22rem)] rounded-3xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-lg">管理訂閱</AlertDialogTitle>
              <AlertDialogDescription className="text-left text-sm leading-relaxed">
                若取消訂閱，Plus 功能將於目前方案到期後恢復為 Free 模式。請至 App Store
                或 Google Play 管理 Roamie Plus 訂閱。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
              <AlertDialogAction
                className="w-full rounded-full"
                onClick={() => void handleOpenSubscriptionManagement()}
              >
                前往管理訂閱
              </AlertDialogAction>
              <AlertDialogCancel className="mt-0 w-full rounded-full">關閉</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
