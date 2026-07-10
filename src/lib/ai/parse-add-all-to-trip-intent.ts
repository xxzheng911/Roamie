import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
const ADD_ALL_TO_TRIP_RE =
  /^(加入全部|全部加入|都加入|幫我加入|建立行程|生成行程|加進全部|全部加進|都加進|幫我加進|加進行程|全部加進行程)$/;

const ADD_ALL_TO_TRIP_LOOSE_RE =
  /(加入全部|全部加入|都加入|幫我加入|全部加進|都加進|加進全部|加進行程)/;

export function isAddAllToTripIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const normalized = raw.replace(/\s+/g, "");
  if (ADD_ALL_TO_TRIP_RE.test(normalized)) return true;
  if (normalized.length <= 16 && ADD_ALL_TO_TRIP_LOOSE_RE.test(normalized)) return true;
  if (/^(建立|生成).{0,4}行程$/.test(normalized)) return true;
  return false;
}

export function logAddAllToTripIntentDetected(): void {
  logAiPipeline("[AI_INTENT_DETECTED]", "intent=ADD_ALL_TO_TRIP");
}
