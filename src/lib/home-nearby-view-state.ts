import type { HomeNearbyRenderState } from "@/lib/home-nearby-log";

export type HomeNearbyViewState = "loading" | "content" | "empty" | "error";

/**
 * Loading is authoritative until the first request settles. A slow request is
 * still loading, not evidence that the nearby result is empty.
 */
export function resolveHomeNearbyViewState(params: {
  placeCount: number;
  loading: boolean;
  renderState: HomeNearbyRenderState;
}): HomeNearbyViewState {
  if (params.placeCount > 0) return "content";
  if (params.loading || params.renderState === "loading") return "loading";
  if (params.renderState === "error") return "error";
  if (params.renderState === "empty") return "empty";
  return "loading";
}
