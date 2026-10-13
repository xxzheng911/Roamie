// Public venue/type/time shapes observed in saved trips; no account, trip ID or chat data.
// A was generated after 5a1bbc00 activation. B predates it and is regression evidence only.
const stop = (id, name, type, time, types = [type]) => ({
  id,
  name,
  primaryType: type,
  types,
  time,
  googlePlaceId: `ChIJfixture${id}`,
  lat: 35.69 + id.length * 0.0001,
  lng: 139.7,
  address: "東京都",
  rating: 4.5,
  userRatingCount: 1200,
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
});
export const productionA = [
  {
    day: 1,
    places: [
      stop("a1", "心齋橋筋商店街", "market", "11:00"),
      stop("a2", "Osaka Romantei", "japanese_restaurant", "12:00", [
        "japanese_restaurant",
        "restaurant",
        "food",
      ]),
      stop("a3", "OKO - Fun Okonomiyaki 酒吧", "japanese_restaurant", "12:30", [
        "vegan_restaurant",
        "vegetarian_restaurant",
        "japanese_restaurant",
        "restaurant",
        "food",
      ]),
      stop("a4", "道頓堀", "tourist_attraction", "14:00"),
      stop("a5", "北極星", "japanese_restaurant", "18:30", [
        "japanese_restaurant",
        "restaurant",
        "food",
      ]),
    ],
  },
  {
    day: 2,
    places: [
      stop("a6", "住吉大社", "shinto_shrine", "09:30"),
      stop("a7", "新世界", "market", "11:00"),
      stop("a8", "通天閣", "observation_deck", "12:30"),
      stop("a9", "大阪城公園", "park", "14:00"),
      stop("a10", "DOTONBORI KUROFUNE", "japanese_restaurant", "18:30", [
        "japanese_restaurant",
        "restaurant",
        "food",
      ]),
    ],
  },
];
export const productionB = [
  {
    day: 1,
    places: [
      stop("b1", "濱離宮恩賜庭園", "garden", "10:00"),
      stop("b2", "東京鐵塔", "observation_deck", "11:37"),
      stop("b3", "薩庫拉橋", "bridge", "13:34"),
      stop("b4", "世田谷 豪德寺", "buddhist_temple", "15:15"),
      stop("b5", "東京都廳 北展望室", "observation_deck", "17:07"),
    ],
  },
  {
    day: 2,
    places: [
      stop("b6", "御台場海濱公園", "park", "10:00"),
      stop("b7", "伊吹壽喜燒", "restaurant", "11:51"),
      stop("b8", "Washoku", "japanese_restaurant", "13:41", [
        "japanese_restaurant",
        "japanese_izakaya_restaurant",
        "snack_bar",
        "restaurant",
        "food",
      ]),
      stop("b9", "Imagawa", "seafood_restaurant", "15:29", [
        "seafood_restaurant",
        "brunch_restaurant",
        "japanese_izakaya_restaurant",
        "restaurant",
        "food",
      ]),
      stop("b10", "SAAMROT", "thai_restaurant", "17:22", ["thai_restaurant", "restaurant", "food"]),
    ],
  },
];
// Coordinates intentionally normalized to one walkable cluster, so fixtures test scheduling,
// not Tokyo/Osaka geography. IDs are mock identities and cannot invoke provider lookups.
export const asPlans = (days) =>
  days.map(({ day, places }) => ({
    day,
    entries: places.map((p) => ({ time: p.time, label: "景點", name: p.name, place: p })),
  }));
