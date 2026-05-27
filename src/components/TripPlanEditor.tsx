import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles, Trash2 } from "lucide-react";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { DayOutfitCard } from "@/components/DayOutfitCard";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
import { buildDirectionsUrl, openExternal, type LatLng } from "@/lib/maps-navigation";
import { formatLegTravelTimeLabel } from "@/lib/saved-trip/travel-time";
import { syncTripLegsFromGoogleRoutes } from "@/lib/saved-trip/sync-route-legs";
import { buildLegKey } from "@/lib/transit/types";
import { RoamieDatePicker, RoamieDurationPicker, RoamieTimePicker } from "@/components/pickers";
import { daysBetweenDates } from "@/lib/fetch-context";
import { groupItineraryByDate, listTripDates } from "@/lib/outfit/group-by-date";
import type {
  RoamieItineraryItem,
  RoamiePayloadV2,
  TripPlanSettings,
  TripTransportMode,
} from "@/lib/ai/types";
import { TripStopSearchField } from "@/components/TripStopSearchField";
import { tripPlaceToItineraryItem } from "@/lib/trip/trip-place-input";
import { insertStopOnDate, moveStopInDay, removeStopAt } from "@/lib/trip/trip-stop-mutations";
import { useI18n } from "@/hooks/use-i18n";

const TRANSPORT_OPTIONS: { value: TripTransportMode; label: string }[] = [
  { value: "walk", label: "步行" },
  { value: "scooter", label: "機車" },
  { value: "drive", label: "開車" },
  { value: "transit", label: "大眾運輸" },
];

const TRANSPORT_LABEL: Record<TripTransportMode, string> = {
  walk: "步行",
  scooter: "機車",
  drive: "開車",
  transit: "大眾運輸",
};

function legKey(item: RoamieItineraryItem): string {
  return item.placeName || item.title;
}

function inferTripDates(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): { start: string; end: string } {
  const fromSettings = settings.tripStartDate;
  const toSettings = settings.tripEndDate;
  if (fromSettings) {
    return { start: fromSettings, end: toSettings || fromSettings };
  }
  const isoDates = [
    ...new Set(items.map((i) => i.date?.trim()).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d!))),
  ].sort();
  if (isoDates.length > 0) {
    return { start: isoDates[0]!, end: isoDates[isoDates.length - 1]! };
  }
  const today = new Date().toISOString().slice(0, 10);
  return { start: today, end: today };
}

function applyTripDateRange(
  items: RoamieItineraryItem[],
  start: string,
  end: string,
): RoamieItineraryItem[] {
  if (!start) return items;
  const dayCount = daysBetweenDates(start, end || start);
  const groups = [...groupItineraryByDate(items).entries()];
  const newDates = listTripDates(items, start, dayCount);
  const next: RoamieItineraryItem[] = [];
  groups.forEach(([, groupItems], idx) => {
    const date = newDates[idx] ?? newDates[newDates.length - 1] ?? start;
    for (const item of groupItems) {
      next.push({ ...item, date });
    }
  });
  return next;
}

function updateDayDate(
  items: RoamieItineraryItem[],
  oldDateKey: string,
  newIso: string,
): RoamieItineraryItem[] {
  return items.map((item) => {
    const key = item.date?.trim() || "未指定日期";
    if (key !== oldDateKey) return item;
    return { ...item, date: newIso };
  });
}

type Props = {
  payload: RoamiePayloadV2;
  onSave: (next: RoamiePayloadV2) => Promise<void>;
  onReplan: (settings: TripPlanSettings, items: RoamieItineraryItem[]) => Promise<void>;
};

