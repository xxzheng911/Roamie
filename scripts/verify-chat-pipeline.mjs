#!/usr/bin/env node
/**
 * Chat pipeline QA（無需啟動 App / Xcode）。
 * 執行：npm run verify:chat
 */
import { runChatPipelineQa } from "../src/lib/chat/chat-pipeline-verify.ts";

console.info("[verify:chat] Roamie chat pipeline QA\n");

const result = runChatPipelineQa();

if (!result.passed) {
  process.exit(1);
}
