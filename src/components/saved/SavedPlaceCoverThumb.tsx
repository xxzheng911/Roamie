import {
  resolveSavedPlaceGooglePlaceId,
  resolveSavedPlacePhotoResource,
} from "@/lib/saved-place-utils";
import { PlaceImage } from "@/components/media/PlaceImage";
import type { SavedPlace } from "@/lib/places-storage";

type Props = {
  place: SavedPlace;
  className?: string;
  alt?: string;
};

export function SavedPlaceCoverThumb({ place, className, alt }: Props) {
  const photoName = resolveSavedPlacePhotoResource(place);
  const placeId = resolveSavedPlaceGooglePlaceId(place);

  return (
    <PlaceImage
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
