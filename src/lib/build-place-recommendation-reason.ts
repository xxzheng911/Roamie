import type { PlaceResult } from "@/lib/place-result";
import {
  identityDisplayLabel,
  resolvePlaceIdentity,
  type PlaceIdentity,
} from "@/lib/place-identity";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
  type BudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import { getPlaceReasonCopy, reasonIdentityIntro } from "@/lib/i18n/place-reason-copy";

export type UserProfileForReason = {
  onboarded?: boolean;
  pace?: TravelPreferences["pace"];
  vibe?: TravelPreferences["vibe"];
  budgetMode?: BudgetMode;
  interests?: string[];
  travelStyle?: string;
  personalityType?: string;
  personalitySummary?: string;
  mood?: string;
  aiPreferences?: Record<string, unknown>;
};

export type PlaceRecommendationContext = {
  /** 僅供相容；文案類型判斷請用 resolvePlaceIdentity，不看 chip 名稱 */
  categoryLabel?: string;
  distanceMeters?: number;
  mood?: string;
  isSavedFavorite?: boolean;
};

const SAFE_FALLBACK =
  "這個地點距離你不遠，評價不錯，可以順路安排進今天行程。";

/** 各身分的主文案模板（禁止跨類型亂套） */
const IDENTITY_INTROS: Record<PlaceIdentity, string[]> = {
  bookstore: [
    "這是一間書店，適合想安靜逛逛、找本書慢慢待著的時候。",
    "書店氛圍通常比較安靜，適合翻書、歇腳、整理思緒。",
  ],
  breakfast_shop: [
    "這是一間在地早餐店，適合早上順路吃點台式早餐再開始今天行程。",
    "早餐店節奏輕快，適合一早先填肚子、再出發逛。",
  ],
  cafe: [
    "這間咖啡店氣氛偏安靜，很適合下午放空或坐著休息一下。",
    "咖啡店適合帶本書或耳機，慢慢坐一會兒。",
  ],
  bakery: [
    "這間烘焙坊適合買點心或下午茶，不必安排太久。",
    "烘焙坊適合順路帶份點心，當行程中的小確幸。",
  ],
  dessert: [
    "這裡是甜點類店家，適合下午茶或解解饞。",
    "甜點店節奏輕鬆，適合走累了進來坐一下。",
  ],
  restaurant: [
    "這是一間餐廳，適合正餐或好好吃頓飯再繼續走。",
    "餐廳選擇適合把肚子填飽，當行程的中繼站。",
  ],
  food_stall: [
    "這裡是小吃類店家，適合快速解饞、不必久留。",
    "小吃店適合順路買一份，邊走邊吃或外帶。",
  ],
  shopping_mall: [
    "可以一次逛很多店，適合慢慢逛街放空。",
    "很適合順路探索，想逛多久都可以自己安排。",
  ],
  department_store: [
    "適合慢慢逛街放空，可以一次逛很多品牌。",
    "很適合順路探索，室內逛起來節奏比較舒服。",
  ],
  tourist_attraction: [
    "這是一處景點，適合順路繞進去看看、拍拍照。",
    "景點適合排進行程中彈性的一站，不必趕。",
  ],
  museum: [
    "如果你喜歡慢慢看展或室內行程，這裡會是不錯的停留點。",
    "博物館適合想躲太陽或下雨天，靜靜看一會兒。",
  ],
  night_market: [
    "晚上氣氛不錯，很適合晚上散步、邊逛邊吃。",
    "可以一次逛很多攤，適合慢慢逛街放空。",
  ],
  district: [
    "很適合順路探索，適合不趕時間繞一圈。",
    "適合慢慢逛街放空，可以一次逛很多小店。",
  ],
  park: [
    "這裡是公園或綠地，適合讓腳步慢下來、透透氣。",
    "公園適合傍晚散步，把節奏放慢。",
  ],
  bar: [
    "這裡適合夜晚小坐，散步後來一杯剛好。",
    "酒吧氛圍偏夜晚，適合行程尾聲放鬆一下。",
  ],
  generic: [SAFE_FALLBACK],
  unsupported: [SAFE_FALLBACK],
};

