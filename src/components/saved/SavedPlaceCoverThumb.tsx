import {
  resolveSavedPlaceGooglePlaceId,
  resolveSavedPlacePhotoResource,
} from "@/lib/saved-place-utils";
import { readPlaceRuntimeCache } from "@/lib/place-runtime-cache";
import { PlaceImage } from "@/components/media/PlaceImage";
import type { SavedPlace } from "@/lib/places-storage";

type Props = {
  place: SavedPlace;
  className?: string;
  alt?: string;
};

export function SavedPlaceCoverThumb({ place, className, alt }: Props) {
  const placeId = resolveSavedPlaceGooglePlaceId(place);
  const cached = placeId ? readPlaceRuntimeCache(placeId) : null;
  const photoName = cached?.photoName ?? resolveSavedPlacePhotoResource(place);
  const initialUrl =
    cached?.coverImageUrl ?? (!photoName ? place.cover_image || place.image_url : null);

  return (
    <PlaceImage
      initialUrl={initialUrl}
      placeId={placeId}
      name={place.name}
      photoName={photoName}
      primaryType={place.category}
      category={place.category ?? undefined}
      photoWidth={256}
      alt={alt ?? place.name}
      className={className}
      imgClassName="h-full w-full object-cover"
      lazy
    />
  );
}
