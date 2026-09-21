import { LOCALIZED_ACTION_GRID, LOCALIZED_ACTION_BUTTON } from "@/lib/localized-action-layout";
import { affiliateDisplayLabel } from "@/lib/native-qa-display";
import { useI18n } from "@/hooks/use-i18n";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AffiliateLinkOffer } from "@/lib/affiliate/affiliate-types";
import { openAffiliateUrl } from "@/lib/affiliate/affiliate-links";
import { cn } from "@/lib/utils";
import { recordAnalyticsEvent } from "@/lib/analytics/record";

type SectionKind = "hotel" | "flight" | "ticket" | "package";

const SECTION_EMOJI = { hotel: "🏨", flight: "✈️", package: "🧳", ticket: "🎟️" };

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
  const { t: uiT, locale } = useI18n();

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

  const meta = { emoji: SECTION_EMOJI[kind], title: uiT(`nativeQa.${kind}`), subtitle: kind === "ticket" ? undefined : uiT(`nativeQa.${kind}Subtitle`, { brand: "Trip.com" }) };
  const isTripBookingSection = surface === "itinerary" && (kind === "flight" || kind === "hotel");
  const hidesInlineAffiliateDisclosure = kind === "ticket" || isTripBookingSection;

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
      {meta.subtitle && !compact && !isTripBookingSection ? (
        <p className="mt-1 text-xs text-muted-foreground">{meta.subtitle}</p>
      ) : null}
      {!hidesInlineAffiliateDisclosure ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {uiT("productionUi.p3a6936a307")}
        </p>
      ) : null}
      <div
        data-affiliate-layout={kind === "ticket" ? "provider-search-grid" : "provider-row"}
        className={cn(
          LOCALIZED_ACTION_GRID,
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
              className={cn(LOCALIZED_ACTION_BUTTON, "transition active:scale-[0.98] disabled:opacity-60") }
            >
              <span className="min-w-0 text-center whitespace-normal">
                {affiliateDisplayLabel(offer, locale)}
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
