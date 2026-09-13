import assert from "node:assert/strict";
import fs from "node:fs";
import { extractGooglePlacePhotoName } from "../src/lib/safe-image-url.ts";
import { resolveSavedPlacePhotoResource } from "../src/lib/saved-place-utils.ts";
import { tripPlaceToItineraryItem } from "../src/lib/trip/trip-place-input.ts";

const photo = "places/ChIJ_photo_test/photos/photo-token";
const encoded = `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=600`;

assert.equal(extractGooglePlacePhotoName(photo), photo);
assert.equal(extractGooglePlacePhotoName(encoded), photo);
assert.equal(extractGooglePlacePhotoName("/api/place-photo?photo=not-a-resource&w=600"), null);
assert.equal(extractGooglePlacePhotoName("/api/place-photo?photo=%E0%A4%A&w=600"), null);

const savedBase = {
  id: "saved-1",
  name: "Saved place",
  category: "cafe",
  address: null,
  city: null,
  lat: null,
  lng: null,
  notes: null,
  mood_tag: null,
  cover_image: encoded,
  image_url: null,
  image_source: "google",
  metadata: {},
  created_at: "2026-09-14T00:00:00.000Z",
};
assert.equal(resolveSavedPlacePhotoResource(savedBase), photo);
assert.equal(
  resolveSavedPlacePhotoResource({ ...savedBase, metadata: { photoName: photo } }),
  photo,
);

const itineraryItem = tripPlaceToItineraryItem(
  {
    name: "Trip place",
    placeName: "Trip place",
    title: "Trip place",
    address: "",
    lat: 25,
    lng: 121,
    googlePlaceId: "ChIJ_trip_photo",
    photoName: photo,
    rating: 4.7,
  },
  { date: "2026-09-14" },
);
assert.equal(itineraryItem.photoName, photo);
assert.equal(itineraryItem.googlePlaceId, "ChIJ_trip_photo");
assert.equal(itineraryItem.rating, 4.7);

const cover = fs.readFileSync("src/components/media/PlaceCoverImage.tsx", "utf8");
const placeImage = fs.readFileSync("src/components/media/PlaceImage.tsx", "utf8");
const safeImage = fs.readFileSync("src/components/media/SafeImage.tsx", "utf8");
const favorite = fs.readFileSync("src/components/saved/SavedPlaceCoverThumb.tsx", "utf8");
const tripCard = fs.readFileSync("src/components/saved/TripPlaceCard.tsx", "utf8");
const detail = fs.readFileSync("src/components/map/PlaceDetailSheet.tsx", "utf8");

assert.match(cover, /!shouldLoad[\s\S]*animate-pulse/);
assert.doesNotMatch(cover, /!shouldLoad[\s\S]{0,240}<img/);
assert.match(placeImage, /!shouldLoad[\s\S]*animate-pulse/);
assert.match(safeImage, /setResolvingSignature\(true\)/);
assert.match(safeImage, /signed[\s\S]*setResolvingSignature\(false\)/);
assert.match(favorite, /resolveSavedPlacePhotoResource/);
assert.match(favorite, /<PlaceImage/);
assert.match(tripCard, /<PlaceImage/);
assert.match(detail, /fetchPriority=.*high/);

console.log("Signed place photo surface regression: PASS");
