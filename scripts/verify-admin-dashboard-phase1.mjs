import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregatePopularDestinations,
  normalizeAdminDashboardData,
} from "../src/lib/admin/admin-analytics.ts";
import {
  AdminAuthError,
  isAdminUser,
  readAdminUserIds,
  requireAdminFromRequest,
  requireAdminUserId,
} from "../src/lib/admin/admin-auth.server.ts";

const migrationPath = new URL(
  "../supabase/migrations/20260816090000_admin_dashboard_phase1.sql",
  import.meta.url,
);
const routePath = new URL("../src/routes/admin.tsx", import.meta.url);
const migration = await readFile(migrationPath, "utf8");
const route = await readFile(routePath, "utf8");

assert.match(migration, /FROM public\.chat_messages\s+WHERE role = 'user'/);
assert.match(migration, /COUNT\(DISTINCT user_id\).*24 hours/s);
assert.match(migration, /COUNT\(DISTINCT user_id\).*7 days/s);
assert.match(migration, /COUNT\(DISTINCT user_id\).*30 days/s);
assert.match(migration, /SELECT user_id, created_at, 'trip'::text[\s\S]+FROM public\.saved_trips/);
assert.match(
  migration,
  /SELECT user_id, created_at, 'saved_place'::text[\s\S]+FROM public\.saved_places/,
);
assert.match(migration, /COUNT\(DISTINCT id\).*public\.saved_trips/s);
assert.match(migration, /p\.plan_tier = 'plus'.*subscription_status IN \('active', 'trialing'\)/s);
assert.match(migration, /status = 'committed'/);
assert.match(migration, /environment = 'production'/);
assert.match(migration, /LIMIT \(SELECT page_size FROM params\)/);
assert.match(migration, /LEAST\(50,/);
assert.match(migration, /REVOKE ALL.*authenticated/);
assert.match(migration, /GRANT EXECUTE.*service_role/);

const priorAdminIds = process.env.ROAMIE_ADMIN_USER_IDS;
process.env.ROAMIE_ADMIN_USER_IDS =
  "5A8B8749-91CF-4C7C-8F95-0E0DF67A9B86,invalid,17b3a3f1-2c93-4d2d-a139-5f31f85865fe";
assert.equal(readAdminUserIds().size, 2);
assert.equal(isAdminUser("5a8b8749-91cf-4c7c-8f95-0e0df67a9b86"), true);
assert.equal(isAdminUser("a0c018a4-9dad-46b7-8dd6-f58b2aaed001"), false);
assert.doesNotThrow(() => requireAdminUserId("5a8b8749-91cf-4c7c-8f95-0e0df67a9b86"));
assert.throws(
  () => requireAdminUserId("a0c018a4-9dad-46b7-8dd6-f58b2aaed001"),
  (error) => error instanceof AdminAuthError && error.status === 403,
);
await assert.rejects(
  () => requireAdminFromRequest(new Request("https://roamie.example/api/admin/dashboard")),
  (error) => error instanceof AdminAuthError && error.status === 401,
);
if (priorAdminIds === undefined) delete process.env.ROAMIE_ADMIN_USER_IDS;
else process.env.ROAMIE_ADMIN_USER_IDS = priorAdminIds;

const rawDashboard = {
  observedAt: "2026-08-16T00:00:00.000Z",
  summary: {
    totalUsers: 3,
    newUsersToday: 1,
    newUsers7d: 2,
    newUsers30d: 3,
    dau: 1,
    wau: 2,
    mau: 3,
    userChatsToday: 4,
    userChats7d: 8,
    savedTripsToday: 1,
    savedTrips7d: 2,
    savedPlaces7d: 3,
    freeUsers: 2,
    plusUsers: 1,
    committedCreditsToday: 1,
    committedCredits7d: 8,
    committedCredits30d: 10,
  },
  users: [
    {
      user_id: "5a8b8749-91cf-4c7c-8f95-0e0df67a9b86",
      display_name: null,
      email: "relay@example.com",
      created_at: "2026-08-01T00:00:00.000Z",
      last_sign_in_at: null,
      last_active_at: "2026-08-15T00:00:00.000Z",
      actions_7d: 3,
      actions_30d: 5,
      chat_count: 2,
      trip_count: 1,
      saved_place_count: 2,
      plan: "free",
    },
  ],
  usersTotal: 1,
  topUsers: [],
  rawDestinations: [
    {
      destination: "Tainan City",
      trip_count: 2,
      unique_users: 2,
      user_ids: ["u1", "u2"],
      last_saved_at: "2026-08-15T00:00:00.000Z",
    },
    {
      destination: "台南",
      trip_count: 1,
      unique_users: 1,
      user_ids: ["u2"],
      last_saved_at: "2026-08-16T00:00:00.000Z",
    },
  ],
  creditBreakdown30d: [{ feature_type: "ITINERARY_GENERATION", credits: 7 }],
};

const normalized = normalizeAdminDashboardData(rawDashboard);
assert.ok(normalized);
assert.equal(normalized.users[0]?.displayName, null);
assert.equal(normalized.summary.dau, 1);
assert.equal(normalized.creditBreakdown30d[0]?.credits, 7);

const destinations = aggregatePopularDestinations(rawDashboard.rawDestinations);
assert.equal(destinations.length, 1);
assert.equal(destinations[0]?.destination, "台南");
assert.equal(destinations[0]?.tripCount, 3);
assert.equal(destinations[0]?.uniqueUsers, 2, "canonical aliases must dedupe users");

assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(route, /ROAMIE_ADMIN_USER_IDS/);
assert.match(route, /Roamie 營運後台/);
assert.match(route, /管理後台/);
assert.match(route, /總使用者/);
assert.match(route, /日活躍使用者/);
assert.match(route, /活躍使用者/);
assert.match(route, /顯示名稱 \/ Email/);
assert.match(route, /近 7 日最活躍/);
assert.match(route, /未命名使用者/);
assert.match(route, /尚未提供 · 尚無可靠資料來源/);
assert.match(route, /僅包含 Free \/ 有 Credits 紀錄的使用量/);
assert.match(route, /Intl\.DateTimeFormat\("zh-TW"/);
assert.doesNotMatch(route, /Intl\.DateTimeFormat\("en"/);
assert.match(route, /AdminDashboardData/);
assert.match(route, /body\.dashboard/);

console.info("[verify-admin-dashboard] all checks passed");
