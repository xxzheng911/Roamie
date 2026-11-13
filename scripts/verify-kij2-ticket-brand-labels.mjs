/**
 * KIJ2-I — TripAffiliateSection: ticket section Klook / KKday buttons show the brand name only,
 * in all four locales and for every ticket label variant (ticket / experience / transport search,
 * exact product, related experiences). Other providers in a ticket section, and flight / hotel /
 * package sections, keep affiliateDisplayLabel(). Tracking (impression + click payload) unchanged:
 * the component diff vs the HEAD snapshot is the label expression only.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=90 scripts/verify-kij2-ticket-brand-labels.mjs [-- --head-dir=<snap-HEAD>]
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let passes = 0;
function check(name, fn) {
  try { fn(); passes++; console.log(`PASS ${name}`); } catch (error) { failures++; console.log(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`); }
}
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NETWORK_DISABLED"); };
const headDir = process.argv.slice(2).find((a) => a.startsWith("--head-dir="))?.slice(11);

try {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { I18nProvider } = await import("../src/hooks/use-i18n.tsx");
  const { TripAffiliateSection } = await import("../src/components/trip/TripAffiliateSection.tsx");
  const { affiliateDisplayLabel } = await import("../src/lib/native-qa-display.ts");
  const { translate } = await import("../src/lib/i18n/translate.ts");

  const LOCALES = ["zh-TW", "en", "ja", "ko"];
  const setLocale = (locale) => Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: locale, languages: [locale] } });
  const render = (locale, props) => { setLocale(locale); return renderToStaticMarkup(createElement(I18nProvider, null, createElement(TripAffiliateSection, props))); };
  const labels = (html) => [...html.matchAll(/<span class="min-w-0 text-center whitespace-normal">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  const offer = (provider, kind, label, extra = {}) => ({ provider, kind, label, url: `https://example.test/${provider}/${kind}?aff=1`, enabled: true, ...extra });
  const brand = { klook: "Klook", kkday: "KKday", trip: "Trip.com", agoda: "Agoda", booking: "Booking.com" };
  const zh = (key, b) => translate("zh-TW", `nativeQa.${key}`, { brand: b });

  check("locale fixture switches I18nProvider (title differs per locale)", () => {
    const titles = LOCALES.map((l) => render(l, { kind: "flight", offers: [offer("trip", "flight", "Trip.com 機票")] }).match(/<\/span> ([^<]+)<\/p>/)?.[1]);
    assert.equal(new Set(titles).size, 4, JSON.stringify(titles));
  });

  // Ticket section — every label variant, both providers, 4 locales → brand only.
  const variants = {
    ticketSearch: (p) => offer(p, "activity_ticket", zh("ticketSearch", brand[p])),
    experienceSearch: (p) => offer(p, "activity_ticket", zh("experienceSearch", brand[p])),
    transportSearch: (p) => offer(p, "activity_ticket", zh("transportSearch", brand[p])),
    exactProduct: (p) => offer(p, "activity_ticket", brand[p]),
    related: (p) => offer(p, "activity_ticket", brand[p], { searchIntent: "related_experiences" }),
  };
  for (const locale of LOCALES) {
    for (const [name, make] of Object.entries(variants)) {
      check(`[${locale}] ticket ${name}: Klook / KKday buttons are brand-only`, () => {
        const html = render(locale, { kind: "ticket", offers: [make("klook"), make("kkday")], compact: true, surface: "itinerary", placeHash: "h", eligible: true });
        assert.deepEqual(labels(html), ["Klook", "KKday"]);
        // Button text only (the section title legitimately says 搜尋 / Search / 探す / 찾기).
        assert.doesNotMatch(labels(html).join("|"), /搜尋|Search|探す|検索|찾기|검색/);
        assert.equal((html.match(/<button /g) ?? []).length, 2);
      });
    }
    check(`[${locale}] ticket section title unchanged (related → relatedExperiences, else ticket)`, () => {
      const rel = render(locale, { kind: "ticket", offers: [variants.related("klook")] });
      const tix = render(locale, { kind: "ticket", offers: [variants.ticketSearch("klook")] });
      assert.ok(rel.includes(translate(locale, "nativeQa.relatedExperiences")), rel);
      assert.ok(tix.includes(translate(locale, "nativeQa.ticket")), tix);
    });
    check(`[${locale}] other provider inside a ticket section keeps affiliateDisplayLabel`, () => {
      const o = offer("trip", "activity_ticket", zh("ticketSearch", "Trip.com"));
      const html = render(locale, { kind: "ticket", offers: [o] });
      assert.deepEqual(labels(html), [affiliateDisplayLabel(o, locale).replace(/^在 (?=(?:Klook|KKday))/, "")]);
    });
    for (const [kind, offers] of [
      ["flight", [offer("trip", "flight", "Trip.com 機票")]],
      ["hotel", [offer("agoda", "hotel", "Agoda"), offer("trip", "hotel", "Trip.com"), offer("booking", "hotel", "Booking.com")]],
      ["package", [offer("trip", "package", "Trip.com"), offer("klook", "package", "Klook")]],
    ]) {
      check(`[${locale}] ${kind} section labels unchanged (affiliateDisplayLabel, Klook not brand-only outside ticket)`, () => {
        const html = render(locale, { kind, offers, surface: "itinerary" });
        assert.deepEqual(labels(html), offers.map((o) => affiliateDisplayLabel(o, locale)));
        assert.ok(labels(html).every((l) => l !== "Klook" && l !== "KKday"));
      });
    }
  }
  check("offers are not mutated by rendering (URL / tracking fields intact)", () => {
    const offers = [variants.related("klook"), variants.ticketSearch("kkday")];
    const before = JSON.stringify(offers);
    for (const l of LOCALES) render(l, { kind: "ticket", offers });
    assert.equal(JSON.stringify(offers), before);
  });

  // Static: tracking / click path unchanged vs HEAD (only the label expression line differs).
  const src = readFileSync("src/components/trip/TripAffiliateSection.tsx", "utf8");
  check("static: impression + click payload present", () => {
    assert.match(src, /eventName: "affiliate_cta_impression",\s*provider: offer\.provider === "trip" \? "tripcom" : offer\.provider,\s*surface: "itinerary"/);
    assert.match(src, /openAffiliateUrl\(offer\.url, \{\s*provider: offer\.provider === "trip" \? "tripcom" : offer\.provider,\s*type: offer\.kind,/);
  });
  if (headDir) {
    check("static: only the label line differs from HEAD", () => {
      const headPath = join(headDir, "src/components/trip/TripAffiliateSection.tsx");
      assert.ok(existsSync(headPath), headPath);
      const a = readFileSync(headPath, "utf8").split("\n");
      const b = src.split("\n");
      assert.equal(a.length, b.length);
      const diff = b.map((line, i) => (line === a[i] ? null : i + 1)).filter(Boolean);
      assert.equal(diff.length, 1, `changed lines ${diff}`);
      assert.match(b[diff[0] - 1], /kind === "ticket" && \(offer\.provider === "klook" \|\| offer\.provider === "kkday"\)/);
    });
  }
} catch (error) {
  failures++;
  console.log("FAIL harness", error?.stack ?? error);
}
check("network: fetch calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`${failures ? "FAIL" : "PASS"} kij2 ticket brand labels: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
