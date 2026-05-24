import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { requireIntroRouteAccess } from "@/lib/require-auth";
import { markOnboardingSeen } from "@/lib/app-onboarding-storage";
import { markBootstrapSplashShown } from "@/lib/bootstrap-splash";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";
import traveler from "@/assets/roamie-traveler.jpg";

export const Route = createFileRoute("/intro")({
  beforeLoad: async () => {
    await requireIntroRouteAccess();
  },
  component: IntroOnboarding,
});

const SLIDES = [
  {
    title: "讓旅程，少想一點",
    body: "Roamie 會根據你的心情、偏好與所在位置，陪你找到剛剛好的去處。",
    art: "peach" as const,
  },
  {
    title: "不是排行，是適合你",
    body: "我們不只推薦熱門景點，而是理解你這趟旅行想要的節奏。",
    art: "blue" as const,
  },
  {
    title: "準備好開始漫遊了嗎？",
    body: "完成簡單偏好設定後，Roamie 會為你推薦更貼近你的地點與行程。",
    art: "blend" as const,
  },
] as const;

function IntroOnboarding() {
  const navigate = useNavigate();
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const isLast = index === SLIDES.length - 1;

  const onSelect = useCallback(() => {
    if (!api) return;
    setIndex(api.selectedScrollSnap());
  }, [api]);

  useEffect(() => {
    if (!api) return;
    onSelect();
    api.on("select", onSelect);
    api.on("reInit", onSelect);
    return () => {
      api.off("select", onSelect);
      api.off("reInit", onSelect);
    };
  }, [api, onSelect]);

  useEffect(() => {
    trackEvent(AnalyticsEvents.ONBOARDING_STARTED, { flow: "app_intro" });
  }, []);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      markOnboardingSeen();
      markBootstrapSplashShown();
      trackEvent(AnalyticsEvents.ONBOARDING_COMPLETED, { flow: "app_intro" });
      const next = await resolveStartupPath();
      navigate({ to: next, replace: true });
    } catch (e) {
      console.error("[intro] finish failed", e);
      setFinishing(false);
    }
  };

  const onPrimary = () => {
    if (finishing) return;
    if (!isLast) {
      api?.scrollNext();
      return;
    }
    void finish();
  };

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col bg-cream px-6 pb-[max(2rem,var(--safe-area-bottom))] pt-[max(1.25rem,var(--safe-area-top))]">
        <div className="flex justify-center gap-2 pb-4">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 頁`}
              onClick={() => api?.scrollTo(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === index ? "w-6 bg-clay" : "w-2 bg-border"
              }`}
            />
          ))}
        </div>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: false, dragFree: false }}
          className="min-h-0 flex-1"
        >
          <CarouselContent className="-ml-0 h-full">
            {SLIDES.map((slide, i) => (
              <CarouselItem key={slide.title} className="basis-full pl-0">
                <div className="flex h-full min-h-[min(62vh,28rem)] flex-col justify-center px-1">
                  <IntroArt variant={slide.art} showMascot={i === 0 || i === 2} />
                  <h1 className="mt-8 font-display text-[26px] leading-snug text-balance text-foreground">
                    {slide.title}
                  </h1>
                  <p className="mt-4 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
                    {slide.body}
                  </p>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        <div className="pt-6">
          <button
            type="button"
            onClick={onPrimary}
            disabled={finishing}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-4 text-[15px] font-medium text-background shadow-lift transition active:scale-[0.99] disabled:opacity-50"
          >
            {finishing ? "準備中…" : isLast ? "開始使用" : "下一步"}
            {!finishing && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </MobileFrame>
  );
}

function IntroArt({
  variant,
  showMascot,
}: {
  variant: "peach" | "blue" | "blend";
  showMascot?: boolean;
}) {
  const gradient =
    variant === "peach"
      ? "from-[#fde8d4]/90 via-[#fdf5ea] to-[#e8eef5]/80"
      : variant === "blue"
        ? "from-[#e8eef5]/90 via-[#fdf5ea] to-[#fde8d4]/70"
        : "from-[#fde8d4]/80 via-[#f7f4ef] to-[#dfe8f0]/85";

  return (
    <div
      className={`relative mx-auto flex h-52 w-full max-w-[280px] items-center justify-center overflow-hidden rounded-[2rem] border border-border/60 bg-gradient-to-br shadow-soft ${gradient}`}
    >
      <span
        className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-clay/20 blur-2xl"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-8 -left-4 h-32 w-32 rounded-full bg-[#c5d4e3]/35 blur-2xl"
        aria-hidden
      />
      {showMascot ? (
        <div className="relative z-10 h-28 w-28 overflow-hidden rounded-[1.35rem] border-2 border-card/80 shadow-soft">
          <img src={traveler} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="relative z-10 flex flex-col items-center gap-2 px-6 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-card/90 text-2xl shadow-soft">
            ✦
          </span>
          <p className="text-xs tracking-wide text-muted-foreground">為你而選</p>
        </div>
      )}
    </div>
  );
}
