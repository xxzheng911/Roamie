/**
 * Leaf module (no project imports) for detecting and stripping "sub-landmark"
 * markers such as gates, entrances, plazas, visitor centers, etc.
 *
 * A sub-landmark (子地標) is a small feature that physically belongs to a larger
 * main landmark (主地標) — e.g. 「饒河夜市牌樓」is the gate/arch of 「饒河街觀光夜市」.
 * Official itineraries should keep only the main landmark.
 *
 * The dictionary is multilingual (中/英/日/韓). Keywords alone are never enough to
 * decide a duplicate — callers must combine this with core-name match + distance +
 * address (see landmark-cluster.ts).
 */

export type SubPlaceType =
  | "gate"
  | "entrance"
  | "exit"
  | "plaza"
  | "visitor_center"
  | "ticket_office"
  | "monument"
  | "statue"
  | "tower"
  | "observation_deck"
  | "annex"
  | "inner_facility"
  | "public_art";

type SubPlacePattern = {
  type: SubPlaceType;
  /** Matched against the compact, lower-cased name (spaces removed). */
  re: RegExp;
  /**
   * When present, this token is stripped (globally, case-insensitive) from the
   * compact name to recover the parent core name. Defaults to `re`.
   */
  strip?: RegExp;
};

/**
 * Ordered so that longer / more specific markers are stripped before generic
 * single characters. Everything operates on a compact lower-cased string.
 */
export const SUB_PLACE_PATTERNS: SubPlacePattern[] = [
  // --- Gates / arches (門・牌樓・鳥居・門) ---
  { type: "gate", re: /牌樓|牌坊|鳥居|拱門|山門|仁王門|中門|三門|正門|側門|大門/, strip: /牌樓|牌坊|鳥居|拱門|山門|仁王門|中門|三門|正門|側門|大門/ },
  { type: "gate", re: /(?<![a-z])(main\s*)?gate(?![a-z])|torii|archway|(?<![a-z])arch(?![a-z])/, strip: /(main)?gate|torii|archway|arch/ },
  { type: "gate", re: /정문|남문|북문|동문|서문|대문/, strip: /정문|남문|북문|동문|서문|대문/ },

  // --- Entrances / exits (入口・出口) ---
  { type: "entrance", re: /入口|口(?=$)|엔트런스|입구|エントランス/, strip: /入口|입구|エントランス|entrance/ },
  { type: "entrance", re: /(?<![a-z])entrance(?![a-z])/, strip: /entrance/ },
  { type: "exit", re: /出口|출구/, strip: /出口|출구|exit/ },
  { type: "exit", re: /(?<![a-z])exit(?![a-z])/, strip: /exit/ },

  // --- Plazas / squares (廣場・広場・광장) ---
  { type: "plaza", re: /廣場|広場|광장/, strip: /廣場|広場|광장/ },
  { type: "plaza", re: /(?<![a-z])plaza|(?<![a-z])square(?![a-z])/, strip: /plaza|square/ },

  // --- Visitor / information / service centers ---
  { type: "visitor_center", re: /遊客中心|游客中心|旅客中心|服務中心|服务中心|案内所|안내소|방문자센터/, strip: /遊客中心|游客中心|旅客中心|服務中心|服务中心|案内所|안내소|방문자센터/ },
  { type: "visitor_center", re: /visitor\s*center|visitor\s*centre|information\s*cent(er|re)/, strip: /visitor\s*cent(er|re)|information\s*cent(er|re)/ },

  // --- Ticket offices (售票處・チケット・매표소) ---
  { type: "ticket_office", re: /售票處|售票口|售票亭|購票處|チケット売場|매표소/, strip: /售票處|售票口|售票亭|購票處|チケット売場|매표소/ },
  { type: "ticket_office", re: /ticket\s*office|box\s*office/, strip: /ticket\s*office|box\s*office/ },

  // --- Monuments / statues (紀念碑・雕像・記念碑) ---
  { type: "monument", re: /紀念碑|纪念碑|記念碑|기념비/, strip: /紀念碑|纪念碑|記念碑|기념비/ },
  { type: "monument", re: /(?<![a-z])monument(?![a-z])/, strip: /monument/ },
  { type: "statue", re: /雕像|銅像|铜像|石像|像(?=$)|동상|石仏/, strip: /雕像|銅像|铜像|石像|동상|石仏/ },
  { type: "statue", re: /(?<![a-z])statue(?![a-z])/, strip: /statue/ },

  // --- Towers / keeps (鐘樓・天守閣・地標柱) ---
  { type: "tower", re: /鐘樓|钟楼|天守閣|天守|地標柱|地标柱/, strip: /鐘樓|钟楼|天守閣|天守|地標柱|地标柱/ },

  // --- Observation decks (觀景台・展望台・전망대) ---
  { type: "observation_deck", re: /觀景台|观景台|觀景平台|观景平台|展望台|展望デッキ|전망대/, strip: /觀景台|观景台|觀景平台|观景平台|展望台|展望デッキ|전망대/ },
  { type: "observation_deck", re: /observation\s*deck|observation\s*tower|sky\s*deck/, strip: /observation\s*deck|observation\s*tower|sky\s*deck/ },

  // --- Annex / branch (分館・別館) ---
  { type: "annex", re: /分館|别館|別館|별관/, strip: /分館|别館|別館|별관/ },
  { type: "annex", re: /(?<![a-z])annex(e)?(?![a-z])/, strip: /annex(e)?/ },

  // --- Public / installation art inside a larger precinct (公共藝術・裝置藝術) ---
  {
    type: "public_art",
    re: /公共藝術|装置艺术|裝置藝術|藝術裝置|艺术装置|公共藝術品|雕塑群/,
    strip: /公共藝術|装置艺术|裝置藝術|藝術裝置|艺术装置|公共藝術品|雕塑園|雕塑群/,
  },
  {
    type: "public_art",
    re: /public\s*art|installation\s*art|art\s*installation/,
    strip: /public\s*art|installation\s*art|art\s*installation/,
  },

  // --- Generic inner facilities / precinct fillers (園內設施・綠園道附屬) ---
  {
    type: "inner_facility",
    re: /園內設施|园内设施|園區設施|园区设施|園區內|园区内|園內|园内/,
    strip: /園內設施|园内设施|園區設施|园区设施|園區內|园区内|園內|园内/,
  },
];

