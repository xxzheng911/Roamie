import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaceDetailSheet } from "../src/components/map/PlaceDetailSheet.tsx";
import { I18nProvider } from "../src/hooks/use-i18n.tsx";
import { buildPlaceImageUrls } from "../src/lib/place-detail-resolve.ts";
import { getRoamieDefaultImage } from "../src/services/placeImageService.ts";

// Provider metadata fixtures, not live provider requests or device observations.
const cases = [
  { name: "Playacolores", id: "ChIJJxdtWymPGGAR-pxIzxoR4m4", photoNames: [] },
  { name: "Chiyoda Building II", id: "ChIJmVTkbkOPGGARf4Y6vd2yJ78", photoNames: [] },
  { name: "UDXギャラリー", id: "udx-renderer-fixture", photoNames: ["places/udx-renderer-fixture/photos/provider-photo"] },
];
const noop = () => {};
for (const fixture of cases) {
  const place = { ...fixture, photoName: fixture.photoNames[0] ?? null, reason: "", address: null,
    lat: 35.7, lng: 139.77, rating: null, userRatingCount: null, primaryType: null,
    businessStatus: null, openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "",
    closingSoonNote: "", nextOpenHint: "" };
  const imageUrls = buildPlaceImageUrls(place);
  for (const category of ["sight", "park"]) {
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(PlaceDetailSheet, { place, imageUrls, fallbackCategoryId: category,
        distanceLabel: null, isSaved: false, isBusy: false, transportModes: [],
        transportLoading: false, transportTip: "", selectedTransportMode: null,
        onSelectTransportMode: noop, onNavigate: noop, onToggleSave: noop,
        onAddToTrip: noop, onOpenChat: noop })));
    const hasPhotos = fixture.photoNames.length > 0;
    const branch = hasPhotos ? "provider-photo" : "fallback-visual";
    assert.match(html, new RegExp(`data-place-detail-hero="${branch}"`));
    assert.doesNotMatch(html, /尚無照片|No photos yet|写真はまだありません|아직 사진이 없어요|uiCoverage\.noPhotos/);
    if (hasPhotos) {
      assert.equal(imageUrls.length, 1);
      assert.ok(imageUrls[0].includes("udx-renderer-fixture"));
      assert.match(html, /<img/); // SafeImage waits for signing after mount.
      assert.ok(!html.includes(`src="${getRoamieDefaultImage(category)}"`));
    } else {
      assert.deepEqual(imageUrls, []);
      assert.ok(html.includes(`src="${getRoamieDefaultImage(category)}"`));
      assert.doesNotMatch(html, /opacity-0/);
    }
    console.info(JSON.stringify({ name: place.name, id: place.id, metadataLength: fixture.photoNames.length,
      imageUrls, category, fallbackResolver: getRoamieDefaultImage(category), branch,
      signingPending: hasPhotos, imageError: false }));
  }
}
console.info("Place Detail actual renderer regression: PASS (provider fixtures; no live image fetch).");