const IDENTITY_SCENE: Partial<Record<PlaceIdentity, string[]>> = {
  bookstore: ["適合慢慢翻書", "適合找室內休息點"],
  breakfast_shop: ["適合一早出發前", "不用排太久"],
  cafe: ["適合坐下來發呆", "適合下午歇腳"],
  night_market: ["晚上氣氛不錯", "很適合晚上散步", "可以一次逛很多攤"],
  museum: ["適合室內待一陣子", "適合喜歡文化的人"],
  park: ["綠意多、步調輕鬆", "適合傍晚"],
  department_store: ["可以一次逛很多店", "適合找伴手禮"],
  shopping_mall: ["適合慢慢逛", "可以一次逛很多店"],
  district: ["很適合順路探索", "適合找伴手禮"],
};

const DISTRICT_STYLE_IDENTITIES: PlaceIdentity[] = [
  "district",
  "shopping_mall",
  "department_store",
  "night_market",
];

function isDistrictStyleReason(
  identity: PlaceIdentity,
  ctx?: PlaceRecommendationContext,
): boolean {
  return (
    DISTRICT_STYLE_IDENTITIES.includes(identity) || ctx?.categoryLabel === "商圈"
  );
}

const PACE_PHRASE: Record<string, string> = {
  slow: "你偏好慢慢散步、不趕行程",
  medium: "你喜歡節奏剛好的探索",
  active: "你喜歡多看看、多走走",
};

const VIBE_PHRASE: Record<string, string> = {
  quiet: "安靜、有質感",
  either: "氛圍舒服、好待",
  lively: "有生活感、熱鬧但不至於太擠",
};

function hashPick(seed: string, options: string[]): string {
  if (options.length === 0) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 9973;
  return options[h % options.length]!;
}

export function hasCompletedTravelQuiz(profile: UserProfileForReason | null | undefined): boolean {
  return Boolean(profile?.onboarded);
}

function inferInterestTags(profile: UserProfileForReason): string[] {
  const blob = [
    profile.travelStyle ?? "",
    profile.personalityType ?? "",
    profile.personalitySummary ?? "",
    profile.pace === "slow" ? "慢 散步 療癒 發呆" : "",
    profile.pace === "active" ? "探索 走走 多看" : "",
    profile.vibe === "quiet" ? "安靜 書店 咖啡 角落" : "",
    profile.vibe === "lively" ? "市集 熱鬧 生活感" : "",
    ...(profile.interests ?? []),
    JSON.stringify(profile.aiPreferences ?? {}),
  ]
    .join(" ")
    .toLowerCase();

  const tags: string[] = [];
  if (/拍照|攝影|打卡|photo/i.test(blob)) tags.push("photo");
  if (/美食|吃|餐|小吃|甜點|咖啡/i.test(blob)) tags.push("food");
  if (/逛|購物|shop/i.test(blob)) tags.push("shopping");
  if (/自然|公園|海|山|戶外|健行/i.test(blob)) tags.push("nature");
  if (/文化|藝術|展覽|博物館|書/i.test(blob)) tags.push("culture");
  return tags;
}

function distancePhrase(meters?: number): string | null {
  if (meters === undefined) return null;
  if (meters < 600) return "距離你很近";
  if (meters < 1800) return "走路或短程就能到";
  if (meters < 5000) return "不算遠，適合順路過去";
  return "稍遠一點，但值得專程安排";
}

function ratingPhrase(rating: number | null, count: number | null): string | null {
  if (rating == null || rating < 4) return null;
  if (count != null && count >= 80) return `評價 ${rating.toFixed(1)} 分、口碑不錯`;
  if (rating >= 4.3) return "評價不錯";
  return null;
}

function weatherSupplement(weather?: WeatherSummary | null, identity?: PlaceIdentity): string | null {
  if (!weather) return null;
  const cond = weather.condition.toLowerCase();
  const precip = weather.precipProbability ?? 0;
  const indoor =
    identity &&
    ["museum", "department_store", "shopping_mall", "bookstore", "cafe", "bakery"].includes(
      identity,
    );

  if (precip >= 50 || cond.includes("雨")) {
    return indoor ? "今天有雨，室內剛好" : "今天有雨，出門記得帶傘";
  }
  if (weather.tempC !== null && weather.tempC >= 32) {
    return indoor ? "今天偏熱，室內比較舒服" : "今天偏熱，注意補水";
  }
  if (weather.tempC !== null && weather.tempC <= 14) {
    return indoor ? "今天偏涼，室內待久一點會比較舒服" : "今天偏涼，記得保暖";
  }
  return null;
}

function hoursSupplement(place: PlaceResult): string | null {
  if (place.openStatus === "closed") return "目前未營業，出發前建議先確認時間";
  if (place.closingSoonNote) return place.closingSoonNote;
  if (place.openStatus === "open" && place.todayHoursLabel && !place.todayHoursLabel.includes("待確認")) {
    return "營業中，現在出發剛好";
  }
  return null;
}