const CJK_RE = /[\u3000-\u9fff\uf900-\ufaff\uac00-\ud7a3]/;

/** True if the compact name still contains CJK characters. */
export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/** Compact, lower-cased, parenthetical-stripped form used for keyword matching. */
export function compactPlaceText(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/\s+/g, "");
}

/** Space-preserving lower-cased form (keeps Latin word boundaries). */
function spacedPlaceText(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Detects whether a place name looks like a sub-landmark and returns its type.
 * NOTE: this is heuristic; callers must confirm with core-name + distance.
 * Tests both the compact (CJK) and spaced (Latin word-boundary) forms.
 */
export function detectSubPlaceType(name: string): SubPlaceType | null {
  const compact = compactPlaceText(name);
  if (!compact) return null;
  const spaced = spacedPlaceText(name);
  for (const pattern of SUB_PLACE_PATTERNS) {
    if (pattern.re.test(compact) || pattern.re.test(spaced)) return pattern.type;
  }
  return null;
}

export function isSubPlaceName(name: string): boolean {
  return detectSubPlaceType(name) !== null;
}

/**
 * Night-market naming convention normalization:
 *   X街觀光夜市 / X觀光夜市 / X街夜市 → X夜市
 * Only applies when the name references a night market, so 街/觀光/商圈 are safe to drop.
 */
export function normalizeNightMarketFiller(compact: string): string {
  if (!/夜市|nightmarket|night市/.test(compact)) return compact;
  return compact
    .replace(/觀光|观光|tourist/g, "")
    .replace(/商圈/g, "")
    .replace(/街(?=.*夜市)/g, "")
    .replace(/street(?=.*nightmarket)/g, "");
}

/** Suffix-anchored strip patterns compiled once. */
const SUFFIX_STRIP_RES: RegExp[] = SUB_PLACE_PATTERNS.map((pattern) => {
  const source = (pattern.strip ?? pattern.re).source;
  return new RegExp(`(?:${source})$`);
});

/**
 * Strips *trailing* sub-landmark markers from a compact core name so the parent
 * landmark can be recovered (e.g. 饒河夜市牌樓 → 饒河夜市, 大阪城公園入口 → 大阪城公園).
 * Suffix-anchored + iterative to handle chained markers. Never returns an empty
 * string when the input was non-empty (falls back to the input).
 */
export function stripSubPlaceMarkers(compact: string): string {
  if (!compact) return compact;
  let current = compact;
  for (let pass = 0; pass < 4; pass += 1) {
    let next = current;
    for (const re of SUFFIX_STRIP_RES) {
      const stripped = next.replace(re, "").trim();
      // Keep a meaningful core; never strip down to nothing.
      if (stripped && stripped !== next) {
        next = stripped;
      }
    }
    if (next === current) break;
    current = next;
  }
  return current || compact;
}

/** 商業複合設施後綴（接在地標語幹後才剝，避免「大阪城」→「大阪」） */
const COMMERCIAL_ANNEX_SUFFIX =
  /(?:城|town|タウン|シティ|city|ソラマチ|solamachi|商業設施|購物中心|ショッピング|shoppingmall|mall)$/i;

const LANDMARK_STEM_BEFORE_ANNEX =
  /(?:塔|寺|宮|神社|廟|園|橋|館|樓|楼|駅|站|skytree|tower|temple|shrine|castle|palace|museum)$/i;

/**
 * 剝商業附屬後綴：晴空塔城 → 晴空塔；大阪城 保持不變（語幹即城）。
 */
export function stripCommercialAnnexSuffix(core: string): string {
  if (!core) return core;
  let current = core;
  for (let i = 0; i < 3; i += 1) {
    const stripped = current.replace(COMMERCIAL_ANNEX_SUFFIX, "");
    if (!stripped || stripped === current) break;
    if (stripped.length < 3) break;
    if (!LANDMARK_STEM_BEFORE_ANNEX.test(stripped) && !/^[a-z]{4,}$/i.test(stripped)) {
      break;
    }
    current = stripped;
  }
  return current || core;
}
