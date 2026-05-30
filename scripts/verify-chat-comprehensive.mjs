#!/usr/bin/env node
/**
 * Chat 自然語句 comprehensive QA（40+ 句）。
 * 執行：npm run verify:chat:comprehensive
 */
import {
  printComprehensiveQaTable,
  runChatComprehensiveQa,
} from "../src/lib/chat/chat-comprehensive-qa.ts";

console.info("[verify:chat:comprehensive] Roamie chat natural-language QA\n");

const result = await runChatComprehensiveQa({ concurrency: 2 });

printComprehensiveQaTable(result.rows);

console.info(`\n[verify:chat:comprehensive] PASS=${result.passCount} FAIL=${result.failCount}`);

if (!result.passed) {
  console.error("\nFailed cases:");
  for (const r of result.rows.filter((x) => x.result === "FAIL")) {
    console.error(`  - ${r.test_input}: ${r.error}`);
  }
  process.exit(1);
}
