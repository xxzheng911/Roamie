import { verifiedDestinationDisplay } from "@/lib/ai/destination-display-metadata";
import type { TripLocation } from "@/lib/location/types";
import { resolveCandidateDisplay, findReviewedDisplayCandidate } from "@/lib/ai/destination-localization";
import { localizedCountryReference } from "@/lib/ai/destination-country-normalize";
import { displayDestinationForCopy } from "@/lib/ai/destination-locale-aliases";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import type { AffiliateLinkOffer } from "@/lib/affiliate/affiliate-types";
import { resolvePlaceIdentity } from "@/lib/place-identity";
import type { PlaceResult } from "@/lib/place-result";

const brands = { trip: "Trip.com", agoda: "Agoda", booking: "Booking.com", klook: "Klook", kkday: "KKday" };
export function affiliateDisplayLabel(offer: AffiliateLinkOffer, locale: Locale): string {
  const brand = brands[offer.provider];
  if (offer.searchIntent === "related_experiences") {
    return translate(locale, "nativeQa.relatedExperienceSearch", { brand });
  }
  if (offer.kind === "activity_ticket") {
    for (const key of ["ticketSearch", "experienceSearch", "transportSearch"]) {
      if (offer.label === translate("zh-TW", `nativeQa.${key}`, { brand })) {
        return translate(locale, `nativeQa.${key}`, { brand });
      }
    }
    return brand;
  }
  return translate(locale, `nativeQa.${offer.kind}Product`, { brand });
}
export function itineraryTransportDisplay(value: string, locale: Locale): string {
  for (const mode of ["walk", "transit", "drive", "taxi", "bike", "scooter"]) {
    if (value === mode || value === translate("zh-TW", `nativeQa.${mode}`)) return translate(locale, `nativeQa.${mode}`);
  }
  return value;
}
export function placeCategoryDisplay(place: PlaceResult, locale: Locale): string {
  return translate(locale, `nativeQa.category_${resolvePlaceIdentity(place)}`);
}

/** Only Roamie-owned legacy templates are projected; external opening-hours text is retained. */
export function openingCopyDisplay(value: string | undefined, locale: Locale): string | undefined {
  if (!value) return value;
  for (const key of ["place.open", "place.closed", "place.hoursUnknown", "nativeQa.closingSoon", "nativeQa.todayOpen", "nativeQa.closedToday", "nativeQa.closedNow", "nativeQa.closingNote", "nativeQa.todayHours", "nativeQa.opensToday", "nativeQa.opensTomorrow", "nativeQa.opensDate"]) {
    const template = translate("zh-TW", key);
    const names = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    const pattern = template.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+)");
    const match = value.match(new RegExp(`^${pattern}$`));
    if (match) return translate(locale, key, Object.fromEntries(names.map((name, index) => [name, openingCopyDisplay(match[index + 1], locale) ?? ""])));
  }
  return value;
}

/** Display projection only; never fed back into resolver or saved destination. */
export function itineraryDestinationDisplay(value: string, locale: Locale, location?: TripLocation | null): string {
  const trusted = verifiedDestinationDisplay(location);
  const parts = location?.country?.trim() && (location.city?.trim() || location.region?.trim())
    ? [...new Set([location.country.trim(), trusted?.name ?? (location.city || location.region)!.trim()])]
    : value.split(/\s*[·・]\s*/).map(part => part.trim()).filter(Boolean);
  const country = parts.map(part => localizedCountryReference(part)?.code).find(Boolean);
  return parts.map(part => {
    if (trusted && (part === trusted.name || part === location?.city || part === location?.region)) {
      return resolveCandidateDisplay(trusted, locale).name;
    }
    // Reuse reviewed display bindings only inside an explicit matching country.
    const candidate = findReviewedDisplayCandidate(part, country);
    if (candidate) {
      // Preserve the existing title/header preference for canonical Traditional Chinese.
      if (locale === "zh-TW") return candidate.name;
      return resolveCandidateDisplay(candidate, locale).name;
    }
    return displayDestinationForCopy(part, undefined, locale);
  }).join(" · ");
}

/** New system prose only; never relabel previously generated or user-authored text. */
export function generatedTripCopy(destination: string, days: number, count: number, locale: Locale) {
  return {
    generatedLocale: locale,
    title: translate(locale, "destinationEditorial.generated_trip_title", { destination: itineraryDestinationDisplay(destination, locale), days }),
    summary: translate(locale, "nativeQa.generatedStopsSummary", { count, days }),
  };
}
