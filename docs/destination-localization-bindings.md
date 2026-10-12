# Display-only destination localization review

Wikidata CC0 label snapshots retain their source revisions. The references below approve **toponym display**, not Google Place ID equivalence, coordinate authority or administrative boundary equality.

## Approval criteria

Two different reviews must not be conflated:

- Geographic authority: resolver identity, exact scope, coordinates, routing and persistence. Unchanged by this index.
- Display identity: the editorial candidate's country, city/region meaning and contextual description must agree with the entity and an independent authoritative source. A name match alone is insufficient. An absent Google ID is not itself grounds for rejection.

Use `display_identity_evidence` with `scope=display_name_only`, a written basis, at least the revision-specific Wikidata source and independent evidence, and the review date. Explicit references and country/type/QID/admin conflict checks still apply. New records follow the same review; there are no country-specific acceptance branches. Unknown or pending candidates continue planning with existing aliases/original names.

## Decisions — 2026-10-12

- **APPROVED — Lisbon Q597.** Source: structured Portugal city candidate (hills/trams/coast). Turismo de Portugal identifies the capital by Tagus, hills and trams. Q597 represents the named city/municipality, distinct from the district and region. Approval is for the city name only.
- **APPROVED — Porto Q36433.** Source: structured Portugal city candidate (riverfront/wine/old town). Turismo de Portugal describes Porto city on Douro and its historic centre, distinguishing nearby Gaia/Matosinhos and the broader north. The municipality entity supplies the same city-seat toponym; its boundaries are not imported.
- **PENDING — Algarve Q26831.** Source: structured travel region (beaches/cliffs/holiday). Q26831 is a NUTS 3 subregion. Existing evidence does not establish that this is the intended regional entity. Need authoritative geographic scope comparison or review of the correct travel-region entity; do not equate similarly named regions.
- **APPROVED — Reykjavík Q1764.** Source: structured Iceland city candidate, expressly a capital/departure base. Visit Iceland identifies the capital city; Q1764 is the city, distinct from enclosing municipality Q1675663 and the wider capital region. Display scope is the city.
- **PENDING — Da Nang Q25282.** Source: curated and structured Vietnam city candidate describing a coastal central-Vietnam destination. Current municipality identity/scope and the editorial city-core meaning remain insufficiently reconciled. Need an official source explicitly relating the intended city core and the entity, including administrative-change context.
- **PENDING — Sapporo Q37951.** The entity is a Japanese city, but this candidate-producing path has no corresponding structured seed/source attachment. Do not approve a binding for a hypothetical production candidate. Need an actual candidate source and scope review; no new candidate is added here.

No records are rejected: uncertainty is not proof of non-equivalence.

Independent sources:
- https://www.visitportugal.com/en/destinos/lisboa/255867
- https://www.visiticeland.com/the-regions/reykjavik-the-capital/

QID, country/class/admin evidence, original source revision and per-record basis remain in `destination-localization-data.ts`. Historical ended/deprecated country claims are excluded from the captured country evidence; the snapshot is not a live country resolver. Evidence coordinates never replace candidate coordinates.

## Data update process

Assign a stable editorial reference at its owning data record. Review scope using the criteria above, retain QID/revision/provenance, and update labels only from a checked source snapshot. A change in QID or geographic meaning requires a new review. Fetch only needed entities during data updates; no runtime lookup, complete dumps, or automatic translation.

Priority: existing locale-specific name → approved offline label → existing alias → original name. Fixed diagnostic reasons identify unreviewed/conflicting/missing-label fallback. Missing translations never prevent planning.

Regression uses both real production review statuses and injected test-only registries for failure cases. The latter do not constitute evidence approving a production entity.

## Official travel-region display source (2026-10-12)

A binding may additionally carry `officialTravelRegion`, independently reviewed from its legacy Wikidata record. It has no QID requirement. The stable binding reference, matching country code and candidate type, `travel_region` semantics, official per-language URL, reviewed snapshot version, date and written evidence are mandatory. `display_name_only` and `boundaryEquivalence: false` are mandatory. An HTTPS URL alone is not approval: reviewers must verify the publisher and tourism meaning before setting either source or label status to approved. No URL is fetched at runtime.

For `editorial-pt-region-001`, the structured Portugal region describes beaches, cliffs and resort stays. Turismo de Portugal's official coastal tourism descriptions support English **Algarve** and Japanese **アルガルヴェ**:
- https://www.visitportugal.com/en/destinos/algarve/73810 (review snapshot `review-2026-10-12-en-73810-v1`)
- https://www.visitportugal.com/ja/destinos/algarve/73807 (review snapshot `review-2026-10-12-ja-73807-v1`)

These are local review versions, not publisher revision IDs. They approve tourism name display, not equality of territorial boundaries. Q26831 remains PENDING with all original provenance unchanged. No Korean tourism label is approved: Korean uses approved English with `english_fallback`. Traditional Chinese keeps the known original-language candidate name; this does not approve a new translation. Da Nang and Sapporo remain pending.

