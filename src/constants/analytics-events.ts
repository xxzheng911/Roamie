/**
 * Central analytics event names — keep stable for dashboards & funnel analysis.
 */
export const AnalyticsEvents = {
  // Onboarding & auth
  ONBOARDING_STARTED: "onboarding_started",
  ONBOARDING_COMPLETED: "onboarding_completed",
  INTRO_COMPLETED: "intro_completed",
  AUTH_SIGN_IN: "auth_sign_in",
  AUTH_SIGN_OUT: "auth_sign_out",

  // AI & planning
  AI_CHAT_SENT: "ai_chat_sent",
  AI_CHAT_RECEIVED: "ai_chat_received",
  AI_ITINERARY_GENERATED: "ai_itinerary_generated",
  AI_PLACE_SELECTED: "ai_place_selected",
  AI_RATE_LIMITED: "ai_rate_limited",

  // Map & discovery
  MAP_SEARCH: "map_search",
  MAP_PLACE_VIEW: "map_place_view",
  MAP_PLACE_SAVE: "map_place_save",
  HOME_NEARBY_CLICK: "home_nearby_click",

  // Subscription
  PAYWALL_VIEW: "paywall_view",
  SUBSCRIPTION_START: "subscription_start",
  SUBSCRIPTION_RESTORE: "subscription_restore",
  SUBSCRIPTION_CANCEL: "subscription_cancel",

  // Affiliate
  AFFILIATE_CLICK: "affiliate_click",
  AFFILIATE_IMPRESSION: "affiliate_impression",

  // Retention
  APP_OPEN: "app_open",
  SESSION_START: "session_start",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];