function timeSupplement(identity: PlaceIdentity, hour: number): string | null {
  if (
    identity === "night_market" ||
    identity === "district" ||
    identity === "shopping_mall" ||
    identity === "department_store"
  ) {
    if (hour >= 17) return "晚上氣氛不錯，很適合散步逛逛";
    if (hour >= 14 && hour < 17) return "下午很適合慢慢逛、順路探索";
    if (identity === "night_market" && hour < 16) {
      return "建議傍晚後再過去，氛圍比較對味";
    }
  }
  if (identity === "bar") {
    if (hour < 16) return "建議傍晚後再過去，氛圍比較對味";
    return "晚上來剛剛好";
  }
  if (identity === "breakfast_shop" && hour >= 13) {
    return "早餐店通常中午前較合適，出發前可先確認";
  }
  if (identity === "cafe" && hour >= 14 && hour < 18) {
    return "下午來坐一下很剛好";
  }
  if (identity === "museum" || identity === "department_store") {
    if (hour >= 17) return "若接近打烊，建議先確認營業時間";
  }
  if (hour >= 20 && (identity === "park" || identity === "tourist_attraction")) {
    return "晚上光線較少，若戶外請注意安全";
  }
  return null;
}

function interestMatchesIdentity(interest: string, identity: PlaceIdentity): boolean {
  if (interest === "photo") {
    return ["tourist_attraction", "museum", "district", "park", "night_market"].includes(identity);
  }
  if (interest === "food") {
    return [
      "restaurant",
      "food_stall",
      "cafe",
      "bakery",
      "dessert",
      "breakfast_shop",
      "night_market",
    ].includes(identity);
  }
  if (interest === "shopping") {
    return ["department_store", "shopping_mall", "district", "night_market"].includes(identity);
  }
  if (interest === "nature") return identity === "park" || identity === "tourist_attraction";
  if (interest === "culture") {
    return ["museum", "bookstore", "tourist_attraction", "district"].includes(identity);
  }
  return false;
}

function ratingPhraseIntl(
  locale: Locale,
  rating: number,
  count: number | null,
): string | null {
  const copy = getPlaceReasonCopy(locale);
  if (rating < 4) return null;
  if (count != null && count >= 80) return copy.ratingHigh(rating, count);
  return locale === "en" ? "Well rated" : copy.ratingHigh(rating, count ?? 0);
}

function weatherSupplementIntl(
  locale: Locale,
  weather?: WeatherSummary | null,
  identity?: PlaceIdentity,
): string | null {
  if (!weather) return null;
  const copy = getPlaceReasonCopy(locale);
  const indoor =
    identity &&
    ["museum", "department_store", "shopping_mall", "bookstore", "cafe", "bakery"].includes(
      identity,
    );
  const cond = weather.condition.toLowerCase();
  const precip = weather.precipProbability ?? 0;
  if (precip >= 50 || cond.includes("雨") || cond.includes("rain")) {
    return indoor ? copy.rainIndoor : copy.rainOutdoor;
  }
  if (weather.tempC != null && weather.tempC >= 32) {
    return indoor ? copy.hotIndoor : copy.hotOutdoor;
  }
  if (weather.tempC != null && weather.tempC <= 14) {
    return indoor ? copy.coldIndoor : copy.coldOutdoor;
  }
  return null;
}

function hoursSupplementIntl(locale: Locale, place: PlaceResult): string | null {
  const copy = getPlaceReasonCopy(locale);
  if (place.openStatus === "closed") return copy.closedNow;
  if (place.closingSoonNote) return copy.closingSoon(place.closingSoonNote);
  if (place.openStatus === "open") return copy.openNow;
  return null;
}

function buildSafeReason(
  place: PlaceResult,
  ctx: PlaceRecommendationContext,
  weather?: WeatherSummary | null,
  hour?: number,
  locale?: Locale,
): string {
  if (locale && locale !== "zh-TW") {
    const copy = getPlaceReasonCopy(locale);
    const parts = [copy.safeFallback];
    const w = weatherSupplementIntl(locale, weather);
    if (w) parts.push(w);
    return parts.join(". ");
  }
  const parts: string[] = [];
  const dist = distancePhrase(ctx.distanceMeters);
  const rating = ratingPhrase(place.rating, place.userRatingCount);
  if (dist) parts.push(dist);
  if (rating) parts.push(rating);
  const w = weatherSupplement(weather);
  if (w) parts.push(w);
  const h = hoursSupplement(place);
  if (h) parts.push(h);
  if (parts.length === 0) return SAFE_FALLBACK;
  const lead = parts.slice(0, 2).join("，");
  return `${lead}，可以順路安排進今天行程。`;
}

