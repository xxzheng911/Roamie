import { ExternalLink } from "lucide-react";
import type { AffiliateLinkOffer } from "@/lib/affiliate/affiliate-types";
import { openAffiliateUrl } from "@/lib/affiliate/affiliate-links";
import { cn } from "@/lib/utils";

type SectionKind = "hotel" | "flight" | "ticket";

const SECTION_META: Record<
  SectionKind,
  { emoji: string; title: string; subtitle?: string }
> = {
  hotel: { emoji: "🏨", title: "住宿推薦", subtitle: "到第三方平台自行選擇住宿" },
  flight: { emoji: "✈️", title: "機票推薦", subtitle: "到 Trip.com 查看機票選項" },
  ticket: { emoji: "🎟️", title: "查看票券優惠" },
};

type Props = {
  kind: SectionKind;
  offers: AffiliateLinkOffer[];
  className?: string;
  /** 地點卡片下方：精簡樣式 */
  compact?: boolean;
};

export function TripAffiliateSection({ kind, offers, className, compact }: Props) {
  const visible = offers.filter((o) => o.enabled && o.url);
  if (visible.length === 0) return null;

  const meta = SECTION_META[kind];

  return (
    <section
      className={cn(
        compact
          ? "mt-3 rounded-2xl border border-border/80 bg-secondary/30 px-3 py-3"
          : "rounded-2xl border border-border bg-card/80 px-4 py-4",
        className,
      )}
    >
      <p className={cn("font-medium text-foreground", compact ? "text-xs" : "text-sm")}>
        <span aria-hidden>{meta.emoji}</span> {meta.title}
      </p>
      {meta.subtitle && !compact ? (
        <p className="mt-1 text-xs text-muted-foreground">{meta.subtitle}</p>
      ) : null}
      <div className={cn("flex flex-wrap gap-2", compact ? "mt-2" : "mt-3")}>
        {visible.map((offer) => (
          <button
            key={`${offer.provider}-${offer.kind}`}
            type="button"
            onClick={() => void openAffiliateUrl(offer.url)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-border bg-background font-medium transition active:scale-[0.98]",
              compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
            )}
          >
            {offer.label}
            <ExternalLink className={compact ? "h-3 w-3 opacity-60" : "h-3.5 w-3.5 opacity-60"} />
          </button>
        ))}
      </div>
    </section>
  );
}
