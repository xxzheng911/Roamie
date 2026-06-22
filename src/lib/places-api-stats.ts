/** 實際 Google Places HTTP 計數（client + server 共用模組） */

export type PlacesScreen =
  | "home"
  | "explore"
  | "chat"
  | "ai_recommend"
  | "itinerary"
  | "plan"
  | "place_detail"
  | "unknown";

export type PlacesApiKind = "nearby" | "text" | "details" | "photo";

export type PlacesCallMeta = {
  caller: string;
  screen: PlacesScreen;
  category?: string;
  requestKey: string;
};

export type PlacesCountBucket = {
  nearby: number;
  text: number;
  details: number;
  photo: number;
};

export type PlacesStatsSnapshot = PlacesCountBucket & {
  nearbyCount: number;
  textCount: number;
  detailsCount: number;
  photoCount: number;
  byScreen: Record<PlacesScreen, PlacesCountBucket>;
  byCaller: Record<string, PlacesCountBucket & { total: number }>;
  byFunction: Record<string, PlacesCountBucket & { total: number }>;
  flows: Record<string, PlacesCountBucket & { total: number; at: string }>;
};

const EMPTY_BUCKET = (): PlacesCountBucket => ({
  nearby: 0,
  text: 0,
  details: 0,
  photo: 0,
});

const SCREENS: PlacesScreen[] = [
  "home",
  "explore",
  "chat",
  "ai_recommend",
  "itinerary",
  "plan",
  "place_detail",
  "unknown",
];

function emptyByScreen(): Record<PlacesScreen, PlacesCountBucket> {
  return Object.fromEntries(SCREENS.map((s) => [s, EMPTY_BUCKET()])) as Record<
    PlacesScreen,
    PlacesCountBucket
  >;
}

const globalCounts: PlacesCountBucket = EMPTY_BUCKET();
const byScreen = emptyByScreen();
const byCaller: PlacesStatsSnapshot["byCaller"] = {};
const byFunction: PlacesStatsSnapshot["byFunction"] = {};
const flows: PlacesStatsSnapshot["flows"] = {};
const recordedPhotoUrls = new Set<string>();

const clientContextStack: Array<Partial<PlacesCallMeta>> = [];

const DEFAULT_CONTEXT: Omit<PlacesCallMeta, "requestKey"> = {
  caller: "unknown",
  screen: "unknown",
};

export function pushPlacesCallContext(ctx: Partial<Omit<PlacesCallMeta, "requestKey">>): void {
  clientContextStack.push(ctx);
}

export function popPlacesCallContext(): void {
  clientContextStack.pop();
}

export async function withPlacesCallContext<T>(
  ctx: Partial<Omit<PlacesCallMeta, "requestKey">>,
  fn: () => Promise<T> | T,
): Promise<T> {
  pushPlacesCallContext(ctx);
  try {
    return await fn();
  } finally {
    popPlacesCallContext();
  }
}

export function getPlacesCallContext(): Omit<PlacesCallMeta, "requestKey"> {
  for (let i = clientContextStack.length - 1; i >= 0; i--) {
    const layer = clientContextStack[i]!;
    return {
      caller: layer.caller ?? DEFAULT_CONTEXT.caller,
      screen: layer.screen ?? DEFAULT_CONTEXT.screen,
      category: layer.category,
    };
  }
  return { ...DEFAULT_CONTEXT };
}

function kindToField(kind: PlacesApiKind): keyof PlacesCountBucket {
  return kind === "nearby"
    ? "nearby"
    : kind === "text"
      ? "text"
      : kind === "details"
        ? "details"
        : "photo";
}

function bumpBucket(bucket: PlacesCountBucket, kind: PlacesApiKind): void {
  bucket[kindToField(kind)] += 1;
}

function ensureCallerBucket(caller: string) {
  if (!byCaller[caller]) {
    byCaller[caller] = { ...EMPTY_BUCKET(), total: 0 };
  }
  return byCaller[caller]!;
}

function ensureFunctionBucket(functionName: string) {
  if (!byFunction[functionName]) {
    byFunction[functionName] = { ...EMPTY_BUCKET(), total: 0 };
  }
  return byFunction[functionName]!;
}

