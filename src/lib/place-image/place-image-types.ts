export type PlaceImageInput = {
  placeId?: string | null;
  name: string;
  photoName?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  categoryId?: string;
  category?: string;
  city?: string | null;
  country?: string | null;
  photoWidth?: number;
};

export type TripCoverInput = {
  destination?: string | null;
  title?: string | null;
  mood?: string | null;
  moodTag?: string | null;
  city?: string | null;
  country?: string | null;
  category?: string | null;
};