function appendSupplements(
  main: string,
  extras: Array<string | null>,
  maxExtras = 1,
): string {
  const picked = extras.filter(Boolean).slice(0, maxExtras) as string[];
  if (picked.length === 0) return main.endsWith("。") ? main : `${main}。`;
  const suffix = picked.join("，");
  if (main.endsWith("。")) return `${main.replace(/。$/, "")}，${suffix}。`;
  return `${main}，${suffix}。`;
}

function buildReasonFromIdentity(
  place: PlaceResult,
  identity: PlaceIdentity,
  profile: UserProfileForReason | null | undefined,
  ctx: PlaceRecommendationContext,
  weather?: WeatherSummary | null,
  hour = new Date().getHours(),
  personalized: boolean,
  locale?: Locale,
): string {
  if (identity === "unsupported" || identity === "generic") {
    return buildSafeReason(place, ctx, weather, hour, locale);
  }

  const seed = `${place.id}-${place.name}-${identity}`;
  const resolvedLocale = locale ?? "zh-TW";

  if (resolvedLocale !== "zh-TW") {
    const copy = getPlaceReasonCopy(resolvedLocale);
    const intro = reasonIdentityIntro(
      resolvedLocale,
      identity,
      seed,
      IDENTITY_INTROS[identity] ?? [copy.safeFallback],
    );
    const parts: string[] = [intro];
    if (ctx.distanceMeters != null) {
      if (ctx.distanceMeters < 1000) parts.push(copy.distanceM(ctx.distanceMeters));
      else parts.push(copy.distanceKm((ctx.distanceMeters / 1000).toFixed(1)));
    }
    if (place.rating != null && place.rating >= 4) {
      const r = ratingPhraseIntl(resolvedLocale, place.rating, place.userRatingCount);
      if (r) parts.push(r);
    }
    const w = weatherSupplementIntl(resolvedLocale, weather, identity);
    if (w) parts.push(w);
    const h = hoursSupplementIntl(resolvedLocale, place);
    if (h) parts.push(h);
    return parts.filter(Boolean).join(resolvedLocale === "ja" ? "。" : ". ");
  }

  const intro = hashPick(seed, IDENTITY_INTROS[identity] ?? [SAFE_FALLBACK]);
  const scene = hashPick(seed, IDENTITY_SCENE[identity] ?? []);
  const dist = distancePhrase(ctx.distanceMeters);
  const rating = ratingPhrase(place.rating, place.userRatingCount);

  if (!personalized || !profile?.onboarded) {
    const parts = [intro];
    if (scene && !intro.includes(scene.slice(0, 4))) {
      parts.push(scene);
    }
    const omitGeneric = isDistrictStyleReason(identity, ctx);
    if (!omitGeneric) {
      if (dist) parts.push(dist);
      if (rating) parts.push(rating);
    }
    const main = parts.filter(Boolean).join("，");
    return appendSupplements(main, [
      weatherSupplement(weather, identity),
      omitGeneric ? null : hoursSupplement(place),
      timeSupplement(identity, hour),
    ]);
  }

  const pace = PACE_PHRASE[profile.pace ?? "medium"] ?? PACE_PHRASE.medium;
  const vibe = VIBE_PHRASE[profile.vibe ?? "either"] ?? VIBE_PHRASE.either;
  const budget = BUDGET_MODE_LABELS[resolveBudgetMode(profile)];
  const interests = inferInterestTags(profile).filter((t) => interestMatchesIdentity(t, identity));

  const templates: string[] = [intro];

  if (interests.includes("culture") && (identity === "bookstore" || identity === "museum")) {
    templates.push(`${intro.replace(/。$/, "")}，也符合你喜歡文化、藝術的偏好。`);
  }
  if (interests.includes("food") && interestMatchesIdentity("food", identity)) {
    templates.push(
      `你喜歡美食探索，${identityDisplayLabel(identity)}這一類選擇${rating ? `，${rating}` : ""}${dist ? `，${dist}` : ""}很值得一試。`,
    );
  }
  if (interests.includes("shopping") && interestMatchesIdentity("shopping", identity)) {
    templates.push(
      isDistrictStyleReason(identity, ctx)
        ? `你喜歡逛街，${intro.replace(/。$/, "")}，很適合順路探索。`
        : `你喜歡逛街，${intro.replace(/。$/, "")}${dist ? `，${dist}` : ""}。`,
    );
  }
  if (profile.pace === "slow" && ["cafe", "bookstore", "park", "museum"].includes(identity)) {
    templates.push(`${pace}，${intro.replace(/。$/, "")}，氛圍${vibe}。`);
  }
  if (profile.vibe === "quiet" && !["bar", "night_market"].includes(identity)) {
    templates.push(`${intro.replace(/。$/, "")}，氛圍${vibe}${dist ? `，${dist}` : ""}。`);
  }
  if (profile.budgetMode === "budget" && ["food_stall", "breakfast_shop", "night_market"].includes(identity)) {
    templates.push(`依照你的${budget}預算，這裡通常比精緻餐廳更輕鬆。`);
  }

  const omitGeneric = isDistrictStyleReason(identity, ctx);
  templates.push(
    omitGeneric
      ? (scene ? `${intro.replace(/。$/, "")}，${scene}。` : intro)
      : `${intro}${dist ? `，${dist}` : ""}${rating ? `，${rating}` : ""}。`,
    scene && !omitGeneric ? `${intro.replace(/。$/, "")}，${scene}。` : intro,
  );

  const main = hashPick(`${seed}-p`, templates.filter(Boolean));
  return appendSupplements(main, [
    weatherSupplement(weather, identity),
    omitGeneric ? null : hoursSupplement(place),
    timeSupplement(identity, hour),
    ctx.mood ? `呼應你「${ctx.mood}」的心情` : null,
  ]);
}

