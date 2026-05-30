import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import {
  AffiliateService,
  type PlaceExperienceAffiliateLink,
} from "@/services/affiliate/affiliate-service";
import type { AffiliatePlaceTypeInput } from "@/services/affiliate/affiliate-place-intent";
import { affiliateIntentFromPlaceInput } from "@/services/affiliate/affiliate-place-intent";
import type { AffiliateClickContext } from "@/services/affiliate/types";
import { cn } from "@/lib/utils";

type Props = {
  placeName: string;
  source: AffiliateClickContext["source"];
  placeTypeHints?: AffiliatePlaceTypeInput;
  className?: string;
  compact?: boolean;
  /** 點擊時阻止事件冒泡（卡片可點場景） */
  stopPropagation?: boolean;
};

export function PlaceAffiliateLinks({
  placeName,
  source,
  placeTypeHints,
  className,
  compact,
  stopPropagation = true,
}: Props) {
  const typeInput = useMemo(
    () => ({ placeName, ...placeTypeHints }),
    [placeName, placeTypeHints],
  );
  const { label: groupLabel } = useMemo(
    () => affiliateIntentFromPlaceInput(typeInput),
    [typeInput],
  );
  const links = useMemo(
    () => AffiliateService.getPlaceExperienceLinks(placeName, typeInput),
    [placeName, typeInput],
  );

  if (!links.length) return null;

  const handleClick = (
    e: React.MouseEvent,
    link: PlaceExperienceAffiliateLink,
  ) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    AffiliateService.openExperienceLink(link, { source, placeName });
  };

  const btnClass = compact
    ? "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-foreground/90 active:scale-[0.98]"
    : "inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground/90 active:scale-[0.98]";

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      role="group"
      aria-label={groupLabel}
    >
      {links.map((link) => (
        <button
          key={link.platform}
          type="button"
          className={btnClass}
          title={`${link.label}（${link.platform === "klook" ? "Klook" : "KKday"}）`}
          aria-label={`${link.label}，${link.platform === "klook" ? "Klook" : "KKday"}`}
          onClick={(e) => handleClick(e, link)}
        >
          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
          {link.label}
        </button>
      ))}
    </div>
  );
}
