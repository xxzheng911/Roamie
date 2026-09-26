# Place Detail fallback verification — 2026-09-27

## Before editing (P0–P3)

Previous fallback implementation: **NO in this checkout**. Prior-turn execution history is not available; the following is the observed starting working-tree evidence, not an attribution of every change to a particular turn.

Existing tracked modifications: `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App/Info.plist`, `package-lock.json`, `package.json`, `scripts/verify-support-privacy-public.mjs`, `src/App.tsx`, `src/components/MapExploreSheet.tsx`, `src/components/map/MapExplorePlaceCards.tsx`, `src/generated/app-bundle-meta.ts`, `src/lib/public-routes.ts`, `src/routeTree.gen.ts`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/login.tsx`, `src/routes/login/legal.tsx`, `src/routes/privacy.tsx`, `src/routes/support.tsx`, `src/styles.css`.

Existing untracked files: `docs/app-store-review-remediation.md`, `docs/router-pending-lifecycle-fix.md`, `ios/App/App/config 2.xml`, `ios/App/App/config 3.xml`, `scripts/patch-tanstack-router.mjs`, `scripts/verify-app-review-browser.mjs`, `scripts/verify-explore-sheet-geometry.mjs`, `scripts/verify-protected-login-bootstrap.mjs`, `scripts/verify-router-pending-lifecycle.mjs`, `src/lib/legal-navigation.ts`, `src/routes/terms.tsx`.

Relevant existing diff only changed sheet max height/body scrolling, ignored touch pointer-down in the card drag handler, and changed card size/touch-action/scroll-snap CSS. **There was no fallback fix diff.** Neither `PlaceDetailSheet.tsx` nor `place-detail-resolve.ts` nor `_app.map.tsx` had a starting diff.

Source hero was:

```tsx
photos.length > 0 ? <SafeImage ... /> :
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    {t("uiCoverage.noPhotos")}
  </div>
```

Both `dist/client/assets/explore-map-selection-dnO5GjjL.js` and the same file under `ios/App/App/public/assets` contained that empty div and translation call. Both SHA-256: `eaa357020fcf51dcde152cbbb0eb794f0ad776f15721e8ca0c2579b3075546cd`.

This explains why rebuilding and running the old source reproduced the empty hero. It is not evidence of a sync failure.

## Actual render path

`/_app/map` → `MapExplorePlaceCards` card `onClick` → `onSelect(i)` → `_app.map.tsx:handlePlaceSelect` → `setSelectedPlace({...place, reason})` + `setSheetMode("detail")` → `PlaceDetailSheet` with `imageUrls={buildPlaceImageUrls(selectedPlace)}` → `photos.length > 0` condition.

Explore detail is an inline sheet, not navigation to a separate detail route. The separate `/_app/place` route also renders this same `PlaceDetailSheet`, using `buildPlaceImageUrls(place)`. Native-specific fetching in that route does not select a different hero renderer. Searching all src found only this renderer calling `uiCoverage.noPhotos`; the literal Chinese string lives in the translation dictionary. `MapPlacePreview`, `PlaceImage`, `PlaceCoverImage`, and search thumbnails are other image surfaces, not alternative detail heroes.

`buildPlaceImageUrls` gathers `photoNames`/`photoName`, builds provider URLs and deduplicates them. Without names, it checks the supplied/cached cover; with no usable cover it returns `[]`. It does not invoke the Explore fallback resolver. Before this change, an empty array therefore never mounted `SafeImage`: no photo loading, signing, or image error handler could repair it.

Explore cards use `PlaceCoverImage` → `usePlaceCoverImage` → `getRoamieDefaultImage(categoryKey)`. This resolver returns bundled `scene-cafe.jpg` for sight/food/coffee/street and `roamie-default-cover.png` for other categories. The fix passes the same `cat.id` to detail and calls the same synchronous resolver in the empty-array branch. Provider photo and carousel code is unchanged. Standalone detail uses the resolver's default when no Explore category is supplied.

## Renderer regression (P5)

Run: `npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-place-detail-photo-renderer.mjs`.

This renders the actual whole `PlaceDetailSheet` via React `renderToStaticMarkup`, with its actual i18n provider, URL builder, fallback resolver and SafeImage. The new test failed before the fix with rendered `No photos yet`, then passed after the fix. Tests cover both sight and park categories, verify the actual fallback img src, and exclude all four translations of the empty state.

| Fixture | Metadata length | Resolved provider URLs | Final branch |
| --- | --- | --- | --- |
| Playacolores / ChIJJxdtWymPGGAR-pxIzxoR4m4 | 0 | [] | fallback-visual |
| Chiyoda Building II / ChIJmVTkbkOPGGARf4Y6vd2yJ78 | 0 | [] | fallback-visual |
| UDXギャラリー | 1 | /api/place-photo?photo=places%2Fudx-renderer-fixture%2Fphotos%2Fprovider-photo&w=800 | provider-photo |

For both zero-photo fixtures: no-photo=true, signing/loading gate=false, no image error event, resolver output `/src/assets/scene-cafe.jpg` (sight) or `/src/assets/roamie-default-cover.png` (park); fallback img is present immediately without opacity-0. The img uses eager loading; actual file decoding/load events are outside SSR.

UDX uses an explicitly synthetic provider photo resource to verify branch preservation, not a live UDX image download. SafeImage begins signing-pending on mount; actual signing/image success is not claimed. No live provider requests were made. The zero metadata premise comes from the user's confirmed provider results. No attached iPad runtime was accessible, so none of these results is presented as new WKWebView telemetry or a passed device acceptance test.

Existing `npm run verify:place-detail-device-regressions`: PASS.

## Build and bundle verification (P6)

`npm run cap:sync:ios`: exit 0, including production client/server build, postbuild preparation, release artifact validation, native sync and bundled config verification. Wrangler could not write its auxiliary log outside the sandbox (EPERM); compilation and sync still completed successfully.

All **127** files in `dist/client` were compared byte-for-byte against their counterparts in `ios/App/App/public`: PASS. Bundled config has no `server.url`.

New hero chunk in both locations: `assets/explore-map-selection-DnuG9FSA.js`; SHA-256 `96dc346fc37dff3139919f59268d3f09e30f4e631360c91d9c68b9584d0e9f3b`. It contains `data-place-detail-hero`, `fallback-visual`, and `provider-photo`, and no `uiCoverage.noPhotos` call. Both fallback assets are present: `scene-cafe-DVVfmY2m.jpg`, `roamie-default-cover-DAbJiF1P.png`.

`git diff --check`: PASS.

This task changed `src/components/map/PlaceDetailSheet.tsx`, `src/routes/_app.map.tsx`, one explanatory comment in `src/lib/place-detail-resolve.ts`, added the renderer regression and this report; build regenerated `src/generated/app-bundle-meta.ts` and generated build/iOS public assets. Existing unrelated work was retained. No deploy, commit, push, Archive or build-number bump was performed.

Ready for another Xcode Run: **YES**. Device acceptance remains to be performed.
