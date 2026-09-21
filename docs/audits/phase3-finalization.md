# Localization Phase 3 Finalization

HEAD: `62fb6901c59ae16d7d01ec85a5571548fbeba4c9`. Initial working tree: 97 paths. Final: 129 paths. Nothing committed, pushed, deployed, archived or synced to Capacitor. Build number and native configuration unchanged.

## Bounded changes

- 175 destination summaries are static editorial copy (174 distinct summaries), moved into the canonical `destinationEditorial` message namespace. Geography/identity/type/order stay in the structured destination index. All output paths (curated, dynamic, cache, fallback) project display with the requested locale. Unknown non-zh editorial input gets a localized type-based description, never a Chinese fallback. Cached options remain canonical; locale-specific projection is applied on every read. The zh-TW curated text is retained.
- 78 curated theme occurrences (51 distinct titles) have complete four-language display mappings. `canonicalEditorialTheme` returns the unchanged legacy semantic value for matching/ranking/nearby policies. Only `localizeCombinationThemeTitle` resolves display language, including session offers and final suggestion rendering. No place names, theme matching values, category enums or analytics identifiers were translated.
- A shared `GeneratedLocaleContract` defines optional `generatedLocale`. Missing/invalid means unknown. Metadata is assigned at generation, not by reading old records. No DB schema migration or remote write occurred during this work.
- Supabase Chat writes use the existing `content` column with a versioned assistant envelope carrying `generatedLocale`. `/api/chat` now forwards locale through schema parsing; `/api/roamie` covers stream and non-stream writes. Restoring old plain-text or JSON history preserves original content and unknown provenance. User messages are unchanged. Stream client captures locale in the request and response. Historical messages keep their language; itinerary handoff and current session recommendation prose use a separate read-only projection.
- Saved-trip JSON preserves provenance through normalization/storage/editing. Itinerary AI responses carry their request locale; the existing Chinese deterministic planner fallback is honestly marked zh-TW. Saved card/header/title display derives from neutral destination/day facts when copy is foreign/legacy; customized titles stay unchanged. Preview summary and generated transport tips are gated independently. Notes, IDs, coordinates, dates and order are not migrated or translated. Trip settings track the provenance of the existing Chinese transport-tip producer separately.
- Outfit generation now passes locale client → server schema → AI instruction, and stores `outfitCopy.generatedLocale` independently from trip narrative locale. The cache key includes locale. A cancelled effect cannot publish or persist a stale response. Old-server responses lacking provenance use local localized fallback and are not persisted as verified current-locale AI output. Daily outfit advice carries provenance; legacy/foreign display is rebuilt from numeric weather/activity facts. Old textual weather labels are not replayed as current-locale labels. User style preferences remain intact.
- Verified enrichment boundary: server availability hints and late-night summaries could append Chinese to otherwise localized AI prose before persistence. Non-zh copy now uses the request locale without changing filtering, ranking or external place names.
- Home weather remains cached neutral scene → current locale projection; Home insight cache remains owner + locale scoped. No new AI architecture or second locale authority.

## Contract classification and legacy behavior

| Field family | Contract | Locale change |
| --- | --- | --- |
| IDs, geography, coordinates, dates, times, ordering, ratings, price/category enums | LANGUAGE_NEUTRAL | Retain unchanged |
| Notes, customized titles, user messages | USER_AUTHORED | Never translate/rewrite |
| External place/business names, addresses | External factual identity | Retain identity |
| Assistant prose, recommendation reason, generated summary/title | GENERATED_LOCALIZED | Carry generatedLocale; historical chat remains original; new UI projects foreign/unknown copy |
| Outfit/weather explanation | GENERATED_LOCALIZED | Nested canonical contract; locale cache + factual projection |
| Generated transport tips | GENERATED_LOCALIZED | Independent provenance; unknown/foreign prose not rendered as current language |

Legacy records are accepted without migrations. Unknown does not mean the current locale. Display projections do not rewrite stored history/trip payloads or user notes. A new valid outfit result is the existing explicit onGenerated save boundary; fallback is display-only. There is no regeneration loop caused by missing metadata: local fallback is keyed to the requested locale/input.

## Strict completeness

Confirmed remaining production literal leakage: **0**. Files: **none**. Strict gate checks confirmed A/B records and the generated-display contract regression. The separate G/manual-review backlog is non-blocking as requested; it is not declared safe or fully localized. At final inventory, **7,802** original G rows remain present. This round did not bulk-translate the original 7,813 manual-review strings; changes outside the 253 editorial occurrences are confined to proven persisted copy/provenance boundaries. Prompt instructions are explicitly allowlisted by function, not by whole file.

The dictionary adds 253 keys × 4 locales: 174 distinct summaries, 51 distinct theme titles, 3 neutral destination fallback descriptions, and 25 outfit/availability/trip display keys. This deduplicates display strings rather than duplicating destination records four times.

## Verification

All eight required Plus/subscription scripts PASS. Provider/Auth PASS (8 browser cases). Locale projection, Chat shortcut/historical reuse, itinerary localization, combination localization, transport copy, Home localization and personalization checks PASS. The new deterministic test covers all 175 summaries / 78 title occurrences in every locale, Supabase encoding/restore, unknown legacy Chat, saved-trip JSON round-trip, user note/identity/order preservation, zh-TW → ja handoff/cache projection and outfit fallback. See `phase3-verification-results.json` for actual commands.

Production web build: PASS. `git diff --check`: PASS. TypeScript: HEAD 334, current 334, **new 0** (file/code/site multiset comparison). New non-formatting lint diagnostics: **0**. Formatting findings remain; this was not a formatting sweep.

The two requested known baseline failures retain identical HEAD/current assertion signatures: `verify-plus-entitlement-authority` and `verify-localization-diversity-hard-gates`. Not fixed.

Additional bounded semantic checks: country-city discovery PASS. `verify-country-city-combination-flow` has the same three HEAD/current A3 Seoul failures (`no Seoul places failure`, `shows combinations`, `pending=combination_choice`), with zero new failures. This extra pre-existing failure is reported separately and is not described as PASS.

## Complete diff scope

Primary categories (each path counted once): A=2, B=0, C=24, D=49, E=34, F=9, G=9, H=2, I=0.
A = prior Provider/Auth fix; B = Plus/RevenueCat (already in HEAD, no new independent pending path); C = Phase 1; D = Phase 2; E = Phase 3 (takes precedence on shared paths); F = tests/verification; G = audit docs; H = existing generated metadata/artifacts; I = unrelated/suspicious.

Every path and its reason is recorded in `phase3-diff-scope.json`. No dependency/lockfile, environment file, secret, build artifact, DerivedData or Xcode user-data change is included in this scope. The two H paths predate Phase 3 and match the preflight hashes: `src/generated/app-bundle-meta.ts` and `ios/App/App/config 2.xml`. The duplicate XML is byte-identical to official config.xml and not referenced by the Xcode project. Both were left untouched, not silently cleaned or staged.

## Next boundary

Source is ready for four-language native retest after a separately authorized production build/Capacitor sync. No native asset update happened in this phase. Server-side persistence/generation changes also require a separately authorized server release to exercise the new backend contract against a deployed API; the client safely handles older responses with missing provenance.

Verdict: **READY FOR FOUR-LANGUAGE NATIVE RETEST** for the requested confirmed-copy gate and required regression set; the separately listed unchanged baseline failures are not represented as green tests.
