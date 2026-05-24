export type AffiliatePartnerId =
  | "booking"
  | "agoda"
  | "klook"
  | "kkday"
  | "skyscanner"
  | "expedia"
  | "airbnb"
  | "uber"
  | "google_places";

export type AffiliateOfferType = "hotel" | "flight" | "activity" | "transport" | "place";

export type AffiliateOffer = {
  id: string;
  partnerId: AffiliatePartnerId;
  type: AffiliateOfferType;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  priceLabel?: string;
  outboundUrl: string;
  placeId?: string;
  metadata?: Record<string, string>;
};

export type AffiliateClickContext = {
  offerId: string;
  partnerId: AffiliatePartnerId;
  source: "chat" | "map" | "itinerary" | "home";
  userId?: string;
};

export type AffiliateProvider = {
  id: AffiliatePartnerId;
  displayName: string;
  buildOutboundUrl(params: Record<string, string>): string;
  isEnabled(): boolean;
};
