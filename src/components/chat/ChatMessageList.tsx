import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { ChatMsg } from "@/lib/chat-history";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import {
  tripAddPlaceLoadingBubbleText,
  resolveTripAddPlaceMessageRecommendations,
} from "@/lib/trip/trip-add-place-render";
import { useI18n } from "@/hooks/use-i18n";
import { RoamieAssistantAvatar } from "@/components/RoamieAssistantAvatar";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { ChatDuoRecommendationPane } from "@/components/chat/ChatDuoRecommendationPane";
import { useDuoLayout } from "@/hooks/use-duo-layout";
import { useDuoLaptop } from "@/hooks/use-duo-laptop";
import { cn } from "@/lib/utils";
import {
  resolveChatRecommendationCardCount,
  stableChatMessageKey,
} from "@/lib/chat-render-stability";

type RowProps = {
  message: ChatMsg;
  index: number;
  isLast: boolean;
  streaming: boolean;
  generating?: boolean;
  /** Destination itinerary planning: never render place / candidate cards. */
  suppressPlaceCards?: boolean;
  partial: Partial<RoamieResponse>;
  selectedNames: Set<string>;
  savedNames: Set<string>;
  savingName: string | null;
  addToTripLabel: string;
  discussPlaceLabel: string;
  viewMapLabel: string;
  selectionMode?: boolean;
  recommendationSessionId?: string;
  groupKey: string;
  onRecommendationEngage: () => void;
  onSavePlace: (rec: RoamieRecommendationItem) => void;
  onAddToTrip: (rec: RoamieRecommendationItem) => void;
  onOpenPlaceDetail: (rec: RoamieRecommendationItem) => void;
  onDiscussPlace: (rec: RoamieRecommendationItem) => void;
  /** iPhone Duo 展開雙頁或筆電半開：卡片移到右頁／下半部，訊息列顯示標籤（非 Duo 時一律不傳） */
  duoTwoPane?: boolean;
  duoSelected?: boolean;
  onDuoSelect?: (groupKey: string) => void;
};

/** 訊息列與 Duo 右頁共用：決定交給 RoamieResponseView 的資料（邏輯與原本 row 內聯版本相同） */
function resolveRowRoamieData(
  m: ChatMsg,
  {
    generating,
    suppressPlaceCards,
    streaming,
    isLast,
    partial,
  }: {
    generating: boolean;
    suppressPlaceCards: boolean;
    streaming: boolean;
    isLast: boolean;
    partial: Partial<RoamieResponse>;
  },
) {
  const hideCards = generating || suppressPlaceCards;
  const showStreamingPartial = streaming && isLast && partial.summary;
  const structuredRecs = hideCards ? [] : resolveTripAddPlaceMessageRecommendations(m);
  const roamieFromMsg =
    m.roamie && structuredRecs.length
      ? { ...m.roamie, recommendations: structuredRecs, summary: m.roamie.summary ?? m.content }
      : hideCards && m.roamie
        ? { ...m.roamie, recommendations: [], itinerary: [] }
        : hideCards
          ? undefined
          : m.roamie;
  // Text-only when suppressing: never hand recommendations / itinerary draft to the view.
  const roamieData: Partial<RoamieResponse> | undefined = hideCards
    ? undefined
    : (roamieFromMsg ?? (showStreamingPartial ? partial : undefined));
  return { hideCards, roamieData };
}

