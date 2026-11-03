/**
 * Trip Workspace V1 — 分頁（行程／總覽／地圖）定義。
 * 純邏輯模組：不得 import "@/..."，需相容 node --experimental-strip-types。
 */

export type WorkspaceView = "trip" | "overview" | "map";

export const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["trip", "overview", "map"];

export function isWorkspaceView(raw: unknown): raw is WorkspaceView {
  return raw === "trip" || raw === "overview" || raw === "map";
}

/** URL search 參數解析：非法值一律回到 "trip"。 */
export function parseWorkspaceView(raw: unknown): WorkspaceView {
  return isWorkspaceView(raw) ? raw : "trip";
}

/** 相鄰分頁；在邊界時回傳 null。 */
export function adjacentWorkspaceView(
  view: WorkspaceView,
  dir: "next" | "prev",
): WorkspaceView | null {
  const index = WORKSPACE_VIEWS.indexOf(view);
  if (index < 0) return null;
  const nextIndex = dir === "next" ? index + 1 : index - 1;
  return WORKSPACE_VIEWS[nextIndex] ?? null;
}
