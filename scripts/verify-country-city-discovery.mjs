/**
 * Verify dynamic country → city/region discovery (not curated-only).
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import {
  buildCountryCitySelectionReply,
  resolveDestinationAdvice,
} from "../src/lib/ai/destination-advice.ts";
import {
  buildCountryCityOptions,
  clearCountryCityOptionsCache,
  listStructuredCountries,
  validateCountryCityOptions,
} from "../src/lib/ai/country-city-options.ts";
import { isCountryLevelDestination } from "../src/lib/ai/destination-scope.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

clearCountryCityOptionsCache();

const ASIA = ["韓國", "日本", "泰國", "菲律賓", "越南", "印尼", "馬來西亞", "新加坡"];
const EUROPE = ["英國", "法國", "義大利", "西班牙", "荷蘭", "瑞士", "德國"];
const AMERICAS = ["美國", "加拿大"];
const OCEANIA = ["澳洲", "紐西蘭"];
const ALL = [...ASIA, ...EUROPE, ...AMERICAS, ...OCEANIA];

assert(listStructuredCountries().includes("菲律賓"), "structured index covers 菲律賓");

for (const country of ALL) {
  clearCountryCityOptionsCache();
  const built = buildCountryCityOptions({ country, month: 2 });
  const v = validateCountryCityOptions(built.options, country);
  assert(built.valid && v.ok, `${country} discovery valid (source=${built.source}, count=${built.options.length})`);
  assert(
    built.options.length >= 3 && built.options.length <= 5,
    `${country} has 3–5 options`,
  );
  assert(
    built.options.every((o) => o.country === country && o.name && o.summary && o.type),
    `${country} options shaped correctly`,
  );
  assert(
    !built.options.some((o) => o.name === country),
    `${country} does not list itself`,
  );

  const replyBuilt = buildCountryCitySelectionReply({
    country,
    month: 2,
    cityOptions: built.options,
  });
  assert(Boolean(replyBuilt?.reply), `${country} reply built`);
  assert(/可以先從這幾個城市／地區考慮：/.test(replyBuilt?.reply ?? ""), `${country} lists section`);
  assert(/你比較想去哪個城市或地區？/.test(replyBuilt?.reply ?? ""), `${country} fixed ending`);
  assert(!/選定地點後我再幫你看比較適合的日期/.test(replyBuilt?.reply ?? ""), `${country} no generic empty fallback`);
  assert(!/旅行日期或天數/.test(replyBuilt?.reply ?? ""), `${country} does not ask days`);
  for (const opt of built.options) {
    assert(
      replyBuilt?.reply?.includes(`・${opt.name}：`) ?? false,
      `${country} multiline ・${opt.name}`,
    );
  }
}

// Philippines Feb end-to-end
{
  clearCountryCityOptionsCache();
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "我明年 2 月想去菲律賓");
  assert(merged.context.destination === "菲律賓", "PH destination=菲律賓");
  assert(merged.context.travelMonth === "2月", "PH travelMonth=2月");
  assert(merged.context.travelYear === 2027, "PH travelYear=2027 (明年 from 2026)");
  assert(
    merged.context.destinationType === "country" ||
      isCountryLevelDestination(merged.context.destination),
    "PH type=country",
  );
  const advice = resolveDestinationAdvice(merged.context, merged.session, "我明年 2 月想去菲律賓");
  console.log("\n=== Philippines Feb reply ===\n");
  console.log(advice.reply);
  console.log("\n=============================\n");
  assert(Boolean(advice.reply), "PH has reply");
  assert(/馬尼拉|宿霧|長灘|巴拉望/.test(advice.reply ?? ""), "PH lists concrete places");
  assert(/・.+：/.test(advice.reply ?? ""), "PH multiline options");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "PH fixed ending");
  assert(!/選定地點後我再幫你看比較適合的日期/.test(advice.reply ?? ""), "PH no empty generic");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "PH does not ask days yet");
  assert(advice.pendingQuestion?.type === "region_choice", "PH pending=region_choice");
  assert(advice.contextPatch?.destinationType === "country", "PH patch type=country");
}

// Month must not wipe city options
{
  clearCountryCityOptionsCache();
  const a = buildCountryCityOptions({ country: "菲律賓", month: 2 });
  clearCountryCityOptionsCache();
  const b = buildCountryCityOptions({ country: "菲律賓", month: 8 });
  assert(a.options.length >= 3 && b.options.length >= 3, "PH cities exist for month 2 and 8");
  assert(
    a.options.map((o) => o.name).join(",") === b.options.map((o) => o.name).join(","),
    "PH city list independent of month",
  );
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll country-city discovery checks passed.");
