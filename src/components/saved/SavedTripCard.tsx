import { useNavigate } from "@tanstack/react-router";
import { Calendar } from "lucide-react";
import { TripCoverImage } from "@/components/media/TripCoverImage";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import type { CoreTrip } from "@/lib/trip/core-trip";
import { resolveCoreTripTitle } from "@/lib/trip/core-trip";
import { resolveDisplayCoverImage } from "@/lib/saved-trip/display";
import { cn } from "@/lib/utils";

type Props = {
  trip: CoreTrip;
  deleteSlot?: React.ReactNode;
  className?: string;
};

/** 收藏列表封面：沿用 saved-trip display 鏈，不受首頁 nearby 圖片邏輯影響 */
function resolveSavedTripListCover(trip: CoreTrip): string {
  return resolveDisplayCoverImage({
    coverImageUrl: trip.coverImageUrl,
    customCoverImageUrl: trip.customCoverImageUrl,
    aiGeneratedCoverImageUrl: trip.aiGeneratedCoverImageUrl,
    aiGeneratedDestinationCoverUrl: trip.aiGeneratedCoverImageUrl,
    isCoverCustomized: trip.isCoverCustomized,
  });
}

/**
 * 收藏頁行程列表卡片（/_app/saved/ 唯一使用）。
 * 左封面、中間標題與天數、右側獨立刪除區。
 */
export function SavedTripCard({ trip, deleteSlot, className }: Props) {
  const navigate = useNavigate();
  const coverUrl = resolveSavedTripListCover(trip);
  const title = resolveCoreTripTitle(trip);

  const openDetail = () => {
    logTripNav("SavedTripCard", trip.id);
    navigate(tripDetailNavigateOptions(trip.id, { from: "saved" }));
  };

  return (
    <article
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-3xl border border-border bg-card shadow-soft transition active:scale-[0.99]",
        className,
      )}
    >
      <div className="flex w-full min-w-0 items-stretch">
        <button
          type="button"
          onClick={openDetail}
          className="flex min-w-0 flex-1 touch-manipulation items-center gap-3 p-4 text-left"
          aria-label={`查看行程：${title}`}
        >
          <div className="h-[5.5rem] w-[5.5rem] shrink-0 overflow-hidden rounded-2xl bg-secondary">
            <TripCoverImage
              displayCoverImage={coverUrl}
              coverImageUrl={trip.coverImageUrl}
              customCoverImageUrl={trip.customCoverImageUrl}
              aiGeneratedCoverImageUrl={trip.aiGeneratedCoverImageUrl}
              isCoverCustomized={trip.isCoverCustomized}
              mood="roamie"
              alt=""
              className="h-full w-full rounded-2xl object-cover"
              imgClassName="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="line-clamp-2 font-display text-[17px] leading-snug text-foreground [word-break:keep-all]">
              {title}
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 shrink-0" />
              <span className="whitespace-nowrap">
                {trip.days} 天
              </span>
            </p>
          </div>
        </button>
        {deleteSlot ? (
          <div className="flex w-12 shrink-0 flex-col items-center justify-start px-2 pb-4 pt-3">
            {deleteSlot}
          </div>
        ) : null}
      </div>
    </article>
  );
}
