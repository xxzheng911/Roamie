/**
 * 規劃新行程表單（v2）
 * - 已移除：今天的心情、備註欄
 * - 保留：目的地、出發地、日期、旅伴、預算、交通、旅行風格
 */
import { Loader2, MapPin, Route as RouteIcon } from "lucide-react";
import { LocationSearchField } from "@/components/LocationSearchField";
import { RoamieDatePicker } from "@/components/pickers";
import { PlanTravelStylePicker } from "@/components/plan/PlanTravelStylePicker";
import type { PlanTravelStyleCard } from "@/lib/i18n/plan-travel-styles";
import type { TripLocation } from "@/lib/location/types";
import type { BudgetMode } from "@/lib/preferences-storage";
import type { PlanBudgetOption } from "@/lib/i18n/plan-form-options";
import type { RoamieRecommendationItem } from "@/lib/ai/types";

export type PlanTripFormProps = {
  t: (key: string, params?: Record<string, unknown>) => string;
  busy: boolean;
  sourceLoading: boolean;
  selectedPlaces: RoamieRecommendationItem[];
  destination: TripLocation | null;
  onDestinationChange: (v: TripLocation | null) => void;
  origin: TripLocation | null;
  onOriginChange: (v: TripLocation | null) => void;
  startDate: string;
  endDate: string;
  onDateRangeChange: (range: { start: string; end: string }) => void;
  tripDaysLabel?: string;
  travelers: number;
  travelersCustom: boolean;
  onTravelersQuick: (n: number) => void;
  onTravelersCustomToggle: () => void;
  onTravelersCustomChange: (n: number) => void;
  budgetOptions: PlanBudgetOption[];
  budgetMode: BudgetMode;
  onBudgetMode: (v: BudgetMode) => void;
  transportOptions: string[];
  transport: string;
  onTransportToggle: (label: string) => void;
  styleCards: PlanTravelStyleCard[];
  styleIds: string[];
  onToggleStyle: (id: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCreateTrip: () => void;
  /** 「讓 Roamie 幫我安排」生成中 */
  roamieArranging?: boolean;
  creatingTrip?: boolean;
  /** 全螢幕生成中：隱藏底部按鈕，避免與 overlay 重疊 */
  hideFooterActions?: boolean;
};

const TRAVELER_QUICK = [1, 2, 3, 4] as const;

export function PlanTripForm({
  t,
  busy,
  sourceLoading,
  selectedPlaces,
  destination,
  onDestinationChange,
  origin,
  onOriginChange,
  startDate,
  endDate,
  onDateRangeChange,
  tripDaysLabel,
  travelers,
  travelersCustom,
  onTravelersQuick,
  onTravelersCustomToggle,
  onTravelersCustomChange,
  budgetOptions,
  budgetMode,
  onBudgetMode,
  transportOptions,
  transport,
  onTransportToggle,
  styleCards,
  styleIds,
  onToggleStyle,
  onSubmit,
  onCreateTrip,
  roamieArranging = false,
  creatingTrip = false,
  hideFooterActions = false,
}: PlanTripFormProps) {
  const footerDisabled = busy || sourceLoading || roamieArranging || creatingTrip;
  return (
    <form onSubmit={onSubmit} className="space-y-6 px-5 pt-5 pb-8" data-plan-ui-version="2">
      {sourceLoading ? (
        <div className="flex items-center gap-2 rounded-2xl bg-secondary/80 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("plan.loadingPlaces")}
        </div>
      ) : selectedPlaces.length > 0 ? (
        <div className="rounded-2xl border border-border bg-secondary/50 px-4 py-3">
          <p className="text-sm font-medium">
            {t("plan.importedPlaces", { count: selectedPlaces.length })}
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

      <LocationSearchField
        fieldRole="destination"
        searchMode="geographic"
        label={t("plan.destination")}
        required
        value={destination}
        onChange={onDestinationChange}
        placeholder={t("plan.destinationPlaceholder")}
        disabled={busy}
      />

      <LocationSearchField
        fieldRole="start"
        searchMode="place"
        label={t("plan.origin")}
        value={origin}
        onChange={onOriginChange}
        placeholder={t("plan.originPlaceholder")}
        disabled={busy}
      />

      <section>
        <label className="text-sm font-medium">{t("plan.travelDates")}</label>
        <div className="mt-2">
          <RoamieDatePicker
            mode="range"
            displayWithYear
            value={{ start: startDate, end: endDate }}
            onChange={onDateRangeChange}
            placeholder={t("plan.datePlaceholder")}
            disabled={busy}
          />
        </div>
      </section>
      {tripDaysLabel ? (
        <p className="text-xs text-muted-foreground">{tripDaysLabel}</p>
      ) : null}

      <section>
        <label className="text-sm font-medium">{t("plan.travelers")}</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRAVELER_QUICK.map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy}
              onClick={() => onTravelersQuick(n)}
              className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                !travelersCustom && travelers === n
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card"
              }`}
            >
              {n} 人
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={onTravelersCustomToggle}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
              travelersCustom
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card"
            }`}
          >
            {t("plan.travelersCustom")}
          </button>
        </div>
        {travelersCustom ? (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(travelers)}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "");
              if (!raw) {
                onTravelersCustomChange(0);
                return;
              }
              onTravelersCustomChange(Math.min(99, Number.parseInt(raw, 10)));
            }}
            placeholder="1–99"
            className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            disabled={busy}
          />
        ) : null}
      </section>

      <section>
        <label className="text-sm font-medium">{t("plan.budget")}</label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {budgetOptions.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => onBudgetMode(b.value)}
              disabled={busy}
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
        <label className="text-sm font-medium">{t("plan.transport")}</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {transportOptions.map((tr) => (
            <button
              key={tr}
              type="button"
              onClick={() => onTransportToggle(tr)}
              disabled={busy}
              className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                transport === tr
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card"
              }`}
            >
              {tr}
            </button>
          ))}
        </div>
      </section>

      <section>
        <label className="text-sm font-medium">{t("plan.styles")}</label>
        <PlanTravelStylePicker
          cards={styleCards}
          selectedIds={styleIds}
          onToggle={onToggleStyle}
          disabled={busy}
          suitableLabel={t("plan.styleSuitableFor")}
        />
      </section>

      {!hideFooterActions ? (
        <div className="space-y-3 pt-1">
          <button
            type="button"
            disabled={footerDisabled}
            aria-busy={creatingTrip}
            onClick={onCreateTrip}
            className="flex w-full items-center justify-center rounded-full border border-border bg-card py-4 text-[15px] font-medium text-foreground shadow-sm transition disabled:opacity-60"
          >
            {creatingTrip ? (
              <span
                key="create-loading"
                className="inline-flex items-center justify-center gap-2.5 whitespace-nowrap"
              >
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                <span>{t("plan.creatingTrip")}</span>
              </span>
            ) : (
              <span key="create-idle" className="whitespace-nowrap">
                {t("plan.createTrip")}
              </span>
            )}
          </button>

          <button
            type="submit"
            disabled={footerDisabled}
            aria-busy={roamieArranging}
            aria-live="polite"
            className="relative flex w-full min-h-[3.25rem] items-center justify-center rounded-full bg-primary px-4 py-4 text-[15px] font-medium text-primary-foreground shadow-lift transition disabled:opacity-60"
          >
            <span
              key={roamieArranging ? "roamie-arranging" : "roamie-idle"}
              className="inline-flex max-w-full items-center justify-center gap-2.5 whitespace-nowrap"
            >
              {roamieArranging ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  <span>{t("plan.arranging")}</span>
                </>
              ) : (
                <>
                  <RouteIcon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{t("plan.submit")}</span>
                </>
              )}
            </span>
          </button>
        </div>
      ) : null}
    </form>
  );
}
