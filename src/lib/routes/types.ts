export type LegDurationEstimate = {
  walk?: number;
  drive?: number;
  transit?: number;
  distanceMeters: number;
};

export type RoutesTravelMode = "WALK" | "DRIVE" | "TRANSIT" | "BICYCLE" | "TWO_WHEELER";

export type RouteResult = {
  durationSeconds: number;
  durationMinutes: number;
  distanceMeters: number;
  travelMode: RoutesTravelMode;
};
