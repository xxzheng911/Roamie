import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnalyticsEvents } from "@/constants/analytics-events";
import type { AnalyticsEventName } from "@/constants/analytics-events";
import { getAnalyticsService } from "@/services/analytics";
import type { AnalyticsProperties } from "@/services/analytics/types";

type AnalyticsCtx = {
  track: (event: AnalyticsEventName, properties?: AnalyticsProperties) => void;
  identify: (userId: string, traits?: AnalyticsProperties) => void;
  reset: () => void;
};

const Ctx = createContext<AnalyticsCtx | null>(null);

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const run = () => {
      void getAnalyticsService().init();
      getAnalyticsService().track(AnalyticsEvents.APP_OPEN);
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 8_000 });
    } else {
      window.setTimeout(run, 250);
    }
  }, []);

  const track = useCallback((event: AnalyticsEventName, properties?: AnalyticsProperties) => {
    getAnalyticsService().track(event, properties);
  }, []);

  const identify = useCallback((userId: string, traits?: AnalyticsProperties) => {
    getAnalyticsService().identify(userId, traits);
  }, []);

  const reset = useCallback(() => {
    getAnalyticsService().reset();
  }, []);

  const value = useMemo(() => ({ track, identify, reset }), [track, identify, reset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalytics() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAnalytics must be used within AnalyticsProvider");
  return ctx;
}
