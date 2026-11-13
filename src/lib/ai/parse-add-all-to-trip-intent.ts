import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
const ADD_ALL_TO_TRIP_RE =
  /^(加入全部|全部加入|都加入|幫我加入|建立行程|生成行程|加進全部|全部加進|都加進|幫我加進|加進行程|全部加進行程)$/;

const ADD_ALL_TO_TRIP_LOOSE_RE =
  /(加入全部|全部加入|都加入|幫我加入|全部加進|都加進|加進全部|加進行程)/;

/** en whole-sentence only (lowercased, single-spaced, trailing punctuation stripped). */
const ADD_ALL_TO_TRIP_EN_RE =
  /^(?:please )?add (?:them all|these all|all(?: of (?:them|these|those))?|everything)(?: to (?:my|the) (?:trip|itinerary))?(?: please)?$/;

/** ja whole-sentence only (whitespace removed). */
const ADD_ALL_TO_TRIP_JA_RE =
  /^(?:旅程に)?(?:すべて|全て|ぜんぶ|全部)(?:旅程に)?追加(?:して(?:ください|下さい)?|する|します|でお願いします|お願いします)?$/;

/** ko whole-sentence only (whitespace removed). */
const ADD_ALL_TO_TRIP_KO_RE =
  /^(?:일정에)?(?:전부|다|모두)(?:일정에)?추가(?:해|해줘|해주세요|해요|할게요|하기|해줄래)?$/;

const TRAILING_PUNCT_RE = /[\s.!！。?？~～]+$/u;

function isForeignAddAllToTripIntent(raw: string): boolean {
  const stripped = raw.replace(TRAILING_PUNCT_RE, "");
  if (!stripped) return false;
  const en = stripped.toLowerCase().replace(/\s+/g, " ");
  if (ADD_ALL_TO_TRIP_EN_RE.test(en)) return true;
  const compact = stripped.replace(/\s+/g, "");
  return ADD_ALL_TO_TRIP_JA_RE.test(compact) || ADD_ALL_TO_TRIP_KO_RE.test(compact);
}

export function isAddAllToTripIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const normalized = raw.replace(/\s+/g, "");
  if (ADD_ALL_TO_TRIP_RE.test(normalized)) return true;
  if (isForeignAddAllToTripIntent(raw)) return true;
  if (normalized.length <= 16 && ADD_ALL_TO_TRIP_LOOSE_RE.test(normalized)) return true;
  if (/^(建立|生成).{0,4}行程$/.test(normalized)) return true;
  return false;
}

export function logAddAllToTripIntentDetected(): void {
  logAiPipeline("[AI_INTENT_DETECTED]", "intent=ADD_ALL_TO_TRIP");
}
