/**
 * L4 probe (diagnostic only, no assertions):
 *  - which fixture pools build combinations;
 *  - how many geocodeFn calls Places discovery makes for a switched destination (route passes
 *    geocodeFn; after the combination switch destinationCoordinates are cleared, so discovery
 *    receives no resolvedDestination unless the local scope table has one).
 * Run: npx vite-node scripts/verify-l-seoul-pool-probe.mjs --config scripts/vite.verify.config.mjs
 */
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK"); };
const discovery = await import(/* @vite-ignore */ "/src/lib/ai/destination-combination-discovery.ts");
const poolCache = await import(/* @vite-ignore */ "/src/lib/ai/places-cost-cache/candidate-pool-cache.ts");
const scopeMod = await import(/* @vite-ignore */ "/src/lib/ai/destination-scope.ts");
const mk = (key, names, lang, lat, lng, address) => names.map((name, i) => ({ id: `ChIJP${key}${i}`, name, sourceLocale: lang, lat: lat + i * 0.0003, lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address, businessStatus: "OPERATIONAL" }));
const KYOTO = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都文化博物館", "京都国際マンガミュージアム", "細見美術館", "京都御苑", "円山公園", "京都府立植物園", "嵐山公園", "梅小路公園", "鴨川公園"];
const CASES = [
  ["京都", "JP", 35.0116, 135.7681, mk("kyoto", KYOTO, "ja", 35.0116, 135.7681, "Kyoto Japan")],
  ["台東", "TW", 22.758, 121.1444, mk("tt", ["三仙台", "伯朗大道", "鹿野高台", "小野柳", "多良車站", "加路蘭", "國立臺灣史前文化博物館", "鐵花村", "臺東美術館", "池上穀倉藝術館", "臺東故事館", "卑南遺址公園", "臺東森林公園", "琵琶湖", "大坡池", "海濱公園", "知本國家森林遊樂區", "關山親水公園"], "zh-TW", 22.758, 121.1444, "Taitung Taiwan")],
  ["首爾", "KR", 37.5665, 126.978, mk("seoul", ["景福宮", "N首爾塔", "北村韓屋村", "明洞", "昌德宮", "仁寺洞", "國立中央博物館", "首爾歷史博物館", "國立現代美術館", "戰爭紀念館", "Leeum美術館", "大韓民國歷史博物館", "南山公園", "首爾林", "奧林匹克公園", "汝矣島漢江公園", "北漢山國立公園", "駱山公園"], "zh-TW", 37.5665, 126.978, "Seoul, South Korea")],
  ["釜山", "KR", 35.1796, 129.0756, []],
  ["大阪", "JP", 34.6937, 135.5023, []],
];
for (const [dest, cc, lat, lng, pool] of CASES) {
  discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache();
  let calls = 0; let geo = 0;
  const scope = scopeMod.resolveDestinationScopeFields(dest);
  const r = await discovery.ensureDestinationCombinationsReady({ destination: dest, destinationCountry: cc, locale: "zh-TW", days: 5,
    geocodeFn: async () => { geo++; return { rawResultCount: 1, location: { placeId: `ChIJ${dest}`, country: cc, city: dest, region: dest, lat, lng, formattedName: dest, displayLabel: dest } }; },
    searchPlaces: async () => { calls++; return { places: pool, error: null }; } });
  out(`RESULT ${dest}: ok=${r.ok} n=${r.combinations?.length ?? 0} reason=${r.failureReason ?? ""} searchCalls=${calls} geocodeFnCalls=${geo} scope=${JSON.stringify({ name: scope.destinationName, type: scope.destinationType, country: scope.destinationCountry })}`);
}
out(`fetch=${fetchCalls}`);
process.exit(0);
