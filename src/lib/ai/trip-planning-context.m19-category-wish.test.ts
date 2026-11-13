import { categorySwitchSearchText, isFutureTripPlanningStatement } from "./trip-planning-context";

/**
 * M19 review of M18: category wish wording must reach the category path; named places must not.
 * 「想去泡湯」is listed in the M18 requirement (Japan region_choice); 「我想泡湯」「想泡湯」are the same wish.
 *
 * vitest is not installed in this repo, so this file carries a minimal self-contained harness
 * (describe / it.each / expect) and is run with:
 *   npx vite-node --config scripts/vite.verify.config.mjs src/lib/ai/trip-planning-context.m19-category-wish.test.ts
 * A failing assertion throws and sets a non-zero exit code.
 */

type Matchers = {
  toContain: (want: string) => void;
  toBeUndefined: () => void;
  toBe: (want: unknown) => void;
};

let failures = 0;
let passes = 0;
const prefix: string[] = [];

function describe(name: string, body: () => void): void {
  prefix.push(name);
  body();
  prefix.pop();
}

function runCase(name: string, body: () => void): void {
  const label = [...prefix, name].join(" > ");
  try {
    body();
    passes += 1;
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatName(template: string, args: readonly unknown[]): string {
  let index = 0;
  return template.replace(/%s/g, () => String(args[index++]));
}

const it = {
  each<Row extends readonly unknown[] | string>(rows: readonly Row[]) {
    return (template: string, body: (...args: Row extends readonly unknown[] ? Row : [Row]) => void): void => {
      for (const row of rows) {
        const args = (Array.isArray(row) ? row : [row]) as Row extends readonly unknown[] ? Row : [Row];
        runCase(formatName(template, args), () => body(...args));
      }
    };
  },
};

function expect(actual: unknown): Matchers {
  return {
    toContain(want: string) {
      if (typeof actual !== "string" || !actual.includes(want)) {
        throw new Error(`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(want)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) throw new Error(`expected undefined, got ${JSON.stringify(actual)}`);
    },
    toBe(want: unknown) {
      if (!Object.is(actual, want)) throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    },
  };
}

describe("categorySwitchSearchText — category wishes (M18 requirement 1 / 3)", () => {
  it.each<readonly [string, string]>([
    ["我想去博物館", "博物館"],
    ["I want to go to a museum", "museum"],
    ["rather than Sydney, I want to go to a museum", "museum"],
    ["我想泡溫泉", "溫泉"],
    ["想去海邊", "海邊"],
    ["泡湯", "泡湯"],
    ["想去泡湯", "泡湯"],
    ["我想泡湯", "泡湯"],
    ["想泡湯", "泡湯"],
  ])("%s → category %s", (text: string, want: string) => {
    expect(categorySwitchSearchText(text)).toContain(want);
  });

  it.each<string>(["我想去東京玩", "I want to go to Tokyo", "我想去上海", "我想去海南", "我想去草津溫泉", "我想去台北的博物館", "I'm going to Hot Springs", "I want to go to Bondi Beach"])(
    "%s is not a bare category wish",
    (text: string) => {
      expect(categorySwitchSearchText(text)).toBeUndefined();
    },
  );
});

describe("isFutureTripPlanningStatement — trip statements unchanged", () => {
  it.each<string>(["我想去東京玩", "我想去東京", "I want to go to Tokyo", "I want to go to Japan", "我要去台北", "12月想去東京玩", "I'm going to Bar Harbor"])(
    "%s is still trip planning",
    (text: string) => {
      expect(isFutureTripPlanningStatement(text)).toBe(true);
    },
  );
  it.each<string>(["我想去博物館", "I want to go to a museum", "我想泡溫泉"])("%s is not trip planning", (text: string) => {
    expect(isFutureTripPlanningStatement(text)).toBe(false);
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
}
