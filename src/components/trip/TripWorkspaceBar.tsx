import { forwardRef, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { WORKSPACE_VIEWS, type WorkspaceView } from "@/lib/trip/workspace-view";
import type { TripWorkspaceCopy } from "@/lib/i18n/trip-workspace-copy";

type Props = {
  view: WorkspaceView;
  onChange: (next: WorkspaceView) => void;
  copy: TripWorkspaceCopy;
  /**
   * 顯示的分頁（選填）；iPhone Duo 雙欄時傳 ["trip", "overview"]（地圖常駐右欄）。
   * 未傳時為 WORKSPACE_VIEWS，輸出與修改前相同。
   */
  views?: readonly WorkspaceView[];
};

const LABEL_KEY: Record<WorkspaceView, "tabTrip" | "tabOverview" | "tabMap"> = {
  trip: "tabTrip",
  overview: "tabOverview",
  map: "tabMap",
};

export function workspaceTabId(view: WorkspaceView): string {
  return `trip-workspace-tab-${view}`;
}

export function workspacePanelId(view: WorkspaceView): string {
  return `trip-workspace-panel-${view}`;
}

/**
 * 行程｜總覽｜地圖 切換 bar（吸頂）。ref 指向非 sticky 的定位哨兵，供捲動還原計算 bar 原始位置。
 */
export const TripWorkspaceBar = forwardRef<HTMLDivElement, Props>(function TripWorkspaceBar(
  { view, onChange, copy, views = WORKSPACE_VIEWS },
  sentinelRef,
) {
  const tabRefs = useRef<Partial<Record<WorkspaceView, HTMLButtonElement | null>>>({});
  const activeIndex = Math.max(0, views.indexOf(view));

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = Math.min(views.length - 1, activeIndex + 1);
    else if (e.key === "ArrowLeft") nextIndex = Math.max(0, activeIndex - 1);
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = views.length - 1;
    if (nextIndex == null) return;
    e.preventDefault();
    const next = views[nextIndex];
    if (next !== view) onChange(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-0 w-full" />
      <div className="sticky top-0 z-20 bg-background px-5 pb-1 pt-3">
        <div
          role="tablist"
          aria-label={copy.tablistLabel}
          onKeyDown={handleKeyDown}
          className={
            views.length === 2
              ? "relative grid h-11 grid-cols-2 rounded-full bg-secondary p-1"
              : "relative grid h-11 grid-cols-3 rounded-full bg-secondary p-1"
          }
        >
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-full bg-foreground shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{
              width: `calc((100% - 0.5rem) / ${views.length})`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />
          {views.map((v) => {
            const selected = v === view;
            return (
              <button
                key={v}
                ref={(el) => {
                  tabRefs.current[v] = el;
                }}
                id={workspaceTabId(v)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={v === "trip" ? undefined : workspacePanelId(v)}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  if (!selected) onChange(v);
                }}
                className={cn(
                  "relative z-10 flex min-w-0 items-center justify-center whitespace-nowrap rounded-full px-1 text-[clamp(13px,4vw,15px)] font-medium transition-colors duration-[220ms] motion-reduce:transition-none",
                  selected ? "text-background" : "text-muted-foreground",
                )}
              >
                {copy[LABEL_KEY[v]]}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
});
