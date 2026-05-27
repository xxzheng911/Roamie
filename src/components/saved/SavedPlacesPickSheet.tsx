import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { listPlaces } from "@/lib/places-storage";
import { tripPlaceFromSavedPlace, type TripPlaceInput } from "@/lib/trip/trip-place-input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (place: TripPlaceInput) => void;
};

export function SavedPlacesPickSheet({ open, onOpenChange, onPick }: Props) {
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState<Awaited<ReturnType<typeof listPlaces>>>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[70dvh] rounded-t-[1.75rem] border-0 bg-background px-0 pb-8"
      >
        <SheetTitle className="px-5 text-base font-medium">從收藏選擇地點</SheetTitle>
        <div className="mt-3 max-h-[50dvh] overflow-y-auto px-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : places.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">尚無收藏地點</p>
          ) : (
            <ul className="space-y-2">
              {places.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-left transition active:scale-[0.99]"
                    onClick={() => {
                      onPick(tripPlaceFromSavedPlace(p));
                      onOpenChange(false);
                    }}
                  >
                    <p className="font-medium">{p.name}</p>
                    {p.address ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.address}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
