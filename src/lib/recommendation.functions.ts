import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import { buildPlaceIntroFromFacts } from "@/lib/recommendation/place-intro";
import type { PlaceIntroPayload } from "@/lib/recommendation/types";
import { fetchPlaceDetailsForIntro } from "@/lib/places.functions";
import { getServerCachedPlaceDetailsIntro } from "@/lib/places-details-server-cache";

const Input = z.object({
  placeId: z.string().min(1),
  reason: z.string().max(500).optional(),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const getPlaceIntro = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }): Promise<{ intro: PlaceIntroPayload | null; error: string | null }> => {
    try {
      const locale = coerceLocale(data.locale);
      const details = await getServerCachedPlaceDetailsIntro(data.placeId, locale, () =>
        fetchPlaceDetailsForIntro(data.placeId, locale),
      );
      if (!details) {
        return { intro: null, error: "place_not_found" };
      }
      const intro = buildPlaceIntroFromFacts({
        place: details.place,
        reason: data.reason,
        locale,
        editorialSummary: details.editorialSummary,
        reviewSnippets: details.reviewSnippets,
      });
      return { intro, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "intro failed";
      console.error("[Roamie PlaceIntro]", msg);
      return { intro: null, error: msg };
    }
  });
