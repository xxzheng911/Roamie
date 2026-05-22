import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { DayOutfitCard } from "@/components/DayOutfitCard";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
import { buildDirectionsUrl, openExternal, type LatLng } from "@/lib/maps-navigation";
import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings, TripTransportMode } from "@/lib/ai/types";

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

type Props = {
  payload: RoamiePayloadV2;
  onSave: (next: RoamiePayloadV2) => Promise<void>;
  onReplan: (settings: TripPlanSettings, items: RoamieItineraryItem[]) => Promise<void>;
};

export function TripPlanEditor({ payload, onSave, onReplan }: Props) {
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
          travelMode: settings.transport === "drive" ? "driving" : settings.transport === "transit" ? "transit" : "walking",
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

  const outfitByDate = new Map<string, DailyOutfitAdvice>();
  for (const d of payload.outfitAdvice?.days ?? []) {
    outfitByDate.set(d.date, d);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">{payload.summary}</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="rounded-2xl border border-border bg-card p-3">
          <span className="text-[11px] text-muted-foreground">出發時間</span>
          <input
            type="time"
            value={settings.startTime ?? "10:00"}
            onChange={(e) => setSettings((s) => ({ ...s, startTime: e.target.value }))}
            className="mt-1 w-full bg-transparent text-sm font-medium focus:outline-none"
          />
        </label>
        <label className="rounded-2xl border border-border bg-card p-3">
          <span className="text-[11px] text-muted-foreground">交通方式</span>
          <select
            value={settings.transport ?? "walk"}
            onChange={(e) =>
              setSettings((s) => ({ ...s, transport: e.target.value as TripTransportMode }))
            }
            className="mt-1 w-full bg-transparent text-sm font-medium focus:outline-none"
          >
            {TRANSPORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

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
            (payload.outfitAdvice?.days.length === 1
              ? payload.outfitAdvice.days[0]
              : undefined);
          return (
          <section key={dateKey}>
            <p className="mb-3 font-display text-lg">{dateKey}</p>
            {outfit && <DayOutfitCard advice={outfit} className="mb-4" />}
            <div className="relative space-y-0 border-l border-dashed border-border pl-5">
              {dayItems.map((item, i) => {
                const key = legKey(item);
                const mins = settings.legMinutes?.[key] ?? 90;
                return (
                  <article key={`${key}-${i}`} className="relative pb-6 last:pb-0">
                    <span className="absolute -left-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground" />
                    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <input
                          type="time"
                          value={item.time?.slice(0, 5) || ""}
                          onChange={(e) => {
                            const next = [...items];
                            const idx = items.indexOf(item);
                            next[idx] = { ...item, time: e.target.value };
                            setItems(next);
                          }}
                          className="rounded-lg border border-border bg-secondary px-2 py-0.5 font-medium"
                        />
                        <label className="flex items-center gap-1">
                          停留
                          <input
                            type="number"
                            min={15}
                            max={480}
                            step={15}
                            value={mins}
                            onChange={(e) => setLegMinutes(key, Number(e.target.value) || 90)}
                            className="w-14 rounded-lg border border-border bg-secondary px-1.5 py-0.5 text-center"
                          />
                          分
                        </label>
                      </div>
                      <h3 className="mt-2 text-[16px] font-medium leading-snug">{item.title}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.placeName}</p>
                      <p className="mt-2 text-sm leading-relaxed text-foreground/80">{item.description}</p>
                      <PlaceNavButtons
                        lat={item.lat}
                        lng={item.lng}
                        placeName={item.placeName}
                        compact
                        className="mt-3"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
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
          {replanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
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