export function TripPlanEditor({ payload, onSave, onReplan }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<TripPlanSettings>(
    () =>
      payload.tripSettings ?? {
        startTime: payload.itinerary[0]?.time?.slice(0, 5) ?? "10:00",
        transport: "walk",
        legMinutes: {},
      },
  );
  const [items, setItems] = useState<RoamieItineraryItem[]>(() => [...payload.itinerary]);
  const [saving, setSaving] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [transitLoading, setTransitLoading] = useState(false);
  const skipInitialTransitFetch = useRef(
    Boolean(
      payload.tripSettings?.transitLegs && Object.keys(payload.tripSettings.transitLegs).length > 0,
    ),
  );

  const routeCoords = useMemo(
    () =>
      items
        .filter((i) => i.lat != null && i.lng != null)
        .map((i) => ({ lat: i.lat!, lng: i.lng! })),
    [items],
  );

  const routeUrl =
    routeCoords.length >= 2
      ? buildDirectionsUrl(routeCoords[routeCoords.length - 1], {
          origin: routeCoords[0],
          waypoints: routeCoords.length > 2 ? routeCoords.slice(1, -1) : undefined,
          travelMode:
            settings.transport === "drive"
              ? "driving"
              : settings.transport === "transit"
                ? "transit"
                : "walking",
        })
      : null;

  const setLegMinutes = (key: string, minutes: number) => {
    setSettings((s) => ({
      ...s,
      legMinutes: { ...s.legMinutes, [key]: minutes },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...payload, itinerary: items, tripSettings: settings, recommendations: [] });
    } finally {
      setSaving(false);
    }
  };

  const refreshTransit = useCallback(async () => {
    const withCoords = items.filter((i) => i.lat != null && i.lng != null);
    if (withCoords.length < 2) return;

    setTransitLoading(true);
    try {
      const transitLegs = await syncTripLegsFromGoogleRoutes(items, settings);
      setSettings((s) => ({ ...s, transitLegs }));
    } catch (e) {
      console.warn("[TripPlanEditor] Google Routes leg sync failed", e);
    } finally {
      setTransitLoading(false);
    }
  }, [items, settings]);

  useEffect(() => {
    if (skipInitialTransitFetch.current) {
      skipInitialTransitFetch.current = false;
      return;
    }
    const t = setTimeout(() => {
      void refreshTransit();
    }, 600);
    return () => clearTimeout(t);
  }, [refreshTransit]);

  const handleReplan = async () => {
    setReplanning(true);
    try {
      await onReplan(settings, items);
    } finally {
      setReplanning(false);
    }
  };

  const groups = new Map<string, RoamieItineraryItem[]>();
  for (const item of items) {
    const key = item.date?.trim() || "今日";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const firstWithCoords = items.find((i) => i.lat != null && i.lng != null);
  const tripCenter = firstWithCoords
    ? { lat: firstWithCoords.lat!, lng: firstWithCoords.lng! }
    : undefined;

  const handleAddStop = (
    dateKey: string,
    place: Parameters<typeof tripPlaceToItineraryItem>[0],
  ) => {
    const stop = tripPlaceToItineraryItem(place, {
      date: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : inferTripDates(items, settings).start,
      time: settings.startTime ?? "10:00",
    });
    setItems(insertStopOnDate(items, stop, { date: stop.date, position: "end" }));
  };

  const outfitByDate = new Map<string, DailyOutfitAdvice>();
  for (const d of payload.outfitAdvice?.days ?? []) {
    outfitByDate.set(d.date, d);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">{payload.summary}</p>

      {settings.transportTips && (
        <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {settings.transportTips}
        </p>
      )}

      <RoamieDatePicker
        mode="range"
        label="旅行日期"
        title="編輯行程日期"
        value={{
          start: inferTripDates(items, settings).start,
          end: inferTripDates(items, settings).end,
        }}
        onChange={(range) => {
          setSettings((s) => ({
            ...s,
            tripStartDate: range.start,
            tripEndDate: range.end,
          }));
          setItems(applyTripDateRange(items, range.start, range.end));
        }}
        className="mb-1"
      />

      <label className="block rounded-2xl border border-border bg-card p-3">
        <span className="text-[11px] text-muted-foreground">預設交通方式</span>
        <select
          value={settings.transport ?? "walk"}
          onChange={(e) => {
            setSettings((s) => ({ ...s, transport: e.target.value as TripTransportMode }));
            void refreshTransit();
          }}
          className="mt-1 w-full bg-transparent text-sm font-medium focus:outline-none"
        >
          {TRANSPORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {routeUrl && (
        <button
          type="button"
          onClick={() => openExternal(routeUrl)}
          className="w-full rounded-full border border-border bg-card py-2.5 text-sm"
        >
          整段路線導航（{TRANSPORT_LABEL[settings.transport ?? "walk"]}）
        </button>
      )}

      <div className="space-y-6">
        {[...groups.entries()].map(([dateKey, dayItems]) => {
          const outfit =
            outfitByDate.get(dateKey) ??
            (payload.outfitAdvice?.days.length === 1 ? payload.outfitAdvice.days[0] : undefined);
          return (
            <section key={dateKey}>
              <div className="mb-3">
                <RoamieDatePicker
                  mode="single"
                  variant="inline"
                  title="選擇日期"
                  value={
                    /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
                      ? dateKey
                      : inferTripDates(items, settings).start
                  }
                  onChange={(iso) => setItems(updateDayDate(items, dateKey, iso))}
                  placeholder={dateKey}
                />
              </div>
              {outfit && <DayOutfitCard advice={outfit} className="mb-4" />}
              <div className="relative space-y-0 border-l border-dashed border-border pl-5">
                {dayItems.map((item, i) => {
                  const key = legKey(item);
                  const mins = settings.legMinutes?.[key] ?? 90;
                  const prev = i > 0 ? dayItems[i - 1] : null;
                  const transitKey =
                    prev != null
                      ? buildLegKey(prev.placeName || prev.title, item.placeName || item.title)
                      : null;
                  const transit = transitKey ? settings.transitLegs?.[transitKey] : undefined;
                  const transportLabel = TRANSPORT_LABEL[settings.transport ?? "walk"];

                  return (
                    <div key={`${key}-${i}`}>
                      <article className="relative pb-6 last:pb-0">
                        <span className="absolute -left-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground" />
                        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                          {transitKey && i > 0 ? (
                            <p className="mb-3 text-xs text-muted-foreground">
                              {formatLegTravelTimeLabel(transit, transportLabel, {
                                loading: transitLoading,
                              })}
                            </p>
                          ) : null}
                          <div className="mb-2 flex items-center justify-end gap-1">
                            <button
                              type="button"
                              aria-label="上移"
                              disabled={i === 0}
                              onClick={() => setItems(moveStopInDay(items, dateKey, i, -1))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card disabled:opacity-40"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="下移"
                              disabled={i >= dayItems.length - 1}
                              onClick={() => setItems(moveStopInDay(items, dateKey, i, 1))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card disabled:opacity-40"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={t("trip.deleteStop")}
                              onClick={() => setItems(removeStopAt(items, dateKey, i))}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <RoamieTimePicker
                              compact
                              title="抵達時間"
                              value={item.time?.slice(0, 5) || "10:00"}
                              onChange={(t) => {
                                const next = [...items];
                                const idx = items.indexOf(item);
                                next[idx] = { ...item, time: t };
                                setItems(next);
                              }}
                            />
                            <RoamieDurationPicker
                              valueMinutes={mins}
                              onChangeMinutes={(m) => setLegMinutes(key, m)}
                            />
                          </div>
                          <h3 className="mt-2 text-[16px] font-medium leading-snug">
                            {item.placeName || item.title}
                          </h3>
                          {item.address ? (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {item.address}
                            </p>
                          ) : null}
                          <PlaceNavButtons
                            lat={item.lat}
                            lng={item.lng}
                            placeName={item.placeName}
                            compact
                            className="mt-3"
                          />
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
              <TripStopSearchField
                label={t("trip.addStop")}
                center={tripCenter}
                onPick={(place) => handleAddStop(dateKey, place)}
              />
            </section>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleReplan}
          disabled={replanning || items.length < 1}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {replanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          依交通與停留時間重新規劃路線
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-full border border-border bg-card py-3 text-sm disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存調整"}
        </button>
      </div>
    </div>
  );
}
