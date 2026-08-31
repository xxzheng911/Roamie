import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const meal = fs.readFileSync(path.join(root, "src/lib/ai/meal-intent-parser.ts"), "utf8");
const nearby = fs.readFileSync(path.join(root, "src/lib/ai/chat-place-recommendation.ts"), "utf8");
const destination = fs.readFileSync(
  path.join(root, "src/lib/ai/chat-destination-category-recommendation.ts"),
  "utf8",
);
const diversity = fs.readFileSync(path.join(root, "src/lib/place-reason-diversity.ts"), "utf8");
const summary = fs.readFileSync(path.join(root, "src/lib/ai/chat-place-recommendation.ts"), "utf8");

assert.doesNotMatch(destination, /reason: buildMealRecommendationDescription\(place, mealIntent\)/);
assert.match(nearby, /preserveMealRecommendationReason\(item\.reason, source, mealIntent\)/);
assert.match(destination, /preserveMealRecommendationReason\(withTypes\.reason, place, mealIntent\)/);
assert.doesNotMatch(diversity, /templateCount: 0/);
assert.match(meal, /const groundedReason = reason\?\.trim\(\)/);
assert.match(meal, /groundedReason\s*\? sanitizeMealReasonText\(groundedReason, intent\.slot\)/);
assert.match(meal, /: buildMealRecommendationDescription\(place, intent\)/);
assert.match(diversity, /case "late_hours"[\s\S]*?營業至/);
assert.match(diversity, /case "nearby"[\s\S]*?距離你很近/);
assert.match(diversity, /case "high_rating"[\s\S]*?Google 評分/);
for (const followup of ["如果你偏好：", "我可以再幫你縮小範圍", "如果你喜歡安靜"]) {
  assert.equal(summary.includes(followup), false, `post-recommendation follow-up must be absent: ${followup}`);
}

console.log("verify:recommendation-reason-template-pipeline passed");
