import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/hooks/use-i18n";
import { fetchRoamieAI } from "@/lib/ai/stream-client";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { buildClientContextBundle, toRoamieRequest } from "@/lib/fetch-context";
import { getWeather } from "@/lib/weather.functions";
import { supabase } from "@/integrations/supabase/client";
import { getPlaceDetails, searchPlaces } from "@/services/placesService";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import { tripPlaceFromRecommendation, type TripPlaceInput } from "@/lib/trip/trip-place-input";
import { cn } from "@/lib/utils";

const EXAMPLE_PROMPTS = [
  "幫我安排適合下午的咖啡廳",
  "幫我補一個晚餐",
  "幫我排順路景點",
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripTitle: string;
  dayLabel: string;
  existingStopNames: string[];
  onAddPlace: (place: TripPlaceInput) => void;
};

export function TripRoamiePlanSheet({
  open,
  onOpenChange,
  tripTitle,
  dayLabel,
  existingStopNames,
  onAddPlace,
}: Props) {
  const { locale } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<RoamieRecommendationItem[]>([]);
  const fetchWeather = useServerFn(getWeather);
  const searchFn = useServerFn(searchTripStops);
  const resolveFn = useServerFn(resolveTripStop);

  const runPlan = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    console.log("[TRIP_ROAMIE_PLAN] prompt=", trimmed);
    setLoading(true);
    setSuggestions([]);
    try {
      const bundle = await buildClientContextBundle(fetchWeather);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const summary = [
        `行程：${tripTitle}`,
        dayLabel,
        existingStopNames.length
          ? `已有地點：${existingStopNames.join("、")}`
          : "這天尚無地點",
        `使用者需求：${trimmed}`,
      ].join("；");

      const req = toRoamieRequest("recommend", bundle, {
        locale,
        chatPhase: "recommend",
        chatInput: trimmed,
        conversation: [{ role: "user", content: trimmed }],
        conversationSummary: summary,
      });

      const data = await fetchRoamieAI(req, { token });
      let recs = data?.recommendations ?? [];

      if (recs.length === 0) {
        const { suggestions: searchHits } = await searchPlaces(trimmed, {
          locale,
          center: bundle.location
            ? { lat: bundle.location.lat, lng: bundle.location.lng }
            : undefined,
          searchFn,
        });
        recs = searchHits.slice(0, 6).map((s) => ({
          name: s.label,
          placeName: s.label,
          type: s.types?.[0] ?? "景點",
          description: s.secondary ?? "",
          reason: "依你的需求搜尋",
          address: s.secondary ?? "",
          lat: null,
          lng: null,
          googlePlaceId: s.placeId,
          estimatedTime: "約 1 小時",
        }));
      }

      console.log(
        "[TRIP_ROAMIE_PLAN] suggestions=",
        recs.map((r) => r.name).join(", "),
      );
      setSuggestions(recs);
      if (recs.length === 0) {
        toast.message("暫時沒有合適建議，可以換個描述再試試");
      }
    } catch (e) {
      console.warn("[TRIP_ROAMIE_PLAN] failed", e);
      toast.error(e instanceof Error ? e.message : "安排失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, [
    prompt,
    tripTitle,
    dayLabel,
    existingStopNames,
    locale,
    fetchWeather,
    searchFn,
  ]);

  const handleAdd = async (rec: RoamieRecommendationItem) => {
    let place = tripPlaceFromRecommendation(rec);
    if (
      (place.lat == null || place.lng == null) &&
      rec.googlePlaceId
    ) {
      const { place: resolved } = await getPlaceDetails(rec.googlePlaceId, {
        locale,
        resolveFn,
        fallback: {
          placeId: rec.googlePlaceId,
          label: rec.name,
          secondary: rec.address,
        },
      });
      if (resolved) {
        place = {
          ...place,
          lat: resolved.lat,
          lng: resolved.lng,
          address: resolved.address || place.address,
        };
      }
    }
    if (place.lat == null || place.lng == null) {
      toast.message("暫時找不到這個地點的座標，換一個試試");
      return;
    }
    onAddPlace(place);
    console.log("[TRIP_ADD_PLACE_SUCCESS]");
    toast.success(`已加入「${rec.name}」`);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPrompt("");
          setSuggestions([]);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        className="flex max-h-[85dvh] flex-col rounded-t-[1.75rem] border-0 bg-background px-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="flex items-center gap-2 px-5 text-base font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          請 Roamie 幫我安排
        </SheetTitle>
        <p className="mt-1 px-5 text-xs text-muted-foreground">
          {dayLabel} · 在行程頁內完成，不會跳轉聊天
        </p>

        <div className="mt-4 space-y-3 px-5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="描述你想補的地點或氛圍…"
            className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading || !prompt.trim()}
            onClick={() => void runPlan()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            產生建議
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : suggestions.length > 0 ? (
            <ul className="space-y-2 pb-4">
              {suggestions.map((rec) => (
                <li
                  key={`${rec.googlePlaceId ?? rec.name}-${rec.address}`}
                  className="rounded-2xl border border-border bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{rec.name}</p>
                      {rec.address ? (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {rec.address}
                        </p>
                      ) : null}
                      {rec.reason ? (
                        <p className="mt-1 text-xs text-foreground/70">{rec.reason}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAdd(rec)}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium",
                      )}
                    >
                      <Plus className="h-3 w-3" />
                      加入
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              輸入需求後按「產生建議」
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
