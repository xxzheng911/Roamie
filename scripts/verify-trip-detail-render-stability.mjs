/**
 * 後台驗證：行程詳情 render / auto-save 穩定性（不需開 Xcode）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stablePayloadPath = join(root, "src/lib/saved-trip/trip-editor-stable-payload.ts");
const autoSavePath = join(root, "src/lib/saved-trip/use-trip-editor-auto-save.ts");
const editorPath = join(root, "src/components/saved/SavedTripItineraryEditor.tsx");
const outfitExtrasPath = join(root, "src/lib/saved-trip/trip-editor-outfit-extras.ts");

function assert(condition, message) {
  if (!condition) {
    console.error("[verify-trip-detail] FAIL:", message);
    process.exit(1);
  }
}

const stableSrc = readFileSync(stablePayloadPath, "utf8");
assert(
  /export const TRIP_EDITOR_AUTO_SAVE_DISABLED = true/.test(stableSrc),
  "TRIP_EDITOR_AUTO_SAVE_DISABLED must be true",
);

const autoSaveSrc = readFileSync(autoSavePath, "utf8");
assert(
  autoSaveSrc.includes("logDebouncedSaveDepChanged"),
  "useTripEditorAutoSave must log DEBOUNCED_SAVE_DEP_CHANGED",
);
assert(
  !autoSaveSrc.includes("logTripDetailReloadSkipped"),
  "useTripEditorAutoSave must not log TRIP_DETAIL_RELOAD_SKIPPED",
);
assert(
  autoSaveSrc.includes("if (disabled) return") &&
    autoSaveSrc.includes("useLayoutEffect"),
  "disabled path must short-circuit layout/save effects",
);

const editorSrc = readFileSync(editorPath, "utf8");
assert(
  editorSrc.includes("useTripEditorAutoSave"),
  "editor must use useTripEditorAutoSave",
);
assert(
  !editorSrc.includes("useDebouncedTripSave("),
  "editor must not call useDebouncedTripSave directly",
);
assert(
  editorSrc.includes("useStableContentFingerprint"),
  "editor must stabilize payload fingerprint",
);

const outfitExtrasSrc = readFileSync(outfitExtrasPath, "utf8");
assert(
  /export const TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED = true/.test(outfitExtrasSrc),
  "TRIP_EDITOR_OUTFIT_SUGGESTION_DISABLED must be true",
);
assert(
  editorSrc.includes("hashStableOutfitExtrasFromPayload"),
  "editor must use hashStableOutfitExtrasFromPayload not live object hash",
);
assert(
  !editorSrc.includes("hashOutfitSlice(undefined, undefined, outfitExtrasForPayload"),
  "editor must not hash outfitExtrasForPayload object each render",
);

console.info("[verify-trip-detail] static checks OK");

const test = spawnSync("npm", ["test", "--", "--run", "src/lib/saved-trip/trip-editor-outfit-extras.test.ts", "src/lib/saved-trip/trip-editor-render-stability.test.ts", "src/lib/saved-trip/use-debounced-trip-save.test.ts"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (test.status !== 0) {
  process.exit(test.status ?? 1);
}

console.info("[verify-trip-detail] all checks passed — safe to re-run app after cap:sync");
