import type { PlanTravelStyleCard } from "@/lib/i18n/plan-travel-styles";

type Props = {
  cards: PlanTravelStyleCard[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  suitableLabel: string;
};

export function PlanTravelStylePicker({
  cards,
  selectedIds,
  onToggle,
  disabled,
  suitableLabel,
}: Props) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {cards.map((card) => {
        const selected = selectedIds.includes(card.id);
        return (
          <button
            key={card.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(card.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card"
            }`}
          >
            <p className="text-sm font-medium">{card.label}</p>
            <p className={`mt-1 text-[11px] leading-relaxed ${selected ? "opacity-80" : "text-muted-foreground"}`}>
              {suitableLabel}：{card.suitableFor.join(" · ")}
            </p>
          </button>
        );
      })}
    </div>
  );
}
