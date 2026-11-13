/**
 * KIJ2-H — Home Plus insight grammar per locale.
 *  - en: interpolated category labels are lower-case mid-sentence (moodSaved / saved / nearbySaved x2 / evening / nearby).
 *  - ko: particles follow the interpolated value (을/를, 과/와, 이/가, 이에요/예요, quoted “…”을/를).
 *  - zh-TW / ja copy unchanged; chat / trip / mood text (user content) is never lower-cased.
 * Fixtures: cafe (ko 카페, vowel ending) and book_store (ko 서점, batchim ending).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=90 scripts/verify-home-insight-locale-grammar.mjs
 */
import assert from "node:assert/strict";

let failures = 0;
let passes = 0;
function check(name, fn) {
  try {
    fn();
    passes++;
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

try {
  const { buildHomePlusInsight } = await import("../src/lib/home-personalization-insight.ts");
  const { getLocalizedPlaceCategoryLabel } = await import("../src/lib/place-category.ts");

  const realGetHours = Date.prototype.getHours;
  const at = (hour, fn) => {
    Date.prototype.getHours = () => hour;
    try {
      return fn();
    } finally {
      Date.prototype.getHours = realGetHours;
    }
  };
  const cafe = { name: "Fixture Cafe", primaryType: "cafe", types: ["cafe"] };
  const book = { name: "Fixture Books", primaryType: "book_store", types: ["book_store"] };
  const saved = (p, i) => ({ id: `s${i}`, name: p.name, address: "", category: p.primaryType, metadata: { primaryType: p.primaryType, types: p.types } });
  const build = (locale, input, hour = 12) => at(hour, () => buildHomePlusInsight({ savedPlaces: [], locale, ...input }));

  check("fixture categories", () => {
    assert.equal(getLocalizedPlaceCategoryLabel(cafe, "en"), "Cafés");
    assert.equal(getLocalizedPlaceCategoryLabel(book, "en"), "Bookstores");
    assert.equal(getLocalizedPlaceCategoryLabel(cafe, "ko"), "카페");
    assert.equal(getLocalizedPlaceCategoryLabel(book, "ko"), "서점");
  });

  // ---------- en lower-case ----------
  const en = (input, hour) => build("en", input, hour);
  check("en insightMoodSaved", () => {
    assert.equal(en({ selectedMood: "Chill", savedPlaces: [saved(cafe, 1)] }), "You're feeling “Chill” and often save cafés. Let's explore at that pace today.");
  });
  check("en insightSaved", () => {
    assert.equal(en({ savedPlaces: [saved(cafe, 1), saved(cafe, 2), saved(book, 3)] }), "Your recent saves in cafés, bookstores suggest a relaxed day with room to explore.");
  });
  check("en insightNearbySaved (saved + nearby)", () => {
    assert.equal(en({ savedPlaces: [saved(cafe, 1)], nearbyPicks: [book] }), "We could connect your saved cafés with nearby bookstores for an easy route today.");
  });
  check("en insightEvening", () => {
    assert.equal(en({ nearbyPicks: [cafe, book] }, 20), "It's evening. Nearby cafés, bookstores are a good way to unwind without rushing.");
  });
  check("en insightNearby", () => {
    assert.equal(en({ nearbyPicks: [book] }, 12), "There are bookstores nearby. Tell me what you feel like and I'll narrow it down.");
  });
  check("en mood / chat / trip user text is NOT lower-cased", () => {
    assert.ok(en({ selectedMood: "Chill", savedPlaces: [saved(cafe, 1)] }).includes("“Chill”"));
    assert.ok(en({ chatSession: { lastUserIntent: "Tokyo Cafe Hopping" } }).includes("“Tokyo Cafe Hopping”"));
    assert.ok(en({ latestTripTitle: "Osaka Weekend" }).includes("“Osaka Weekend”"));
  });

  // ---------- ko particles ----------
  const ko = (input, hour) => build("ko", input, hour);
  check("ko insightPreferences 이에요 (batchim)", () => {
    assert.equal(ko({ prefs: { interests: ["박물관"] } }), "기억하고 있는 취향은 좋아하는 박물관이에요. 이 조건에 맞춰 오늘의 장소를 추천할게요.");
  });
  check("ko insightPreferences 예요 (vowel)", () => {
    assert.equal(ko({ prefs: { interests: ["카페"] } }), "기억하고 있는 취향은 좋아하는 카페예요. 이 조건에 맞춰 오늘의 장소를 추천할게요.");
    assert.ok(ko({ prefs: { interests: ["카페"], avoid: ["소음"] } }).includes("소음 피하기예요."));
  });
  check("ko insightMoodSaved 를/을", () => {
    assert.ok(ko({ selectedMood: "여유", savedPlaces: [saved(cafe, 1)] }).includes("카페를 자주 저장하셨네요"));
    assert.ok(ko({ selectedMood: "여유", savedPlaces: [saved(book, 1)] }).includes("서점을 자주 저장하셨네요"));
  });
  check("ko insightSaved 를/을 (last word decides)", () => {
    assert.ok(ko({ savedPlaces: [saved(book, 1), saved(book, 2), saved(cafe, 3)] }).includes("서점, 카페를 바탕으로"));
    assert.ok(ko({ savedPlaces: [saved(cafe, 1), saved(cafe, 2), saved(book, 3)] }).includes("카페, 서점을 바탕으로"));
  });
  check("ko insightNearbySaved 와/과 + 을/를", () => {
    assert.equal(ko({ savedPlaces: [saved(cafe, 1)], nearbyPicks: [book] }), "저장한 카페와 가까운 서점을 연결해 알맞은 동선을 만들 수 있어요.");
    assert.equal(ko({ savedPlaces: [saved(book, 1)], nearbyPicks: [cafe] }), "저장한 서점과 가까운 카페를 연결해 알맞은 동선을 만들 수 있어요.");
  });
  check("ko insightChat quoted 을/를", () => {
    assert.ok(ko({ chatSession: { lastUserIntent: "도쿄 여행 계획" } }).includes("“도쿄 여행 계획”을 바탕으로"));
    assert.ok(ko({ chatSession: { lastUserIntent: "서울 카페 투어" } }).includes("“서울 카페 투어”를 바탕으로"));
  });
  check("ko insightTrip quoted 을/를", () => {
    assert.ok(ko({ latestTripTitle: "부산 여행" }).includes("“부산 여행”을 바탕으로"));
    assert.ok(ko({ latestTripTitle: "제주 바다" }).includes("“제주 바다”를 바탕으로"));
  });
  check("ko insightNearby 이/가", () => {
    assert.ok(ko({ nearbyPicks: [cafe] }, 12).startsWith("근처에 카페가 있어요."));
    assert.ok(ko({ nearbyPicks: [book] }, 12).startsWith("근처에 서점이 있어요."));
  });

  // ---------- zh-TW / ja unchanged ----------
  check("zh-TW / ja copy unchanged", () => {
    assert.equal(build("zh-TW", { nearbyPicks: [cafe] }, 12), "附近現在有咖啡廳的選擇，跟我說你今天想怎麼過，我來幫你收斂。");
    assert.equal(build("ja", { nearbyPicks: [cafe] }, 12), "近くにはカフェがあります。今日の気分を教えてくれたら、候補を絞ります。");
  });

  // INFO only (outside the 7 sites in scope): remaining ko templates with fixed particles after quotes.
  const info = [
    ko({ chatSession: { lastUserIntent: "도쿄 여행 계획" }, prefs: { pace: "slow" } }),
    ko({ chatSession: { lastUserIntent: "도쿄 여행 계획" }, selectedMood: "행복" }),
    ko({ selectedMood: "행복" }, 12),
  ];
  console.log("INFO ko out-of-scope templates:\n  " + info.join("\n  "));
} catch (error) {
  failures++;
  console.log("FAIL harness", error?.stack ?? error);
}

console.log(`${failures ? "FAIL" : "PASS"} home insight locale grammar: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
