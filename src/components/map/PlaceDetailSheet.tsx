import { useState } from "react";
import {
  Car,
  CarTaxiFront,
  ChevronLeft,
  ChevronRight,
  Footprints,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Star,
  TrainFront,
} from "lucide-react";
import { PlaceActionRow } from "@/components/PlaceActionRow";
import { MotorcycleIcon } from "@/components/map/MotorcycleIcon";
import { PlaceHoursBadge } from "@/components/PlaceHoursBadge";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import {
  TRANSIT_MVP_NOTICE,
  TRAVEL_MODE_LABEL,
  type TravelModeEstimate,
  type TravelModeId,
} from "@/lib/estimate-travel-mode";
import { cn } from "@/lib/utils";
import type { PlaceResult } from "@/lib/place-result";

function TransportModeIcon({ mode }: { mode: TravelModeId }) {
  const cls = "h-4 w-4 shrink-0 text-muted-foreground";
  switch (mode) {
    case "walk":
      return <Footprints className={cls} aria-hidden />;
    case "motorcycle":
      return <MotorcycleIcon className={cls} />;
    case "drive":
      return <Car className={cls} aria-hidden />;
    case "transit":
      return <TrainFront className={cls} aria-hidden />;
    case "taxi":
      return <CarTaxiFront className={cls} aria-hidden />;
  }
}

export type PlaceDetailData = PlaceResult & {
  reason: string;
  intro?: string;
  suitableFor?: string;
  weatherFit?: string;
  goNowAdvice?: string;
  introLoading?: boolean;
  website?: string | null;
  phone?: string | null;
};

type Props = {
  place: PlaceDetailData;
  imageUrls: string[];
  distanceLabel: string | null;
  isSaved: boolean;
  isBusy: boolean;
  transportModes: TravelModeEstimate[];
  transportLoading: boolean;
  transportTip: string;
  selectedTransportMode: TravelModeId;
  onSelectTransportMode: (mode: TravelModeId) => void;
  onNavigate: () => void;
  onToggleSave: () => void;
  onAddToTrip: () => void;
  onOpenChat: () => void;
  saveLabel?: string;
  addToTripLabel?: string;
};

