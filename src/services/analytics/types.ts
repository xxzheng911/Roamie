import type { AnalyticsEventName } from "@/constants/analytics-events";

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export type AnalyticsAdapter = {
  id: string;
  init(): Promise<void>;
  track(event: AnalyticsEventName, properties?: AnalyticsProperties): void;
  identify(userId: string, traits?: AnalyticsProperties): void;
  reset(): void;
};

export type AnalyticsService = {
  init(): Promise<void>;
  track(event: AnalyticsEventName, properties?: AnalyticsProperties): void;
  identify(userId: string, traits?: AnalyticsProperties): void;
  reset(): void;
};
