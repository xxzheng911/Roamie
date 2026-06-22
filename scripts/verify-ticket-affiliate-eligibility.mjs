import {
  buildTicketAffiliateSearchKeyword,
  isFamousLandmarkName,
  shouldShowTicketAffiliate,
} from "../src/lib/affiliate/ticket-affiliate-eligibility.ts";

const shouldShow = [
  ["富士山", {}],
  ["東京哈利波特影城", {}],
  ["東京淺草雷門", {}],
  ["淺草寺", {}],
  ["雷門", {}],
  ["仲見世商店街", {}],
  ["東京晴空塔", {}],
  ["東京鐵塔", {}],
  ["teamLab Planets", {}],
  ["澀谷 Sky", {}],
  ["大阪環球影城", {}],
  ["清水寺", {}],
  ["伏見稻荷大社", {}],
  ["首爾塔", {}],
  ["景福宮", {}],
  ["樂天世界", {}],
  ["香港迪士尼樂園", {}],
  ["濱海灣花園", {}],
  [
    "國立科學工藝博物館",
    { types: ["museum"], rating: 4.5, userRatingCount: 2500 },
  ],
];

const shouldHide = [
  ["河濱公園", { types: ["park"] }],
  ["小型社區公園", { types: ["park", "tourist_attraction"] }],
  ["星巴克 淺草店", { types: ["cafe"] }],
  ["一蘭拉麵", { types: ["restaurant"] }],
  ["HARBS 甜點", { types: ["bakery", "cafe"] }],
  ["7-ELEVEN", { types: ["convenience_store"] }],
  ["東京車站", { types: ["transit_station"] }],
  ["新宿飯店", { types: ["lodging"] }],
  ["路邊小商店", { types: ["store"] }],
  ["普通散步點", { types: ["tourist_attraction"], rating: 4.0, userRatingCount: 12 }],
];

let failed = 0;

for (const [name, extra] of shouldShow) {
  const place = { placeName: name, ...extra };
  const decision = shouldShowTicketAffiliate(place);
  if (!decision.show) {
    console.error(`FAIL should show: ${name} → ${decision.reason}`);
    failed += 1;
  } else {
    console.log(`OK show: ${name} (${decision.reason}) keyword=${decision.searchKeyword}`);
  }
}

for (const [name, extra] of shouldHide) {
  const place = { placeName: name, ...extra };
  const decision = shouldShowTicketAffiliate(place);
  if (decision.show) {
    console.error(`FAIL should hide: ${name} → ${decision.reason}`);
    failed += 1;
  } else {
    console.log(`OK hide: ${name} (${decision.reason})`);
  }
}

const keyword = buildTicketAffiliateSearchKeyword(
  { placeName: "東京淺草雷門" },
  { destinationLabel: "東京" },
);
if (!/淺草/.test(keyword) || !/雷門/.test(keyword)) {
  console.error(`FAIL keyword: ${keyword}`);
  failed += 1;
} else {
  console.log(`OK keyword: ${keyword}`);
}

if (!isFamousLandmarkName("淺草寺")) {
  console.error("FAIL whitelist: 淺草寺");
  failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} verification failure(s)`);
  process.exit(1);
}

console.log("\nAll ticket affiliate eligibility checks passed.");
