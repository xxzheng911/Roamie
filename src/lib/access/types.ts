/** User-facing subscription tier */
export type SubscriptionState = "free" | "plus";

export type UserRole = "user" | "developer";

/** Developer test override — simulates subscription for QA */
export type TestModeOverride = "none" | "force-free" | "force-plus";

export type AccessSnapshot = {
  /** Stored mock / IAP tier (defaults free) */
  subscriptionState: SubscriptionState;
  userRole: UserRole;
  testModeOverride: TestModeOverride;
  /** Whether Plus personalization features are active */
  hasPlusAccess: boolean;
  /** Same as hasPlusAccess — subscription plus or dev test override */
  isPlusUser: boolean;
  /** TestFlight / 開發：force-plus 測試模式 */
  devPlusMode: boolean;
  /** Supabase profiles：plan_tier=plus 且訂閱有效 */
  subscriptionPlusActive: boolean;
  /** Tier sent to AI prompts */
  effectiveTier: SubscriptionState;
  developerUnlocked: boolean;
  canShowDeveloperTools: boolean;
};
