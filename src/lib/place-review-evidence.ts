import { z } from "zod";

/** Structured observations from the available sample, never all Google reviews. */
export const ReviewSignalSchema = z.object({
  topic: z.enum([
    "parking",
    "outlets",
    "work",
    "service",
    "quiet",
    "view",
    "food",
    "gratin",
    "meat",
    "variety",
    "dessert",
    "family",
    "queue",
    "crowds",
    "value",
    "portion",
  ]),
  sentiment: z.enum(["positive", "negative"]),
  supportCount: z.number().int().min(1).max(5),
  strength: z.enum(["single", "multiple", "strong"]),
  confidence: z.enum(["low", "medium", "high"]),
});
export const PlaceReviewEvidenceSchema = z
  .object({
    version: z.literal(1),
    extractionVersion: z.literal(2).optional(),
    placeId: z.string(),
    source: z.literal("google_review_sample"),
    sampleSize: z.number().int().min(0).max(5),
    trace: z
      .object({
        rawReviewsCount: z.number(),
        normalizedReviewsCount: z.number(),
        reviewsWithTextCount: z.number(),
        candidateSignals: z.array(z.object({ topic: z.string(), supportCount: z.number() })),
        rejectedSignals: z.array(
          z.object({ topic: z.string(), reason: z.string(), supportCount: z.number() }),
        ),
        rejectionReasons: z.array(z.string()),
      })
      .optional(),
    signals: z.array(ReviewSignalSchema).max(32),
  })
  .refine(
    (evidence) =>
      evidence.signals.every((signal) => {
        const opposite = evidence.signals.find(
          (other) => other.topic === signal.topic && other.sentiment !== signal.sentiment,
        );
        const strength =
          signal.supportCount >= 3 && !opposite && signal.supportCount / evidence.sampleSize >= 0.6
            ? "strong"
            : signal.supportCount >= 2
              ? "multiple"
              : "single";
        return signal.supportCount <= evidence.sampleSize && signal.strength === strength;
      }),
    "Review strength must match independent sample support",
  );
export type PlaceReviewEvidence = z.infer<typeof PlaceReviewEvidenceSchema>;
export type ReviewSignal = z.infer<typeof ReviewSignalSchema>;
export type GoogleReviewSample = {
  name?: string;
  authorAttribution?: { uri?: string };
  text?: { text?: string; languageCode?: string };
  originalText?: { text?: string };
};

