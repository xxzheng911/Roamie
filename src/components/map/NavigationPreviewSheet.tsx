import { useI18n } from "@/hooks/use-i18n";
import { ChevronLeft, Loader2, MapPin, Navigation, User } from "lucide-react";
import { MotorcycleIcon } from "@/components/map/MotorcycleIcon";
import {
  TRAVEL_MODE_LABEL,
  type TravelModeEstimate,
  type TravelModeId,
} from "@/lib/estimate-travel-mode";
import { cn } from "@/lib/utils";

const TABS: { id: TravelModeId; label: string }[] = [
  { id: "walk", label: TRAVEL_MODE_LABEL.walk },
  { id: "motorcycle", label: TRAVEL_MODE_LABEL.motorcycle },
  { id: "drive", label: TRAVEL_MODE_LABEL.drive },
  { id: "transit", label: TRAVEL_MODE_LABEL.transit },
  { id: "taxi", label: TRAVEL_MODE_LABEL.taxi },
];

type Props = {
  placeName: string;
  originLabel?: string;
  modes: TravelModeEstimate[];
  selectedMode: TravelModeId | null;
  onSelectMode: (mode: TravelModeId) => void;
  loading: boolean;
  aiTip: string;
  onBack: () => void;
  onStartNavigation: () => void;
};

export function NavigationPreviewSheet({
  placeName,
  originLabel,
  modes,
  selectedMode,
  onSelectMode,
  loading,
  aiTip,
  onBack,
  onStartNavigation,
}: Props) {
  const { t } = useI18n();
  const active = modes.find((m) => m.id === selectedMode) ?? modes[0];

  return (
    <div className="flex flex-col pb-6" data-no-sheet-drag>
      <div className="space-y-3 px-5">
        <div className="rounded-2xl border border-border/80 bg-card/70 px-4 py-3">
          <div className="flex items-start gap-2 text-sm">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{t("uiCoverage.origin")}</p>
              <p className="font-medium">{originLabel ?? t("uiCoverage.myLocation")}</p>
            </div>
          </div>
          <div className="my-2 border-t border-dashed border-border/60" />
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
            <div>
              <p className="text-xs text-muted-foreground">{t("uiCoverage.destination")}</p>
              <p className="font-medium">{placeName}</p>
            </div>
          </div>
        </div>

        {aiTip && (
          <p className="rounded-2xl bg-clay/10 px-3.5 py-2.5 text-sm leading-relaxed text-foreground/85">
            {aiTip}
          </p>
        )}

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-no-sheet-drag
              onClick={() => onSelectMode(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm transition",
                selectedMode === tab.id
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "border border-border bg-card text-muted-foreground",
              )}
            >
              {tab.id === "motorcycle" && <MotorcycleIcon className="h-3.5 w-3.5" />}
              {t(`uiCoverage.${tab.id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-[120px] px-5">
        {loading && modes.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2
              aria-label={t("uiCoverage.transportLoading")}
              className="h-6 w-6 animate-spin text-muted-foreground"
            />
          </div>
        ) : (
          <div className="space-y-2">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectMode(m.id)}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3.5 text-left transition",
                  selectedMode === m.id
                    ? "border-clay/40 bg-card shadow-soft"
                    : "border-border/60 bg-card/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t(`uiCoverage.${m.id}`)}</span>
                  {m.recommended && (
                    <span className="rounded-full bg-clay/15 px-2 py-0.5 text-[10px] font-medium text-clay">
                      {t("uiCoverage.recommended")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-foreground">
                  {t("uiCoverage.minutes", { count: m.minutes })}
                  <span className="text-muted-foreground"> ・ {m.distanceLabel}</span>
                  {m.costLabel && <span className="text-muted-foreground"> ・ {m.costLabel}</span>}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.hint}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 px-5">
        <button
          type="button"
          onClick={onStartNavigation}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground shadow-soft"
        >
          <Navigation className="h-4 w-4" />
          {t("uiCoverage.navigate")}
          {active ? `・${t(`uiCoverage.${active.id}`)}` : ""}
        </button>
      </div>
    </div>
  );
}

export function NavigationPreviewSheetHeader({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-0">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-soft transition active:scale-95"
        aria-label={t("uiCoverage.backDetail")}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <p className="font-display text-lg leading-tight">{t("uiCoverage.goHere")}</p>
    </div>
  );
}
