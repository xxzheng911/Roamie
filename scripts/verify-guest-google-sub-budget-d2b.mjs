/**
 * D2b — 訪客 Google 子額度（guest sub-budget）與 IPv6 /64 正規化。
 *
 * 任務單 #G1：證明「訪客可以把全站每日 Google 額度用光」。修正前 G1／G3／G4 應 FAIL，
 * 修正後全部 PASS。G2／G5／NET 描述既有行為，修正前後都必須 PASS。
 *
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-guest-google-sub-budget-d2b.mjs
 *
 * 期望值定義（不依賴實作細節）：
 *   - GUEST_SHARE_MAX = 0.15：所有未登入訪客「加總」的 Google 權重用量，
 *     不得超過 GOOGLE_GLOBAL_DAILY_UNITS（正式 100000）的 15%。
 *   - GUEST_SHARE_MIN = 0.14：訪客至少要能用到約 14%（容許整數化／權重粒度），
 *     避免實作把訪客份額做成 0 或遠小於 15% 也算通過。
 *   - 訪客被子額度拒絕時：HTTP 429，JSON body 的 reason 為字串、不同於既有的
 *     user_rate_limited / ip_rate_limited / global_budget_limited / guest_rate_limited，
 *     且包含 "guest"（任務單建議 guest_global_budget_limited）。
 *   - 子額度按「已核准的權重」計算；被拒的請求不得留下任何 IP／global 扣點。
 *   - 子額度以 readGlobalDailyUnits(env) 為基準（GOOGLE_GLOBAL_DAILY_UNITS 可覆寫），
 *     因此小額 GOOGLE_GLOBAL_DAILY_UNITS 情境與正式預設 100000 情境都會驗證。
 *
 * 網路安全：全域 fetch、http(s).request/get、net.connect/createConnection、
 * net.Socket#connect、tls.connect 全部攔截；任何非 mock 的網路請求都會被擋下並使 NET 失敗。
 * 所有 Google upstream 都以注入的 fetcher／photo deps 模擬，並計數。
 */
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

// ---------------------------------------------------------------------------
// NET：在載入任何 source 之前先裝好攔截。
// ---------------------------------------------------------------------------
const unmockedNetwork = [];
function blockNetwork(kind, target) {
  unmockedNetwork.push(`${kind}:${String(target).slice(0, 120)}`);
  throw new TypeError(`NETWORK_BLOCKED ${kind}`);
}
globalThis.fetch = async (input) => blockNetwork("fetch", input?.url ?? input);
for (const [name, mod] of [["http", http], ["https", https]]) {
  mod.request = (...args) => blockNetwork(`${name}.request`, args[0]?.hostname ?? args[0]);
  mod.get = (...args) => blockNetwork(`${name}.get`, args[0]?.hostname ?? args[0]);
}
net.connect = (...args) => blockNetwork("net.connect", args[0]?.host ?? args[0]);
net.createConnection = (...args) => blockNetwork("net.createConnection", args[0]?.host ?? args[0]);
net.Socket.prototype.connect = function (...args) {
  return blockNetwork("net.Socket.connect", args[0]?.host ?? args[0]);
};
tls.connect = (...args) => blockNetwork("tls.connect", args[0]?.host ?? args[0]);

// 攔截自我測試：每一種都必須真的被擋。
{
  const probes = [
    () => globalThis.fetch("https://places.googleapis.com/v1/places:searchText"),
    () => http.request({ hostname: "example.com" }),
    () => https.request({ hostname: "places.googleapis.com" }),
    () => https.get("https://maps.googleapis.com/"),
    () => net.connect({ host: "example.com", port: 443 }),
    () => net.createConnection({ host: "example.com", port: 443 }),
    () => new net.Socket().connect({ host: "example.com", port: 443 }),
    () => tls.connect({ host: "example.com", port: 443 }),
  ];
  for (const probe of probes) {
    let blocked = false;
    try {
      await probe();
    } catch (error) {
      blocked = String(error?.message).startsWith("NETWORK_BLOCKED");
    }
    assert.equal(blocked, true, "NET self-test: interception must block");
  }
  assert.equal(unmockedNetwork.length, probes.length);
  unmockedNetwork.length = 0;
}

// 診斷 log 量很大（上千次請求），結果改用 stdout 直接輸出。
const out = (line) => process.stdout.write(`${line}\n`);
const quiet = () => {};
console.log = quiet;
console.info = quiet;
console.warn = quiet;
console.debug = quiet;

delete process.env.ABUSE_GUARD_ENFORCEMENT;
delete process.env.DISABLE_GOOGLE_PROXY;
delete process.env.GOOGLE_GLOBAL_DAILY_UNITS;

