import type { NavigateOptions } from "@tanstack/react-router";

/** 進入行程詳情時的來源（寫入 URL search） */
export type TripDetailFromSource = "saved" | "chat" | "plan" | "home";

export type TripDetailBackTarget = {
  to: "/saved" | "/chat" | "/";
  search?: { tab: "trips" };
  replace?: boolean;
};

export function resolveTripDetailBackTarget(
  navSource: string,
  from?: TripDetailFromSource,
): TripDetailBackTarget {
  const normalized = from ?? inferFromFromNavSource(navSource);
  switch (normalized) {
    case "saved":
    case "plan":
      return { to: "/saved", search: { tab: "trips" } };
    case "chat":
      return { to: "/chat" };
    case "home":
      return { to: "/" };
    default:
      return { to: "/saved", search: { tab: "trips" } };
  }
}

function inferFromFromNavSource(navSource: string): TripDetailFromSource {
  const s = navSource.toLowerCase();
  if (s.includes("saved") || s.includes("收藏")) return "saved";
  if (s.includes("chat") || s.includes("聊聊")) return "chat";
  if (s.includes("plan") || s.includes("規劃")) return "plan";
  if (s.includes("home") || s.includes("首頁")) return "home";
  return "saved";
}

export function tripDetailBackNavigateOptions(
  navSource: string,
  from?: TripDetailFromSource,
): NavigateOptions {
  const target = resolveTripDetailBackTarget(navSource, from);
  return {
    to: target.to,
    search: target.search,
    replace: target.replace,
  };
}

export function logTripDetailBack(meta: {
  tripId: string;
  navSource: string;
  returnTo: string;
  from?: TripDetailFromSource;
}): void {
  console.info("[TRIP_DETAIL_BACK]", meta);
}