const ChatMessageRow = memo(function ChatMessageRow({
  message: m,
  index: i,
  isLast,
  streaming,
  generating = false,
  suppressPlaceCards = false,
  partial,
  selectedNames,
  savedNames,
  savingName,
  addToTripLabel,
  discussPlaceLabel,
  viewMapLabel,
  selectionMode = false,
  recommendationSessionId = "",
  groupKey,
  onRecommendationEngage,
  onSavePlace,
  onAddToTrip,
  onOpenPlaceDetail,
  onDiscussPlace,
  duoTwoPane = false,
  duoSelected = false,
  onDuoSelect,
}: RowProps) {
  const { locale, t: uiT } = useI18n();
  const { hideCards, roamieData } = resolveRowRoamieData(m, {
    generating,
    suppressPlaceCards,
    streaming,
    isLast,
    partial,
  });
  const hasPlaceCards =
    !hideCards &&
    ((m.structuredPlaces?.length ?? 0) > 0 || (roamieData?.recommendations?.length ?? 0) > 0);
  const cardCount = resolveChatRecommendationCardCount({
    hidden: !hasPlaceCards,
    structuredCount: m.structuredPlaces?.length,
    recommendationCount: roamieData?.recommendations?.length,
  });
  const cardCountRef = useRef(cardCount);
  cardCountRef.current = cardCount;
  const recommendationSessionIdRef = useRef(recommendationSessionId);
  recommendationSessionIdRef.current = recommendationSessionId;

  useEffect(() => {
    if (m.role !== "assistant") return;
    console.info("[CHAT_RECOMMENDATION_MOUNT]", {
      recommendationRequestId: m.recommendationRequestId ?? "",
      sessionId: recommendationSessionIdRef.current,
      groupKey,
      cardCount: cardCountRef.current,
      reason: "message_row_mount",
    });
    return () => {
      console.info("[CHAT_RECOMMENDATION_MOUNT]", {
        recommendationRequestId: m.recommendationRequestId ?? "",
        sessionId: recommendationSessionIdRef.current,
        groupKey,
        cardCount: cardCountRef.current,
        reason: "message_row_unmount",
      });
    };
  }, [groupKey, m.role]);

  useEffect(() => {
    if (cardCount <= 0) return;
    console.info("[CHAT_RECOMMENDATION_MOUNT]", {
      recommendationRequestId: m.recommendationRequestId ?? "",
      sessionId: recommendationSessionId,
      groupKey,
      cardCount,
      reason: "recommendations_ready",
    });
  }, [cardCount, groupKey, recommendationSessionId]);

  const textContent =
    (m.loadingPhase ? tripAddPlaceLoadingBubbleText(m, locale) : "") ||
    m.content ||
    (hideCards ? m.roamie?.summary : undefined) ||
    "";

  // Duo 雙頁：有卡片的 assistant 回覆在左頁只留文字，泡泡下方顯示標籤；非 Duo 時 duoTag 恆為 false。
  const duoCardCount =
    duoTwoPane && m.role === "assistant" ? (roamieData?.recommendations?.length ?? 0) : 0;
  const duoTag = duoCardCount > 0;
  const handleDuoSelect = duoTag ? () => onDuoSelect?.(groupKey) : undefined;

  return (
    <div
      data-chat-message-id={m.id ?? `chat-${m.role}-${i}`}
      data-chat-message-index={i}
      data-chat-message-role={m.role}
      className={`flex animate-rise ${m.role === "user" ? "justify-end" : "justify-start gap-2.5"}${duoTag ? " flex-wrap" : ""}`}
    >
      {m.role === "assistant" ? (
        <RoamieAssistantAvatar className="h-8 w-8 shrink-0 self-end" />
      ) : null}
      <div
        className={cn(
          "rounded-3xl px-4 py-3",
          m.role === "user"
            ? "max-w-[88%] rounded-br-md bg-primary text-primary-foreground"
            : hasPlaceCards && !duoTag
              ? "min-w-0 flex-1 max-w-[calc(100%-2.625rem)] rounded-bl-md border border-border bg-card"
              : "max-w-[88%] rounded-bl-md border border-border bg-card",
          duoTag && "cursor-pointer",
          duoTag && duoSelected && "border-clay ring-1 ring-clay/40",
        )}
        onClick={handleDuoSelect}
      >
        {m.role === "user" ? (
          <p className="chat-latin-text whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
        ) : roamieData ? (
          <RoamieResponseView
            data={roamieData}
            compact
            hideRecommendations={duoTwoPane}
            recommendationsPreFiltered
            onRecommendationEngage={onRecommendationEngage}
            showItinerary={false}
            onSavePlace={onSavePlace}
            onAddToTrip={onAddToTrip}
            onOpenPlaceDetail={onOpenPlaceDetail}
            onDiscussPlace={onDiscussPlace}
            outfitAdvice={m.roamie?.outfitAdvice}
            selectedPlaceNames={selectedNames}
            savingPlaceName={savingName}
            savedPlaceNames={savedNames}
            addToTripLabel={addToTripLabel}
            discussPlaceLabel={discussPlaceLabel}
            viewMapLabel={viewMapLabel}
            selectionMode={selectionMode}
          />
        ) : (
          <p className="chat-latin-text whitespace-pre-wrap text-[15px] leading-relaxed">
            {textContent || (
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
              </span>
            )}
          </p>
        )}
      </div>
      {duoTag ? (
        <div className="basis-full pl-[2.625rem]">
          <button
            type="button"
            aria-pressed={duoSelected}
            onClick={handleDuoSelect}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
              duoSelected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <Sparkles className={cn("h-3 w-3", duoSelected ? "text-background" : "text-clay")} />
            {uiT("productionUi.p042d7d5a05")} · {duoCardCount}
          </button>
        </div>
      ) : null}
    </div>
  );
});

type ListProps = Omit<
  RowProps,
  "message" | "index" | "isLast" | "groupKey" | "duoTwoPane" | "duoSelected" | "onDuoSelect"
> & {
  msgs: ChatMsg[];
  hydrating: boolean;
  /** Independent of msgs — dots-only loading bubble (no remount / scroll thrash). */
  loadingIndicator?: { baseText: string; requestId: string; dots: number } | null;
};

type DuoCandidate = { key: string; data: Partial<RoamieResponse> };
const NO_DUO_CANDIDATES: DuoCandidate[] = [];

