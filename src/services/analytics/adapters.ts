import { clientEnv } from "@/constants/env";
import type { AnalyticsAdapter } from "./types";

/** Dev console adapter — always available */
export const consoleAnalyticsAdapter: AnalyticsAdapter = {
  id: "console",
  async init() {},
  track(event, properties) {
    if (clientEnv.isDev) {
      console.info("[analytics]", event, properties ?? {});
    }
  },
  identify(userId, traits) {
    if (clientEnv.isDev) {
      console.info("[analytics] identify", userId, traits ?? {});
    }
  },
  reset() {},
};

/** No-op for SSR / tests */
export const noopAnalyticsAdapter: AnalyticsAdapter = {
  id: "noop",
  async init() {},
  track() {},
  identify() {},
  reset() {},
};

/** PostHog stub — wire when VITE_POSTHOG_KEY is set */
export const posthogAdapter: AnalyticsAdapter = {
  id: "posthog",
  async init() {
  },
  track(event, properties) {
    console.info("[posthog stub]", event, properties);
  },
  identify(userId, traits) {
    console.info("[posthog stub] identify", userId, traits);
  },
  reset() {},
};

export function createAnalyticsAdapters(): AnalyticsAdapter[] {
  const adapters: AnalyticsAdapter[] = [];
  if (typeof window === "undefined") return [noopAnalyticsAdapter];
  if (clientEnv.posthogKey) adapters.push(posthogAdapter);
  if (clientEnv.isDev) adapters.push(consoleAnalyticsAdapter);
  if (adapters.length === 0) adapters.push(noopAnalyticsAdapter);
  return adapters;
}
