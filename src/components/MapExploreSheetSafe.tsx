import { forwardRef, type ReactNode } from "react";
import { MapExploreSheet, type MapExploreSheetHandle } from "@/components/MapExploreSheet";

export type { MapExploreSheetHandle };
import type { MapExploreSheetMode } from "@/lib/map-explore-sheet-mode";

type Props = {
  header: ReactNode;
  children: ReactNode;
  sheetMode?: MapExploreSheetMode;
};

/** 探索頁 sheet 包裝 */
export const MapExploreSheetSafe = forwardRef<MapExploreSheetHandle, Props>(function MapExploreSheetSafe(
  { header, children, sheetMode },
  ref,
) {
  return (
    <MapExploreSheet ref={ref} header={header} sheetMode={sheetMode}>
      {children}
    </MapExploreSheet>
  );
});
