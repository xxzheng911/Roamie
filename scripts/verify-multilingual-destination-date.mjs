import assert from "node:assert/strict";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

// Destination + date range in one turn. Dates stay owned by parseTravelDateRangeFromText;
// unknown cities stay pending candidates for the Trusted Resolver (no provider call here).
const cases = [
  ["Tokyo 11/25-11/30", { destination: "東京", dated: true }],
  ["Porto 11/25-11/30", { candidate: "Porto", dated: true }],
  ["Reykjavík 11/25-11/30", { candidate: "Reykjavík", dated: true }],
  ["I'm going to Tokyo 11/25-11/30", { destination: "東京", dated: true }],
  ["11/25-11/30 도쿄 여행", { destination: "東京", dated: true }],
  ["11/25-11/30に東京へ行きます", { destination: "東京", dated: true }],
  ["東京 11/25-11/30", { destination: "東京", dated: true }],
  ["我11/25-11/30要去東京", { destination: "東京", dated: true }],
  ["京都 11/25-11/30", { destination: "京都", dated: true }],
  ["日本東京都", { destination: "東京", dated: false }],
  ["Tokyo", { destination: "東京", dated: false }],
];

for (const [text, want] of cases) {
  const ctx = mergeTravelContext(createEmptySession(), text).context;
  if (want.destination) assert.equal(ctx.destination, want.destination, `${text} destination`);
  if (want.candidate) {
    assert.equal(ctx.destinationCandidate?.raw, want.candidate, `${text} candidate`);
    assert.equal(ctx.destinationCandidate?.status, "pending", `${text} stays unverified`);
  }
  if (want.dated) {
    assert.match(ctx.startDate ?? "", /-11-25$/, `${text} startDate`);
    assert.match(ctx.endDate ?? "", /-11-30$/, `${text} endDate`);
    assert.equal(ctx.days, 6, `${text} days come from the range, not "30"`);
  }
}

console.log(`PASS multilingual destination + date (${cases.length} cases)`);
