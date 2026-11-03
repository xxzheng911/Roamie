import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { useI18n } from "@/hooks/use-i18n";

type Props = {
  /** two-pane：展開雙頁右頁（預設）；laptop：筆電半開的摺痕下方推薦區 */
  variant?: "two-pane" | "laptop";
  /** 目前選取那則訊息的 groupKey；改變時捲回頂端 */
  selectionKey: string;
  /** 與左頁原本交給卡片的 roamieData 完全相同 */
  data: Partial<RoamieResponse>;
  selectedNames: Set<string>;
  savedNames: Set<string>;
  savingName: string | null;
  addToTripLabel: string;
  discussPlaceLabel: string;
  viewMapLabel: string;
  selectionMode?: boolean;
  onRecommendationEngage: () => void;
  onSavePlace: (rec: RoamieRecommendationItem) => void;
  onAddToTrip: (rec: RoamieRecommendationItem) => void;
  onOpenPlaceDetail: (rec: RoamieRecommendationItem) => void;
  onDiscussPlace: (rec: RoamieRecommendationItem) => void;
};

/**
 * 筆電推薦區下緣＝輸入列上緣：量測輸入列（_app.chat.tsx 的 .messenger-chat-composer）高度，
 * 交給 CSS（bottom＝底部導覽高度＋輸入列高度）。只在 laptop 變體時量測。
 */
function useComposerHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const el = document.querySelector<HTMLElement>(".messenger-chat-composer");
    if (!el) return;
    const update = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) setHeight(h);
    };
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [enabled]);
  return height;
}

/**
 * iPhone Duo 展開雙頁時，聊天推薦卡顯示在右頁；筆電半開時顯示在摺痕下方（只在 duoTwoPane 時由 ChatMessageList 渲染）。
 * 聊天頁根節點被限制在左頁且 overflow hidden，因此 portal 到 body、以 fixed 定位（見 styles.css .chat-duo-rec-pane／.chat-laptop-rec）。
 */
export function ChatDuoRecommendationPane({
  variant = "two-pane",
  selectionKey,
  data,
  selectedNames,
  savedNames,
  savingName,
  addToTripLabel,
  discussPlaceLabel,
  viewMapLabel,
  selectionMode = false,
  onRecommendationEngage,
  onSavePlace,
  onAddToTrip,
  onOpenPlaceDetail,
  onDiscussPlace,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const laptop = variant === "laptop";
  const composerHeight = useComposerHeight(laptop);
  const { t: uiT } = useI18n();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (laptop && scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [selectionKey, laptop]);

  if (typeof document === "undefined" || !document.body) return null;

  if (laptop) {
    // 與右頁相同的 RoamieResponseView props（卡片內容、handler 完全相同；只換外層容器與排列）
    const viewProps = {
      data,
      hideSummary: true,
      recommendationsPreFiltered: true,
      onRecommendationEngage,
      showItinerary: false,
      onSavePlace,
      onAddToTrip,
      onOpenPlaceDetail,
      onDiscussPlace,
      selectedPlaceNames: selectedNames,
      savingPlaceName: savingName,
      savedPlaceNames: savedNames,
      addToTripLabel,
      discussPlaceLabel,
      viewMapLabel,
      selectionMode,
    };
    const style =
      composerHeight != null
        ? ({ "--chat-laptop-composer-height": `${composerHeight}px` } as CSSProperties)
        : undefined;
    return createPortal(
      <aside className="chat-laptop-rec" data-chat-duo-rec-pane data-variant="laptop" style={style}>
        <p className="flex shrink-0 items-center gap-1 px-5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-clay" /> {uiT("productionUi.p042d7d5a05")}
        </p>
        <div ref={scrollRef} className="chat-laptop-rec__scroll">
          <RoamieResponseView {...viewProps} />
        </div>
      </aside>,
      document.body,
    );
  }

  return createPortal(
    <aside className="chat-duo-rec-pane" data-chat-duo-rec-pane>
      <div ref={scrollRef} className="chat-duo-rec-pane__scroll">
        <RoamieResponseView
          data={data}
          hideSummary
          recommendationsPreFiltered
          onRecommendationEngage={onRecommendationEngage}
          showItinerary={false}
          onSavePlace={onSavePlace}
          onAddToTrip={onAddToTrip}
          onOpenPlaceDetail={onOpenPlaceDetail}
          onDiscussPlace={onDiscussPlace}
          selectedPlaceNames={selectedNames}
          savingPlaceName={savingName}
          savedPlaceNames={savedNames}
          addToTripLabel={addToTripLabel}
          discussPlaceLabel={discussPlaceLabel}
          viewMapLabel={viewMapLabel}
          selectionMode={selectionMode}
        />
      </div>
    </aside>,
    document.body,
  );
}
