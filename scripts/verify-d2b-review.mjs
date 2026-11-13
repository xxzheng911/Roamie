import "./verify-netguard-full.mjs";
/**
 * D2b 獨立複審（任務單 #G6，tester）。a～e 實測。
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-d2b-review.mjs
 * 網路：verify-netguard-full 攔截 fetch／http(s)／net／tls；所有 Google upstream 都是注入 mock。
 */
import assert from "node:assert/strict";

const out = (line) => process.stdout.write(`${line}\n`);
const quiet = () => {};
const realInfo = console.info;
console.log = quiet;
console.info = quiet;
console.warn = quiet;
console.debug = quiet;
console.error = quiet;

delete process.env.ABUSE_GUARD_ENFORCEMENT;
delete process.env.DISABLE_GOOGLE_PROXY;
delete process.env.GOOGLE_GLOBAL_DAILY_UNITS;

const HEAD_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/snap-HEAD-full";

const { createMemoryAbuseGuard } = await import("../src/lib/abuse-guard-memory.ts");
const { utcDay } = await import("../src/lib/abuse-guard-clock.ts");
const policy = await import("../src/lib/abuse-guard-policy.ts");
const { fetchGoogleRestProvider } = await import("../src/lib/google-rest-provider.server.ts");
const { handleGoogleProxy } = await import("../src/lib/google-proxy.server.ts");
const { handlePlacePhotoRequest } = await import("../src/routes/api/place-photo.ts");
const { signPlacePhoto, sealPlacePhotoPrincipal } = await import("../src/lib/place-photo-signature.server.ts");
const scope = await import("../src/lib/worker-request-scope.ts");
const headScope = await import(`${HEAD_DIR}/src/lib/worker-request-scope.ts`);
const { checkRateLimit, SECURITY_RATE_LIMITS } = await import("../src/lib/rate-limit.server.ts");
const { fixedPlacesFailureReason } = await import("../src/lib/places-failure-reason.ts");
const { normalizePlacesSearchResult } = await import("../src/lib/places-search-normalize.ts");
const discoveryScope = await import("../src/lib/ai/discovery-search-scope.ts");
const discoveryTrace = await import("../src/lib/ai/combination-discovery-trace.ts");

const { GOOGLE_FAMILY_LIMITS } = policy;
const day = utcDay();
const placesKey = "AIza" + "x".repeat(35);
const signingSecret = "photo-signing-secret-at-least-32";
const photo = "places/ChIJ_photo/photos/ref";

const FAMILIES = {
  places_text: { url: "https://places.googleapis.com/v1/places:searchText", method: "POST", body: { textQuery: "Tokyo", pageSize: 1 } },
  places_nearby: {
    url: "https://places.googleapis.com/v1/places:searchNearby", method: "POST",
    body: { locationRestriction: { circle: { center: { latitude: 35.6, longitude: 139.7 }, radius: 500 } }, maxResultCount: 1 },
  },
  places_autocomplete: { url: "https://places.googleapis.com/v1/places:autocomplete", method: "POST", body: { input: "Tokyo" } },
  places_details: { url: "https://places.googleapis.com/v1/places/ChIJtestplace", method: "GET" },
  routes: {
    url: "https://routes.googleapis.com/directions/v2:computeRoutes", method: "POST",
    body: {
      origin: { location: { latLng: { latitude: 35, longitude: 139 } } },
      destination: { location: { latLng: { latitude: 35.1, longitude: 139.1 } } },
      travelMode: "WALK",
    },
  },
  geocoding: { url: "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo", method: "GET" },
  directions: { url: "https://maps.googleapis.com/maps/api/directions/json?origin=Tokyo&destination=Osaka", method: "GET" },
};

