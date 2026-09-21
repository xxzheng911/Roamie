import { recommendationDisplayForLocale } from "@/lib/recommendation-display-locale";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles, MessageCircle } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { RoamieResponseView } from "@/components/RoamieResponseView";
import { getRecommendation, type StoredRecommendation } from "@/lib/recommendation-storage";
import { isRoamiePayloadV2, type RoamieRecommendationItem } from "@/lib/ai/types";
import { listPlaces, toggleSavePlace } from "@/lib/places-storage";
import { buildNewSavedPlaceInput } from "@/lib/saved-place-utils";
import { buildClientContextBundle } from "@/lib/fetch-context";
import { getWeather } from "@/lib/weather.functions";
import { getPreferences } from "@/lib/preferences-storage";
import {
  saveRecPagePicks,
  loadRecPagePicks,
  saveChatSession,
  createEmptySession,
} from "@/lib/chat-session";
import { prepareMoodFlowSession } from "@/lib/mood-chat-handoff";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromRecommendation } from "@/lib/trip/trip-place-input";
import { openRecommendationOnMap } from "@/lib/recommendation-place-handoff";
import { useI18n } from "@/hooks/use-i18n";

type RecSearch = { id?: string };

export const Route = createFileRoute("/_app/recommendations")({
  validateSearch: (s: Record<string, unknown>): RecSearch => ({
    id: typeof s.id === "string" ? s.id : undefined,
  }),
  component: RecommendationsPage,
});

function RecommendationsPage() {
  const { t: uiT } = useI18n();

  const { t, locale } = useI18n();
  const { openAddToTrip } = useAddToTrip();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const fetchWeather = useServerFn(getWeather);
  const [storedRecord, setRecord] = useState<StoredRecommendation | null>(null);
  const record = storedRecord ? recommendationDisplayForLocale(storedRecord, locale) : null;
  const [loading, setLoading] = useState(!!id);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const [pickedNames, setPickedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    listPlaces()
      .then((p) => setSavedNames(new Set(p.map((x) => x.name))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getRecommendation(id)
      .then((data) => {
        if (!cancelled) {
          setRecord(data);
          const stored = loadRecPagePicks(id);
          if (stored.length) setPickedNames(new Set(stored));
        }
      })
      .catch(() => toast.error(uiT("productionUi.p66610fd11f")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uiT, id]);

  const data = record?.payload && isRoamiePayloadV2(record.payload) ? record.payload : null;

  const handleOpenPlaceDetail = useCallback(
    (rec: RoamieRecommendationItem) => {
      if (!rec.googlePlaceId?.trim()) {
        toast.message(uiT("productionUi.pefb7c5f5c4"));
        return;
      }
      if (rec.lat == null || rec.lng == null) {
        toast.message(uiT("productionUi.pc631c41bc7"));
        return;
      }
      const snapshot = openRecommendationOnMap(rec);
      if (!snapshot) {
        toast.message(uiT("productionUi.pefb7c5f5c4"));
        return;
      }
      navigate({ to: "/map" });
    },
    [uiT, navigate],
  );

  const handleTogglePick = useCallback(
    (rec: RoamieRecommendationItem) => {
      if (!id) return;
      setPickedNames((prev) => {
        const next = new Set(prev);
        if (next.has(rec.name)) next.delete(rec.name);
        else next.add(rec.name);
        saveRecPagePicks(id, [...next]);
        return next;
      });
    },
    [id],
  );

  const handleContinueInChat = async () => {
    if (!record || !data) return;
    if (!data.recommendations?.length) {
      toast.message(uiT("productionUi.p6e555512c7"));
      navigate({ to: "/chat" });
      return;
    }
    try {
      const [bundle, prefs] = await Promise.all([
        buildClientContextBundle(fetchWeather),
        getPreferences(),
      ]);

      const session = prepareMoodFlowSession({
        record,
        payload: data,
        bundle,
        preferences: prefs,
        existing: createEmptySession(),
      });
      saveChatSession(session);
      navigate({
        to: "/chat",
        search: { from: "mood", recommendationId: record.id, fromMoodFlow: "1" },
      });
    } catch (e) {
      console.error("[recommendations] chat handoff failed", e);
      toast.error(uiT("productionUi.pc7fbc3beff"));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 px-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="font-display text-lg">{uiT("productionUi.p091e209a6a")}</p>
        <p className="text-sm text-muted-foreground">{uiT("productionUi.p1b973b5676")}</p>
      </div>
    );
  }

  if (!record || !data) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm text-muted-foreground">{uiT("productionUi.pb319943c13")}</p>
        <Link
          to="/"
          className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
        >
          {uiT("productionUi.pd75d02a93c")}
        </Link>
      </div>
    );
  }

  const handleSavePlace = async (rec: RoamieRecommendationItem) => {
    setSavingName(rec.name);
    try {
      const { saved } = await toggleSavePlace(
        buildNewSavedPlaceInput({
          name: rec.name,
          category: rec.type,
          address: rec.address || null,
          lat: rec.lat ?? null,
          lng: rec.lng ?? null,
          notes: rec.reason,
          mood_tag: data.moodTag,
          placeId: rec.googlePlaceId,
          googlePlaceId: rec.googlePlaceId,
          photoName: rec.photoName,
          rating: rec.rating,
          userRatingCount: rec.userRatingCount,
          businessStatus: rec.businessStatus,
        }),
      );
      setSavedNames((prev) => {
        const next = new Set(prev);
        if (saved) next.add(rec.name);
        else next.delete(rec.name);
        return next;
      });
      toast.success(saved ? uiT("productionUi.p471dd4d7f8") : uiT("productionUi.p7fa7b63b0e"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : uiT("productionUi.p59ede0ba72"));
    } finally {
      setSavingName(null);
    }
  };

  const pickCount = pickedNames.size;

  return (
    <div className="pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <BackButton preferFallback fallback={{ to: "/" }} />
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-clay" />
          <h1 className="font-display text-lg leading-tight">{data.title || record.title}</h1>
        </div>
      </header>

      <div className="px-5 pt-5">
        <p className="mb-3 text-xs text-muted-foreground">{uiT("productionUi.p9057494540")}</p>
        <RoamieResponseView
          data={data}
          showItinerary={data.itinerary.length > 0}
          pickMode
          pickedPlaceNames={pickedNames}
          onTogglePick={handleTogglePick}
          onOpenPlaceDetail={handleOpenPlaceDetail}
          onSavePlace={handleSavePlace}
          onAddToTrip={(rec) => openAddToTrip(tripPlaceFromRecommendation(rec), "selection")}
          addToTripLabel={t("chat.addToTrip")}
          viewMapLabel={t("chat.viewMap")}
          savingPlaceName={savingName}
          savedPlaceNames={savedNames}
        />

        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleContinueInChat}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-center text-sm font-medium text-primary-foreground shadow-lift"
          >
            <MessageCircle className="h-4 w-4" />
            {pickCount > 0
              ? uiT("productionUi.continueSelected", { count: pickCount })
              : uiT("productionUi.pcb3f34e459")}
          </button>
          <Link
            to="/plan"
            className="block rounded-full border border-dashed border-border py-2.5 text-center text-xs text-muted-foreground"
          >
            {uiT("productionUi.p531267ef15")}
          </Link>
        </div>
      </div>
    </div>
  );
}
