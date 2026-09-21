/**
 * Avatar remove: UI contract, DB-first service, Storage ownership, cache/tombstone races.
 * Run: vite-node --config scripts/vite.verify.config.mjs scripts/verify-avatar-remove.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const store = new Map();
const localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(String(key), String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};
globalThis.localStorage = localStorage;
globalThis.window = {
  localStorage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

const sheet = read("src/components/ImageSourceSheet.tsx");
const profile = read("src/routes/_app.profile.tsx");
const media = read("src/lib/profile-media-storage.ts");
const removeSrc = read("src/lib/remove-profile-avatar.ts");
const authoritySrc = read("src/lib/avatar-authority.ts");
const storeSrc = read("src/lib/user-media/user-media-store.ts");
const diskSrc = read("src/lib/user-media/user-media-disk.ts");
const persistedSrc = read("src/lib/profile-persisted-cache.ts");
const sessionSrc = read("src/lib/profile-session-cache.ts");
const messages = read("src/lib/i18n/messages.ts");
const avatarHook = read("src/hooks/use-avatar.tsx");
const assistant = read("src/lib/roamie-assistant-avatar.ts");
const home = read("src/routes/_app.index.tsx");
const map = read("src/routes/_app.map.tsx");
const cleanup = read("src/lib/clear-auth-state.ts");
const accountClient = read("src/lib/account-deletion/account-deletion.ts");

const PROJECT = "https://abcxyz.supabase.co";
const ownedPath = "user-1/avatar.jpg";
const ownedUrl = `${PROJECT}/storage/v1/object/public/profile-media/${ownedPath}`;
const coverUrl = `${PROJECT}/storage/v1/object/public/profile-media/user-1/cover.jpg`;

function sourceBetween(src, start, end) {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing region ${start}`);
  return src.slice(from, to);
}

// 1–4, 21: UI reuses ImageSourceSheet; cover UX stays optional/backward compatible.
assert.match(sheet, /showRemove && onRemove/);
assert.match(sheet, /Trash2/);
assert.match(sheet, /removing \? \(/);
assert.match(sheet, /Loader2/);
assert.match(sheet, /resolvedRemoveLabel = removeLabel \?\? uiT\("profile.removeAvatar"\)/);
assert.match(sheet, /resolvedAlbumLabel = albumLabel \?\? uiT\("productionUi.p30784c6dd2"\)/);
assert.match(sheet, /resolvedCameraLabel = cameraLabel \?\? uiT\("productionUi.p6e3a10ade7"\)/);
assert.doesNotMatch(sheet, /removeLabel = "刪除"|albumLabel = "從相簿選取"|cameraLabel = "拍照"/);
assert.match(sheet, /disabled = false/);
assert.match(sheet, /if \(disabled \|\| preparingRef\.current \|\| pickerOpeningRef\.current\) return/);
assert.match(sheet, /disabled=\{removing \|\| disabled\}/);
assert.match(sheet, /if \(!disabled && !removing\) onRemove\(\)/);
assert.doesNotMatch(sheet, /AlertDialog|confirm\(/);

const coverSheet = sourceBetween(profile, "<ImageSourceSheet\n          open={coverSourceOpen}", "<ProfileImageCropSheet");
assert.match(coverSheet, /showRemove=\{\!\!coverUrl\}/);
assert.match(coverSheet, /onRemove=\{\(\) => void handleCoverRemove\(\)\}/);
assert.match(coverSheet, /removing=\{coverRemoving\}/);
assert.match(coverSheet, /albumLabel=\{uiT\("productionUi.p30784c6dd2"\)\}/);
assert.match(coverSheet, /cameraLabel=\{uiT\("productionUi.p6e3a10ade7"\)\}/);
assert.match(coverSheet, /removeLabel=\{t\("profile.removeAvatar"\)\}/);
assert.doesNotMatch(coverSheet, /disabled=|onPickerBusyChange/);

const avatarSheet = sourceBetween(profile, "<ImageSourceSheet\n            open={avatarSourceOpen}", "<AvatarCropSheet");
assert.match(avatarSheet, /showRemove=\{hasCustomAvatar\}/);
assert.match(avatarSheet, /onRemove=\{\(\) => void handleAvatarRemove\(\)\}/);
assert.match(avatarSheet, /removing=\{avatarRemoving\}/);
assert.match(avatarSheet, /removeLabel=\{t\("profile.removeAvatar"\)\}/);
assert.match(avatarSheet, /disabled=\{avatarBusy \|\| avatarPicking \|\| !!avatarCropFile\}/);
assert.match(profile, /hasCanonicalCustomAvatar|hasCustomAvatar/);
assert.match(avatarHook, /hasCanonicalCustomAvatar\(bootUserId, persistedProfile\?\.avatarUrl\)/);
assert.match(profile, /if \(avatarMutationRef\.current \|\| avatarPicking \|\| avatarCropFile \|\| !hasCustomAvatar\) return/);
assert.doesNotMatch(sourceBetween(profile, "const handleAvatarRemove", "const handleAvatarConfirm"), /setAvatarSourceOpen\(false\)|confirm\(|AlertDialog/);
assert.match(profile, /from "@\/lib\/remove-profile-avatar"/);

// Cover delete path is unchanged: storage first, ignore storage error, then DB.
assert.match(media, /export async function removeProfileCover/);
assert.ok(media.indexOf("await deleteProfileMedia(id, \"cover\")") < media.indexOf("cover_image_url: null"));
assert.match(media, /try \{\s*await deleteProfileMedia\(id, "cover"\);\s*\} catch \{\s*\/\* file may not exist \*\//);

// 20: four locales
for (const key of ["removeAvatar:", "avatarRemoved:", "avatarCleanupPending:", "avatarRemoveFailed:"]) {
  assert.equal([...messages.matchAll(new RegExp(key.replace(":", "\\s*:"), "g"))].length, 4, key);
}
assert.match(messages, /removeAvatar: "刪除"/);
assert.match(messages, /removeAvatar: "Delete"/);
assert.match(messages, /removeAvatar: "削除"/);
assert.match(messages, /removeAvatar: "삭제"/);

// 19, assistant isolation
assert.match(home, /<ProfileAvatar self/);
assert.match(map, /const \{ avatarDisplaySrc, avatarPending \} = useAvatar\(\)/);
assert.match(map, /resolveUserMarkerAvatarSrc\(avatarDisplaySrc/);
assert.match(assistant, /不受使用者個人頭像更換影響/);
assert.doesNotMatch(assistant, /removeProfileAvatar|broadcastAvatarUpdate/);

// 22: account deletion still only clears after server success; new keys are user-scoped.
assert.match(accountClient, /Authorization: `Bearer \$\{session\.access_token\}`/);
assert.match(cleanup, /key\.includes\(userId\)/);
assert.match(authoritySrc, /roamie:avatar-authority:\$\{userId\}/);
assert.match(removeSrc, /roamie:avatar-cleanup:\$\{userId\}/);
assert.doesNotMatch(removeSrc, /sanitizeAvatarUrl/);
assert.match(removeSrc, /avatar_url: null/);
assert.match(removeSrc, /\.eq\("id", id\)/);
assert.match(removeSrc, /if \(!updated \|\| updated\.avatar_url !== null\)/);
assert.match(removeSrc, /latest\.avatar_url !== null/);
assert.match(storeSrc, /authority\.url === null/);
assert.match(diskSrc, /row\.userId === userId && row\.kind === "avatar"/);
assert.match(diskSrc, /kind === "avatar" && !isAvatarMediaCurrent/);
assert.match(persistedSrc, /applyAvatarAuthority/);
assert.match(sessionSrc, /withAvatarProfileAuthority/);

const {
  commitAvatarAuthority,
  readAvatarAuthority,
  clearAvatarAuthority,
  isAvatarMediaCurrent,
  hasCanonicalCustomAvatar,
  acceptAvatarProfileRead,
} = await import("../src/lib/avatar-authority.ts");
const { isOwnedAvatarObject, isMissingAvatarObject, removeProfileAvatar } = await import("../src/lib/remove-profile-avatar.ts");
const { writeCachedProfile, readCachedProfile } = await import("../src/lib/profile-persisted-cache.ts");
const {
  resetUserMediaStore,
  seedUserMediaFromPersistedSync,
  getUserMediaSnapshot,
  hydrateUserMediaFromCache,
  validateUserMediaRemote,
  clearRemovedAvatarMedia,
} = await import("../src/lib/user-media/user-media-store.ts");
const { writeProfileSessionCache, readProfileSessionCache, clearProfileSessionCache } = await import("../src/lib/profile-session-cache.ts");

function owned(path = ownedPath) {
  return `${PROJECT}/storage/v1/object/public/profile-media/${path}`;
}

assert.equal(isOwnedAvatarObject(ownedUrl, ownedUrl), true, "owned exact URL");
assert.equal(isOwnedAvatarObject(`${ownedUrl}?v=9`, ownedUrl), true, "owned ignores query");
assert.equal(isOwnedAvatarObject("https://lh3.googleusercontent.com/a/x", ownedUrl), false, "oauth not owned");
assert.equal(isOwnedAvatarObject("https://cdn.example/avatar.jpg", ownedUrl), false, "external not owned");
assert.equal(
  isOwnedAvatarObject(`${PROJECT}/storage/v1/object/public/profile-media/user-2/avatar.jpg`, ownedUrl),
  false,
  "other user path not owned",
);
assert.equal(
  isOwnedAvatarObject(`${PROJECT}/storage/v1/object/public/other-bucket/user-1/avatar.jpg`, ownedUrl),
  false,
  "other bucket not owned",
);
assert.equal(
  isOwnedAvatarObject("https://other.supabase.co/storage/v1/object/public/profile-media/user-1/avatar.jpg", ownedUrl),
  false,
  "other project not owned",
);
assert.equal(isMissingAvatarObject({ statusCode: "404" }), true);
assert.equal(isMissingAvatarObject({ message: "Object not found" }), true);
assert.equal(isMissingAvatarObject({ message: "network" }), false);

function makeHarness(initialUrl = ownedUrl) {
  const state = {
    userId: "user-1",
    row: { avatar_url: initialUrl, updated_at: "2026-01-01T00:00:00.000Z" },
    removed: [],
    localClears: 0,
    reads: 0,
    clears: 0,
    clearError: null,
    clearResult: undefined,
    removeError: null,
    afterLocal: null,
  };
  return {
    state,
    deps: {
      userId: async () => state.userId,
      read: async () => {
        state.reads += 1;
        return { ...state.row };
      },
      clear: async () => {
        state.clears += 1;
        if (state.clearError) throw state.clearError;
        if (state.clearResult === null) return null;
        state.row = { avatar_url: null, updated_at: "2026-01-02T00:00:00.000Z" };
        return { ...state.row };
      },
      publicUrl: (path) => owned(path),
      remove: async (path) => {
        if (state.removeError) throw state.removeError;
        state.removed.push(path);
      },
      clearLocal: async (userId) => {
        state.localClears += 1;
        if (state.afterLocal) await state.afterLocal(userId);
      },
    },
  };
}

async function withUser(userId, run) {
  clearAvatarAuthority(userId);
  clearProfileSessionCache();
  resetUserMediaStore();
  try {
    await run();
  } finally {
    clearAvatarAuthority(userId);
    resetUserMediaStore();
    clearProfileSessionCache();
  }
}

await withUser("user-1", async () => {
  const { state, deps } = makeHarness();
  const result = await removeProfileAvatar(deps);
  assert.equal(result.removed, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(state.clears, 1);
  assert.equal(state.row.avatar_url, null);
  assert.deepEqual(state.removed, [ownedPath]);
  assert.equal(readAvatarAuthority("user-1")?.url, null);
  assert.equal(hasCanonicalCustomAvatar("user-1", ownedUrl), false);
  assert.equal(readCachedProfile("user-1")?.avatarUrl, null);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness();
  state.clearError = new Error("db down");
  await assert.rejects(() => removeProfileAvatar(deps), /db down/);
  assert.equal(state.removed.length, 0);
  assert.equal(readAvatarAuthority("user-1"), null);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness();
  state.clearResult = null;
  await assert.rejects(() => removeProfileAvatar(deps), /avatar_update_not_confirmed/);
  assert.equal(state.removed.length, 0);
  assert.equal(readAvatarAuthority("user-1"), null);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness("https://lh3.googleusercontent.com/a/oauth");
  const result = await removeProfileAvatar(deps);
  assert.equal(result.removed, true);
  assert.equal(state.removed.length, 0);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness(owned("user-2/avatar.jpg"));
  const result = await removeProfileAvatar(deps);
  assert.equal(result.removed, true);
  assert.equal(state.removed.length, 0);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness();
  state.removeError = { statusCode: 404, message: "Object not found" };
  const result = await removeProfileAvatar(deps);
  assert.equal(result.removed, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(readAvatarAuthority("user-1")?.url, null);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness();
  state.removeError = { message: "storage timeout" };
  const result = await removeProfileAvatar(deps);
  assert.equal(result.removed, true);
  assert.equal(result.cleanupPending, true);
  assert.equal(state.row.avatar_url, null);
  assert.equal(readAvatarAuthority("user-1")?.url, null);
  assert.match(localStorage.getItem("roamie:avatar-cleanup:user-1") ?? "", /storage_cleanup/);
});

await withUser("user-1", async () => {
  writeCachedProfile({
    userId: "user-1",
    displayName: "Ada",
    avatarUrl: ownedUrl,
    coverImageUrl: coverUrl,
    hasCustomAvatar: true,
    hasCustomCover: true,
  });
  writeProfileSessionCache({
    displayName: "Ada",
    avatarUrl: ownedUrl,
    coverImageUrl: coverUrl,
    bio: "",
    travelStyle: "",
    language: "zh-Hant",
    notificationsEnabled: false,
    authProvider: null,
    prefs: {},
    personalityType: "",
    personalitySummary: "",
    personalityImpression: "",
  }, "user-1");
  resetUserMediaStore();
  seedUserMediaFromPersistedSync("user-1");
  const { deps } = makeHarness();
  await removeProfileAvatar(deps);
  await clearRemovedAvatarMedia("user-1");
  const snap = getUserMediaSnapshot();
  assert.equal(snap.avatarStatus, "none");
  assert.equal(snap.avatarUrl, null);
  assert.equal(snap.hasCustomAvatar, false);
  assert.equal(snap.coverUrl, coverUrl);
  assert.equal(readProfileSessionCache("user-1")?.avatarUrl, null);
  assert.equal(readProfileSessionCache("user-1")?.coverImageUrl, coverUrl);
  assert.equal(readCachedProfile("user-1")?.coverImageUrl, coverUrl);
  assert.equal(readCachedProfile("user-1")?.avatarUrl, null);
});

await withUser("user-1", async () => {
  writeCachedProfile({
    userId: "user-1",
    avatarUrl: ownedUrl,
    coverImageUrl: coverUrl,
    hasCustomAvatar: true,
    hasCustomCover: true,
  });
  commitAvatarAuthority("user-1", null, "2026-01-02T00:00:00.000Z");
  const hydrated = await hydrateUserMediaFromCache("user-1");
  assert.equal(hydrated.avatarStatus, "none");
  assert.equal(hydrated.avatarUrl, null);
  assert.equal(hydrated.coverUrl, coverUrl);
  await validateUserMediaRemote({
    userId: "user-1",
    avatarUrl: ownedUrl,
    coverUrl,
    avatarUpdatedAt: "2026-01-01T00:00:00.000Z",
    profileUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  const snap = getUserMediaSnapshot();
  assert.equal(snap.avatarStatus, "none");
  assert.equal(snap.avatarUrl, null);
  assert.equal(readCachedProfile("user-1")?.avatarUrl, null);
  assert.equal(isAvatarMediaCurrent("user-1", "1", ownedUrl), false);
});

await withUser("user-1", async () => {
  const { state, deps } = makeHarness();
  state.afterLocal = async () => {
    commitAvatarAuthority("user-1", ownedUrl, "2026-01-03T00:00:00.000Z");
    state.row = { avatar_url: ownedUrl, updated_at: "2026-01-03T00:00:00.000Z" };
  };
  const result = await removeProfileAvatar(deps);
  assert.equal(result.removed, true);
  assert.equal(state.removed.length, 0);
  assert.equal(readAvatarAuthority("user-1")?.url, ownedUrl);
  assert.equal(isAvatarMediaCurrent("user-1", readAvatarAuthority("user-1").version, ownedUrl), true);
});

await withUser("user-1", async () => {
  commitAvatarAuthority("user-1", null, "2026-01-02T00:00:00.000Z");
  const tombstone = readAvatarAuthority("user-1");
  acceptAvatarProfileRead("user-1", "stale-token", ownedUrl, "2026-01-01T00:00:00.000Z");
  assert.equal(readAvatarAuthority("user-1")?.token, tombstone.token);
  assert.equal(readAvatarAuthority("user-1")?.url, null);
  const replacement = commitAvatarAuthority("user-1", ownedUrl, "2026-01-04T00:00:00.000Z");
  assert.equal(hasCanonicalCustomAvatar("user-1"), true);
  assert.equal(isAvatarMediaCurrent("user-1", tombstone.version, ownedUrl), false);
  assert.equal(isAvatarMediaCurrent("user-1", replacement.version, ownedUrl), true);
});

console.log("verify:avatar-remove passed");
