import { useI18n } from "@/hooks/use-i18n";
import { useNavigate } from "@tanstack/react-router";
import { Calendar } from "lucide-react";
import { TripCoverImage } from "@/components/media/TripCoverImage";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import type { CoreTrip } from "@/lib/trip/core-trip";
import { resolveCoreTripCoverDisplayUrl, resolveCoreTripTitle } from "@/lib/trip/core-trip";

type Props = {
  trip: CoreTrip;
  shareSlot?: React.ReactNode;
  deleteSlot?: React.ReactNode;
};

/** 收藏列表：僅封面、自訂名稱、旅行天數 */
export function SavedTripCard({ trip, shareSlot, deleteSlot }: Props) {
  const { t: uiT } = useI18n();

  const navigate = useNavigate();

  return (
    <div className="relative rounded-3xl border border-border bg-card shadow-soft transition active:scale-[0.99]">
      {shareSlot ? <div className="absolute right-3 top-3 z-10">{shareSlot}</div> : null}
      {deleteSlot ? <div className="absolute right-3 bottom-3 z-10">{deleteSlot}</div> : null}
      <button
        type="button"
        onClick={() => {
          logTripNav("SavedTripCard", trip.id);
          navigate(tripDetailNavigateOptions(trip.id));
        }}
        className="block w-full p-4 text-left"
        aria-label={uiT("productionUi.viewTrip", { name: resolveCoreTripTitle(trip) })}
      >
        <div className="flex gap-3">
          <div className="h-[5.5rem] w-[5.5rem] shrink-0 overflow-hidden rounded-2xl">
            <TripCoverImage
              key={`${trip.id}-cover-${trip.updatedAt}`}
              displayCoverImage={resolveCoreTripCoverDisplayUrl(trip)}
              coverImageUrl={null}
              customCoverImageUrl={trip.customCoverImageUrl}
              aiGeneratedCoverImageUrl={trip.aiGeneratedCoverImageUrl}
              isCoverCustomized={Boolean(trip.customCoverImageUrl)}
              mood="roamie"
              className="h-full w-full rounded-2xl"
            />
          </div>
          <div className="min-w-0 flex-1 pr-8">
            <p className="line-clamp-2 font-display text-[17px] leading-snug">
              {resolveCoreTripTitle(trip)}
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 shrink-0" />
              <span>{uiT("productionUi.pab2b69cb47", { v0: trip.days })}</span>
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}