type Rule = { topic: ReviewSignal["topic"]; positive: RegExp; negative: RegExp };
// Phrase-level positive evidence; generic category/name/rating is never a review signal.
const RULES: Rule[] = [
  {
    topic: "parking",
    positive:
      /(?:停車(?:很|非常|相當)?方便|(?:好|很好)停車|停車位(?:算|很|非常)?多|(?:旁邊|附近)有停車場|easy parking|ample parking)/i,
    negative: /(?:不好停車|難停車|停車不便|停車位少|停車.*難|hard to park|no parking)/i,
  },
  {
    topic: "outlets",
    positive:
      /(?:有(?:提供)?插座|座位旁有插座|插座(?:很)?多|power outlets available|plenty of outlets)/i,
    negative: /(?:沒有插座|無插座|插座(?:很)?少|no (?:power )?outlets)/i,
  },
  {
    topic: "work",
    positive:
      /(?:適合(?:帶筆電|工作|用筆電|使用筆電)|可以工作|laptop.friendly|good (?:place )?for work)/i,
    negative: /(?:不適合(?:帶筆電|工作|用筆電|使用筆電)|禁止.*筆電|not .*for work)/i,
  },
  {
    topic: "service",
    positive: /(?:服務(?:很|非常|相當)?好|服務親切|店員親切|friendly staff|great service)/i,
    negative: /(?:服務(?:不|很差|差)|態度差|rude staff|poor service)/i,
  },
  {
    topic: "quiet",
    positive: /(?:很安靜|環境安靜|十分安靜|quiet atmosphere|very quiet)/i,
    negative: /(?:不安靜|很吵|吵雜|noisy|not quiet)/i,
  },
  {
    topic: "view",
    positive:
      /(?:景色(?:很|非常)?(?:好|美)|視野(?:真的|算)?(?:很|非常)?(?:好|棒|開闊|遼闊|絕佳)|夜景(?:很)?美|beautiful view|great view)/i,
    negative: /(?:景色(?:不好|很差)|視野(?:不好|受阻)|poor view)/i,
  },
  {
    topic: "food",
    positive: /(?:餐點(?:很|非常)?好吃|食物(?:很)?好吃|湯頭(?:很)?好喝|delicious food|great food)/i,
    negative: /(?:餐點不好吃|食物難吃|湯頭難喝|bad food)/i,
  },
  {
    topic: "gratin",
    positive:
      /(?:焗烤(?:很|非常)?好吃|(?:最)?推薦(?:起司)?焗烤|(?:起司)?焗烤(?:值得)?推薦|最喜歡(?:他們的)?焗烤|焗烤起司很香|delicious gratin)/i,
    negative: /(?:焗烤不好吃|不推薦焗烤|bad gratin)/i,
  },
  {
    topic: "meat",
    positive: /(?:肉質(?:很|非常)?好|肉品(?:很)?新鮮|excellent meat)/i,
    negative: /(?:肉質不好|肉不新鮮|poor meat)/i,
  },
  {
    topic: "variety",
    positive: /(?:品項(?:很)?多|選擇(?:很)?(?:多|豐富)|wide variety)/i,
    negative: /(?:品項(?:很)?少|選擇(?:很)?少|limited selection)/i,
  },
  {
    topic: "dessert",
    positive: /(?:甜點(?:很)?好吃|推薦甜點|great desserts)/i,
    negative: /(?:甜點不好吃|不推薦甜點|bad desserts)/i,
  },
  {
    topic: "family",
    positive: /(?:適合親子|適合帶小孩|family.friendly)/i,
    negative: /(?:不適合親子|不適合帶小孩|not family.friendly)/i,
  },
  {
    topic: "queue",
    positive: /(?:不用排隊|不必排隊|no queue)/i,
    negative: /(?:排隊(?:很|非常)?久|等(?:待)?(?:很|非常)?久|long (?:queue|wait))/i,
  },
  {
    topic: "crowds",
    positive: /(?:人潮(?:很)?少|not crowded)/i,
    negative: /(?:人潮(?:很)?多|很擁擠|very crowded)/i,
  },
  {
    topic: "value",
    positive: /(?:CP值(?:很)?高|性價比(?:很)?高|物超所值|good value)/i,
    negative: /(?:CP值低|性價比低|不划算|poor value)/i,
  },
  {
    topic: "portion",
    positive: /(?:份量(?:很|非常)?大|份量足|large portions)/i,
    negative: /(?:份量(?:很)?少|份量不足|small portions)/i,
  },
];

