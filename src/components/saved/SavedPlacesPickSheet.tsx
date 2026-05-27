import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { listPlaces } from "@/lib/places-storage";
import { tripPlaceFromSavedPlace, type TripPlaceInput } from "@/lib/trip/trip-place-input";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick?: (place: TripPlaceInput) => void;
  /** 多選模式：按「加入行程」一次加入 */
  multiSelect?: boolean;
  onConfirm?: (places: TripPlaceInput[]) => void;
};

export function SavedPlacesPickSheet({
  open,
  onOpenChange,
  onPick,
  multiSelect = false,
  onConfirm,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState<Awaited<ReturnType<typeof listPlaces>>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelectedIds(new Set());
    void listPlaces()
      .then((rows) => {
        if (!cancelled) setPlaces(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    const picked = places
      .filter((p) => selectedIds.has(p.id))
      .map((p) => tripPlaceFromSavedPlace(p));
    console.log("[TRIP_ADD_PLACE_FROM_FAVORITES] count=", picked.length);
    onConfirm?.(picked);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[80dvh] flex-col rounded-t-[1.75rem] border-0 bg-background px-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="px-5 text-base font-medium">從收藏選擇地點</SheetTitle>
        {multiSelect ? (
          <p className="mt-1 px-5 text-xs text-muted-foreground">可複選，完成後按「加入行程」</p>
        ) : null}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : places.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">尚無收藏地點</p>
          ) : (
            <ul className="space-y-2 pb-4">
              {places.map((p) => {
                const selected = selectedIds.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99]",
                        selected
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-card",
                      )}
                      onClick={() => {
                        if (multiSelect) {
                          toggle(p.id);
                          return;
                        }
                        onPick?.(tripPlaceFromSavedPlace(p));
                        onOpenChange(false);
                      }}
                    >
                      {multiSelect ? (
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <p className="font-medium">{p.name}</p>
                        {p.address ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{p.address}</p>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {multiSelect ? (
          <div className="shrink-0 border-t border-border px-5 pt-3">
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={handleConfirm}
              className="w-full rounded-full bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              加入行程{selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}
            </button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
