/**
 * Run: node scripts/verify-normalize-destination.mjs
 * (uses dynamic import — run from repo root after build not required if using ts via vite-node)
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function main() {
  const mod = await import("../src/lib/ai/normalize-destination.ts");
  const { extractKnownDestinationFromText, normalizeDestination, resolveCleanDestination } = mod;

  const cases = [
    ["11月去釜山怎麼樣", "釜山"],
    ["11月釜山適合嗎", "釜山"],
    ["我想11月去釜山", "釜山"],
    ["釜山11月有什麼好玩", "釜山"],
    ["那釜山呢", "釜山"],
    ["12月大阪適合拍照嗎", "大阪"],
    ["京都春天有什麼好玩", "京都"],
    ["大阪怎麼樣", "大阪"],
    ["首爾11月推薦嗎", "首爾"],
    ["東京附近呢", "東京"],
    ["釜山 11 月去的話你覺得怎麼樣", "釜山"],
  ];

  for (const [input, expected] of cases) {
    const got =
      extractKnownDestinationFromText(input) ??
      normalizeDestination(input) ??
      resolveCleanDestination(input, {});
    if (got !== expected) {
      throw new Error(`"${input}" → expected ${expected}, got ${got}`);
    }
  }

  const pronoun = resolveCleanDestination("那附近還有什麼", {
    sessionDestination: "大阪",
  });
  if (pronoun !== "大阪") {
    throw new Error(`pronoun follow-up expected 大阪, got ${pronoun}`);
  }

  console.info("[verify-normalize-destination] OK", cases.length, "cases");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
