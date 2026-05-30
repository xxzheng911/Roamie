#!/usr/bin/env node
/**
 * Chat 完整 QA：四則手動模擬 + 真實 /api/roamie 請求（C/D）。
 * 執行：npm run verify:chat:full
 */
import { runChatPipelineFullQa } from "../src/lib/chat/chat-pipeline-full-qa.ts";

console.info("[verify:chat:full] Roamie chat full QA\n");

const result = await runChatPipelineFullQa();

console.info("\n[verify:chat:full] summary");
console.info(`  PASS=${result.passCount} FAIL=${result.failCount}`);
for (const c of result.cases) {
  console.info(
    `  ${c.id} ${c.passed ? "PASS" : "FAIL"} path=${c.path} recs=${c.recommendationCount} itinerary=${c.itineraryCount}${c.failureReason ? ` reason=${c.failureReason}` : ""}`,
  );
  console.info(`     → ${c.summaryExcerpt}`);
}
console.info("  aggregate logs:", result.aggregateLogs);

if (!result.passed) {
  process.exit(1);
}
