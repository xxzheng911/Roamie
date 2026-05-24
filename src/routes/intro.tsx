import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import {
  IntroBrandCharacter,
  IntroFinalBrand,
  IntroSlideBackdrop,
  type IntroSlideScene,
} from "@/components/onboarding/IntroOnboardingVisuals";
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

export const Route = createFileRoute("/intro")({
  beforeLoad: async () => {
    await requireIntroRouteAccess();
  },
  component: IntroOnboarding,
});

type IntroSlide = {
  scene: IntroSlideScene;
  title: string;
  body: string;
  finale?: boolean;
};

const SLIDES: IntroSlide[] = [
  {
    scene: "welcome",
    title: "準備好開始漫遊了嗎？",
    body: "Roamie 陪你用更輕鬆的方式，找到屬於此刻的去處。",
  },
  {
    scene: "journey",
    title: "讓旅程，少想一點",
    body: "根據心情、位置與偏好，為你推薦剛剛好的路線與地點。",
  },
  {
    scene: "personal",
    title: "不是排行，是適合你",
    body: "我們理解你這趟旅行想要的節奏，而不是只列出熱門清單。",
  },
  {
    scene: "start",
    title: "開始你的 Roamie",
    body: "",
    finale: true,
  },
];

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
      <div className="intro-onboard">
        <div className="intro-onboard__indicators">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 頁`}
              aria-current={i === index ? "step" : undefined}
              onClick={() => api?.scrollTo(i)}
              className={`intro-onboard__dot ${i === index ? "intro-onboard__dot--active" : ""}`}
            />
          ))}
        </div>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: false, dragFree: false }}
          className="intro-onboard__carousel"
        >
          <CarouselContent className="intro-onboard__carousel-content">
            {SLIDES.map((slide, i) => (
              <CarouselItem key={slide.scene} className="intro-onboard__carousel-item">
                <IntroSlidePanel slide={slide} active={index === i} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        <div className="intro-onboard__footer">
          <button
            type="button"
            onClick={onPrimary}
            disabled={finishing}
            className="intro-onboard__cta"
          >
            <span className="intro-onboard__cta-label">
              {finishing ? "準備中…" : isLast ? "開始使用" : "下一步"}
            </span>
            {!finishing && <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />}
          </button>
        </div>
      </div>
    </MobileFrame>
  );
}

function IntroSlidePanel({ slide, active }: { slide: IntroSlide; active: boolean }) {
  return (
    <div className={`intro-onboard__panel ${active ? "intro-onboard__panel--active" : ""}`}>
      <IntroSlideBackdrop scene={slide.scene} />

      <div className="intro-onboard__hero">
        <IntroBrandCharacter scene={slide.scene} active={active} />
      </div>

      <div className="intro-onboard__copy">
        {slide.finale ? (
          <>
            <h1 className="intro-onboard__title intro-onboard__title--finale">{slide.title}</h1>
            <IntroFinalBrand />
          </>
        ) : (
          <>
            <h1 className="intro-onboard__title">{slide.title}</h1>
            <p className="intro-onboard__body">{slide.body}</p>
          </>
        )}
      </div>
    </div>
  );
}
