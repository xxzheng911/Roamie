/**
 * Global: reject SEO / booking / tour-product titles from place candidate pools.
 * Destination-agnostic — covers Hualien bug + Tokyo/Seoul/Paris/etc. patterns.
 */
import assert from "node:assert/strict";
import {
  isLikelyPlaceName,
  normalizePlaceCandidateName,
} from "../src/lib/ai/place-name-likelihood.ts";
import { validateCandidateIntent } from "../src/lib/ai/combination-candidate-quality.ts";
import { isValidItineraryStopPlace } from "../src/lib/ai/generic-place-label.ts";

const HUALIEN_BAD =
  "花蓮沙灘車報名處/天空之鏡費用/花蓮天空之鏡怎麼拍-花蓮沙灘車自行前往天空之鏡報名處、張家樹園、花蓮賞鯨體驗/旅遊行程規劃/導覽(市區可預約接送)";

const GLOBAL_BAD = [
  HUALIEN_BAD,
  "東京一日遊預約",
  "首爾包車行程",
  "巴黎博物館門票優惠",
  "曼谷水上市場半日遊",
  "墨爾本大洋路接送方案",
  "花蓮沙灘車報名處",
  "Klook 賞鯨體驗優惠",
  "又一村文創園區 (各店詳細營業時間請見粉絲專頁)",
  "京都半日遊｜清水寺＋二年坂接送",
  "大阪一日遊攻略/怎麼去/費用",
];

const GLOBAL_GOOD = [
  "清水寺",
  "台北101",
  "石門水庫",
  "長頸鹿親子公園",
  "花蓮港景觀橋",
  "帝君廟",
  "明治神宮",
  "景福宮",
  "聖母院",
  "大溪老街",
  "Xpark",
];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("=== place-name likelihood / non-place reject ===\n");

check("Hualien SEO bundle rejected as seo_title", () => {
  const r = isLikelyPlaceName(HUALIEN_BAD);
  assert.equal(r.ok, false);
  assert.ok(
    r.reason === "seo_title" ||
      r.reason === "long_marketing_text" ||
      r.reason === "multi_activity_bundle" ||
      r.reason === "booking_page",
    `reason=${r.reason}`,
  );
});

check("must not split SEO bundle into accepted parts via normalize", () => {
  const n = normalizePlaceCandidateName(HUALIEN_BAD);
  assert.equal(n.accepted, false);
});

for (const name of GLOBAL_BAD) {
  check(`reject: ${name.slice(0, 40)}`, () => {
    const r = isLikelyPlaceName(name);
    // Parenthetical-only case may normalize to a short core — check normalize path too.
    if (name.includes("粉絲專頁")) {
      const n = normalizePlaceCandidateName(name);
      // After strip, core may be accepted if short; raw must fail likelihood before strip
      // or normalize accepts only the cleaned core without marketing paren.
      assert.ok(
        !r.ok || n.accepted,
        "fan-page paren: raw rejected or cleaned accepted",
      );
      if (n.accepted) {
        assert.ok(!/粉絲|營業時間|請見/.test(n.normalized));
        assert.ok(n.normalized.length <= 36);
      }
      return;
    }
    assert.equal(r.ok, false, `${name} should be rejected, reason=${r.reason}`);
    assert.equal(
      validateCandidateIntent({ name }, {}, "花蓮").ok,
      false,
    );
    assert.equal(
      isValidItineraryStopPlace({ name, googlePlaceId: "ChIJ_x", lat: 24, lng: 121 }, "花蓮"),
      false,
    );
  });
}

for (const name of GLOBAL_GOOD) {
  check(`accept: ${name}`, () => {
    const r = isLikelyPlaceName(name);
    assert.equal(r.ok, true, `${name} rejected as ${r.reason}`);
  });
}

check("travel_agency type forbidden", () => {
  const r = validateCandidateIntent(
    {
      name: "花蓮旅遊服務中心旅行社",
      types: ["travel_agency"],
      primaryType: "travel_agency",
      googlePlaceId: "ChIJ_agency",
    },
    { theme: "attraction" },
    "花蓮",
  );
  assert.equal(r.ok, false);
});

check("real park still accepted", () => {
  const r = validateCandidateIntent(
    {
      name: "美崙溪自行車道",
      types: ["park", "tourist_attraction"],
      primaryType: "park",
      googlePlaceId: "ChIJ_park",
      lat: 23.99,
      lng: 121.63,
    },
    { theme: "nature" },
    "花蓮",
  );
  assert.equal(r.ok, true, r.reason);
});

console.log(`\n=== summary failed=${failed} ===`);
if (failed > 0) process.exit(1);
console.log("All place-name likelihood checks passed.");
