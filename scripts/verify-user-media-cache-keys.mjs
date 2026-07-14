/**
 * Unit checks for user-media cache keys and stable URLs (no Network).
 */
import {
  buildUserMediaCacheKey,
  stableMediaUrl,
} from "../src/lib/user-media/user-media-disk.ts";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    failed += 1;
  } else {
    console.log("OK", msg);
  }
}

const urlA =
  "https://xxx.supabase.co/storage/v1/object/public/profile-media/u1/avatar.jpg?v=111&token=abc";
const urlB =
  "https://xxx.supabase.co/storage/v1/object/public/profile-media/u1/avatar.jpg?v=222";

assert(
  stableMediaUrl(urlA) === stableMediaUrl(urlB),
  "stableMediaUrl ignores v= and token",
);

const k1 = buildUserMediaCacheKey({
  userId: "u1",
  kind: "avatar",
  pathOrId: "u1/avatar.jpg",
  version: "1000",
});
const k2 = buildUserMediaCacheKey({
  userId: "u1",
  kind: "avatar",
  pathOrId: "u1/avatar.jpg",
  version: "1000",
});
const k3 = buildUserMediaCacheKey({
  userId: "u1",
  kind: "avatar",
  pathOrId: "u1/avatar.jpg",
  version: "2000",
});

assert(k1 === k2, "same version → same cacheKey");
assert(k1 !== k3, "version change → new cacheKey");
assert(!k1.includes("token"), "cacheKey does not embed signed token");
assert(!k1.includes("http"), "cacheKey is not a URL");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("All user-media key checks passed.");
