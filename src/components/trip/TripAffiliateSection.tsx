import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AffiliateLinkOffer } from "@/lib/affiliate/affiliate-types";
import { openAffiliateUrl } from "@/lib/affiliate/affiliate-links";
import { cn } from "@/lib/utils";
import { recordAnalyticsEvent } from "@/lib/analytics/record";

type SectionKind = "hotel" | "flight" | "ticket" | "package";

const SECTION_META: Record<SectionKind, { emoji: string; title: string; subtitle?: string }> = {
  hotel: { emoji: "🏨", title: "住宿推薦", subtitle: "到第三方平台自行選擇住宿" },
  flight: { emoji: "✈️", title: "機票推薦", subtitle: "到 Trip.com 搜尋合適航班" },
  package: { emoji: "🧳", title: "套裝行程", subtitle: "到 Trip.com 查看套裝行程" },
  ticket: { emoji: "🎟️", title: "查看票券優惠" },
};

type Props = {
  kind: SectionKind;
  offers: AffiliateLinkOffer[];
  className?: string;
  /** 地點卡片下方：精簡樣式 */
  compact?: boolean;
  surface?: "itinerary" | "detail";
  placeHash?: string;
  eligibilityResolved?: boolean;
  eligible?: boolean;
  renderedCtaMode?: "exact_product" | "ticket_search" | "experience_search" | "hidden";
};

const OPEN_RESET_MS = 800;

export function TripAffiliateSection({
  kind,
  offers,
  className,
  compact,
  surface,
  placeHash,
  eligibilityResolved = true,
  eligible,
  renderedCtaMode,
}: Props) {
  const visible = useMemo(() => offers.filter((o) => o.enabled && o.url), [offers]);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const impressionId = useRef(crypto.randomUUID());
  useEffect(() => {
    for (const offer of visible)
      recordAnalyticsEvent({
        eventId: `${impressionId.current}:${offer.provider}:${offer.kind}`,
        eventName: "affiliate_cta_impression",
        provider: offer.provider === "trip" ? "tripcom" : offer.provider,
        surface: "itinerary",
      });
  }, [visible]);
  useEffect(() => {
    if (!surface || !placeHash) return;
    console.info("[AFFILIATE_RENDER_DECISION]", {
      placeHash,
      surface,
      eligibilityResolved,
      eligible: eligible ?? visible.length > 0,
      renderedCtaMode: renderedCtaMode ?? (visible.length > 0 ? "exact_product" : "hidden"),
      offerCount: visible.length,
      sectionInvoked: true,
      sectionRendered: visible.length > 0,
      hiddenReason: visible.length > 0 ? "none" : "no_offers",
    });
  }, [eligible, eligibilityResolved, placeHash, renderedCtaMode, surface, visible.length]);
  if (visible.length === 0) return null;

  const meta = SECTION_META[kind];

  return (
    <section
      data-no-sheet-drag
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
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        透過部分連結完成預訂時，Roamie可能獲得合作佣金，不影響你的價格。
      </p>
      <div
        data-affiliate-layout={kind === "ticket" ? "provider-search-grid" : "provider-row"}
        className={cn(
          kind === "ticket" ? "grid w-full gap-2" : "flex flex-wrap gap-2",
          kind === "ticket" && (visible.length > 1 ? "grid-cols-2" : "grid-cols-1"),
          compact ? "mt-2" : "mt-3",
        )}
      >
        {visible.map((offer) => {
          const offerKey = `${offer.provider}-${offer.kind}`;
          const isOpening = openingKey === offerKey;
          return (
            <button
              key={offerKey}
              type="button"
              data-no-sheet-drag
              disabled={isOpening}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (openingKey) return;
                setOpeningKey(offerKey);
                void openAffiliateUrl(offer.url, {
                  provider: offer.provider === "trip" ? "tripcom" : offer.provider,
                  type: offer.kind,
                  destination: offer.destination,
                  placeName: offer.placeName,
                  keyword: offer.keyword,
                  checkIn: offer.checkIn,
                  checkOut: offer.checkOut,
                  adults: offer.adults,
                  surface: "itinerary",
                  eventId: crypto.randomUUID(),
                }).finally(() => {
                  window.setTimeout(() => setOpeningKey(null), OPEN_RESET_MS);
                });
              }}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background font-medium transition active:scale-[0.98] disabled:opacity-60",
                kind === "ticket" && "w-full px-2 text-xs",
                kind !== "ticket" && (compact ? "px-3" : "px-4"),
                compact ? "py-1.5 text-xs" : "py-2 text-sm",
              )}
            >
              <span
                className={cn(
                  kind === "ticket" && "min-w-0 text-center leading-tight whitespace-normal",
                )}
              >
                {offer.label}
              </span>
              <ExternalLink
                className={cn("shrink-0 opacity-60", compact ? "h-3 w-3" : "h-3.5 w-3.5")}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