function makeGuard() {
  const guard = createMemoryAbuseGuard();
  return { guard, namespace: guard.namespace, counter: (n, k) => guard.counter(n, k) };
}
function limiter(seen = []) {
  return { limit: async ({ key }) => { seen.push(key); return { success: true }; } };
}
function envOf(g, { enforcement = false, globalUnits, seen } = {}) {
  return {
    ABUSE_GUARD: g.namespace,
    GOOGLE_PLACES_SERVER_API_KEY: placesKey,
    GOOGLE_ROUTES_SERVER_API_KEY: placesKey,
    GOOGLE_GEOCODING_SERVER_API_KEY: placesKey,
    GOOGLE_API_RATE_LIMITER: limiter(seen),
    PLACE_PHOTO_SIGNING_SECRET: signingSecret,
    ...(enforcement ? { ABUSE_GUARD_ENFORCEMENT: "1" } : {}),
    ...(globalUnits !== undefined ? { GOOGLE_GLOBAL_DAILY_UNITS: String(globalUnits) } : {}),
  };
}
const globalW = (g) => g.counter("global:google", `global:weight:${day}`);
const guestW = (g) => g.counter("global:google", `global:guest:weight:${day}`);
const ipW = (g, ip) => g.counter(`ip:${ip}`, `ip:weight:${day}`);

async function seed(g, name, buckets, operationId) {
  const r = await g.guard.namespace.get(name).fetch(new Request("https://abuse-guard.internal/", {
    method: "POST", body: JSON.stringify({ action: "charge", operationId, buckets }),
  }));
  assert.equal((await r.json()).ok, true, `seed ${operationId}`);
}
const retryAt = Date.now() + 86_400_000;
async function seedGlobal(g, globalUsed, guestUsed) {
  const buckets = [];
  if (globalUsed > 0) buckets.push({ key: `global:weight:${day}`, limit: 1e9, delta: globalUsed, reason: "seed", retryAt });
  if (guestUsed > 0) buckets.push({ key: `global:guest:weight:${day}`, limit: 1e9, delta: guestUsed, reason: "seed", retryAt });
  if (buckets.length) await seed(g, "global:google", buckets, `seed-global-${Math.random()}`);
}
async function readBody(response) {
  try { return await response.clone().json(); } catch { return null; }
}
async function proxyCall(env, { ip, userId = null, input = FAMILIES.places_text }) {
  const upstream = { count: 0 };
  const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
  if (userId) headers.authorization = "Bearer fixture-token";
  const response = await handleGoogleProxy(
    new Request("https://roamie.tw/api/google", { method: "POST", headers, body: JSON.stringify(input) }),
    env,
    {
      authenticate: async () => userId,
      provider: (i, e) => fetchGoogleRestProvider(i, e, async () => { upstream.count += 1; return Response.json({ places: [] }); }),
    },
  );
  return { response, upstream: upstream.count, body: await readBody(response) };
}
function photoDeps(upstream) {
  return {
    fetch: async () => { upstream.count += 1; return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])); },
    resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
    recordHttpCall: () => {},
    timeoutMs: 1000,
  };
}
async function photoRaw(env, ip, query) {
  const upstream = { count: 0 };
  const response = await handlePlacePhotoRequest(
    new Request(`https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&${query}`, { headers: { "cf-connecting-ip": ip } }),
    photoDeps(upstream), env,
  );
  return { response, upstream: upstream.count, body: await readBody(response) };
}
async function photoCall(env, { ip, userId = null, mode }) {
  if (userId) {
    const principal = await sealPlacePhotoPrincipal(env, userId);
    const t = await signPlacePhoto(env, photo, 480, undefined, "authenticated", principal);
    return photoRaw(env, ip, `expires=${t.expires}&signature=${encodeURIComponent(t.signature)}&aud=authenticated&principal=${encodeURIComponent(principal)}`);
  }
  if (mode === "legacy") {
    const t = await signPlacePhoto(env, photo, 480);
    return photoRaw(env, ip, `expires=${t.expires}&signature=${encodeURIComponent(t.signature)}`);
  }
  const t = await signPlacePhoto(env, photo, 480, undefined, "guest");
  return photoRaw(env, ip, `expires=${t.expires}&signature=${encodeURIComponent(t.signature)}&aud=guest`);
}

