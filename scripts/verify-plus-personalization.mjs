#!/usr/bin/env node
/**
 * P0 Plus personalization E2E verification.
 * Prompt wiring (always) + live OpenAI diff (when OPENAI_API_KEY is set).
 *
 * 執行：npm run verify:plus-personalization
 */
import { runPlusPersonalizationVerifyFull } from "../src/lib/ai/plus-personalization-verify.ts";

console.info("[verify:plus-personalization] Roamie Plus P0 QA\n");

const result = await runPlusPersonalizationVerifyFull();

if (!result.passed) {
  process.exit(1);
}

console.info("QA PASSED", {
  promptDiffScore: result.promptDiffScore,
  liveAiSkipped: result.liveAiSkipped,
  liveAiPassed: result.liveAiPassed,
});
