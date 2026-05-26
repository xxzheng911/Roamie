import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Loader2, MapPin, Plus, Sparkles } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useI18n } from "@/hooks/use-i18n";
import { listItineraries, type StoredItinerary } from "@/lib/itinerary-storage";
import { loadDraftTrip } from "@/lib/trip-draft-storage";
import { getPayloadItinerary } from "@/lib/trip/append-place-to-trip";
import { listTripDateKeys } from "@/lib/trip/trip-stop-mutations";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { RoamieDatePicker, RoamieTimePicker } from "@/components/pickers";
import { cn } from "@/lib/utils";

type ConfirmPayload = {
  target: "draft" | { tripId: string } | "new";
  newTitle?: string;
  date: string;
  time: string;
  position: "start" | "end";
  afterPlaceName?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: TripPlaceInput | null;
  busy: boolean;
  onConfirm: (opts: ConfirmPayload) => void;
};

export function AddToTripSheet({ open, onOpenChange, place, busy, onConfirm }: Props) {
  const { t } = useI18n();
  const [keyboardInsetPx, setKeyboardInsetPx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [trips, setTrips] = useState<StoredItinerary[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [target, setTarget] = useState<"draft" | { tripId: string } | "new">("new");
  const [newTitle, setNewTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [position, setPosition] = useState<"start" | "end">("end");
  const [afterPlace, setAfterPlace] = useState("");

  const selectedTrip = useMemo(() => {
    if (typeof target === "object") return trips.find((t) => t.id === target.tripId) ?? null;
    return null;
  }, [target, trips]);

  const dateOptions = useMemo(() => {
    if (target === "draft") {
      const draft = loadDraftTrip();
      const items = draft?.itinerary ?? [];
      const start = draft?.tripSettings?.tripStartDate ?? new Date().toISOString().slice(0, 10);
      return listTripDateKeys(items, start);
    }
    if (selectedTrip && isRoamiePayloadV2(selectedTrip.payload)) {
      const start = selectedTrip.payload.tripSettings?.tripStartDate;
      return listTripDateKeys(selectedTrip.payload.itinerary ?? [], start);
    }
    if (selectedTrip) {
      return listTripDateKeys(getPayloadItinerary(selectedTrip.payload));
    }
    return [new Date().toISOString().slice(0, 10)];
  }, [target, selectedTrip, open]);

  const stopsOnDate = useMemo(() => {
    if (!date) return [];
    if (target === "draft") {
      const draft = loadDraftTrip();
      return (draft?.itinerary ?? []).filter((i) => (i.date?.trim() || "未指定日期") === date);
    }
    if (selectedTrip && isRoamiePayloadV2(selectedTrip.payload)) {
      return (selectedTrip.payload.itinerary ?? []).filter(
        (i) => (i.date?.trim() || "未指定日期") === date,
      );
    }
    return getPayloadItinerary(selectedTrip?.payload).filter(
      (i) => (i.date?.trim() || "未指定日期") === date,
    );
  }, [target, selectedTrip, date]);

  useEffect(() => {
    if (!open) return;
    setLoadingTrips(true);
    setHasDraft(Boolean(loadDraftTrip()));
    listItineraries()
      .then(setTrips)
      .catch(() => setTrips([]))
      .finally(() => setLoadingTrips(false));
    if (place) {
      setNewTitle(`${place.placeName} 的小旅行`);
    }
    const draft = loadDraftTrip();
    if (draft) {
      setTarget("draft");
      const start = draft.tripSettings?.tripStartDate ?? new Date().toISOString().slice(0, 10);
      setDate(listTripDateKeys(draft.itinerary ?? [], start)[0] ?? start);
    } else {
      setTarget("new");
      setDate(new Date().toISOString().slice(0, 10));
    }
    setTime("10:00");
    setPosition("end");
    setAfterPlace("");
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      setKeyboardInsetPx(0);
      return;
    }

    let removeCap: (() => void) | null = null;
    const cap = (
      window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;
    const isNative = Boolean(cap?.isNativePlatform?.());

    const applyInset = (px: number) => setKeyboardInsetPx(Math.max(0, Math.round(px)));

    if (isNative) {
      void import("@capacitor/keyboard").then(({ Keyboard }) => {
        const showWill = Keyboard.addListener("keyboardWillShow", (info) => {
          applyInset(info.keyboardHeight ?? 0);
        });
        const showDid = Keyboard.addListener("keyboardDidShow", (info) => {
          applyInset(info.keyboardHeight ?? 0);
        });
        const hideWill = Keyboard.addListener("keyboardWillHide", () => applyInset(0));
        removeCap = () => {
          void showWill.then((s) => s.remove());
          void showDid.then((s) => s.remove());
          void hideWill.then((s) => s.remove());
        };
      });
    }

    const vv = window.visualViewport;
    const onVv = () => {
      if (!vv) return;
      const rawInset = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
      const inset = Math.min(rawInset, Math.round(window.innerHeight * 0.55));
      if (!isNative) applyInset(inset > 50 ? inset : 0);
    };
    vv?.addEventListener("resize", onVv);
    vv?.addEventListener("scroll", onVv);
    onVv();

    return () => {
      removeCap?.();
      vv?.removeEventListener("resize", onVv);
      vv?.removeEventListener("scroll", onVv);
    };
  }, [open]);

  useEffect(() => {
    if (dateOptions.length && !dateOptions.includes(date)) {
      setDate(dateOptions[0]!);
    }
  }, [dateOptions, date]);

  const handleSubmit = () => {
    if (!place) return;
    onConfirm({
      target,
      newTitle: target === "new" ? newTitle.trim() || `${place.placeName} 的小旅行` : undefined,
      date,
      time,
      position: afterPlace ? "end" : position,
      afterPlaceName: afterPlace || undefined,
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="z-[70] mx-auto max-w-lg rounded-t-[1.75rem] border-0 bg-cream shadow-[0_-8px_40px_rgba(40,30,20,0.12)] [&>div:first-child]:hidden">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-border/80" aria-hidden />
        <div
          className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4"
          style={{ paddingBottom: `max(1.25rem, env(safe-area-inset-bottom, 0px), ${keyboardInsetPx}px)` }}
        >
          <h2 className="font-display text-lg font-medium">{t("trip.addToTripTitle")}</h2>
          {place && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-clay" />
              <span>{place.placeName}</span>
            </p>
          )}

          <div
            ref={scrollRef}
            className="mt-4 max-h-[min(70vh,520px)] space-y-4 overflow-y-auto overscroll-contain"
          >
            <section>
              <p className="text-xs font-medium text-muted-foreground">{t("trip.chooseTrip")}</p>
              {loadingTrips ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("plan.loadingPlaces")}
                </div>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {hasDraft && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setTarget("draft")}
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left text-sm transition",
                          target === "draft"
                            ? "border-foreground bg-secondary shadow-soft"
                            : "border-border bg-card",
                        )}
                      >
                        <span className="font-medium">{t("trip.draftTrip")}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {t("trip.draftTripHint")}
                        </span>
                      </button>
                    </li>
                  )}
                  {trips.map((trip) => (
                    <li key={trip.id}>
                      <button
                        type="button"
                        onClick={() => setTarget({ tripId: trip.id })}
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left text-sm transition",
                          typeof target === "object" && target.tripId === trip.id
                            ? "border-foreground bg-secondary shadow-soft"
                            : "border-border bg-card",
                        )}
                      >
                        <span className="font-medium">{trip.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {getPayloadItinerary(trip.payload).length} {t("trip.stops")}
                        </span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => setTarget("new")}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-2xl border px-4 py-3 text-left text-sm transition",
                        target === "new"
                          ? "border-foreground bg-secondary shadow-soft"
                          : "border-dashed border-border bg-card/80",
                      )}
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      <span className="font-medium">{t("trip.newTrip")}</span>
                    </button>
                  </li>
                </ul>
              )}
            </section>

            {target === "new" && (
              <section>
                <label className="text-xs font-medium text-muted-foreground">{t("trip.tripName")}</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onFocus={(e) => {
                    // Give the keyboard time to open, then ensure field is visible.
                    window.setTimeout(() => {
                      e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" });
                      scrollRef.current?.scrollBy({ top: 1, behavior: "instant" as ScrollBehavior });
                    }, 250);
                  }}
                  className="mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </section>
            )}

            <section>
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {t("trip.chooseDay")}
              </p>
              {target === "new" ? (
                <div className="mt-2">
                  <RoamieDatePicker
                    mode="single"
                    value={date}
                    onChange={setDate}
                    title={t("trip.chooseDay")}
                    placeholder={t("picker.chooseDate")}
                  />
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {dateOptions.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDate(d)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition",
                        date === d
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card",
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-muted-foreground">{t("trip.arrivalTime")}</span>
                <RoamieTimePicker
                  compact
                  title={t("trip.arrivalTime")}
                  value={time}
                  onChange={setTime}
                  className="mt-1"
                />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t("trip.insertOrder")}</span>
                <select
                  value={afterPlace ? `after:${afterPlace}` : position}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith("after:")) {
                      setAfterPlace(v.slice(6));
                      setPosition("end");
                    } else {
                      setAfterPlace("");
                      setPosition(v as "start" | "end");
                    }
                  }}
                  className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm"
                >
                  <option value="end">{t("trip.positionEnd")}</option>
                  <option value="start">{t("trip.positionStart")}</option>
                  {stopsOnDate.map((s) => (
                    <option key={s.placeName} value={`after:${s.placeName}`}>
                      {t("trip.positionAfter", { name: s.placeName })}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </div>

          <button
            type="button"
            disabled={busy || !place}
            onClick={handleSubmit}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {t("trip.confirmAdd")}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
