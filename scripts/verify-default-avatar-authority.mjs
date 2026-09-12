import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const authority = read("src/lib/default-avatar.ts");
const profile = read("src/components/profile/ProfileAvatar.tsx");
const provider = read("src/hooks/use-avatar.tsx");
const map = read("src/lib/map-user-location-marker.ts");

assert.match(authority, /roamie-default-avatar\.png/);
assert.match(profile, /DEFAULT_USER_AVATAR/);
assert.match(provider, /showAvatarDefault \? DEFAULT_USER_AVATAR : avatarDisplaySrc/);
assert.match(map, /DEFAULT_USER_MARKER_AVATAR = DEFAULT_USER_AVATAR/);
assert.match(map, /if \(trimmed\.length > 0\) return trimmed/);
assert.doesNotMatch(map, /roamie-traveler\.jpg/);

console.log("Default avatar authority regression: PASS");