export const ChatMessageList = memo(function ChatMessageList({
  msgs,
  hydrating,
  loadingIndicator = null,
  ...rowProps
}: ListProps) {
  const stableKeys = useMemo(() => msgs.map((m, i) => stableChatMessageKey(m, i)), [msgs]);

  // iPhone Duo 展開雙頁（判斷方式同地點詳情頁）：推薦卡改顯示在右頁。
  const duoLayout = useDuoLayout();
  const duoTwoPaneLayout =
    duoLayout.navPlacement === "right-rail" &&
    duoLayout.tripLayout === "two-pane" &&
    duoLayout.pane != null;
  // iPhone Duo 筆電半開（雙頁優先）：推薦卡改顯示在摺痕下方的推薦區。非 Duo 裝置恆為 false。
  const duoLaptop = useDuoLaptop().laptop && !duoTwoPaneLayout;
  // 以下 duoTwoPane 代表「卡片移出訊息列」模式（雙頁或筆電半開），兩者的訊息列行為相同（隱藏卡片、顯示標籤）。
  const duoTwoPane = duoTwoPaneLayout || duoLaptop;
  const { generating = false, suppressPlaceCards = false, streaming, partial } = rowProps;
  const hasLoadingIndicator = loadingIndicator != null;
  const duoCandidates = useMemo(() => {
    if (!duoTwoPane) return NO_DUO_CANDIDATES;
    const out: DuoCandidate[] = [];
    msgs.forEach((m, i) => {
      if (m.role !== "assistant") return;
      const { roamieData } = resolveRowRoamieData(m, {
        generating,
        suppressPlaceCards,
        streaming,
        isLast: i === msgs.length - 1 && !hasLoadingIndicator,
        partial,
      });
      if (roamieData && (roamieData.recommendations?.length ?? 0) > 0) {
        out.push({ key: stableKeys[i]!, data: roamieData });
      }
    });
    return out;
  }, [
    duoTwoPane,
    msgs,
    stableKeys,
    generating,
    suppressPlaceCards,
    streaming,
    partial,
    hasLoadingIndicator,
  ]);
  const latestDuoCandidate = duoCandidates[duoCandidates.length - 1] ?? null;
  const latestDuoKey = latestDuoCandidate?.key ?? null;
  // 使用者點選的那則；有更新的推薦回覆出現（latest 改變）時自動回到最新。
  const [duoPick, setDuoPick] = useState<{ key: string; latest: string | null } | null>(null);
  const latestDuoKeyRef = useRef(latestDuoKey);
  latestDuoKeyRef.current = latestDuoKey;
  const handleDuoSelect = useCallback((key: string) => {
    setDuoPick({ key, latest: latestDuoKeyRef.current });
  }, []);
  const pickedDuoCandidate =
    duoPick && duoPick.latest === latestDuoKey
      ? duoCandidates.find((c) => c.key === duoPick.key)
      : undefined;
  const duoSelected = pickedDuoCandidate ?? latestDuoCandidate;
  const duoSelectedKey = duoSelected?.key ?? null;

  if (hydrating && msgs.length === 0) {
    return (
      <div className="flex justify-center pt-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const loadingDots = Math.min(3, Math.max(1, loadingIndicator?.dots ?? 1));
  const loadingText = loadingIndicator
    ? `${loadingIndicator.baseText}${".".repeat(loadingDots)}`
    : null;

  return (
    <>
      {msgs.map((m, i) => (
        <ChatMessageRow
          key={stableKeys[i]}
          message={m}
          index={i}
          isLast={i === msgs.length - 1 && !loadingIndicator}
          groupKey={stableKeys[i]!}
          {...rowProps}
          duoTwoPane={duoTwoPane}
          duoSelected={duoTwoPane && duoSelectedKey === stableKeys[i]}
          onDuoSelect={duoTwoPane ? handleDuoSelect : undefined}
        />
      ))}
      {loadingIndicator && loadingText ? (
        <ChatMessageRow
          key={`loading:${loadingIndicator.requestId}`}
          message={{ role: "assistant", content: loadingText }}
          index={msgs.length}
          isLast
          groupKey={`loading:${loadingIndicator.requestId}`}
          {...rowProps}
          streaming={false}
        />
      ) : null}
      {duoTwoPane && duoSelected ? (
        <ChatDuoRecommendationPane
          variant={duoLaptop ? "laptop" : "two-pane"}
          selectionKey={duoSelected.key}
          data={duoSelected.data}
          selectedNames={rowProps.selectedNames}
          savedNames={rowProps.savedNames}
          savingName={rowProps.savingName}
          addToTripLabel={rowProps.addToTripLabel}
          discussPlaceLabel={rowProps.discussPlaceLabel}
          viewMapLabel={rowProps.viewMapLabel}
          selectionMode={rowProps.selectionMode}
          onRecommendationEngage={rowProps.onRecommendationEngage}
          onSavePlace={rowProps.onSavePlace}
          onAddToTrip={rowProps.onAddToTrip}
          onOpenPlaceDetail={rowProps.onOpenPlaceDetail}
          onDiscussPlace={rowProps.onDiscussPlace}
        />
      ) : null}
    </>
  );
});

/** Re-export so chat route header shares the same module binding as message rows (avoids iOS bundle ReferenceError). */
export { RoamieAssistantAvatar };
