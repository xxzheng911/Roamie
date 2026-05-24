import { Shirt } from "lucide-react";
import type { DailyPrepAdvice } from "@/lib/recommendation/types";

type HomeOutfitCardProps = {
  advice: DailyPrepAdvice | null;
  labels: {
    title: string;
    empty: string;
  };
};

export function HomeOutfitCard({ advice, labels }: HomeOutfitCardProps) {
  if (!advice) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-border/80 bg-secondary/50 px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shirt className="h-4 w-4 opacity-70" />
          <span>{labels.title}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{labels.empty}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-3xl bg-card p-5 shadow-soft">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Shirt className="h-4 w-4 text-clay" />
        <span>{labels.title}</span>
      </div>
      <h3 className="mt-2 font-display text-lg leading-snug">{advice.headline}</h3>
      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
        {advice.bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="text-clay" aria-hidden>
              ·
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
