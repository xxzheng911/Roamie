/**
 * Trip Workspace V1 — 分頁左右滑動判定（純邏輯）。
 * 純邏輯模組：不得 import "@/..."，需相容 node --experimental-strip-types。
 */

export const EDGE_GUARD_PX = 24;
export const AXIS_LOCK_PX = 12;
export const AXIS_RATIO = 1.5;
export const COMMIT_DISTANCE_PX = 64;
export const COMMIT_VELOCITY = 0.4;
export const MAX_DRAG_RATIO = 0.3;

export type SwipeAxis = "pending" | "horizontal" | "vertical";
export type SwipeDirection = "next" | "prev";

export interface SwipeStartInput {
  startX: number;
  insideHorizontalScroller: boolean;
  insideNoSwipe: boolean;
  overlayOpen: boolean;
  inputFocused: boolean;
}

export function shouldTrackSwipeStart(input: SwipeStartInput): boolean {
  if (!(input.startX >= EDGE_GUARD_PX)) return false;
  if (input.insideHorizontalScroller) return false;
  if (input.insideNoSwipe) return false;
  if (input.overlayOpen) return false;
  if (input.inputFocused) return false;
  return true;
}

export function classifySwipeAxis(dx: number, dy: number): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= AXIS_LOCK_PX && ay <= AXIS_LOCK_PX) return "pending";
  if (ax > AXIS_LOCK_PX && ax > ay * AXIS_RATIO) return "horizontal";
  return "vertical";
}

export interface SwipeEndInput {
  dx: number;
  velocity: number;
  canGoNext?: boolean;
  canGoPrev?: boolean;
}

/** dx < 0（手指往左）→ next；dx > 0 → prev。 */
export function resolveSwipeEnd(input: SwipeEndInput): SwipeDirection | null {
  const { dx, velocity } = input;
  if (dx === 0) return null;
  if (!(Math.abs(dx) > COMMIT_DISTANCE_PX || Math.abs(velocity) > COMMIT_VELOCITY)) return null;
  const dir: SwipeDirection = dx < 0 ? "next" : "prev";
  if (dir === "next" && input.canGoNext === false) return null;
  if (dir === "prev" && input.canGoPrev === false) return null;
  return dir;
}

/**
 * 拖曳跟手位移：有目標分頁時跟手並夾在 ±width*0.3；
 * 無目標分頁（邊界）時以阻尼曲線回彈，結果與 dx 同號且遠小於 |dx|。
 */
export function dampedOffset(
  dx: number,
  width: number,
  opts: { canGoNext: boolean; canGoPrev: boolean },
): number {
  if (dx === 0 || !Number.isFinite(dx)) return 0;
  const max = Math.max(0, width) * MAX_DRAG_RATIO;
  if (max <= 0) return 0;
  const sign = dx < 0 ? -1 : 1;
  const abs = Math.abs(dx);
  const hasTarget = dx < 0 ? opts.canGoNext : opts.canGoPrev;
  if (hasTarget) return sign * Math.min(abs, max);
  // 阻尼：漸近上限 max 的 1/3，且斜率最大 0.5（< 0.6）。
  const limit = max / 3;
  const damped = limit * (1 - Math.exp(-abs / (2 * limit)));
  return sign * Math.min(damped, abs * 0.5, max);
}
