import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import {
  resolveSavedPlaceCoverImage,
  resolveSavedPlaceCoverImageSync,
} from "@/lib/saved-place-utils";
import type { SavedPlace } from "@/lib/places-storage";

type Props = {
  place: SavedPlace;
  className?: string;
  alt?: string;
};

export function SavedPlaceCoverThumb({ place, className, alt }: Props) {
  const [src, setSrc] = useState(() => resolveSavedPlaceCoverImageSync(place, { photoWidth: 256 }));

  useEffect(() => {
    let cancelled = false;
    const sync = resolveSavedPlaceCoverImageSync(place, { photoWidth: 256 });
    setSrc(sync);

    void resolveSavedPlaceCoverImage(place, { photoWidth: 256 }).then((url) => {
      if (!cancelled && url) setSrc(url);
    });

    return () => {
      cancelled = true;
    };
  }, [place]);

  if (!src) {
    return (
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center bg-secondary">
          <MapPin className="h-5 w-5 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={src}
        alt={alt ?? place.name}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => {
          const fallback = resolveSavedPlaceCoverImageSync(place, { photoWidth: 256 });
          setSrc((current) => (current === fallback ? "" : fallback));
        }}
      />
    </div>
  );
}
