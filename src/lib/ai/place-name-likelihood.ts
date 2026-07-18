/**
 * Detect SEO / booking / tour-product titles that must never enter place pools.
 * Destination-agnostic — no city hardcodes.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type NonPlaceRejectReason =
  | "incomplete_name"
  | "seo_title"
  | "booking_page"
  | "activity_product"
  | "long_marketing_text"
  | "marketing_parenthetical"
  | "full_sentence_or_ad_copy"
  | "multi_activity_bundle"
  | "affiliate_or_commerce_copy";

export type PlaceNameLikelihood = {
  ok: boolean;
  reason?: NonPlaceRejectReason;
  normalized: string;
};

/** Soft ceiling for a single real place name (not SEO / product titles). */
const MAX_LIKELY_PLACE_NAME_LENGTH = 36;

const MARKETING_SEMANTIC_RE =
  /報名處?|預約接送|費用|價格|票價|優惠|行程規劃|一日遊|半日遊|二日遊|三日遊|接送|包車|導覽|體驗方案|套裝行程|怎麼去|怎麼拍|攻略|必買|自行前往|線上訂購|線上購買|線上預約|賞鯨體驗|沙灘車體驗|跳島行程|半日游|一日游|day\s*tour|half[\s-]?day|airport\s*transfer|pickup\s*service|tour\s*package|itinerary\s*plan|how\s*to\s*(get|go|shoot|visit)|booking\s*(page|form)|ticket\s*(price|deal)|klook|kkday/i;

const BOOKING_PAGE_RE =
  /報名處|線上訂購|線上購買|線上預約|booking|reserve\s*now|立即報名|馬上預約/i;

const AFFILIATE_COMMERCE_RE =
  /klook|kkday|trip\.com|booking\.com|agoda|門票優惠|優惠碼|折扣碼|限時優惠/i;

const HARD_SEPARATOR_RE = /[\/／|｜→➞]/g;

const MARKETING_PAREN_RE =
  /[（(][^）)]*(?:營業時間|詳細營業|粉絲專頁|請見|請洽|預約|接送|費用|報名|怎麼去|市區可)[^）)]*[）)]/;

function countMatches(re: RegExp, text: string): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return (text.match(global) ?? []).length;
}

/**
 * Strip trailing marketing parentheses when the core name remains plausible.
 * Never splits SEO slash-bundles into multiple places.
 */
export function normalizePlaceCandidateName(raw: string): {
  normalized: string;
  accepted: boolean;
  reason?: NonPlaceRejectReason;
} {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return { normalized: "", accepted: false, reason: "incomplete_name" };
  }

  let normalized = trimmed;
  if (MARKETING_PAREN_RE.test(normalized)) {
    normalized = normalized.replace(MARKETING_PAREN_RE, "").replace(/\s+/g, " ").trim();
  }

  const likelihood = isLikelyPlaceName(normalized);
  logAiPipeline(
    "[PLACE_NAME_NORMALIZATION_RESULT]",
    `raw=${trimmed.slice(0, 120)}`,
    `normalized=${normalized.slice(0, 80)}`,
    `accepted=${likelihood.ok}`,
    likelihood.reason ? `reason=${likelihood.reason}` : "",
  );
  return {
    normalized: likelihood.normalized,
    accepted: likelihood.ok,
    reason: likelihood.reason,
  };
}

/**
 * True when the string looks like a single visitable place name.
 */
export function isLikelyPlaceName(name: string): PlaceNameLikelihood {
  const raw = name.replace(/\s+/g, " ").trim();
  if (!raw || raw.length < 2) {
    return { ok: false, reason: "incomplete_name", normalized: raw };
  }

  if (AFFILIATE_COMMERCE_RE.test(raw)) {
    return { ok: false, reason: "affiliate_or_commerce_copy", normalized: raw };
  }

  const hardSeparators = countMatches(HARD_SEPARATOR_RE, raw);
  if (hardSeparators >= 2) {
    return { ok: false, reason: "seo_title", normalized: raw };
  }

  if (hardSeparators >= 1 && MARKETING_SEMANTIC_RE.test(raw)) {
    return { ok: false, reason: "seo_title", normalized: raw };
  }

  if (raw.length > MAX_LIKELY_PLACE_NAME_LENGTH) {
    if (MARKETING_SEMANTIC_RE.test(raw) || hardSeparators >= 1 || /[、，,]/.test(raw)) {
      return { ok: false, reason: "long_marketing_text", normalized: raw };
    }
    if (raw.length > 48) {
      return { ok: false, reason: "long_marketing_text", normalized: raw };
    }
  }

  if (BOOKING_PAGE_RE.test(raw)) {
    return { ok: false, reason: "booking_page", normalized: raw };
  }

  if (MARKETING_PAREN_RE.test(raw)) {
    return { ok: false, reason: "marketing_parenthetical", normalized: raw };
  }

  const listSeparators = countMatches(/[、，,]/g, raw);
  if (listSeparators >= 2 && (MARKETING_SEMANTIC_RE.test(raw) || hardSeparators >= 1)) {
    return { ok: false, reason: "multi_activity_bundle", normalized: raw };
  }

  if (
    /[。！？?]/.test(raw) ||
    /請見粉絲|詳細營業|市區可預約|旅遊行程規劃|怎麼拍|怎麼去|必去攻略/.test(raw)
  ) {
    return { ok: false, reason: "full_sentence_or_ad_copy", normalized: raw };
  }

  if (
    MARKETING_SEMANTIC_RE.test(raw) &&
    (raw.length > 12 ||
      /體驗|方案|套裝|行程|報名|接送|導覽|預約|包車|一日遊|半日遊|二日遊|三日遊|攻略|費用|優惠|怎麼/.test(
        raw,
      ))
  ) {
    return { ok: false, reason: "activity_product", normalized: raw };
  }

  return { ok: true, normalized: raw };
}

export function logNonPlaceCandidateRejected(
  name: string,
  reason: string,
  source?: string,
): void {
  logAiPipeline(
    "[NON_PLACE_CANDIDATE_REJECTED]",
    `name=${name.slice(0, 160)}`,
    `reason=${reason}`,
    source ? `source=${source}` : "",
  );
}

export function logAffiliateExcludedFromPlacePool(name: string, platform?: string): void {
  logAiPipeline(
    "[AFFILIATE_RESULT_EXCLUDED_FROM_PLACE_POOL]",
    `name=${name.slice(0, 120)}`,
    platform ? `platform=${platform}` : "",
  );
}