export function PlaceDetailSheet({
  place,
  imageUrls,
  distanceLabel,
  isSaved,
  isBusy,
  transportModes,
  transportLoading,
  transportTip,
  selectedTransportMode,
  onSelectTransportMode,
  onNavigate,
  onToggleSave,
  onAddToTrip,
  onOpenChat,
  saveLabel = "收藏",
  addToTripLabel = "加入行程",
}: Props) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const photos = imageUrls.length > 0 ? imageUrls : [];
  const typeLabel = identityDisplayLabel(resolvePlaceIdentity(place));
  const navButtonLabel = `導航・${TRAVEL_MODE_LABEL[selectedTransportMode]}`;

  return (
    <div className="flex flex-col" data-no-sheet-drag>
      <div className="relative mx-5 mt-1 aspect-[16/10] overflow-hidden rounded-3xl bg-secondary shadow-soft">
        {photos.length > 0 ? (
          <>
            <img
              src={photos[photoIdx]}
              alt={place.name}
              className="h-full w-full object-cover"
            />
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                  className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 shadow-soft"
                  aria-label="上一張"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                  className="absolute right-12 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 shadow-soft"
                  aria-label="下一張"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                  {photos.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        i === photoIdx ? "bg-card" : "bg-card/50",
                      )}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            尚無照片
          </div>
        )}
        <button
          type="button"
          onClick={onToggleSave}
          disabled={isBusy}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-card/95 shadow-soft disabled:opacity-60"
          aria-label={isSaved ? "移除收藏" : "收藏"}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart
              className={`h-4 w-4 ${isSaved ? "fill-clay text-clay" : "text-muted-foreground"}`}
            />
          )}
        </button>
      </div>

      <div className="px-5 pb-6 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl leading-tight">{place.name}</h2>
          {place.rating != null && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-sm shadow-soft">
              <Star className="h-3.5 w-3.5 fill-clay text-clay" />
              {place.rating.toFixed(1)}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-secondary px-2.5 py-0.5">{typeLabel}</span>
          {distanceLabel && <span>{distanceLabel}</span>}
        </div>

        <PlaceHoursBadge
          className="mt-2"
          statusLabel={place.openStatusLabel}
          todayHoursLabel={place.todayHoursLabel}
          closingSoonNote={place.closingSoonNote}
          nextOpenHint={place.nextOpenHint}
        />

        {place.address && (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{place.address}</span>
          </p>
        )}

        {(place.phone || place.website) && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {place.phone ? (
              <a
                href={`tel:${place.phone.replace(/\s/g, "")}`}
                className="rounded-full border border-border bg-card px-3 py-1 text-foreground"
              >
                {place.phone}
              </a>
            ) : null}
            {place.website ? (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-border bg-card px-3 py-1 text-foreground"
              >
                官網
              </a>
            ) : null}
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-border/80 bg-card/60 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Roamie 推薦理由</p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{place.reason}</p>
        </div>

        {(place.intro || place.introLoading) && (
          <div className="mt-3 rounded-2xl border border-border/80 bg-secondary/40 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Roamie 簡介</p>
            {place.introLoading ? (
              <p className="mt-1.5 text-sm text-muted-foreground">整理中…</p>
            ) : (
              <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{place.intro}</p>
            )}
            {place.suitableFor && (
              <p className="mt-2 text-xs text-muted-foreground">適合：{place.suitableFor}</p>
            )}
            {place.weatherFit && (
              <p className="mt-1 text-xs text-muted-foreground">天氣：{place.weatherFit}</p>
            )}
            {place.goNowAdvice && (
              <p className="mt-1 text-xs text-muted-foreground">{place.goNowAdvice}</p>
            )}
          </div>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">交通方式</p>
          {transportTip && (
            <p className="mt-1 text-xs leading-relaxed text-foreground/80">{transportTip}</p>
          )}
          <div className="mt-2 space-y-2">
            {transportLoading && transportModes.length === 0 ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              transportModes.map((m) => {
                const isSelected = selectedTransportMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-no-sheet-drag
                    onClick={() => onSelectTransportMode(m.id)}
                    className={cn(
                      "w-full rounded-2xl border px-3.5 py-2.5 text-left transition active:scale-[0.99]",
                      isSelected
                        ? "border-clay bg-clay/12 shadow-soft ring-1 ring-clay/30"
                        : "border-border/60 bg-card/40 hover:border-clay/25 hover:bg-card/70",
                    )}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <TransportModeIcon mode={m.id} />
                        {m.label}
                      </p>
                      {m.recommended && !isSelected && (
                        <span className="shrink-0 rounded-full bg-clay/12 px-2 py-0.5 text-[10px] font-medium text-clay">
                          推薦
                        </span>
                      )}
                      {isSelected && (
                        <span className="shrink-0 rounded-full bg-clay/20 px-2 py-0.5 text-[10px] font-medium text-clay">
                          已選取
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-foreground">
                      {m.minutes} 分鐘
                      <span className="text-muted-foreground"> ・ {m.distanceLabel}</span>
                      {m.costLabel && (
                        <span className="text-muted-foreground"> ・ {m.costLabel}</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.hint}</p>
                  </button>
                );
              })
            )}
          </div>
          {selectedTransportMode === "transit" && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{TRANSIT_MVP_NOTICE}</p>
          )}
        </div>

        <PlaceActionRow
          className="mt-4"
          isSaved={isSaved}
          isBusy={isBusy}
          onToggleSave={onToggleSave}
          onAddToTrip={onAddToTrip}
          saveLabel={saveLabel}
          addLabel={addToTripLabel}
        />

        <button
          type="button"
          data-no-sheet-drag
          onClick={onNavigate}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-[0.99]"
        >
          <Navigation className="h-4 w-4" />
          {navButtonLabel}
        </button>

        <button
          type="button"
          onClick={onOpenChat}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-border bg-card py-3 text-sm transition active:scale-[0.99]"
        >
          <MessageCircle className="h-4 w-4" />
          和 Roamie 聊這裡
        </button>
      </div>
    </div>
  );
}

export function ExploreSubpageHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-0" data-no-sheet-drag>
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-soft transition active:scale-95"
        aria-label="返回"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <p className="font-display text-lg leading-tight">{title}</p>
    </div>
  );
}