function logTagForKind(kind: PlacesApiKind): string {
  switch (kind) {
    case "nearby":
      return "[PLACES_NEARBY_CALL]";
    case "text":
      return "[PLACES_TEXT_CALL]";
    case "details":
      return "[PLACES_DETAILS_CALL]";
    case "photo":
      return "[PLACES_PHOTO_CALL]";
  }
}

function syncWindowStats(): void {
  if (typeof window === "undefined") return;
  window.__placesStats = getPlacesStatsSnapshot();
  window.printPlacesStats = printPlacesStatsReport;
}

export function recordPlacesHttpCall(
  kind: PlacesApiKind,
  input: {
    functionName: string;
    requestKey: string;
    caller?: string;
    screen?: PlacesScreen;
    category?: string;
  },
): void {
  const ctx = getPlacesCallContext();
  const caller = input.caller ?? ctx.caller;
  const screen = input.screen ?? ctx.screen;
  const category = input.category ?? ctx.category ?? "-";
  const requestKey = input.requestKey;
  const functionName = input.functionName;

  bumpBucket(globalCounts, kind);
  bumpBucket(byScreen[screen] ?? byScreen.unknown, kind);

  const callerBucket = ensureCallerBucket(caller);
  bumpBucket(callerBucket, kind);
  callerBucket.total += 1;

  const fnBucket = ensureFunctionBucket(functionName);
  bumpBucket(fnBucket, kind);
  fnBucket.total += 1;

  console.info(
    `${logTagForKind(kind)} caller=${caller} screen=${screen} category=${category} requestKey=${requestKey} function=${functionName}`,
  );

  syncWindowStats();
}

export function recordPlacesPhotoUrlLoad(
  src: string,
  meta?: Partial<Omit<PlacesCallMeta, "requestKey">>,
): void {
  if (!src) return;
  const isPlacePhoto =
    src.includes("places.googleapis.com") && src.includes("/media") ||
    src.includes("/api/place-photo");
  if (!isPlacePhoto) return;
  if (recordedPhotoUrls.has(src)) return;
  recordedPhotoUrls.add(src);

  recordPlacesHttpCall("photo", {
    functionName: "PlaceImage.load",
    requestKey: src.slice(0, 120),
    caller: meta?.caller ?? getPlacesCallContext().caller,
    screen: meta?.screen ?? getPlacesCallContext().screen,
    category: meta?.category,
  });
}

export function getPlacesStatsSnapshot(): PlacesStatsSnapshot {
  return {
    nearbyCount: globalCounts.nearby,
    textCount: globalCounts.text,
    detailsCount: globalCounts.details,
    photoCount: globalCounts.photo,
    nearby: globalCounts.nearby,
    text: globalCounts.text,
    details: globalCounts.details,
    photo: globalCounts.photo,
    byScreen: JSON.parse(JSON.stringify(byScreen)) as Record<PlacesScreen, PlacesCountBucket>,
    byCaller: JSON.parse(JSON.stringify(byCaller)),
    byFunction: JSON.parse(JSON.stringify(byFunction)),
    flows: JSON.parse(JSON.stringify(flows)),
  };
}

export type PlacesFlowName =
  | "home_cold"
  | "explore_open"
  | "explore_category"
  | "ai_recommend"
  | "chat_once"
  | "itinerary_once";

type FlowToken = { name: PlacesFlowName; start: PlacesCountBucket };

let activeTrackedFlow: FlowToken | null = null;

export function beginPlacesFlow(name: PlacesFlowName): FlowToken {
  return { name, start: { ...globalCounts } };
}

export function beginTrackedPlacesFlow(name: PlacesFlowName): FlowToken {
  const token = beginPlacesFlow(name);
  activeTrackedFlow = token;
  return token;
}

export function endPlacesFlow(token: FlowToken): PlacesCountBucket {
  const delta: PlacesCountBucket = {
    nearby: globalCounts.nearby - token.start.nearby,
    text: globalCounts.text - token.start.text,
    details: globalCounts.details - token.start.details,
    photo: globalCounts.photo - token.start.photo,
  };
  const total = delta.nearby + delta.text + delta.details + delta.photo;
  flows[token.name] = { ...delta, total, at: new Date().toISOString() };
  console.info(
    `[PLACES_FLOW] flow=${token.name} nearby=${delta.nearby} text=${delta.text} details=${delta.details} photo=${delta.photo} total=${total}`,
  );
  if (activeTrackedFlow === token) activeTrackedFlow = null;
  syncWindowStats();
  return delta;
}

