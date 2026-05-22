import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Sparkles, Loader2, MapPin } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { generateItinerary } from "@/lib/itinerary.functions";
import { saveItinerary } from "@/lib/itinerary-storage";
import { buildClientContextBundle, daysBetweenDates } from "@/lib/fetch-context";
import { getWeather } from "@/lib/weather.functions";
import {
  getPreferences,
  savePreferences,
  resolveBudgetMode,
  type BudgetMode,
} from "@/lib/preferences-storage";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import {
  inferDestinationFromPlaces,
  loadItinerarySource,
  placesToInterestsText,
  type ItinerarySourceContext,
} from "@/lib/itinerary-source";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { getUserProfile } from "@/lib/profile-storage";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";

type PlanSearch = {
  mood?: string;
  destination?: string;
  recommendationId?: string;
  from?: string;
};

export const Route = createFileRoute("/_app/plan")({
  validateSearch: (s: Record<string, unknown>): PlanSearch => ({
    mood: typeof s.mood === "string" ? s.mood : undefined,
    destination: typeof s.destination === "string" ? s.destination : undefined,
    recommendationId: typeof s.recommendationId === "string" ? s.recommendationId : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
  }),
  component: PlanPage,
});

const budgetOptions = [
  { value: "budget" as BudgetMode, label: "小資", hint: "平價、在地" },
  { value: "standard" as BudgetMode, label: "一般", hint: "舒服自在" },
  { value: "quality" as BudgetMode, label: "品質感", hint: "有質感但不浮誇" },
  { value: "luxury" as BudgetMode, label: "奢華", hint: "好好享受" },
];

const transportOptions = ["大眾運輸", "步行為主", "租車自駕", "計程車/共乘", "單車"];

const styleOptions = ["慢旅行", "在地美食", "文青咖啡", "自然戶外", "夜景散步", "藝術展覽"];
const moodOptions = ["想放空", "一個人", "下雨天", "深夜散步", "找咖啡", "看海"];

function PlanPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const generate = useServerFn(generateItinerary);
  const fetchWeather = useServerFn(getWeather);

  const [sourceCtx, setSourceCtx] = useState<ItinerarySourceContext | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [destination, setDestination] = useState(search.destination ?? "");
  const [days, setDays] = useState(2);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>("standard");
  const [styles, setStyles] = useState<string[]>([]);
  const [mood, setMood] = useState<string>(search.mood ?? "");
  const [interests, setInterests] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [origin, setOrigin] = useState("");
  const [travelers, setTravelers] = useState(1);
  const [transport, setTransport] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await loadItinerarySource(search.recommendationId);
        if (cancelled) return;
        setSourceCtx(ctx);

        if (ctx?.selectedPlaces?.length) {
          const inferred = inferDestinationFromPlaces(ctx.selectedPlaces, ctx.location);
          if (inferred) setDestination((d) => d || inferred);
          setInterests((prev) => prev || placesToInterestsText(ctx.selectedPlaces));
          if (ctx.moodTag) setMood((m) => m || ctx.moodTag!);
        }
        if (search.mood) setMood((m) => m || search.mood!);
        if (search.destination) setDestination((d) => d || search.destination!);
      } catch (e) {
        console.error("[plan] load source failed", e);
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search.recommendationId, search.mood, search.destination]);

  useEffect(() => {
    getPreferences().then((p) => setBudgetMode(resolveBudgetMode(p)));
  }, []);

  const toggle = (list: string[], v: string, set: (l: string[]) => void) => {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  const selectedPlaces: RoamieRecommendationItem[] = sourceCtx?.selectedPlaces ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) {
      toast.error("請輸入目的地");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      toast.error("結束日期不能早於開始日期");
      return;
    }
    const tripDays = startDate && endDate ? daysBetweenDates(startDate, endDate) : days;

    setLoading(true);
    try {
      const [bundle, prefs, profile] = await Promise.all([
        buildClientContextBundle(fetchWeather),
        getPreferences(),
        getUserProfile(),
      ]);
      const fashionStyle = resolveFashionStyle({
        travelStyle: profile.travelStyle,
        interests: prefs.interests,
        style: styles.join("、"),
      });
      const effectiveBudgetMode = budgetMode;
      await savePreferences({ ...prefs, budgetMode: effectiveBudgetMode });
      const itineraryBudget = budgetModeToItineraryTier(effectiveBudgetMode);

      const mergedPlaces = selectedPlaces.length > 0 ? selectedPlaces : [];

      const interestsText = [
        interests.trim(),
        mergedPlaces.length ? `\n【Roamie 推薦地點】\n${placesToInterestsText(mergedPlaces)}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      console.info("[Roamie AI] plan submit", {
        destination: destination.trim(),
        days: tripDays,
        places: mergedPlaces.length,
        from: search.from,
      });

      const { itinerary } = await generate({
        data: {
          destination: destination.trim(),
          days: tripDays,
          budget: itineraryBudget,
          style: styles.join("、"),
          mood,
          interests: interestsText,
          startDate,
          endDate,
          origin: origin.trim(),
          travelers,
          transport: transport.trim(),
          selectedPlaces: mergedPlaces,
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: bundle.time,
          fashionStyle: fashionStyle ?? "",
        },
      });
      const saved = await saveItinerary(itinerary);
      toast.success("行程已生成！");
      navigate({ to: "/trip", search: { id: saved.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "發生未知錯誤";
      console.error("[Roamie AI] plan failed", err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <BackButton fallback={{ to: "/" }} />
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-clay" />
          <h1 className="font-display text-lg">規劃新行程</h1>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6 px-5 pt-5">
        {sourceLoading ? (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary/80 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            載入推薦地點…
          </div>
        ) : selectedPlaces.length > 0 ? (
          <div className="rounded-2xl border border-border bg-secondary/50 px-4 py-3">
            <p className="text-sm font-medium">
              已帶入 Roamie 推薦的 {selectedPlaces.length} 個地點
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {selectedPlaces.map((p) => (
                <li key={p.name} className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {p.name} · {p.type}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section>
          <label className="text-sm font-medium">目的地 *</label>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="例如：台北、京都、宜蘭"
            className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={loading}
          />
        </section>

        <section>
          <label className="text-sm font-medium">出發地（選填）</label>
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="例如：台北車站、你家附近"
            className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={loading}
          />
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">開始日期（選填）</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={loading}
            />
          </div>
          <div>
            <label className="text-sm font-medium">結束日期（選填）</label>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={loading}
            />
          </div>
        </section>
        {startDate && endDate && (
          <p className="text-xs text-muted-foreground">
            共 {daysBetweenDates(startDate, endDate)} 天（已依日期覆寫下方天數滑桿）
          </p>
        )}

        <section>
          <label className="text-sm font-medium">旅伴人數</label>
          <input
            type="number"
            min={1}
            max={12}
            value={travelers}
            onChange={(e) => setTravelers(Math.max(1, Number(e.target.value) || 1))}
            className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={loading}
          />
        </section>

        <section>
          <label className="text-sm font-medium">天數：{days} 天</label>
          <input
            type="range"
            min={1}
            max={7}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-3 w-full accent-primary"
            disabled={loading || !!(startDate && endDate)}
          />
        </section>

        <section>
          <label className="text-sm font-medium">預算</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {budgetOptions.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => setBudgetMode(b.value)}
                disabled={loading}
                className={`rounded-2xl border px-3 py-3 text-center transition ${
                  budgetMode === b.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card"
                }`}
              >
                <p className="text-sm font-medium">{b.label}</p>
                <p className="mt-0.5 text-[11px] opacity-70">{b.hint}</p>
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="text-sm font-medium">交通方式（選填）</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {transportOptions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTransport(transport === t ? "" : t)}
                disabled={loading}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                  transport === t
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="text-sm font-medium">旅遊風格（可多選）</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {styleOptions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(styles, s, setStyles)}
                disabled={loading}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                  styles.includes(s)
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="text-sm font-medium">今天的心情</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {moodOptions.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMood(mood === m ? "" : m)}
                disabled={loading}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                  mood === m
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="text-sm font-medium">其他想去的 / 備註（選填）</label>
          <textarea
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            rows={4}
            placeholder="Roamie 推薦地點會自動帶入；你也可以補充其他想去的…"
            className="mt-2 w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={loading}
          />
        </section>

        <button
          type="submit"
          disabled={loading || sourceLoading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-[15px] font-medium text-primary-foreground shadow-lift transition disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Roamie 正在幫你想…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              生成我的行程
            </>
          )}
        </button>
      </form>
    </div>
  );
}