/**
 * 依地點真實身分與使用者偏好生成推薦理由（主入口）。
 */
export function generatePlaceReason(
  place: PlaceResult,
  userProfile?: UserProfileForReason | null,
  options?: {
    weather?: WeatherSummary | null;
    currentTime?: Date | string;
    context?: PlaceRecommendationContext;
    locale?: Locale;
  },
): string {
  return buildPlaceRecommendationReason(
    place,
    userProfile ?? null,
    options?.weather,
    options?.currentTime,
    options?.context,
    options?.locale,
  );
}

/**
 * 探索／聊天／心情推薦共用的推薦理由。
 */
export function buildPlaceRecommendationReason(
  place: PlaceResult,
  userProfile: UserProfileForReason | null | undefined,
  weather?: WeatherSummary | null,
  currentTime?: Date | string,
  context?: PlaceRecommendationContext,
  locale?: Locale,
): string {
  const ctx = context ?? {};
  const profile: UserProfileForReason = {
    ...userProfile,
    mood: ctx.mood ?? userProfile?.mood,
  };
  const hour =
    currentTime instanceof Date
      ? currentTime.getHours()
      : typeof currentTime === "string"
        ? new Date(currentTime).getHours()
        : new Date().getHours();

  const identity = resolvePlaceIdentity(place);

  if (ctx.isSavedFavorite) {
    if (!hasCompletedTravelQuiz(profile)) {
      return `${copy.savedNearbyLead}${copy.safeFallback}`;
    }
    const body = buildReasonFromIdentity(place, identity, profile, ctx, weather, hour, true, locale);
    return `${copy.savedNearbyLead}${body.replace(/^這[^，。]+[，。]/, "")}`;
  }

  const personalized = hasCompletedTravelQuiz(profile);
  return buildReasonFromIdentity(place, identity, profile, ctx, weather, hour, personalized, locale);
}

/** 從完整 profile + prefs 組裝理由用資料 */
export function userProfileForReasonFrom(
  prefs: TravelPreferences,
  extras?: {
    travelStyle?: string;
    personalityType?: string;
    personalitySummary?: string;
    mood?: string;
    aiPreferences?: Record<string, unknown>;
  },
): UserProfileForReason {
  return {
    onboarded: prefs.onboarded,
    pace: prefs.pace,
    vibe: prefs.vibe,
    budgetMode: resolveBudgetMode(prefs),
    interests: prefs.interests,
    travelStyle: extras?.travelStyle,
    personalityType: extras?.personalityType ?? prefs.personalityType,
    personalitySummary: extras?.personalitySummary ?? prefs.personalitySummary,
    mood: extras?.mood,
    aiPreferences: extras?.aiPreferences,
  };
}
