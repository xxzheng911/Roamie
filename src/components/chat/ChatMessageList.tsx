import { memo, useMemo } from "react";
import { Loader2 } from "lucide-react";
import type { ChatMsg } from "@/lib/chat-history";
import type { RoamieResponse, RoamieRecommendationItem } from "@/lib/ai/types";
import { resolveTripAddPlaceMessageRecommendations } from "@/lib/trip/trip-add-place-render";
import { RoamieAssistantAvatar } from "@/components/RoamieAssistantAvatar";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { cn } from "@/lib/utils";

type RowProps = {
  message: ChatMsg;
  index: number;
  isLast: boolean;
  streaming: boolean;
  partial: Partial<RoamieResponse>;
  selectedNames: string[];
  savedNames: Set<string>;
  savingName: string | null;
  addToTripLabel: string;
  discussPlaceLabel: string;
  viewMapLabel: string;
  onRecommendationEngage: () => void;
  onSavePlace: (rec: RoamieRecommendationItem) => void;
  onAddToTrip: (rec: RoamieRecommendationItem) => void;
  onOpenPlaceDetail: (rec: RoamieRecommendationItem) => void;
  onDiscussPlace: (rec: RoamieRecommendationItem) => void;
};

const ChatMessageRow = memo(function ChatMessageRow({
  message: m,
  index: i,
  isLast,
  streaming,
  partial,
  selectedNames,
  savedNames,
  savingName,
  addToTripLabel,
  discussPlaceLabel,
  viewMapLabel,
  onRecommendationEngage,
  onSavePlace,
  onAddToTrip,
  onOpenPlaceDetail,
  onDiscussPlace,
}: RowProps) {
  const showStreamingPartial = streaming && isLast && partial.summary;
  const structuredRecs = resolveTripAddPlaceMessageRecommendations(m);
  const roamieFromMsg =
    m.roamie && structuredRecs.length
      ? { ...m.roamie, recommendations: structuredRecs, summary: m.roamie.summary ?? m.content }
      : m.roamie;
  const roamieData = roamieFromMsg ?? (showStreamingPartial ? partial : undefined);
  const hasPlaceCards =
    (m.structuredPlaces?.length ?? 0) > 0 || (roamieData?.recommendations?.length ?? 0) > 0;

  return (
    <div
      data-chat-message-id={m.id ?? `chat-${m.role}-${i}`}
      data-chat-message-index={i}
      data-chat-message-role={m.role}
      className={`flex animate-rise ${m.role === "user" ? "justify-end" : "justify-start gap-2.5"}`}
    >
      {m.role === "assistant" ? <RoamieAssistantAvatar className="h-8 w-8 shrink-0 self-end" /> : null}
      <div
        className={cn(
          "rounded-3xl px-4 py-3",
          m.role === "user"
            ? "max-w-[88%] rounded-br-md bg-primary text-primary-foreground"
            : hasPlaceCards
              ? "min-w-0 flex-1 max-w-[calc(100%-2.625rem)] rounded-bl-md border border-border bg-card"
              : "max-w-[88%] rounded-bl-md border border-border bg-card",
        )}
      >
        {m.role === "user" ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
        ) : roamieData ? (
          <RoamieResponseView
            data={roamieData}
            compact
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
          />
        ) : (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {m.content || (
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
});

type ListProps = Omit<RowProps, "message" | "index" | "isLast"> & {
  msgs: ChatMsg[];
  hydrating: boolean;
};

export const ChatMessageList = memo(function ChatMessageList({
  msgs,
  hydrating,
  ...rowProps
}: ListProps) {
  const stableKeys = useMemo(
    () =>
      msgs.map((m, i) => {
        const head = m.content?.slice(0, 24) ?? "";
        const recCount =
          m.structuredPlaces?.length ?? m.roamie?.recommendations?.length ?? 0;
        return `${m.role}:${i}:${head}:${recCount}`;
      }),
    [msgs],
  );

  if (hydrating) {
    return (
      <div className="flex justify-center pt-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {msgs.map((m, i) => (
        <ChatMessageRow
          key={stableKeys[i]}
          message={m}
          index={i}
          isLast={i === msgs.length - 1}
          {...rowProps}
        />
      ))}
    </>
  );
});

/** Re-export so chat route header shares the same module binding as message rows (avoids iOS bundle ReferenceError). */
export { RoamieAssistantAvatar };
