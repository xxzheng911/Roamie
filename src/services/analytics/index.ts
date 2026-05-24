import { createAnalyticsAdapters } from "./adapters";
import type { AnalyticsEventName } from "@/constants/analytics-events";
import type { AnalyticsProperties, AnalyticsService } from "./types";

let service: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (service) return service;

  const adapters = createAnalyticsAdapters();

  service = {
    async init() {
      await Promise.all(adapters.map((a) => a.init()));
    },
    track(event: AnalyticsEventName, properties?: AnalyticsProperties) {
      for (const a of adapters) a.track(event, properties);
    },
    identify(userId: string, traits?: AnalyticsProperties) {
      for (const a of adapters) a.identify(userId, traits);
    },
    reset() {
      for (const a of adapters) a.reset();
    },
  };

  return service;
}

export function trackEvent(event: AnalyticsEventName, properties?: AnalyticsProperties): void {
  if (typeof window === "undefined") return;
  getAnalyticsService().track(event, properties);
}
