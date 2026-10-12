import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import { itineraryDestinationDisplay } from "@/lib/native-qa-display";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type { ConversationWorkspace } from "@/lib/conversation-workspace/types";

export function tripTitleDisplay(input: { title: string; custom?: boolean; destination?: string; days?: number; destinationLocation?: import("@/lib/location/types").TripLocation | null }, locale: Locale): string {
  if (input.custom === true) return input.title;
  if (input.custom !== false || !input.destination?.trim() || !Number.isInteger(input.days) || input.days! <= 0) {
    devVerboseInfo("[TRIP_TITLE_LOCALIZATION]", { fallback: true, reason: input.custom == null ? "unknown_title_authority" : "missing_structured_context" });
    return input.title;
  }
  return translate(locale, "destinationEditorial.generated_trip_title", {
    destination: itineraryDestinationDisplay(input.destination, locale, input.destinationLocation), days: input.days!,
  }).trim();
}

export function workspaceTitleDisplay(workspace: ConversationWorkspace | null, fallback: string, locale: Locale): string {
  if (!workspace) return tripTitleDisplay({title:fallback},locale);
  const context = workspace.planningSession?.travelContext;
  const city = context?.destinationCity || context?.destination || workspace.destination;
  const country = context?.destinationCountry;
  const destination = country && city && country !== city && !city.includes(" · ") ? `${country} · ${city}` : city;
  return tripTitleDisplay({ title: workspace.title || fallback, custom: workspace.titleCustom, destination, destinationLocation: workspace.planningSession?.tripDestination, days: context?.days ?? workspace.tripDays }, locale);
}