export function endTrackedPlacesFlow(name: PlacesFlowName): PlacesCountBucket | null {
  if (!activeTrackedFlow || activeTrackedFlow.name !== name) return null;
  return endPlacesFlow(activeTrackedFlow);
}

export type PlacesStatsReportRow = {
  name: string;
  nearby: number;
  text: number;
  details: number;
  photo: number;
  total: number;
  percentage: number;
};

function buildReportRows(
  map: Record<string, PlacesCountBucket & { total: number }>,
): PlacesStatsReportRow[] {
  const grand = globalCounts.nearby + globalCounts.text + globalCounts.details + globalCounts.photo;
  return Object.entries(map)
    .map(([name, bucket]) => ({
      name,
      nearby: bucket.nearby,
      text: bucket.text,
      details: bucket.details,
      photo: bucket.photo,
      total: bucket.total,
      percentage: grand > 0 ? Math.round((bucket.total / grand) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function getPlacesCallerReport(kind: PlacesApiKind): PlacesStatsReportRow[] {
  const snap = getPlacesStatsSnapshot();
  const field = kindToField(kind);
  const grand = snap.byCaller
    ? Object.values(snap.byCaller).reduce((sum, b) => sum + (b[field] ?? 0), 0)
    : 0;
  return Object.entries(snap.byCaller)
    .map(([name, bucket]) => ({
      name,
      nearby: bucket.nearby,
      text: bucket.text,
      details: bucket.details,
      photo: bucket.photo,
      total: bucket[field] ?? 0,
      percentage: grand > 0 ? Math.round(((bucket[field] ?? 0) / grand) * 1000) / 10 : 0,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function printPlacesCallerReport(): void {
  console.info("[PLACES_STATS] === Nearby Search by caller ===");
  for (const row of getPlacesCallerReport("nearby")) {
    console.info(
      `[PLACES_STATS_ROW] kind=nearby function=${row.name} count=${row.total} pct=${row.percentage}%`,
    );
  }
  console.info("[PLACES_STATS] === Text Search by caller ===");
  for (const row of getPlacesCallerReport("text")) {
    console.info(
      `[PLACES_STATS_ROW] kind=text function=${row.name} count=${row.total} pct=${row.percentage}%`,
    );
  }
}

export function printPlacesStatsReport(): void {
  const snap = getPlacesStatsSnapshot();
  printPlacesCallerReport();
  console.info("[PLACES_STATS] global", {
    nearbyCount: snap.nearbyCount,
    textCount: snap.textCount,
    detailsCount: snap.detailsCount,
    photoCount: snap.photoCount,
  });
  console.info("[PLACES_STATS] byScreen", snap.byScreen);
  console.info("[PLACES_STATS] flows", snap.flows);

  const nearbyRows = buildReportRows(
    Object.fromEntries(
      Object.entries(snap.byFunction).map(([k, v]) => [k, { ...v, total: v.nearby }]),
    ),
  ).filter((r) => r.nearby > 0);

  const textRows = buildReportRows(
    Object.fromEntries(
      Object.entries(snap.byFunction).map(([k, v]) => [k, { ...v, total: v.text }]),
    ),
  ).filter((r) => r.text > 0);

  console.info("[PLACES_STATS] top nearby byFunction", nearbyRows.slice(0, 15));
  console.info("[PLACES_STATS] top text byFunction", textRows.slice(0, 15));
  console.info("[PLACES_STATS] top byCaller", buildReportRows(snap.byCaller).slice(0, 20));
}

export function placesStatsPayload(input: {
  placesCaller: string;
  placesScreen: PlacesScreen;
  categoryId?: string;
}): {
  placesCaller: string;
  placesScreen: PlacesScreen;
  categoryId?: string;
} {
  return {
    placesCaller: input.placesCaller,
    placesScreen: input.placesScreen,
    categoryId: input.categoryId,
  };
}

if (typeof window !== "undefined") {
  syncWindowStats();
}
