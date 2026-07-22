/**
 * Debug-only：App 啟動完成後印出 RAOS Feature Flag 狀態 + 單行診斷字串。
 * 不改 Flag / 不寫 localStorage / 不碰推薦或 Planner 商業邏輯。
 *
 * Flag 實際讀取名稱（須與此一致）：
 * - env: import.meta.env.VITE_REC_ENGINE_PLANNER_ENABLED
 * - localStorage: "roamie:rec-engine-planner"
 */
import {
  isCandidatePoolEnabled,
  resolveCandidatePoolFlag,
} from "@/lib/ai/candidate-pool/feature-flag";
import {
  isItineraryValidatorEnabled,
  resolveItineraryValidatorFlag,
} from "@/lib/ai/itinerary-validator/feature-flag";
import {
  isCreditsFeatureEnabled,
  resolveCreditsFeatureFlag,
} from "@/lib/credits/feature-flag";
import { isDebugDiagnosticsEnabled } from "@/lib/debug-flags";
import {
  isPiePlannerSearchEnabled,
  resolvePiePlannerSearchFlag,
} from "@/lib/pie/feature-flag-planner-search";
import {
  isRecEnginePlannerEnabled,
  resolveRecEnginePlannerFlag,
} from "@/lib/recommendation/engine/feature-flag-planner";
import {
  isRecEngineValidatorEnabled,
  resolveRecEngineValidatorFlag,
} from "@/lib/recommendation/engine/feature-flag-validator";

let logged = false;

function onOff(enabled: boolean): "ON" | "OFF" {
  return enabled ? "ON" : "OFF";
}

function shouldLogRaosFlags(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  if (import.meta.env.MODE === "development") return true;
  return isDebugDiagnosticsEnabled();
}

/** 與 Flag `parseTruthy` 相同規則；缺值 → undefined（字串 "undefined"）。 */
function parseFlagTriState(raw: string | undefined | null): "true" | "false" | "undefined" {
  if (raw == null) return "undefined";
  const v = String(raw).trim().toLowerCase();
  if (!v) return "undefined";
  if (v === "1" || v === "true" || v === "yes" || v === "on") return "true";
  if (v === "0" || v === "false" || v === "no" || v === "off") return "false";
  return "undefined";
}

function rawForLog(raw: unknown): string {
  if (raw === undefined) return "undefined";
  if (raw === null) return "null";
  return String(raw);
}

/** 單行純字串；只用 console.log（避免 Xcode 當成 error / 物件被截斷）。 */
function logPlannerFlagDiagnostics(): void {
  const envRaw = import.meta.env.VITE_REC_ENGINE_PLANNER_ENABLED;

  let localStorageRaw: string | null = null;
  try {
    localStorageRaw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("roamie:rec-engine-planner")
        : null;
  } catch {
    localStorageRaw = null;
  }

  const resolved = resolveRecEnginePlannerFlag();
  const finalEnabled = isRecEnginePlannerEnabled();

  const line =
    `[RAOS_FLAGS_DIAG] envRaw="${rawForLog(envRaw)}"` +
    ` | localStorageRaw="${rawForLog(localStorageRaw)}"` +
    ` | parsedEnv=${parseFlagTriState(envRaw as string | undefined)}` +
    ` | parsedLocalStorage=${parseFlagTriState(localStorageRaw)}` +
    ` | final=${onOff(finalEnabled)}` +
    ` | source=${resolved.source}`;

  console.log(line);
}

/**
 * App 啟動完成後呼叫一次。
 * ON/OFF 走實際 `is*Enabled()`；source 走同優先序 resolve（storage → env → default）。
 */
export function logRaosFlagsOnStartup(): void {
  if (!shouldLogRaosFlags() || logged) return;
  logged = true;

  const plannerEnabled = isRecEnginePlannerEnabled();
  const recommendationValidatorEnabled = isRecEngineValidatorEnabled();
  const itineraryValidatorEnabled = isItineraryValidatorEnabled();
  const piePlannerSearchEnabled = isPiePlannerSearchEnabled();
  const candidatePoolEnabled = isCandidatePoolEnabled();
  const creditsEnabled = isCreditsFeatureEnabled();

  const plannerSource = resolveRecEnginePlannerFlag().source;
  const recommendationValidatorSource = resolveRecEngineValidatorFlag().source;
  const itineraryValidatorSource = resolveItineraryValidatorFlag().source;
  const piePlannerSearchSource = resolvePiePlannerSearchFlag().source;
  const candidatePoolSource = resolveCandidatePoolFlag().source;
  const creditsSource = resolveCreditsFeatureFlag().source;

  console.log(
    `[RAOS_FLAGS] planner=${onOff(plannerEnabled)} source=${plannerSource}` +
      ` | recommendationValidator=${onOff(recommendationValidatorEnabled)} source=${recommendationValidatorSource}` +
      ` | itineraryValidator=${onOff(itineraryValidatorEnabled)} source=${itineraryValidatorSource}` +
      ` | piePlannerSearch=${onOff(piePlannerSearchEnabled)} source=${piePlannerSearchSource}` +
      ` | candidatePool=${onOff(candidatePoolEnabled)} source=${candidatePoolSource}` +
      ` | credits=${onOff(creditsEnabled)} source=${creditsSource}`,
  );

  logPlannerFlagDiagnostics();
}