const results = [];
async function check(id, title, fn) {
  try {
    const note = await fn();
    results.push({ id, ok: true });
    out(`PASS ${id} ${title}${note ? `\n     ${note}` : ""}`);
  } catch (error) {
    results.push({ id, ok: false });
    out(`FAIL ${id} ${title}\n     ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

// ---------------------------------------------------------------------------
// a. 最重一筆空間規則：邊界值
// ---------------------------------------------------------------------------
for (const enforcement of [false, true]) {
  const mode = enforcement ? "on" : "off";
  for (const G of [100_000, 2000]) {
    const share = policy.guestGlobalDailyUnits(G);
    const edge = share - 8; // 最後一個仍可通過的訪客用量
    await check(`A1[G=${G},enf=${mode}]`, `every guest family passes at guest=${edge}, denied at guest=${edge + 1}`, async () => {
      const lines = [];
      const calls = [
        ...Object.entries(FAMILIES).map(([family, input]) => ({ family, run: (env, ip) => proxyCall(env, { ip, input }) })),
        { family: "place_photos", run: (env, ip) => photoCall(env, { ip }) },
      ];
      for (const { family, run } of calls) {
        const w = GOOGLE_FAMILY_LIMITS[family].weight;
        {
          const g = makeGuard();
          const env = envOf(g, { enforcement, globalUnits: G });
          await seedGlobal(g, edge, edge);
          const r = await run(env, "198.51.100.7");
          assert.equal(r.response.status, 200, `${family} at guest=${edge} must pass (got ${r.response.status} ${JSON.stringify(r.body)})`);
          assert.equal(r.upstream, 1);
          assert.equal(guestW(g), edge + w, `${family} guest counter`);
          assert.ok(guestW(g) <= share, `${family} guest counter ${guestW(g)} exceeds share ${share}`);
          assert.equal(globalW(g), edge + w);
        }
        {
          const g = makeGuard();
          const env = envOf(g, { enforcement, globalUnits: G });
          await seedGlobal(g, edge + 1, edge + 1);
          const r = await run(env, "198.51.100.8");
          assert.equal(r.response.status, 429, `${family} at guest=${edge + 1} must be 429 (got ${r.response.status})`);
          assert.equal(r.upstream, 0);
          assert.equal(r.body?.reason, "guest_global_budget_limited", `${family} reason ${JSON.stringify(r.body)}`);
          assert.equal(guestW(g), edge + 1, `${family} denied leaves guest counter`);
          assert.equal(globalW(g), edge + 1, `${family} denied leaves global counter`);
          assert.equal(ipW(g, "198.51.100.8"), 0, `${family} denied leaves IP counter`);
        }
        lines.push(`${family}(w${w})`);
      }
      return `share=${share} pass@${edge} deny@${edge + 1}; usable range ${edge + 1}..${share}; families: ${lines.join(" ")}`;
    });
  }
}

await check("A2", "authenticated users ignore guest counter (guest=share, global far from full) incl. photo; guest counter untouched", async () => {
  for (const enforcement of [false, true]) {
    for (const G of [100_000, 2000]) {
      const g = makeGuard();
      const env = envOf(g, { enforcement, globalUnits: G });
      const share = policy.guestGlobalDailyUnits(G);
      await seedGlobal(g, share, share);
      for (const [family, input] of Object.entries(FAMILIES)) {
        const r = await proxyCall(env, { ip: "192.0.2.10", userId: "plus-a2", input });
        assert.equal(r.response.status, 200, `${family} auth (G=${G}, enf=${enforcement}) got ${r.response.status} ${JSON.stringify(r.body)}`);
      }
      const p = await photoCall(env, { ip: "192.0.2.10", userId: "plus-a2" });
      assert.equal(p.response.status, 200, "auth photo");
      assert.equal(guestW(g), share, "authenticated usage never charges guest counter");
    }
  }
});

await check("A3", "global exhausted wins over guest share: reason stays global_budget_limited for guest and user", async () => {
  const G = 2000;
  const g = makeGuard();
  const env = envOf(g, { globalUnits: G });
  await seedGlobal(g, G, policy.guestGlobalDailyUnits(G));
  const guest = await proxyCall(env, { ip: "198.51.100.9" });
  assert.equal(guest.body?.reason, "global_budget_limited");
  const user = await proxyCall(env, { ip: "198.51.100.9", userId: "u-a3" });
  assert.equal(user.body?.reason, "global_budget_limited");
  // guest share free but global just short of a weight-8 → global_budget_limited, not guest
  const g2 = makeGuard();
  await seedGlobal(g2, G - 7, 0);
  const guest2 = await proxyCall(envOf(g2, { globalUnits: G }), { ip: "198.51.100.9" });
  assert.equal(guest2.body?.reason, "global_budget_limited");
});

await check("A4", "small GOOGLE_GLOBAL_DAILY_UNITS (40): guest share 6 < weight 8 -> guests fully denied, users fine", async () => {
  const g = makeGuard();
  const env = envOf(g, { globalUnits: 40 });
  const t = await proxyCall(env, { ip: "198.51.100.10" });
  const a = await proxyCall(env, { ip: "198.51.100.10", input: FAMILIES.places_autocomplete });
  const u = await proxyCall(env, { ip: "198.51.100.10", userId: "u-a4" });
  assert.equal(u.response.status, 200);
  return `guest text=${t.response.status}/${t.body?.reason} autocomplete=${a.response.status}/${a.body?.reason} user=${u.response.status}`;
});

// ---------------------------------------------------------------------------
// b. rollback 與 burst
// ---------------------------------------------------------------------------
for (const enforcement of [false, true]) {
  const mode = enforcement ? "on" : "off";
  await check(`B1[enf=${mode}]`, "guest-share denial: IP/global/guest counters unchanged (x6 repeats); burst consumed same as global_budget_limited", async () => {
    const G = 2000;
    const share = policy.guestGlobalDailyUnits(G);
    // guest-share denial
    const seenGuest = [];
    const g = makeGuard();
    const env = envOf(g, { enforcement, globalUnits: G, seen: seenGuest });
    await seedGlobal(g, share, share);
    const ip = "203.0.113.50";
    const denied = await proxyCall(env, { ip });
    assert.equal(denied.body?.reason, "guest_global_budget_limited");
    assert.equal(ipW(g, ip), 0, "IP charge rolled back");
    assert.equal(globalW(g), share);
    assert.equal(guestW(g), share);
    for (let n = 0; n < 5; n += 1) await proxyCall(env, { ip });
    assert.equal(ipW(g, ip), 0, "repeated denials leave no IP residue");
    assert.equal(globalW(g), share, "repeated denials leave no global residue");
    // global denial for comparison
    const seenGlobal = [];
    const g2 = makeGuard();
    const env2 = envOf(g2, { enforcement, globalUnits: G, seen: seenGlobal });
    await seedGlobal(g2, G, 0);
    const deniedGlobal = await proxyCall(env2, { ip });
    assert.equal(deniedGlobal.body?.reason, "global_budget_limited");
    assert.equal(ipW(g2, ip), 0);
    const perGuest = seenGuest.length / 6;
    assert.equal(perGuest, seenGlobal.length, "burst calls per denied request identical between guest-share and global denials");
    // body / headers shape identical apart from reason
    assert.deepEqual(Object.keys(denied.body).sort(), Object.keys(deniedGlobal.body).sort());
    assert.equal(denied.response.headers.get("retry-after"), deniedGlobal.response.headers.get("retry-after"));
    return `burst limiter keys per denied request: ${JSON.stringify(seenGlobal)} (same for both); retry-after=${denied.response.headers.get("retry-after")}`;
  });
}

await check("B2", "guest-share denial on photo: IP/global unchanged, google:photo burst consumed once (same as global denial)", async () => {
  const G = 2000;
  const share = policy.guestGlobalDailyUnits(G);
  const seen = [];
  const g = makeGuard();
  const env = envOf(g, { enforcement: true, globalUnits: G, seen });
  await seedGlobal(g, share, share);
  const r = await photoCall(env, { ip: "203.0.113.51" });
  assert.equal(r.response.status, 429);
  assert.equal(r.body?.reason, "guest_global_budget_limited");
  assert.equal(ipW(g, "203.0.113.51"), 0);
  assert.equal(globalW(g), share);
  return `photo burst keys: ${JSON.stringify(seen)}`;
});

// ---------------------------------------------------------------------------
// c. IPv6 正規化：對照 HEAD
// ---------------------------------------------------------------------------
const resolveWith = (mod, header) => mod.resolveTrustedIp(new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": header } }));
const IP_CASES = [
  ["mixed case", "2001:DB8:AbCd:0012::1", "2001:db8:abcd:12::/64"],
  ["leading zeros", "2001:0db8:abcd:0012:0000:0000:0000:0001", "2001:db8:abcd:12::/64"],
  ["no leading zeros full", "2001:db8:abcd:12:ffff:1:2:3", "2001:db8:abcd:12::/64"],
  [":: at start", "::abcd:1", "0:0:0:0::/64"],
  [":: in middle", "2001:db8::abcd:1", "2001:db8:0:0::/64"],
  [":: at end", "2001:db8:abcd:12::", "2001:db8:abcd:12::/64"],
  [":: in host half", "2001:db8:abcd:12:1::2", "2001:db8:abcd:12::/64"],
  ["%zone", "fe80::1%eth0", "fe80:0:0:0::/64"],
  ["%zone upper", "FE80::1%EN0", "fe80:0:0:0::/64"],
  ["embedded IPv4 tail", "2001:db8:abcd:12::192.0.2.1", "2001:db8:abcd:12::/64"],
  ["::ffff: mapped", "::ffff:192.0.2.33", "192.0.2.33"],
  ["::FFFF: upper mapped", "::FFFF:192.0.2.33", "192.0.2.33"],
  ["mapped full form", "0:0:0:0:0:ffff:192.0.2.33", "192.0.2.33"],
  ["mapped hex form", "::ffff:c000:221", "192.0.2.33"],
  ["::1", "::1", "0:0:0:0::/64"],
  ["::", "::", "0:0:0:0::/64"],
  ["whitespace", "  2001:db8:abcd:12::9  ", "2001:db8:abcd:12::/64"],
  ["IPv4 only", "203.0.113.80", "203.0.113.80"],
  ["IPv4 leading zero", "010.001.002.003", "010.001.002.003"],
  ["invalid abc", "abc", "abc"],
  ["invalid 1.2.3", "1.2.3", "1.2.3"],
  ["invalid 9 groups", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8:9"],
  ["invalid two ::", "1::2::3", "1::2::3"],
  ["invalid :::", ":::", ":::"],
  ["invalid 5-hex group", "12345::1", "12345::1"],
  ["invalid mapped octet", "::ffff:999.1.1.1", "::ffff:999.1.1.1"],
  ["invalid non-hex", "2001:db8:zz::1", "2001:db8:zz::1"],
  ["bracketed", "[2001:db8::1]", "[2001:db8::1]"],
  ["full 8 groups + ::", "1:2:3:4:5:6:7:8::", "1:2:3:4:5:6:7:8::"],
  ["already-normalized key", "2001:db8:abcd:12::/64", "2001:db8:abcd:12::/64"],
];
await check("C1", `normalizeClientIp: ${IP_CASES.length} forms vs HEAD (HEAD = raw header)`, async () => {
  const rows = [];
  for (const [label, raw, expected] of IP_CASES) {
    let cur;
    assert.doesNotThrow(() => { cur = scope.normalizeClientIp(raw); }, label);
    assert.equal(cur, expected, `${label}: normalizeClientIp(${JSON.stringify(raw)}) = ${JSON.stringify(cur)}`);
    const viaHeader = resolveWith(scope, raw);
    const headValue = resolveWith(headScope, raw);
    assert.equal(viaHeader, expected, `${label}: resolveTrustedIp`);
    assert.equal(headValue, raw.trim(), `${label}: HEAD returns raw trimmed header`);
    if (headValue !== viaHeader) rows.push(`${label}: HEAD=${headValue} -> ${viaHeader}`);
  }
  // 無效值維持原值；空字串 header -> 兩邊皆 null
  assert.equal(scope.normalizeClientIp(""), "");
  assert.equal(resolveWith(scope, ""), headScope.resolveTrustedIp(new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": "" } })));
  return `changed vs HEAD: ${rows.length}/${IP_CASES.length}`;
});

await check("C2", "different /64 not merged; adjacent IPv4 not merged; mapped merges with IPv4", async () => {
  assert.notEqual(scope.normalizeClientIp("2001:db8:abcd:12::1"), scope.normalizeClientIp("2001:db8:abcd:13::1"));
  assert.notEqual(scope.normalizeClientIp("2001:db8:abcd:12::1"), scope.normalizeClientIp("2001:db9:abcd:12::1"));
  assert.notEqual(scope.normalizeClientIp("203.0.113.80"), scope.normalizeClientIp("203.0.113.81"));
  assert.equal(scope.normalizeClientIp("::ffff:203.0.113.80"), "203.0.113.80");
});

await check("C3", "super-long inputs do not throw and run fast (no ReDoS)", async () => {
  const inputs = [
    ":".repeat(200_000),
    "1:".repeat(100_000) + "1.2.3.4",
    "a".repeat(500_000) + ":1",
    "1:".repeat(100_000) + "1.2.3.4.5.6.7.8.9",
    "::ffff:" + "9".repeat(200_000),
    "%".repeat(100_000) + ":",
  ];
  let worst = 0;
  for (const s of inputs) {
    const t0 = performance.now();
    const r = scope.normalizeClientIp(s);
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt);
    assert.equal(typeof r, "string");
    assert.ok(dt < 500, `took ${dt.toFixed(1)}ms for length ${s.length}`);
  }
  return `worst ${worst.toFixed(1)}ms`;
});

// ---------------------------------------------------------------------------
// d. public-read-auth：同一個 /64 的家庭多台裝置
// ---------------------------------------------------------------------------
await check("D1", "public-read rateKey per /64: 4 devices x 8 req/min share 30/min (HEAD: separate keys)", async () => {
  let resolvePrincipal = null;
  try {
    ({ resolvePublicReadPrincipal: resolvePrincipal } = await import("../src/lib/public-read-auth.ts"));
  } catch (error) {
    resolvePrincipal = null;
  }
  const devices = ["2001:db8:1:2::a", "2001:db8:1:2:1c3f:9a2b:4c5d:6e7f", "2001:db8:1:2:aaaa::1", "2001:db8:1:2:ffff:ffff:ffff:fffe"];
  const keys = [];
  for (const ip of devices) {
    const req = new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": ip } });
    const p = resolvePrincipal ? await resolvePrincipal(req) : { kind: "guest", rateKey: scope.resolveTrustedIp(req) };
    assert.equal(p.kind, "guest");
    keys.push(p.rateKey);
  }
  assert.equal(new Set(keys).size, 1, `rateKeys ${keys}`);
  const runFamily = (mapper, tag) => {
    let denied = 0;
    for (let n = 0; n < 8; n += 1) for (const ip of devices) {
      if (!checkRateLimit(`public-read:${tag}:${mapper(ip)}`, 30, 60_000).allowed) denied += 1;
    }
    return denied;
  };
  const curDenied = runFamily((ip) => scope.normalizeClientIp(ip), "cur");
  const headDenied = runFamily((ip) => ip, "head");
  assert.equal(headDenied, 0);
  const curHousehold = (() => {
    let denied = 0;
    for (let n = 0; n < 7; n += 1) for (const ip of devices) {
      if (!checkRateLimit(`public-read:cur7:${scope.normalizeClientIp(ip)}`, 30, 60_000).allowed) denied += 1;
    }
    return denied;
  })();
  return `resolvePublicReadPrincipal=${resolvePrincipal ? "real" : "fallback(resolveTrustedIp)"} key=${keys[0]}; 32 req/min: current denied=${curDenied}, HEAD denied=${headDenied}; 28 req/min: current denied=${curHousehold}`;
});

// ---------------------------------------------------------------------------
// e. legacy_capability、前端原因碼、place-photo 程序內限流
// ---------------------------------------------------------------------------
await check("E1", "guest cannot turn a guest token into a legacy (no aud) or authenticated token", async () => {
  const g = makeGuard();
  const env = envOf(g, { enforcement: true });
  const t = await signPlacePhoto(env, photo, 480, undefined, "guest");
  const stripped = await photoRaw(env, "198.51.100.20", `expires=${t.expires}&signature=${encodeURIComponent(t.signature)}`);
  assert.equal(stripped.response.status, 401, `stripped aud -> ${stripped.response.status}`);
  const relabel = await photoRaw(env, "198.51.100.20", `expires=${t.expires}&signature=${encodeURIComponent(t.signature)}&aud=authenticated&principal=x`);
  assert.equal(relabel.response.status, 401);
  const bogus = await photoRaw(env, "198.51.100.20", `expires=${t.expires}&signature=${encodeURIComponent(t.signature)}&aud=legacy_capability`);
  assert.equal(bogus.response.status, 401);
  const longExpiry = await signPlacePhoto(env, photo, 480, Math.floor(Date.now() / 1000) + 3600);
  const future = await photoRaw(env, "198.51.100.20", `expires=${longExpiry.expires}&signature=${encodeURIComponent(longExpiry.signature)}`);
  assert.equal(future.response.status, 401, "legacy expiry beyond TTL+30 rejected");
  assert.equal(stripped.upstream + relabel.upstream + bogus.upstream + future.upstream, 0);
});

await check("E2", "IF a legacy (no aud) token existed it would bypass the guest share (documenting the risk)", async () => {
  const G = 2000;
  const share = policy.guestGlobalDailyUnits(G);
  const g = makeGuard();
  const env = envOf(g, { enforcement: true, globalUnits: G });
  await seedGlobal(g, share, share);
  const legacy = await photoCall(env, { ip: "198.51.100.21", mode: "legacy" });
  const guest = await photoCall(env, { ip: "198.51.100.21" });
  assert.equal(guest.body?.reason, "guest_global_budget_limited");
  return `legacy token with guest share full -> ${legacy.response.status} (guest counter ${guestW(g)}); guest-aud -> ${guest.response.status}`;
});

await check("E3", "frontend reason mapping for guest_global_budget_limited (vs global_budget_limited)", async () => {
  const guestBody = { error: "rate_limited", reason: "guest_global_budget_limited" };
  const globalBody = { error: "rate_limited", reason: "global_budget_limited" };
  const guestText = JSON.stringify(guestBody);
  const rows = {};
  rows.fixedGuest = fixedPlacesFailureReason(guestBody) ?? "undefined";
  rows.fixedGlobal = fixedPlacesFailureReason(globalBody) ?? "undefined";
  rows.fixedGuestText = fixedPlacesFailureReason(guestText) ?? "undefined";
  rows.normalizeGuest = normalizePlacesSearchResult({ places: [], ...guestBody }).reason ?? "none";
  // places.functions: 429 -> Error(`places_http_429:${parseGoogleError(text)}`); parseGoogleError falls back to raw text for guest
  const guestErr = new Error(`places_http_429:${guestText}`);
  const globalErr = new Error("places_http_429:global_budget_limited");
  rows.classifyGuest = discoveryScope.classifyDiscoverySearch(guestErr, true);
  rows.classifyGlobal = discoveryScope.classifyDiscoverySearch(globalErr, true);
  rows.reasonGuest = discoveryScope.discoverySearchFailureReason(guestErr, rows.classifyGuest);
  rows.reasonGlobal = discoveryScope.discoverySearchFailureReason(globalErr, rows.classifyGlobal);
  rows.discoveryFailureGuest = discoveryTrace.discoveryFailure(rows.reasonGuest);
  rows.discoveryFailureRaw = discoveryTrace.discoveryFailure("guest_global_budget_limited");
  // unified fallback when client is rate-limited: fixedPlacesFailureReason(serverResult) ?? "cooldown_skipped"
  rows.unifiedGuest = fixedPlacesFailureReason({ places: [], error: guestErr.message }) ?? "cooldown_skipped";
  rows.unifiedGlobal = fixedPlacesFailureReason({ places: [], error: globalErr.message }) ?? "cooldown_skipped";
  // trace request() counts it as rate-limited?
  const logs = [];
  console.info = (...a) => logs.push(a.join(" "));
  const trace = discoveryTrace.createCombinationDiscoveryTrace("abcdef01");
  await trace.request(async () => { throw guestErr; }).catch(() => {});
  trace.finish(false);
  console.info = quiet;
  const summary = logs.find((l) => l.includes("request_summary")) ?? "";
  const final = logs.find((l) => l.includes(" final")) ?? "";
  rows.traceRateLimited = /"rateLimited":1/.test(summary);
  rows.traceFinal = (final.match(/"failureReason":"([^"]+)"/) ?? [])[1] ?? "?";
  assert.notEqual(rows.discoveryFailureGuest, "unknown", "guest denial classified as unknown in discovery trace");
  return JSON.stringify(rows);
});

await check("E4", "place-photo.ts:239 in-process photo:<raw ip>:minute limiter (enforcement off): /64 rotation evades it, but google:photo burst + daily IP use /64", async () => {
  const g = makeGuard();
  const seen = [];
  const env = envOf(g, { enforcement: false, seen });
  const limit = SECURITY_RATE_LIMITS.photoPerMinute;
  // 單一 IPv6 位址超過 limit -> 429（程序內限流仍生效）
  let single429 = 0;
  for (let n = 0; n < limit + 1; n += 1) {
    const r = await photoCall(env, { ip: "2001:db8:77:1::1" });
    if (r.response.status === 429) single429 += 1;
  }
  // 同 /64 輪替 limit+1 個不同位址 -> 程序內限流不擋
  let rot429 = 0;
  const before = seen.length;
  for (let n = 0; n < limit + 1; n += 1) {
    const r = await photoCall(env, { ip: `2001:db8:77:2::${(n + 1).toString(16)}` });
    if (r.response.status === 429) rot429 += 1;
  }
  const rotKeys = new Set(seen.slice(before));
  assert.equal(single429, 1, `single address hits in-process limit once (got ${single429})`);
  assert.equal(rot429, 0);
  assert.deepEqual([...rotKeys], ["google:photo:2001:db8:77:2::/64"], "burst key is /64");
  assert.equal(ipW(g, "2001:db8:77:2::/64"), limit + 1, "daily IP weight merged per /64");
  return `limit=${limit}/min; single addr 429s=${single429}; rotated /64 429s=${rot429}; burst keys=${[...rotKeys]}`;
});

const failed = results.filter((r) => !r.ok).map((r) => r.id);
out(`\nSUMMARY ${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
console.info = realInfo;
process.exit(failed.length ? 1 : 0);
