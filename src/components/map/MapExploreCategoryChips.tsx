import { useEffect, useRef } from "react";
import { EXPLORE_CATEGORIES, type ExploreCategory } from "@/lib/places-search-config";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

type Props = {
  selected: ExploreCategory;
  onSelect: (category: ExploreCategory) => void;
};

/** 永遠以「全部」為首項 */
const CHIP_CATEGORIES = EXPLORE_CATEGORIES;

/**
 * 探索頁分類 chips — 獨立水平捲動，不參與 sheet 垂直拖曳。
 */
export function MapExploreCategoryChips({ selected, onSelect }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ left: 0 });
  }, []);

  return (
    <div
      ref={scrollRef}
      className="map-explore-chips w-full min-w-0 max-w-full overflow-x-scroll overflow-y-hidden overscroll-x-contain pb-3 touch-pan-x"
      data-sheet-chips-scroll
      data-no-sheet-drag
      style={{ WebkitOverflowScrolling: "touch" }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div
        className="inline-flex max-w-none flex-nowrap items-center gap-2 pl-5 pr-7"
        style={{ width: "max-content" }}
      >
        {CHIP_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className={cn(
              "shrink-0 grow-0 basis-auto whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs",
              selected.id === c.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card",
            )}
          >
            {t(`explore.category.${c.id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