Locale-first priority: matching existing/provider name → approved Wikidata label → approved official tourism label → trusted locale alias / declared original-language name. If the target language has no name, use trusted English (existing/provider, then reviewed offline), otherwise original. Pending labels are never used. Independent approved offline sources with differing names fail closed with `identity_conflict`; no first-match choice. Other outcomes include `localized_name`, `english_fallback`, `original_fallback`, `binding_unreviewed`, `missing_locale_label` and `invalid_binding`.

Title/weather lookup reuses the same helper, requires explicit matching country context and exactly one reviewed display identity, and never reverse-matches pending translated labels. Custom titles remain untouched. This metadata is not destination acceptance, resolver or search authority.

## Trusted-name preservation coverage

Google normalization now retains supplied `originalName`, `englishName`, `localizedNames` and the response's `sourceLocale`. The request/App locale is not evidence of the returned language. Names from an existing normalized result are reused only for the same normalized Place ID; a different identity cannot inherit them. This changes display metadata, not geographic admission. Country-city normalization and validation retain English/source-locale metadata alongside the existing original/localized names and binding reference. The shared display helper consumes explicit trusted English names without creating offline approvals. Conflicting English fields fail closed.

Coverage is not universal: curated/structured entries often have only canonical Chinese and editorial descriptions. Official region and Wikidata records are independently reviewed. Da Nang may display through an existing alias while its Wikidata binding remains pending; the standard Japan options do not contain Sapporo. Provider preservation fixtures therefore do not establish real-provider name coverage.

The verified scope is Google normalization → candidate normalization/validation → display helper, plus existing JSON restoration and UI regression. `tripDestination` is retained as a resolver object, but selected city canonical context and flattened itinerary/title strings do not carry a complete multilingual metadata envelope. The separate place-details mapper also remains outside this change. Do not claim end-to-end name metadata preservation through every generation/persistence branch. Fixing those missing projections requires separately scoped identity-bound display metadata work; no resolver, generation handoff or database schema is changed here.

Future offline updates should be incremental data-only releases keyed by a reviewed stable external identity, with source versions and per-language provenance. Exact existing crosswalks can be revalidated automatically while ambiguous identities/changed administrative scopes require review. Country + name similarity is not an approval method. Neither a new data service nor provider calls are introduced by this change.

## End-to-end display metadata integration

The preceding coverage note records the pre-integration gaps. The direct paths now carry an optional `destinationDisplay` reference through offered destination options, selected planning context, the already-resolved TripLocation, the existing JSON itinerary payload and CoreTrip display projection. No database column is added. Metadata is selected only from explicitly offered/current display labels (including reviewed localized labels), never fuzzy name similarity. Applying it to a resolved location additionally requires matching country, the same supplied Place ID if present, and a matching city/region field. New destination selection clears stale display references. Resolver results, geography and acceptance rules are unchanged.

TripLocation's Google mapper captures names only when the response supplies a languageCode and its display text matches the extracted geographic field. It does not treat the requested App language as source evidence. Legacy geocoding and responses lacking that evidence retain their original behavior and safe fallback; coverage is not guaranteed for every provider result.

The existing generation persistence call copies this optional display reference after geographic resolution. Saved/Draft titles and weather headers consume it read-only; custom titles are retained. Day-plan output adapters and itinerary normalization preserve `englishName`, `localizedNames` and `sourceLocale`; TripPlaceCard projects available names using the current locale while legacy items keep their prior display behavior. The Details mapper reuses Google normalization for name metadata, with its request, field mask, locale/scope cache key, identity, address and geometry unchanged.

Tests distinguish real Portugal/Iceland editorial references from English-only mocked provider data for Porto, Reykjavík, Sapporo, Da Nang, Florence, Lyon, Queenstown and Marrakech. Algarve remains covered by the real official-region regression. Tests exercise actual mappers, context merge/resolver callback, itinerary adapter, JSON restore, CoreTrip/Draft/Weather projection and SSR stop card, not real network discovery or database writes. Full device/API behavior and legacy records without metadata remain outside offline evidence.


## Iceland attraction / route display review (2026-10-12)

The structured index supplies `藍湖` (hot springs/geothermal scenery) and `南部海岸`
(waterfalls/black-sand beaches/glaciers) under Iceland. Neither had trusted names or
binding metadata. This is missing coverage, not a dropped provider translation.

- `editorial-is-attraction-001`: Blue Lagoon is a geothermal spa attraction, not a city.
  English: https://www.bluelagoon.com/explore
  Japanese ブルーラグーン: https://www.is.emb-japan.go.jp/itpr_ja/volcano.html
  The Japanese embassy identifies the facility near the Reykjanes eruption area;
  this is government name evidence, not a claim that the embassy is a tourism operator.
- `editorial-is-route-001`: South Coast is a tourism route, not an administrative region.
  https://www.south.is/en/destinations/travel-routes/the-south-coast
  The official regional tourism page describes the same three landscape features.
  No Japanese/Korean label approved: use the reviewed English label.

`officialDestination` reuses the existing offline label validation and renderer.
Its semanticType is display evidence only. Legacy candidate type `region` remains
unchanged; it is not evidence of administrative equivalence. No QID, Google ID,
coordinates or boundaries are inferred. Root record status remains pending for
non-official identity authority; only the nested official display record is approved.
Original zh-TW remains unchanged. No runtime requests or automatic name matching.
