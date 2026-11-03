#!/usr/bin/env node
// R10 輔助：唯讀輪詢背景 r10 全量輸出檔，直到出現最終總表行或逾時（最多 9 分鐘）；只印進度。不寫任何檔案。
import { readFileSync, existsSync } from "node:fs";
const FILE = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/tasks/bh4a2ysij.output";
const deadline = Date.now() + 540_000;
for (;;) {
  const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
  if (/verify-destination-authority-phase2-r10: work P1=/.test(text) || /INFRA-FAIL count=|BUILD-FAIL|anchor/.test(text.slice(0, 4000)) && /exit|FAIL count/.test(text)) {
    console.log("DONE");
    break;
  }
  if (Date.now() > deadline) {
    const prog = text.match(/\[p2r5\] (\d+)\/(\d+)\s*$/);
    console.log(`WAITING ${prog ? `${prog[1]}/${prog[2]}` : "(no progress line)"}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
