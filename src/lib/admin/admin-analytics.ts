import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type AdminUserSort = "active_7d" | "active_30d" | "recently_active" | "newest" | "oldest";

export type AdminDashboardSummary = {
  totalUsers: number;
  newUsersToday: number;
  newUsers7d: number;
  newUsers30d: number;
  dau: number;
  wau: number;
  mau: number;
  userChatsToday: number;
  userChats7d: number;
  savedTripsToday: number;
  savedTrips7d: number;
  savedPlaces7d: number;
  freeUsers: number;
  plusUsers: number;
  committedCreditsToday: number;
  committedCredits7d: number;
  committedCredits30d: number;
};

export type AdminActiveUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
  actions7d: number;
  actions30d: number;
  chatCount: number;
  tripCount: number;
  savedPlaceCount: number;
  plan: "free" | "plus";
};

export type PopularDestination = {
  destination: string;
  tripCount: number;
  uniqueUsers: number;
  lastSavedAt: string;
};

export type CreditFeatureUsage = {
  featureType: string;
  credits: number;
};

export type AdminDashboardData = {
  observedAt: string;
  summary: AdminDashboardSummary;
  users: AdminActiveUser[];
  usersTotal: number;
  topUsers: AdminActiveUser[];
  popularDestinations: PopularDestination[];
  creditBreakdown30d: CreditFeatureUsage[];
};

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseUser(value: unknown): AdminActiveUser | null {
  const row = objectValue(value);
  const userId = stringValue(row.user_id);
  const createdAt = stringValue(row.created_at);
  if (!userId || !createdAt) return null;
  return {
    userId,
    displayName: stringValue(row.display_name),
    email: stringValue(row.email),
    createdAt,
    lastSignInAt: stringValue(row.last_sign_in_at),
    lastActiveAt: stringValue(row.last_active_at),
    actions7d: numberValue(row.actions_7d),
    actions30d: numberValue(row.actions_30d),
    chatCount: numberValue(row.chat_count),
    tripCount: numberValue(row.trip_count),
    savedPlaceCount: numberValue(row.saved_place_count),
    plan: row.plan === "plus" ? "plus" : "free",
  };
}

function parseUsers(value: unknown): AdminActiveUser[] {
  return Array.isArray(value)
    ? value.map(parseUser).filter((row): row is AdminActiveUser => row !== null)
    : [];
}

function parseSummary(value: unknown): AdminDashboardSummary {
  const row = objectValue(value);
  return {
    totalUsers: numberValue(row.totalUsers),
    newUsersToday: numberValue(row.newUsersToday),
    newUsers7d: numberValue(row.newUsers7d),
    newUsers30d: numberValue(row.newUsers30d),
    dau: numberValue(row.dau),
    wau: numberValue(row.wau),
    mau: numberValue(row.mau),
    userChatsToday: numberValue(row.userChatsToday),
    userChats7d: numberValue(row.userChats7d),
    savedTripsToday: numberValue(row.savedTripsToday),
    savedTrips7d: numberValue(row.savedTrips7d),
    savedPlaces7d: numberValue(row.savedPlaces7d),
    freeUsers: numberValue(row.freeUsers),
    plusUsers: numberValue(row.plusUsers),
    committedCreditsToday: numberValue(row.committedCreditsToday),
    committedCredits7d: numberValue(row.committedCredits7d),
    committedCredits30d: numberValue(row.committedCredits30d),
  };
}

export function aggregatePopularDestinations(value: unknown): PopularDestination[] {
  if (!Array.isArray(value)) return [];
  const merged = new Map<
    string,
    { tripCount: number; userIds: Set<string>; lastSavedAt: string }
  >();
  for (const item of value) {
    const row = objectValue(item);
    const rawDestination = stringValue(row.destination);
    const lastSavedAt = stringValue(row.last_saved_at);
    if (!rawDestination || !lastSavedAt) continue;
    const destination = normalizeDestinationLabel(rawDestination);
    if (!destination) continue;
    const existing = merged.get(destination);
    const userIds = existing?.userIds ?? new Set<string>();
    if (Array.isArray(row.user_ids)) {
      for (const userId of row.user_ids) {
        const parsed = stringValue(userId);
        if (parsed) userIds.add(parsed);
      }
    }
    const next = {
      tripCount: (existing?.tripCount ?? 0) + numberValue(row.trip_count),
      userIds,
      lastSavedAt:
        !existing || lastSavedAt > existing.lastSavedAt ? lastSavedAt : existing.lastSavedAt,
    };
    merged.set(destination, next);
  }
  return [...merged.entries()]
    .map(
      ([destination, row]): PopularDestination => ({
        destination,
        tripCount: row.tripCount,
        uniqueUsers: row.userIds.size,
        lastSavedAt: row.lastSavedAt,
      }),
    )
    .sort((a, b) => b.tripCount - a.tripCount || b.lastSavedAt.localeCompare(a.lastSavedAt))
    .slice(0, 20);
}

export function normalizeAdminDashboardData(value: unknown): AdminDashboardData | null {
  const root = objectValue(value);
  const observedAt = stringValue(root.observedAt);
  if (!observedAt || !root.summary) return null;
  const creditBreakdown30d = Array.isArray(root.creditBreakdown30d)
    ? root.creditBreakdown30d.flatMap((item): CreditFeatureUsage[] => {
        const row = objectValue(item);
        const featureType = stringValue(row.feature_type);
        return featureType ? [{ featureType, credits: numberValue(row.credits) }] : [];
      })
    : [];
  return {
    observedAt,
    summary: parseSummary(root.summary),
    users: parseUsers(root.users),
    usersTotal: numberValue(root.usersTotal),
    topUsers: parseUsers(root.topUsers),
    popularDestinations: aggregatePopularDestinations(root.rawDestinations),
    creditBreakdown30d,
  };
}