export function extractPlaceReviewEvidence(
  placeId: string,
  reviews: GoogleReviewSample[],
): PlaceReviewEvidence {
  const rejectedSignals: NonNullable<PlaceReviewEvidence["trace"]>["rejectedSignals"] = [];
  const candidateSignals: NonNullable<PlaceReviewEvidence["trace"]>["candidateSignals"] = [];
  const rejectionReasons = new Set<string>();
  let normalizedReviewsCount = 0,
    reviewsWithTextCount = 0;
  const texts = new Set<string>();
  const authors = new Set<string>();
  const ids = new Set<string>();
  const unique: string[] = [];
  for (const review of reviews.slice(0, 5)) {
    if (!review || typeof review !== "object") {
      rejectionReasons.add("invalid_review_shape");
      continue;
    }
    normalizedReviewsCount++;
    const rawText =
      typeof review.text?.text === "string" && review.text.text.trim()
        ? review.text.text
        : typeof review.originalText?.text === "string"
          ? review.originalText.text
          : "";
    if (rawText.trim()) reviewsWithTextCount++;
    else rejectionReasons.add("missing_localized_text");
    const text = rawText.normalize("NFKC").trim().toLowerCase();
    const fingerprint = text.replace(/[\s\p{P}]/gu, "");
    if (
      !fingerprint ||
      texts.has(fingerprint) ||
      (review.name && ids.has(review.name)) ||
      (review.authorAttribution?.uri && authors.has(review.authorAttribution.uri))
    ) {
      if (fingerprint) rejectionReasons.add("duplicate_review");
      continue;
    }
    texts.add(fingerprint);
    if (review.name) ids.add(review.name);
    if (review.authorAttribution?.uri) authors.add(review.authorAttribution.uri);
    unique.push(text);
  }
  const signals: ReviewSignal[] = [];
  for (const rule of RULES) {
    let positive = 0,
      negative = 0;
    let candidates = 0,
      rejected = 0;
    for (const text of unique) {
      const candidate = rule.positive.test(text) || rule.negative.test(text);
      if (candidate) candidates++;
      const clauses = text.split(/[。！？!?；;，,\n]|但是|不過|然而|\bbut\b/);
      let hasPositive = false,
        hasNegative = false;
      for (const clause of clauses) {
        if (/(?:如果|假如|希望|聽說|據說|才怪|哪裡|嗎|if\b|wish\b|「|『|“|")/i.test(clause))
          continue;
        const negativeMatch = rule.negative.exec(clause);
        const negatedComplaint =
          negativeMatch &&
          /(?:不會|不用|沒有|不必|並非|not|never)\s*$/i.test(clause.slice(0, negativeMatch.index));
        if (negativeMatch && !negatedComplaint) hasNegative = true;
        // Conservative: reject negated/conditional/quoted praise in the same clause.
        else if (
          !/(?:不|沒|無|未|並非|如果|假如|希望|聽說|據說|才怪|哪裡|嗎|not\b|no\b|never\b|if\b|wish\b|「|『|“|")/i.test(
            clause,
          ) &&
          rule.positive.test(clause)
        )
          hasPositive = true;
      }
      if (hasNegative) negative++;
      else if (hasPositive) positive++;
      else if (candidate) rejected++;
    }
    if (candidates) candidateSignals.push({ topic: rule.topic, supportCount: candidates });
    if (rejected) {
      rejectedSignals.push({
        topic: rule.topic,
        reason: "negated_conditional_or_quoted",
        supportCount: rejected,
      });
      rejectionReasons.add("negated_conditional_or_quoted");
    }
    for (const [sentiment, count, opposite] of [
      ["positive", positive, negative],
      ["negative", negative, positive],
    ] as const) {
      if (!count) continue;
      const strength =
        count >= 3 && opposite === 0 && count / unique.length >= 0.6
          ? "strong"
          : count >= 2
            ? "multiple"
            : "single";
      signals.push({
        topic: rule.topic,
        sentiment,
        supportCount: count,
        strength,
        confidence: strength === "strong" ? "high" : strength === "multiple" ? "medium" : "low",
      });
    }
  }
  return {
    version: 1,
    extractionVersion: 2,
    placeId: placeId.trim().replace(/^places\//, ""),
    source: "google_review_sample",
    sampleSize: unique.length,
    trace: {
      rawReviewsCount: reviews.length,
      normalizedReviewsCount,
      reviewsWithTextCount,
      candidateSignals,
      rejectedSignals,
      rejectionReasons: [...rejectionReasons, ...(signals.length ? [] : ["no_supported_topic"])],
    },
    signals,
  };
}

export const REVIEW_TOPIC_COPY: Record<ReviewSignal["topic"], [string, string, string, string]> = {
  parking: ["停車方便", "convenient parking", "駐車の便利さ", "편리한 주차"],
  outlets: ["有插座可用", "available power outlets", "利用できる電源", "사용 가능한 콘센트"],
  work: [
    "適合使用筆電工作",
    "suitability for laptop work",
    "パソコン作業のしやすさ",
    "노트북 작업 편의성",
  ],
  service: ["服務親切", "friendly service", "親切な接客", "친절한 서비스"],
  quiet: ["環境安靜", "a quiet atmosphere", "静かな雰囲気", "조용한 분위기"],
  view: ["景色受到好評", "pleasant views", "景色の良さ", "좋은 경치"],
  food: ["餐飲口味受到好評", "enjoyable food", "料理のおいしさ", "좋은 음식 맛"],
  gratin: ["推薦焗烤餐點", "recommended gratin dishes", "グラタンの評判", "추천하는 그라탱"],
  meat: ["肉品受到好評", "well-regarded meat dishes", "肉料理の評判", "좋은 고기 요리"],
  variety: ["品項選擇豐富", "a varied selection", "品揃えの豊富さ", "다양한 선택지"],
  dessert: ["甜點受到推薦", "recommended desserts", "デザートの評判", "추천 디저트"],
  family: ["適合親子同行", "family-friendly visits", "家族での利用のしやすさ", "가족 방문 편의성"],
  queue: ["需要較長時間排隊", "long waits", "待ち時間の長さ", "긴 대기 시간"],
  crowds: ["人潮較多", "crowding", "混雑", "혼잡함"],
  value: ["價格與內容相稱", "good value", "価格に見合う内容", "좋은 가성비"],
  portion: ["份量充足", "generous portions", "十分な量", "넉넉한 양"],
};