const { createMemoryAbuseGuard } = await import("../src/lib/abuse-guard-memory.ts");
const { utcDay } = await import("../src/lib/abuse-guard-clock.ts");
const policy = await import("../src/lib/abuse-guard-policy.ts");
const { fetchGoogleRestProvider } = await import("../src/lib/google-rest-provider.server.ts");
const { handleGoogleProxy } = await import("../src/lib/google-proxy.server.ts");
const { handlePlacePhotoRequest } = await import("../src/routes/api/place-photo.ts");
const { signPlacePhoto, sealPlacePhotoPrincipal } = await import("../src/lib/place-photo-signature.server.ts");

const {
  GOOGLE_FAMILY_LIMITS,
  GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT,
  GOOGLE_IP_DAILY_WEIGHT,
  GOOGLE_USER_DAILY_WEIGHT,
} = policy;

// 期望值（見檔頭說明）。
const GUEST_SHARE_MAX = 0.15;
const GUEST_SHARE_MIN = 0.14;
const EXISTING_REASONS = new Set([
  "user_rate_limited",
  "ip_rate_limited",
  "global_budget_limited",
  "guest_rate_limited",
]);

const day = utcDay();
const placesKey = "AIza" + "x".repeat(35);
const signingSecret = "photo-signing-secret-at-least-32";
const photo = "places/ChIJ_photo/photos/ref";
const TEXT = {
  url: "https://places.googleapis.com/v1/places:searchText",
  method: "POST",
  body: { textQuery: "Tokyo", pageSize: 1 },
};
const FAMILIES = {
  places_text: TEXT,
  places_nearby: {
    url: "https://places.googleapis.com/v1/places:searchNearby",
    method: "POST",
    body: {
      locationRestriction: { circle: { center: { latitude: 35.6, longitude: 139.7 }, radius: 500 } },
      maxResultCount: 1,
    },
  },
  places_autocomplete: {
    url: "https://places.googleapis.com/v1/places:autocomplete",
    method: "POST",
    body: { input: "Tokyo" },
  },
  places_details: { url: "https://places.googleapis.com/v1/places/ChIJtestplace", method: "GET" },
  routes: {
    url: "https://routes.googleapis.com/directions/v2:computeRoutes",
    method: "POST",
    body: {
      origin: { location: { latLng: { latitude: 35, longitude: 139 } } },
      destination: { location: { latLng: { latitude: 35.1, longitude: 139.1 } } },
      travelMode: "WALK",
    },
  },
  geocoding: { url: "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo", method: "GET" },
  directions: {
    url: "https://maps.googleapis.com/maps/api/directions/json?origin=Tokyo&destination=Osaka",
    method: "GET",
  },
};

// ---------------------------------------------------------------------------
// harness（沿用 verify-guest-google-budget.mjs 的寫法）
// ---------------------------------------------------------------------------
function makeGuard() {
  const guard = createMemoryAbuseGuard();
  const names = [];
  const namespace = {
    idFromName: (name) => guard.namespace.idFromName(name),
    get: (id) => {
      names.push(String(id));
      return guard.namespace.get(id);
    },
  };
  return { guard, namespace, names, counter: (n, k) => guard.counter(n, k) };
}
function limiter(seen = []) {
  return { seen, limit: async ({ key }) => { seen.push(key); return { success: true }; } };
}
function envOf(g, { enforcement = false, globalUnits, seen, extra = {} } = {}) {
  return {
    ABUSE_GUARD: g.namespace,
    GOOGLE_PLACES_SERVER_API_KEY: placesKey,
    GOOGLE_ROUTES_SERVER_API_KEY: placesKey,
    GOOGLE_GEOCODING_SERVER_API_KEY: placesKey,
    GOOGLE_API_RATE_LIMITER: limiter(seen),
    PLACE_PHOTO_SIGNING_SECRET: signingSecret,
    ...(enforcement ? { ABUSE_GUARD_ENFORCEMENT: "1" } : {}),
    ...(globalUnits !== undefined ? { GOOGLE_GLOBAL_DAILY_UNITS: String(globalUnits) } : {}),
    ...extra,
  };
}
const globalWeight = (g) => g.counter("global:google", `global:weight:${day}`);
const ipWeightByName = (g, name) => g.counter(name, `ip:weight:${day}`);
const userWeight = (g, userId) => g.counter(`user:${userId}`, `user:weight:${day}`);

async function seed(g, name, buckets, operationId) {
  const response = await g.guard.namespace.get(name).fetch(
    new Request("https://abuse-guard.internal/", {
      method: "POST",
      body: JSON.stringify({ action: "charge", operationId, buckets }),
    }),
  );
  assert.equal((await response.json()).ok, true, `seed ${operationId}`);
}

