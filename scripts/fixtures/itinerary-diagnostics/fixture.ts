export {recordAnalyticsEventServer} from "@/lib/analytics/record.server";
import { Route } from "@/routes/api/generate-itinerary";
import { createMemoryAbuseGuard } from "@/lib/abuse-guard-memory";
import { runWithWorkerRequest, runWithGuardTestContext } from "@/lib/worker-request-scope";
import { createClient } from "@supabase/supabase-js";
import { installWorkerRequestStorage } from "@/lib/worker-request-als.server";
import {
  safeGenerationException,
  startGenerationDiagnostics,
  setGenerationPhase,
  captureGenerationException,
  correlateGeneration,
} from "@/lib/itinerary-diagnostics.server";
export {
  safeGenerationException,
  startGenerationDiagnostics,
  setGenerationPhase,
  captureGenerationException,
  correlateGeneration,
  runWithWorkerRequest,
};
installWorkerRequestStorage();
export async function run(config = {}) {
  const R = (globalThis.R = {
    request: null,
    supabase: null,
    exceptions: [],
    calls: [],
    logs: [],
    aiFixtureCalls: 0,
    handlerEntered: false,
    ledger: "none",
    points: [],
    pointAttempts: 0,
    events: [],
    caught: [],
    analytics: [],
  });
  R.config = config;
  R.primary = new TypeError("plannerStep is not a function");
  const originalConsole = { ...console };
  for (const method of ["info", "warn", "error", "debug", "log"])
    console[method] = (...args) =>
      R.logs.push({
        method,
        args: args.map((x) =>
          x instanceof Error ? { name: x.name, message: x.message, stack: x.stack } : x,
        ),
      });
  const names = [
    "大阪城天守閣",
    "花博記念公園鶴見綠地",
    "大阪歷史博物館",
    "大阪造幣博物館",
    "中之島公園",
    "大阪市中央公會堂",
    "大阪市立科學館",
    "國立國際美術館",
    "梅田藍天大廈",
    "難波公園",
    "大阪生活今昔館",
    "大阪天滿宮",
    "天神橋筋商店街",
    "天王寺公園",
    "大阪市立美術館",
    "四天王寺",
    "新世界商店街",
    "通天閣",
    "阿倍野展望台",
    "慶澤園",
    "難波八阪神社",
    "道頓堀",
    "心齋橋筋商店街",
    "法善寺",
    "黑門市場",
    "日本橋商店街",
    "住吉大社",
    "長居植物園",
    "大阪海遊館",
    "天保山公園",
  ];
  for (const [i, n] of [
    [3, "北浜食堂"],
    [9, "梅田和食店"],
    [15, "天王寺食堂"],
    [21, "道頓堀餐廳"],
    [27, "長居咖啡餐廳"],
  ])
    names[i] = n;
  const selected = names.map((name, i) => ({
    name,
    placeName: name,
    googlePlaceId: "ChIJ_OFFLINE_OSAKA_" + String(i).padStart(8, "0"),
    lat: 34.68 + Math.floor(i / 6) * 0.006 + (i % 6) * 0.0006,
    lng: 135.5 + Math.floor(i / 6) * 0.005 + (i % 6) * 0.0007,
    address: "日本大阪府大阪市中央區",
    type: ["景點", "文化", "購物", "美食", "景點", "文化"][i % 6],
    primaryType: [
      "tourist_attraction",
      "museum",
      "shopping_mall",
      "restaurant",
      "park",
      "art_gallery",
    ][i % 6],
    types: [
      ["tourist_attraction", "museum", "shopping_mall", "restaurant", "park", "art_gallery"][i % 6],
    ],
    description: "大阪市內參觀地點",
    estimatedTime: "30 分鐘",
    reason: "使用者已選",
    sourceCombinationId: Math.floor(i / 6) + 1,
    matchedSelectedCombinationIds: [Math.floor(i / 6) + 1],
    isRequiredBySelection: true,
  }));
  const input = {
    preferences: { pace: "active" },
    destination: "大阪",
    days: 5,
    budget: "medium",
    style: "balanced",
    startDate: "2026-10-10",
    endDate: "2026-10-14",
    transport: "大眾運輸",
    selectedPlaces: config.count ? selected.slice(0, config.count) : selected,
    selectedCombinationIds: config.noCombos ? [] : [1, 2, 3, 4, 5],
    location: { lat: 34.68, lng: 135.5 },
    generationId: "e203d450-234c-4cd1-9118-1c270974e20f",
    ...(config.selectedOnly ? { placeAuthority: "selected_only" } : {}),
  };
  if (config.invalidInput) input.destination = null;
  R.aiPayload = {
    version: 2,
    title: "大阪五天",
    summary: "大阪行程",
    moodTag: "",
    recommendations: selected,
    itinerary: selected.map((p, i) => ({
      ...p,
      title: p.name,
      date: "2026-10-" + (10 + Math.floor(i / 6)),
      time: String(9 + (i % 6) * 2).padStart(2, "0") + ":00",
      dayIndex: Math.floor(i / 6),
    })),
  };
  let external = 0;
  globalThis.fetch = async (url, init = {}) => {
    const req = url instanceof Request ? url : new Request(url, init);
    const u = new URL(req.url);
    const body = await req.clone().text();
    let category = "other";
    if (u.hostname.includes("supabase")) category = "supabase";
    else if (u.hostname.includes("openai")) category = "openai";
    else if (u.hostname.includes("routes.googleapis")) category = "routes";
    else if (u.pathname.includes("/directions/")) category = "directions";
    else if (u.pathname.includes("geocode")) category = "geocoding";
    else if (u.hostname.includes("places"))
      category = u.pathname.includes("/v1/places/") ? "details" : "places";
    else if (u.hostname.includes("weather")) category = "weather";
    const call = { category, path: u.pathname, n: ++external };
    R.calls.push(call);
    R.events.push(u.pathname);
    if (config.ceiling && external > config.ceiling) {
      const e = new Error("Too many subrequests.");
      R.exceptions.push({
        injected: true,
        name: e.name,
        message: e.message,
        stack: e.stack,
        n: external,
      });
      throw e;
    }
    const respond = (v, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (category === "supabase") {
      if (u.pathname.endsWith("resolve_user_plus_entitlement"))
        return respond({ has_plus: !!config.plus });
      if (u.pathname.endsWith("credits_reserve")) {
        if (JSON.parse(body).p_amount !== 7) throw new Error("wrong credit price");
        R.ledger = "reserved";
        return respond({
          ok: true,
          idempotent: false,
          ledger_id: "00000000-0000-4000-8000-000000000001",
        });
      }
      if (u.pathname.endsWith("credits_commit")) {
        if (config.commitRejected) return respond({ ok: false, reason: "already_rolled_back" });
        if (config.commitFailure)
          return respond(
            {
              code: "XX000",
              message:
                "commit token=secret-token prompt=private-trip email=traveler@example.invalid",
            },
            500,
          );
        R.ledger = "committed";
        return respond({ ok: true });
      }
      if (u.pathname.endsWith("credits_rollback")) {
        if (config.rollbackThrow) throw new Error("Too many subrequests.");
        if (config.rollbackFailure)
          return respond({ code: "XX000", message: "fixture rollback unavailable" }, 500);
        R.ledger = "rolled_back";
        return respond({ ok: true });
      }
      if (u.pathname.endsWith("analytics_events")) {
        R.analytics.push(JSON.parse(body));
        return respond({}, 201);
      }
      throw new Error("UNMOCKED_SUPABASE:" + u.pathname);
    }
    if (category === "routes")
      return respond({
        routes: [
          {
            duration: "600s",
            distanceMeters: 1000,
            legs: [{ duration: "600s", distanceMeters: 1000 }],
            polyline: { encodedPolyline: "abc" },
          },
        ],
      });
    if (category === "directions")
      return respond({
        status: "OK",
        routes: [
          {
            legs: [
              { duration: { value: 600, text: "10 min" }, distance: { value: 1000, text: "1 km" } },
            ],
            overview_polyline: { points: "abc" },
          },
        ],
      });
    if (category === "openai")
      return respond({ choices: [{ message: { content: JSON.stringify({ dailyOutfits: [] }) } }] });
    if (category === "weather") return respond({});
    throw new Error("UNMOCKED_NETWORK:" + category + ":" + u.hostname + u.pathname);
  };
  R.supabase = createClient("https://offline.supabase.invalid", "offline-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: globalThis.fetch },
  });
  const rpc = R.supabase.rpc.bind(R.supabase);
  R.supabase.rpc = (name, args) => {
    if (name === "credits_rollback" && config.rollbackReject)
      throw new Error("Too many subrequests.");
    return rpc(name, args);
  };
  const memory = createMemoryAbuseGuard();
  const key = "AIza" + "x".repeat(35);
  const env = {
    ABUSE_GUARD_ENFORCEMENT: "true",
    GOOGLE_GLOBAL_DAILY_UNITS: "100000",
    GOOGLE_PLACES_SERVER_API_KEY: key,
    GOOGLE_ROUTES_SERVER_API_KEY: key,
    GOOGLE_GEOCODING_SERVER_API_KEY: key,
    WORKER_VERSION_METADATA: { id: "afc47401-4aa3-440b-8b51-0e07e77dcfc4" },
    ABUSE_GUARD_ANALYTICS: {
      writeDataPoint(point) {
        R.pointAttempts++;
        if (config.sinkFailure || (config.aeLimit && R.pointAttempts > config.aeLimit))
          throw new Error("sink unavailable");
        R.points.push(point);
        R.events.push(point.blobs[0]);
      },
    },
    GOOGLE_API_RATE_LIMITER: {
      async limit() {
        R.calls.push({ category: "rate_limiter" });
        return { success: true };
      },
    },
    ABUSE_GUARD: {
      idFromName: (n) => n,
      get(n) {
        const stub = memory.namespace.get(n);
        return {
          async fetch(req) {
            R.calls.push({ category: "guard_do", bucket: n.split(":")[0] });
            return stub.fetch(req);
          },
        };
      },
    },
  };
  R.request = new Request("https://roamie.tw/api/generate-itinerary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Roamie-Request-Id": input.generationId,
      Origin: "capacitor://localhost",
    },
    body: JSON.stringify(input),
  });
  let result;
  try {
    const res = await runWithWorkerRequest({ env, request: R.request }, () =>
      runWithGuardTestContext({ userId: "fixture-user", ip: "203.0.113.1" }, () =>
        Route.server.handlers.POST({ request: R.request }),
      ),
    );
    result = { status: res.status, body: await res.json() };
  } catch (e) {
    result = { uncaught: { name: e.name, message: e.message, stack: e.stack } };
  }
  const counts = {};
  for (const c of R.calls) counts[c.category] = (counts[c.category] || 0) + 1;
  Object.assign(console, originalConsole);
  return {
    result,
    counts,
    ...R,
    diagnostics: R.points
      .filter((p) => p.blobs[0] === "itinerary_diagnostic_v1")
      .map((p) => JSON.parse(p.blobs[8])),
  };
}