async function readBody(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

/** Guest or authenticated call through the real /api/google proxy entry. */
async function proxyCall(env, { ip, userId = null, input = TEXT }) {
  const upstream = { count: 0 };
  const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
  if (userId) headers.authorization = "Bearer fixture-token";
  const response = await handleGoogleProxy(
    new Request("https://roamie.tw/api/google", { method: "POST", headers, body: JSON.stringify(input) }),
    env,
    {
      authenticate: async () => userId,
      provider: (i, e) =>
        fetchGoogleRestProvider(i, e, async () => {
          upstream.count += 1;
          return Response.json({ places: [] });
        }),
    },
  );
  return { response, upstream: upstream.count, body: await readBody(response) };
}

function photoDeps(upstream) {
  return {
    fetch: async () => {
      upstream.count += 1;
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    },
    resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
    recordHttpCall: () => {},
    timeoutMs: 1000,
  };
}
async function photoCall(env, { ip, userId = null }) {
  const upstream = { count: 0 };
  let query;
  if (userId) {
    const principal = await sealPlacePhotoPrincipal(env, userId);
    const token = await signPlacePhoto(env, photo, 480, undefined, "authenticated", principal);
    query = `expires=${token.expires}&signature=${encodeURIComponent(token.signature)}&aud=authenticated&principal=${encodeURIComponent(principal)}`;
  } else {
    const token = await signPlacePhoto(env, photo, 480, undefined, "guest");
    query = `expires=${token.expires}&signature=${encodeURIComponent(token.signature)}&aud=guest`;
  }
  const response = await handlePlacePhotoRequest(
    new Request(`https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&${query}`, {
      headers: { "cf-connecting-ip": ip },
    }),
    photoDeps(upstream),
    env,
  );
  return { response, upstream: upstream.count, body: await readBody(response) };
}

const guestIp = (i) => `198.51.${100 + ((i >> 8) & 3)}.${(i & 255) || 1}`;
const GUEST_IP_POOL = 96;

function assertGuestShareDenial(result, label) {
  assert.equal(result.response.status, 429, `${label}: guest over share must be 429 (got ${result.response.status})`);
  assert.equal(result.upstream, 0, `${label}: denied guest must not reach Google`);
  const reason = result.body?.reason;
  assert.equal(typeof reason, "string", `${label}: denial must carry a reason code, body=${JSON.stringify(result.body)}`);
  assert.ok(!EXISTING_REASONS.has(reason), `${label}: reason "${reason}" is not distinguishable from existing reasons`);
  assert.match(reason, /guest/, `${label}: reason "${reason}" must identify the guest share`);
}

/**
 * 讓訪客（輪替多個 IPv4，每個 IP 都遠低於 IP 每日額度）持續請求，直到第一次被拒或超過安全上限。
 * 回傳已核准的權重總和與第一個拒絕結果。
 */
async function exhaustGuestShare(g, env, globalUnits, { kind = "text", startUnits = 0, startIndex = 0 } = {}) {
  const weight = kind === "photo" ? GOOGLE_FAMILY_LIMITS.place_photos.weight : GOOGLE_FAMILY_LIMITS.places_text.weight;
  const safetyUnits = Math.ceil(globalUnits * 0.5);
  let admitted = startUnits;
  let i = startIndex;
  const usedIps = new Set();
  while (admitted <= safetyUnits) {
    const ip = guestIp(i % GUEST_IP_POOL);
    usedIps.add(ip);
    i += 1;
    const result = kind === "photo" ? await photoCall(env, { ip }) : await proxyCall(env, { ip });
    if (result.response.status === 200) {
      assert.equal(result.upstream, 1, "admitted guest dispatches exactly once");
      admitted += weight;
      continue;
    }
    return { admitted, denial: result, usedIps, nextIndex: i };
  }
  return { admitted, denial: null, usedIps, nextIndex: i };
}

function assertShareBounds(admitted, globalUnits, label) {
  const max = Math.floor(globalUnits * GUEST_SHARE_MAX);
  const min = Math.floor(globalUnits * GUEST_SHARE_MIN);
  assert.ok(
    admitted <= max,
    `${label}: guests consumed ${admitted} units (${((admitted / globalUnits) * 100).toFixed(1)}% of global ${globalUnits}) without a guest-share denial; max allowed ${max} (15%)`,
  );
  assert.ok(admitted >= min, `${label}: guests capped at ${admitted} units, below ~14% (${min}) of global ${globalUnits}`);
}

// ---------------------------------------------------------------------------
// case runner：每個案例獨立回報，不因前一個失敗而中止。
// ---------------------------------------------------------------------------
const results = [];
async function check(id, title, fn) {
  try {
    await fn();
    results.push({ id, ok: true });
    out(`PASS ${id} ${title}`);
  } catch (error) {
    results.push({ id, ok: false });
    out(`FAIL ${id} ${title}\n     ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

// ---------------------------------------------------------------------------
// G1：訪客總用量上限約 15%，之後登入用戶照常
// ---------------------------------------------------------------------------
for (const enforcement of [false, true]) {
  const mode = enforcement ? "enforcement=on" : "enforcement=off";
  await check(`G1a[${mode}]`, "guest aggregate capped at ~15% of GOOGLE_GLOBAL_DAILY_UNITS=2000; free+Plus still pass", async () => {
    const G = 2000;
    const g = makeGuard();
    const env = envOf(g, { enforcement, globalUnits: G });
    const run = await exhaustGuestShare(g, env, G);
    assert.ok(run.denial, `guests consumed ${run.admitted} units (${((run.admitted / G) * 100).toFixed(1)}% of global ${G}) and were never denied`);
    assertShareBounds(run.admitted, G, "G1a");
    assertGuestShareDenial(run.denial, "G1a");
    // 被拒的請求不得留下扣點：global 與各 IP 只記到已核准的權重。
    assert.equal(globalWeight(g), run.admitted, "guest usage still counts toward global; denied requests leave no global charge");
    let ipTotal = 0;
    for (const ip of run.usedIps) ipTotal += ipWeightByName(g, `ip:${ip}`);
    assert.equal(ipTotal, run.admitted, "denied guest request must roll back its IP charge");
    // 全新的訪客 IP 也被拒：份額是所有訪客加總，不是單一 IP。
    assertGuestShareDenial(await proxyCall(env, { ip: "192.0.2.250" }), "G1a fresh guest IP");
    // 登入用戶（free 與 Plus）照常通過，並照常計入 global。
    for (const userId of ["free-user-g1", "plus-user-g1"]) {
      const before = globalWeight(g);
      const authed = await proxyCall(env, { ip: "192.0.2.10", userId });
      assert.equal(authed.response.status, 200, `${userId} must pass after guest share exhausted (got ${authed.response.status} ${JSON.stringify(authed.body)})`);
      assert.equal(authed.upstream, 1);
      assert.equal(globalWeight(g), before + GOOGLE_FAMILY_LIMITS.places_text.weight, `${userId} counts toward global`);
    }
  });

  await check(`G1b[${mode}]`, "guest share is guest-only: authenticated usage (50% of global) does not shrink it", async () => {
    const G = 2000;
    const g = makeGuard();
    const env = envOf(g, { enforcement, globalUnits: G });
    const w = GOOGLE_FAMILY_LIMITS.places_text.weight;
    for (let n = 0; n < G / 2 / w; n += 1) {
      const authed = await proxyCall(env, { ip: "192.0.2.20", userId: n % 2 ? "free-user-g1b" : "plus-user-g1b" });
      assert.equal(authed.response.status, 200, "authenticated warm-up");
    }
    assert.equal(globalWeight(g), G / 2);
    const run = await exhaustGuestShare(g, env, G);
    assert.ok(run.denial, `guests consumed ${run.admitted} units on top of authenticated ${G / 2} and were never denied`);
    assertShareBounds(run.admitted, G, "G1b");
    assertGuestShareDenial(run.denial, "G1b");
  });
}

await check("G1c[prod default]", "GOOGLE_GLOBAL_DAILY_UNITS unset (100000): guests capped near 15000 units across many IPs", async () => {
  const G = GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT;
  const g = makeGuard();
  const env = envOf(g, { enforcement: false });
  const run = await exhaustGuestShare(g, env, G);
  assert.ok(run.denial, `guests consumed ${run.admitted} units (${((run.admitted / G) * 100).toFixed(1)}% of global ${G}) and were never denied`);
  assertShareBounds(run.admitted, G, "G1c");
  assertGuestShareDenial(run.denial, "G1c");
  const authed = await proxyCall(env, { ip: "192.0.2.11", userId: "plus-user-g1c" });
  assert.equal(authed.response.status, 200, "Plus user passes after guest share exhausted");
});

// ---------------------------------------------------------------------------
// G2：登入用戶照舊計入 global；global 用完所有人都被拒
// ---------------------------------------------------------------------------
for (const enforcement of [false, true]) {
  const mode = enforcement ? "enforcement=on" : "enforcement=off";
  await check(`G2[${mode}]`, "authenticated usage charges global; exhausted global denies everyone", async () => {
    const G = 40;
    const w = GOOGLE_FAMILY_LIMITS.places_text.weight;
    const g = makeGuard();
    const env = envOf(g, { enforcement, globalUnits: G });
    for (let n = 0; n < G / w; n += 1) {
      const userId = n % 2 ? "free-user-g2" : "plus-user-g2";
      const authed = await proxyCall(env, { ip: "192.0.2.30", userId });
      assert.equal(authed.response.status, 200, `authenticated request ${n} admitted`);
      assert.equal(globalWeight(g), (n + 1) * w, "each authenticated request charges global by its weight");
    }
    for (const userId of ["free-user-g2", "plus-user-g2", "fresh-user-g2"]) {
      const denied = await proxyCall(env, { ip: "192.0.2.31", userId });
      assert.equal(denied.response.status, 429, `${userId} denied once global is exhausted`);
      assert.equal(denied.upstream, 0);
      assert.equal(denied.body?.reason, "global_budget_limited");
    }
    const guest = await proxyCall(env, { ip: "192.0.2.32" });
    assert.equal(guest.response.status, 429, "guest denied once global is exhausted");
    assert.equal(guest.upstream, 0);
    assert.equal(globalWeight(g), G, "no over-admission past global");
  });
}

// ---------------------------------------------------------------------------
// G3：訪客照片（簽名 + 抓取）計入訪客份額
// ---------------------------------------------------------------------------
for (const enforcement of [false, true]) {
  const mode = enforcement ? "enforcement=on" : "enforcement=off";
  await check(`G3a[${mode}]`, "guest text + guest-signed photo fetches share one guest budget", async () => {
    const G = 2000;
    const g = makeGuard();
    const env = envOf(g, { enforcement, globalUnits: G });
    // 先用 places_text 吃掉約一半的訪客份額（不觸及上限），再用訪客照片補滿。
    let admitted = 0;
    let i = 0;
    const half = Math.floor((G * GUEST_SHARE_MIN) / 2);
    while (admitted + GOOGLE_FAMILY_LIMITS.places_text.weight <= half) {
      const r = await proxyCall(env, { ip: guestIp(i++ % GUEST_IP_POOL) });
      assert.equal(r.response.status, 200, "guest text below half share admitted");
      admitted += GOOGLE_FAMILY_LIMITS.places_text.weight;
    }
    const run = await exhaustGuestShare(g, env, G, { kind: "photo", startUnits: admitted, startIndex: i });
    assert.ok(run.denial, `guest text+photo consumed ${run.admitted} units (${((run.admitted / G) * 100).toFixed(1)}%) and photos were never denied`);
    assertShareBounds(run.admitted, G, "G3a");
    assertGuestShareDenial(run.denial, "G3a photo");
    // 照片用量也讓訪客的一般 Google 請求被拒（同一份額）。
    assertGuestShareDenial(await proxyCall(env, { ip: "192.0.2.251" }), "G3a text after photo");
    // 登入用戶的照片照常。
    const authedPhoto = await photoCall(env, { ip: "192.0.2.40", userId: "plus-user-g3" });
    assert.equal(authedPhoto.response.status, 200, `authenticated photo passes (got ${authedPhoto.response.status})`);
    assert.equal(authedPhoto.upstream, 1);
  });

  await check(`G3b[${mode}]`, "guest share exhausted by text denies guest-signed photo fetch", async () => {
    const G = 2000;
    const g = makeGuard();
    const env = envOf(g, { enforcement, globalUnits: G });
    const run = await exhaustGuestShare(g, env, G);
    assert.ok(run.denial, `guests consumed ${run.admitted} units and were never denied`);
    const before = globalWeight(g);
    const guestPhoto = await photoCall(env, { ip: "192.0.2.252" });
    assertGuestShareDenial(guestPhoto, "G3b guest photo");
    assert.equal(globalWeight(g), before, "denied guest photo leaves no global charge");
  });
}

// ---------------------------------------------------------------------------
// G4：IPv6 /64 正規化（IP 每日權重 + burst），IPv4 不變
// ---------------------------------------------------------------------------
const V6_A = "2001:db8:abcd:12::1";
const V6_B = "2001:0db8:abcd:0012:ffff:1:2:3"; // 同一個 /64，不同寫法
const V6_C = "2001:db8:abcd:13::1"; // 不同 /64
const V4 = "203.0.113.80";

async function observeCall(g, env, seen, ip, userId = null) {
  const namesBefore = g.names.length;
  const seenBefore = seen.length;
  const r = await proxyCall(env, { ip, userId });
  assert.equal(r.response.status, 200, `${ip} admitted (got ${r.response.status} ${JSON.stringify(r.body)})`);
  return {
    ipObjects: [...new Set(g.names.slice(namesBefore).filter((n) => n.startsWith("ip:")))],
    ipBurst: seen.slice(seenBefore).filter((k) => k.startsWith("google:ip:")),
    guestBurst: seen.slice(seenBefore).filter((k) => k.startsWith("google:guest:")),
    userBurst: seen.slice(seenBefore).filter((k) => k.startsWith("google:user:")),
  };
}

for (const enforcement of [false, true]) {
  const mode = enforcement ? "enforcement=on" : "enforcement=off";
  await check(`G4a[${mode}]`, "guest: same /64 shares IP daily weight + burst keys; different /64 does not", async () => {
    const g = makeGuard();
    const seen = [];
    const env = envOf(g, { enforcement, seen });
    const a = await observeCall(g, env, seen, V6_A);
    const b = await observeCall(g, env, seen, V6_B);
    const c = await observeCall(g, env, seen, V6_C);
    assert.equal(a.ipObjects.length, 1, "one IP bucket per request");
    assert.deepEqual(b.ipObjects, a.ipObjects, `IP daily bucket differs within one /64: ${a.ipObjects} vs ${b.ipObjects}`);
    assert.equal(
      ipWeightByName(g, a.ipObjects[0]),
      GOOGLE_FAMILY_LIMITS.places_text.weight * 2,
      "both /64 addresses charge the same IP daily weight",
    );
    assert.ok(a.ipBurst.length >= 1 && a.guestBurst.length >= 1, "guest burst keys observed");
    assert.deepEqual(b.ipBurst, a.ipBurst, `google:ip burst key differs within one /64: ${a.ipBurst} vs ${b.ipBurst}`);
    assert.deepEqual(b.guestBurst, a.guestBurst, `google:guest burst key differs within one /64: ${a.guestBurst} vs ${b.guestBurst}`);
    assert.notDeepEqual(c.ipObjects, a.ipObjects, "different /64 must not share the IP daily bucket");
    assert.notDeepEqual(c.ipBurst, a.ipBurst, "different /64 must not share google:ip burst key");
    assert.notDeepEqual(c.guestBurst, a.guestBurst, "different /64 must not share google:guest burst key");
  });

  await check(`G4b[${mode}]`, "authenticated: same /64 shares IP daily weight + google:ip burst; user key unchanged", async () => {
    const g = makeGuard();
    const seen = [];
    const env = envOf(g, { enforcement, seen });
    const a = await observeCall(g, env, seen, V6_A, "user-g4");
    const b = await observeCall(g, env, seen, V6_B, "user-g4");
    const c = await observeCall(g, env, seen, V6_C, "user-g4");
    assert.deepEqual(b.ipObjects, a.ipObjects, `IP daily bucket differs within one /64: ${a.ipObjects} vs ${b.ipObjects}`);
    assert.deepEqual(b.ipBurst, a.ipBurst, `google:ip burst key differs within one /64: ${a.ipBurst} vs ${b.ipBurst}`);
    assert.notDeepEqual(c.ipObjects, a.ipObjects, "different /64 must not share the IP daily bucket");
    assert.deepEqual(a.userBurst, ["google:user:user-g4"], "user burst key unchanged");
    assert.equal(userWeight(g, "user-g4"), GOOGLE_FAMILY_LIMITS.places_text.weight * 3, "personal weight unchanged");
  });

  await check(`G4c[${mode}]`, "guest photo: same /64 shares IP daily weight + google:photo burst", async () => {
    const g = makeGuard();
    const seen = [];
    const env = envOf(g, { enforcement, seen });
    const run = async (ip) => {
      const n0 = g.names.length;
      const s0 = seen.length;
      const r = await photoCall(env, { ip });
      assert.equal(r.response.status, 200, `${ip} photo admitted (got ${r.response.status})`);
      return {
        ipObjects: [...new Set(g.names.slice(n0).filter((n) => n.startsWith("ip:")))],
        photoBurst: seen.slice(s0).filter((k) => k.startsWith("google:photo:")),
      };
    };
    const a = await run(V6_A);
    const b = await run(V6_B);
    const c = await run(V6_C);
    assert.deepEqual(b.ipObjects, a.ipObjects, `photo IP daily bucket differs within one /64: ${a.ipObjects} vs ${b.ipObjects}`);
    assert.deepEqual(b.photoBurst, a.photoBurst, `google:photo burst key differs within one /64: ${a.photoBurst} vs ${b.photoBurst}`);
    assert.notDeepEqual(c.photoBurst, a.photoBurst, "different /64 must not share google:photo burst key");
  });

  await check(`G4d[${mode}]`, "IPv4 keys unchanged (ip:<addr>, google:ip:<addr>, google:guest:<addr>)", async () => {
    const g = makeGuard();
    const seen = [];
    const env = envOf(g, { enforcement, seen });
    const v4 = await observeCall(g, env, seen, V4);
    assert.deepEqual(v4.ipObjects, [`ip:${V4}`]);
    assert.deepEqual(v4.ipBurst, [`google:ip:${V4}`]);
    assert.deepEqual(v4.guestBurst, [`google:guest:${V4}`]);
    const other = await observeCall(g, env, seen, "203.0.113.81");
    assert.deepEqual(other.ipObjects, ["ip:203.0.113.81"], "neighbouring IPv4 addresses are not grouped");
  });
}

// ---------------------------------------------------------------------------
// G5：既有行為不變
// ---------------------------------------------------------------------------
await check("G5a", "weights and daily constants unchanged", async () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(GOOGLE_FAMILY_LIMITS).map(([k, v]) => [k, { daily: v.daily, weight: v.weight }])),
    {
      places_text: { daily: 200, weight: 8 },
      places_nearby: { daily: 150, weight: 8 },
      places_details: { daily: 120, weight: 5 },
      places_autocomplete: { daily: 300, weight: 1 },
      geocoding: { daily: 80, weight: 2 },
      directions: { daily: 80, weight: 4 },
      routes: { daily: 150, weight: 4 },
      place_photos: { daily: 800, weight: 1 },
    },
  );
  assert.equal(GOOGLE_USER_DAILY_WEIGHT, 4_000);
  assert.equal(GOOGLE_IP_DAILY_WEIGHT, 12_000);
  assert.equal(GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT, 100_000);
  assert.equal(policy.readGlobalDailyUnits({}), 100_000);
  assert.equal(policy.readGlobalDailyUnits({ GOOGLE_GLOBAL_DAILY_UNITS: "2000" }), 2000);
});

for (const enforcement of [false, true]) {
  const mode = enforcement ? "enforcement=on" : "enforcement=off";
  await check(`G5b[${mode}]`, "every family charges user / IP / global by its weight (authenticated) and IP / global (guest)", async () => {
    for (const [family, input] of Object.entries(FAMILIES)) {
      const w = GOOGLE_FAMILY_LIMITS[family].weight;
      const g = makeGuard();
      const env = envOf(g, { enforcement });
      const authed = await proxyCall(env, { ip: "192.0.2.50", userId: "user-g5b", input });
      assert.equal(authed.response.status, 200, `${family} authenticated`);
      assert.equal(authed.upstream, 1, family);
      assert.equal(userWeight(g, "user-g5b"), w, `${family} user weight`);
      assert.equal(ipWeightByName(g, "ip:192.0.2.50"), w, `${family} ip weight`);
      assert.equal(globalWeight(g), w, `${family} global weight`);
      const guest = await proxyCall(env, { ip: "192.0.2.51", input });
      assert.equal(guest.response.status, 200, `${family} guest`);
      assert.equal(ipWeightByName(g, "ip:192.0.2.51"), w, `${family} guest ip weight`);
      assert.equal(globalWeight(g), 2 * w, `${family} guest global weight`);
    }
  });

  await check(`G5c[${mode}]`, "personal daily weight, family daily cap and IP daily weight still deny", async () => {
    const retryAt = Date.now() + 86_400_000;
    {
      const g = makeGuard();
      const env = envOf(g, { enforcement });
      await seed(g, "user:capped-user", [{ key: `user:weight:${day}`, limit: GOOGLE_USER_DAILY_WEIGHT, delta: GOOGLE_USER_DAILY_WEIGHT, reason: "user_weight", retryAt }], "seed-user");
      const r = await proxyCall(env, { ip: "192.0.2.60", userId: "capped-user" });
      assert.equal(r.response.status, 429, "personal weight cap");
      assert.equal(r.upstream, 0);
      assert.equal(r.body?.reason, "user_rate_limited");
      assert.equal(globalWeight(g), 0);
      assert.equal(ipWeightByName(g, "ip:192.0.2.60"), 0, "user denial charges no IP");
    }
    {
      const g = makeGuard();
      const env = envOf(g, { enforcement });
      await seed(g, "user:family-user", [{ key: `user:family:places_text:${day}`, limit: 200, delta: 200, reason: "family", retryAt }], "seed-family");
      const r = await proxyCall(env, { ip: "192.0.2.61", userId: "family-user" });
      assert.equal(r.response.status, 429, "family daily cap");
      assert.equal(r.body?.reason, "user_rate_limited");
      const other = await proxyCall(env, { ip: "192.0.2.61", userId: "family-user", input: FAMILIES.places_autocomplete });
      assert.equal(other.response.status, 200, "other family unaffected");
    }
    for (const userId of [null, "ip-capped-user"]) {
      const g = makeGuard();
      const env = envOf(g, { enforcement });
      await seed(g, "ip:192.0.2.62", [{ key: `ip:weight:${day}`, limit: GOOGLE_IP_DAILY_WEIGHT, delta: GOOGLE_IP_DAILY_WEIGHT, reason: "ip_weight", retryAt }], "seed-ip");
      const r = await proxyCall(env, { ip: "192.0.2.62", userId });
      assert.equal(r.response.status, 429, `IP weight cap (${userId ?? "guest"})`);
      assert.equal(r.upstream, 0);
      assert.equal(r.body?.reason, "ip_rate_limited");
      assert.equal(globalWeight(g), 0);
      if (userId) assert.equal(userWeight(g, userId), 0, "IP denial rolls back user charge");
    }
  });

  await check(`G5d[${mode}]`, "authorizeGoogleBilling is mandatory: guard down -> 503, kill switch -> 503, no upstream", async () => {
    const down = { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error("durable object down"); } }) };
    for (const userId of [null, "user-g5d"]) {
      const env = { ...envOf(makeGuard(), { enforcement }), ABUSE_GUARD: down };
      const r = await proxyCall(env, { ip: "192.0.2.70", userId });
      assert.equal(r.response.status, 503, `guard down (${userId ?? "guest"})`);
      assert.equal(r.upstream, 0);
      assert.deepEqual(r.body, { error: "google_unavailable" });
      const p = await photoCall(env, { ip: "192.0.2.70", userId });
      assert.equal(p.response.status, 503, `photo guard down (${userId ?? "guest"})`);
      assert.equal(p.upstream, 0);
    }
    for (const userId of [null, "user-g5d"]) {
      const g = makeGuard();
      const env = envOf(g, { enforcement, extra: { DISABLE_GOOGLE_PROXY: "1" } });
      const r = await proxyCall(env, { ip: "192.0.2.71", userId });
      assert.equal(r.response.status, 503, `kill switch (${userId ?? "guest"})`);
      assert.equal(r.upstream, 0);
      assert.equal(globalWeight(g), 0);
    }
  });
}

await check("G5e", "enforcement on/off differences unchanged (limiter keys, missing limiter, burst 429 body)", async () => {
  // 既有差異 1：缺少 GOOGLE_API_RATE_LIMITER 時，off = 舊路徑錯誤碼；on = fixed google_unavailable。
  {
    const g = makeGuard();
    const off = await proxyCall({ ...envOf(g), GOOGLE_API_RATE_LIMITER: undefined }, { ip: V4 });
    assert.equal(off.response.status, 503);
    assert.deepEqual(off.body, { error: "google_rate_limit_unavailable" });
    const on = await proxyCall({ ...envOf(g, { enforcement: true }), GOOGLE_API_RATE_LIMITER: undefined }, { ip: V4 });
    assert.equal(on.response.status, 503);
    assert.deepEqual(on.body, { error: "google_unavailable" });
    assert.equal(off.upstream + on.upstream, 0);
  }
  // 既有差異 2：limiter 呼叫序列（IPv4 訪客／登入）。
  {
    const seenOff = [];
    const seenOn = [];
    await proxyCall(envOf(makeGuard(), { seen: seenOff }), { ip: V4 });
    await proxyCall(envOf(makeGuard(), { enforcement: true, seen: seenOn }), { ip: V4 });
    assert.deepEqual(seenOff, [`google:ip:${V4}`, `google:guest:${V4}`]);
    assert.deepEqual(seenOn, [`google:ip:${V4}`, `google:guest:${V4}`]);
    const userOff = [];
    const userOn = [];
    await proxyCall(envOf(makeGuard(), { seen: userOff }), { ip: V4, userId: "u-g5e" });
    await proxyCall(envOf(makeGuard(), { enforcement: true, seen: userOn }), { ip: V4, userId: "u-g5e" });
    assert.deepEqual(userOff, [`google:ip:${V4}`, "google:user:u-g5e"]);
    assert.deepEqual(userOn, [`google:ip:${V4}`, "google:user:u-g5e"]);
  }
  // 既有差異 3：限流 429 的 body。off = {error:"rate_limited"}；on = 帶 reason 分類。
  {
    const deny = { limit: async () => ({ success: false }) };
    const off = await proxyCall({ ...envOf(makeGuard()), GOOGLE_API_RATE_LIMITER: deny }, { ip: V4 });
    assert.equal(off.response.status, 429);
    assert.deepEqual(off.body, { error: "rate_limited" });
    const on = await proxyCall({ ...envOf(makeGuard(), { enforcement: true }), GOOGLE_API_RATE_LIMITER: deny }, { ip: V4 });
    assert.equal(on.response.status, 429);
    assert.deepEqual(on.body, { error: "rate_limited", reason: "ip_rate_limited" });
  }
});

// ---------------------------------------------------------------------------
// NET：整支腳本沒有任何非 mock 的網路請求
// ---------------------------------------------------------------------------
await check("NET", "no unmocked network request (fetch / http(s) / net / tls)", async () => {
  assert.deepEqual(unmockedNetwork, [], `unmocked network attempts: ${unmockedNetwork.join(", ")}`);
});

const failed = results.filter((r) => !r.ok).map((r) => r.id);
out(`\nSUMMARY ${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
