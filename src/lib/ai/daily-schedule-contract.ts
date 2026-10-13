/**
 * Daily schedule contract shared by Planner assembly, final route ordering and the
 * Itinerary Validator: meal-window anchors, consecutive meals and long stretches
 * without a meal/rest stop. Pure — never fetches, adds or removes places.
 */
import type { PlaceResult } from "@/lib/place-result";
import { classifyDailyDiversityCategory } from "@/lib/ai/daily-category-diversity";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import { isOpenAtScheduled } from "@/lib/filter-available-places";

export type DailyScheduleIntent = {
  /** Explicit food trip: more meals allowed, still inside meal windows. */
  foodie: boolean;
  /** Explicitly no meal planning: never require a meal/rest stop. */
  noMeals: boolean;
  /** Hiking / outdoor day: longer stretches between stops are normal. */
  outdoor: boolean;
};

export const NEUTRAL_DAILY_SCHEDULE_INTENT: DailyScheduleIntent = {
  foodie: false,
  noMeals: false,
  outdoor: false,
};

const FOODIE_RE =
  /美食之旅|美食旅|吃貨|吃遍|小吃巡禮|食べ歩き|グルメ旅|food\s*(?:tour|trip|crawl)|foodie|맛집\s*투어|먹방/i;
const NO_MEALS_RE =
  /不(?:用|要|需要|必)?安排(?:用餐|餐點|餐廳|吃飯|餐)|餐(?:點)?自理|自理(?:三)?餐|no\s*meals?|skip\s*(?:meals?|lunch|dinner)|without\s*meals|食事(?:は)?(?:不要|なし|抜き)|식사\s*(?:제외|없이)/i;
const OUTDOOR_RE = /登山|健行|爬山|步道|露營|hiking|\bhike\b|trek|camping|ハイキング|등산|트레킹/i;

export function resolveDailyScheduleIntent(userText?: string | null): DailyScheduleIntent {
  const text = userText ?? "";
  return {
    foodie: FOODIE_RE.test(text),
    noMeals: NO_MEALS_RE.test(text),
    outdoor: OUTDOOR_RE.test(text),
  };
}

export type MealWindow = "breakfast" | "lunch" | "dinner";

/** [start, end] minutes, inclusive, plus the preferred anchor time. */
export const MEAL_WINDOWS: Record<MealWindow, { start: number; end: number; center: number }> = {
  breakfast: { start: 7 * 60, end: 10 * 60, center: 8 * 60 + 30 },
  lunch: { start: 11 * 60, end: 14 * 60 + 30, center: 12 * 60 + 30 },
  dinner: { start: 17 * 60, end: 21 * 60, center: 19 * 60 },
};

const MEAL_LABEL: Record<MealWindow, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
const MEAL_LABEL_RE = /早餐|午餐|晚餐/;
const LATE_PINNED_RE = /night_club|\bbar\b|\bpub\b|night_market|夜市|酒吧|居酒/i;

export function parseScheduleMinutes(time: string | null | undefined): number | null {
  const match = (time ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Breakfast counts only for stops explicitly planned as breakfast. */
function mealWindowForEntry(entry: { time: string; label: string }): MealWindow | null {
  const window = mealWindowAt(parseScheduleMinutes(entry.time));
  return window === "breakfast" && !/早餐/.test(entry.label) ? null : window;
}

export function mealWindowAt(minutes: number | null): MealWindow | null {
  if (minutes == null) return null;
  for (const window of ["breakfast", "lunch", "dinner"] as const) {
    const w = MEAL_WINDOWS[window];
    if (minutes >= w.start && minutes <= w.end) return window;
  }
  return null;
}

/** A sit-down meal venue (restaurant family); cafés and bars are not full meals. */
export function isFullMealVenue(place: PlaceResult): boolean {
  return classifyDailyDiversityCategory(place) === "restaurant";
}

/** A stop where travellers can eat or rest (full meal or café). */
export function isRestBreakVenue(place: PlaceResult): boolean {
  const category = classifyDailyDiversityCategory(place);
  return category === "restaurant" || category === "cafe";
}

function isLatePinned(entry: { label: string; place: PlaceResult }): boolean {
  return LATE_PINNED_RE.test(
    [entry.label, entry.place.primaryType, ...(entry.place.types ?? []), entry.place.name].join(" "),
  );
}

/** Meal label matching a full-meal venue's time; non-meal labels on non-meal stops are kept. */
export function scheduleLabelFor(entry: { time: string; label: string; place: PlaceResult }): string {
  if (isFullMealVenue(entry.place)) {
    const window = mealWindowForEntry(entry);
    if (window) return MEAL_LABEL[window];
    return MEAL_LABEL_RE.test(entry.label) ? "景點" : entry.label;
  }
  // A meal label must never sit on a non-meal stop.
  return MEAL_LABEL_RE.test(entry.label) && !/咖啡|cafe/i.test(entry.label) ? "景點" : entry.label;
}

export type DailyScheduleViolationCode =
  | "meal_window_mismatch"
  | "consecutive_food_stops"
  | "long_stretch_without_break";

export type DailyScheduleViolation = {
  code: DailyScheduleViolationCode;
  detail: string;
  names: string[];
};

type ScheduleEntry = { time: string; label: string; name?: string; place: PlaceResult };

/**
 * Evaluates one day. Time- and intent-aware: counts alone never fail a day.
 * - consecutive_food_stops: adjacent full meals closer than a reasonable gap.
 * - meal_window_mismatch: full meal outside every meal window, or a meal label
 *   whose time is outside that meal's window.
 * - long_stretch_without_break: ≥4 consecutive non-rest stops spanning ≥5h through a
 *   meal anchor (outdoor: ≥5 stops, ≥7h). Skipped when the user asked for no meals.
 */
export function evaluateDailySchedule(
  entries: readonly ScheduleEntry[],
  intent: DailyScheduleIntent = NEUTRAL_DAILY_SCHEDULE_INTENT,
): DailyScheduleViolation[] {
  const timed = entries
    .map((entry) => ({ entry, minutes: parseScheduleMinutes(entry.time) }))
    .filter((e): e is { entry: ScheduleEntry; minutes: number } => e.minutes != null)
    .sort((a, b) => a.minutes - b.minutes);
  const name = (e: ScheduleEntry) => e.name || e.place.name || "?";
  const violations: DailyScheduleViolation[] = [];

  const minGap = intent.foodie ? 60 : 180;
  let run = 1;
  for (let i = 1; i < timed.length; i += 1) {
    const prev = timed[i - 1]!;
    const cur = timed[i]!;
    if (isFullMealVenue(prev.entry.place) && isFullMealVenue(cur.entry.place)) {
      run += 1;
      const gap = cur.minutes - prev.minutes;
      if (gap < minGap || (intent.foodie && run >= 4)) {
        violations.push({
          code: "consecutive_food_stops",
          detail: `${prev.entry.time}→${cur.entry.time}:gap=${gap}`,
          names: [name(prev.entry), name(cur.entry)],
        });
      }
    } else {
      run = 1;
    }
  }

  for (const { entry, minutes } of timed) {
    const window = isFullMealVenue(entry.place) ? mealWindowForEntry(entry) : mealWindowAt(minutes);
    if (isFullMealVenue(entry.place) && !window && !isLatePinned(entry)) {
      violations.push({
        code: "meal_window_mismatch",
        detail: `meal_outside_window:${entry.time}`,
        names: [name(entry)],
      });
      continue;
    }
    const labelWindow = /早餐/.test(entry.label)
      ? "breakfast"
      : /午餐/.test(entry.label)
        ? "lunch"
        : /晚餐/.test(entry.label)
          ? "dinner"
          : null;
    if (labelWindow && labelWindow !== window) {
      violations.push({
        code: "meal_window_mismatch",
        detail: `${labelWindow}_label_at:${entry.time}`,
        names: [name(entry)],
      });
    }
  }

  if (!intent.noMeals) {
    const minStops = intent.outdoor ? 5 : 4;
    const minSpan = intent.outdoor ? 420 : 300;
    let start = 0;
    while (start < timed.length) {
      if (isRestBreakVenue(timed[start]!.entry.place)) {
        start += 1;
        continue;
      }
      let end = start;
      while (end + 1 < timed.length && !isRestBreakVenue(timed[end + 1]!.entry.place)) end += 1;
      const first = timed[start]!.minutes;
      const last = timed[end]!.minutes;
      const crossesMeal = [MEAL_WINDOWS.lunch.center, MEAL_WINDOWS.dinner.center].some(
        (center) => first <= center && last >= center,
      );
      if (end - start + 1 >= minStops && last - first >= minSpan && crossesMeal) {
        violations.push({
          code: "long_stretch_without_break",
          detail: `${timed[start]!.entry.time}-${timed[end]!.entry.time}:stops=${end - start + 1}`,
          names: timed.slice(start, end + 1).map((e) => name(e.entry)),
        });
      }
      start = end + 1;
    }
  }
  return violations;
}

export type DayWindow = { start: string; end: string };

/**
 * Clearly closed per the existing hours authorities only: `isClearlyClosedAtSlot`, or the
 * structured Google periods (`isOpenAtScheduled`) saying closed at that time on every weekday.
 * Missing hours are never treated as open or closed.
 */
export function isClearlyClosedForSchedule(place: PlaceResult, time: string): boolean {
  // Scheduling is always for a planned trip day: the current closed_now status must not count
  // (same rule as validatePlaceOpenAtTime), so pass a non-empty planned-day marker.
  if (isClearlyClosedAtSlot(place, "planned_trip_day", time) === true) return true;
  if (!place.regularOpeningHours?.periods?.length) return false;
  const hours = {
    businessStatus: place.businessStatus,
    regularOpeningHours: place.regularOpeningHours,
    utcOffsetMinutes: place.utcOffsetMinutes,
  };
  // The weekday of each trip day is not known here: only "closed at this time every day" counts.
  const week = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 0, 4 + i, 12)));
  return week.every((date) => isOpenAtScheduled(hours, date, time) === false);
}

export type ArrangeDayOptions<T> = {
  orderFree: (free: T[]) => T[];
  intent?: DailyScheduleIntent;
  /** Standard clocks a missing meal window may borrow (e.g. SCHEDULED_DAY_TIME_SLOTS). */
  slotPool?: readonly string[];
  /** Formal day availability (time-budget-planner dayStartTime / dayEndTime). */
  dayWindow?: DayWindow | null;
  /**
   * Entries whose date and clock are user-fixed; never moved. Roamie has no structured
   * time authority yet, so callers leave this unset (nothing is fixed). Titles / names are
   * never evidence of a fixed time.
   */
  isTimeFixed?: (entry: T) => boolean;
  /** Existing hours authority: true only when the venue is clearly closed at that time. */
  isClosedAt?: (place: PlaceResult, time: string) => boolean;
};

/**
 * Meal-anchored day arrangement. Keeps every entry (never drops a place) and never schedules
 * outside the day's valid range: the formal day window ∩ the day's own first/last clock, so a
 * trip is never extended and nothing lands before departure. Fixed-time entries keep their
 * clock. Meals already in a reasonable, open meal window keep it; others take lunch, then
 * dinner, then (only if the range reaches it) breakfast. With no legal meal slot a meal keeps
 * its own clock for the later soft check. Other stops keep the caller's route order.
 */
export function arrangeDayWithMealAnchors<T extends ScheduleEntry>(
  entries: readonly T[],
  options: ArrangeDayOptions<T>,
): T[] {
  const intent = options.intent ?? NEUTRAL_DAILY_SCHEDULE_INTENT;
  if (entries.length <= 1) return entries.map((e) => ({ ...e, label: scheduleLabelFor(e) }));
  const isTimeFixed = (e: T) => options.isTimeFixed?.(e) ?? false;
  const closed = (place: PlaceResult, m: number) =>
    options.isClosedAt?.(place, formatMinutes(m)) === true;
  const fixed = entries.filter(isTimeFixed);
  const movable = entries.filter((e) => !isTimeFixed(e));
  if (movable.some((e) => parseScheduleMinutes(e.time) == null)) return [...entries];

  // Valid range: formal day window ∩ the day's own clocks (clocks outside the window ignored).
  const windowStart = parseScheduleMinutes(options.dayWindow?.start) ?? 0;
  const windowEnd = parseScheduleMinutes(options.dayWindow?.end) ?? 24 * 60;
  const ownClocks = entries
    .map((e) => parseScheduleMinutes(e.time)!)
    .filter((m) => m >= windowStart && m <= windowEnd);
  const rangeStart = ownClocks.length ? Math.max(windowStart, Math.min(...ownClocks)) : windowStart;
  const rangeEnd = ownClocks.length ? Math.min(windowEnd, Math.max(...ownClocks)) : windowEnd;
  const inRange = (m: number) => m >= rangeStart && m <= rangeEnd;
  const fixedClocks = new Set(fixed.map((e) => parseScheduleMinutes(e.time)!));
  const pool = (options.slotPool ?? [])
    .map(parseScheduleMinutes)
    .filter((m): m is number => m != null && inRange(m));

  type Slot = { m: number; own: T; owner: T | null };
  const slots: Slot[] = movable.map((e) => ({ m: parseScheduleMinutes(e.time)!, own: e, owner: null }));
  // A movable clock outside the valid range is re-homed to a free in-range standard clock.
  for (const slot of slots) {
    if (inRange(slot.m)) continue;
    const used = new Set([...slots.map((s) => s.m), ...fixedClocks]);
    const home = pool
      .filter((m) => !used.has(m))
      .sort((a, b) => Math.abs(a - slot.m) - Math.abs(b - slot.m))[0];
    if (home != null) slot.m = home;
  }

  const meals = movable.filter((e) => isFullMealVenue(e.place));
  const fixedMealClocks = fixed
    .filter((e) => isFullMealVenue(e.place))
    .map((e) => parseScheduleMinutes(e.time)!);
  const minGap = intent.foodie ? 60 : 180;
  const mealClocks = () => [
    ...fixedMealClocks,
    ...slots.filter((s) => s.owner && meals.includes(s.owner)).map((s) => s.m),
  ];
  const gapOk = (m: number) => mealClocks().every((t) => Math.abs(t - m) >= minGap);
  const perWindow = intent.foodie ? 2 : 1;
  const windowUse = new Map<MealWindow, number>();
  const claim = (window: MealWindow) => {
    if ((windowUse.get(window) ?? 0) >= perWindow) return false;
    windowUse.set(window, (windowUse.get(window) ?? 0) + 1);
    return true;
  };
  for (const e of fixed) {
    if (isFullMealVenue(e.place)) {
      const w = mealWindowForEntry(e);
      if (w) claim(w);
    }
  }
  const plannedFor = new Map<T, MealWindow>();
  const pending: T[] = [];
  // 1) Keep meals already in a reasonable, open meal window (dinner stays dinner).
  for (const meal of [...meals].sort((a, b) => parseScheduleMinutes(a.time)! - parseScheduleMinutes(b.time)!)) {
    const slot = slots.find((s) => s.own === meal && !s.owner);
    const window = mealWindowForEntry(meal);
    if (
      slot &&
      window &&
      inRange(slot.m) &&
      mealWindowAt(slot.m) === window &&
      gapOk(slot.m) &&
      !closed(meal.place, slot.m) &&
      claim(window)
    ) {
      slot.owner = meal;
      plannedFor.set(meal, window);
    } else {
      pending.push(meal);
    }
  }
  // 2) Remaining meals: lunch, dinner, then breakfast only if the valid range reaches it.
  for (const meal of pending) {
    let slot: Slot | undefined;
    for (const window of ["lunch", "dinner", "breakfast"] as const) {
      const w = MEAL_WINDOWS[window];
      if (w.end < rangeStart || w.start > rangeEnd) continue;
      if ((windowUse.get(window) ?? 0) >= perWindow) continue;
      const fits = (m: number) =>
        m >= w.start && m <= w.end && inRange(m) && gapOk(m) && !closed(meal.place, m);
      const byCentre = (a: number, b: number) => Math.abs(a - w.center) - Math.abs(b - w.center);
      slot = slots.filter((s) => !s.owner && fits(s.m)).sort((a, b) => byCentre(a.m, b.m))[0];
      if (!slot) {
        const used = new Set([...slots.map((s) => s.m), ...fixedClocks]);
        const borrowed = pool.filter((m) => !used.has(m) && fits(m)).sort(byCentre)[0];
        const replaceable = slots
          .filter((s) => !s.owner && mealWindowAt(s.m) == null)
          .sort((a, b) => Math.abs(b.m - w.center) - Math.abs(a.m - w.center))[0];
        if (borrowed != null && replaceable) {
          replaceable.m = borrowed;
          slot = replaceable;
        }
      }
      if (slot) {
        claim(window);
        plannedFor.set(meal, window);
        break;
      }
    }
    // 3) No legal meal slot: keep the meal's own clock (soft check reports it) unless the
    //    venue is clearly closed then — use the open free slot farthest from other meals.
    if (!slot) {
      const own = slots.find((s) => s.own === meal && !s.owner);
      const distanceToMeals = (m: number) =>
        Math.min(Infinity, ...mealClocks().map((t) => Math.abs(t - m)));
      slot =
        (own && !closed(meal.place, own.m) ? own : undefined) ??
        slots
          .filter((s) => !s.owner && !closed(meal.place, s.m))
          .sort((a, b) => distanceToMeals(b.m) - distanceToMeals(a.m))[0] ??
        own ??
        slots.find((s) => !s.owner);
    }
    if (slot) slot.owner = meal;
  }
  slots.sort((a, b) => a.m - b.m);
  const late = movable.filter((e) => !isFullMealVenue(e.place) && isLatePinned(e));
  const free = movable.filter((e) => !isFullMealVenue(e.place) && !isLatePinned(e));
  for (const entry of [...late].reverse()) {
    const open = [...slots].reverse().find((s) => !s.owner);
    if (open) open.owner = entry;
  }
  const routed = options.orderFree(free);
  let cursor = 0;
  for (const slot of slots) {
    if (!slot.owner && cursor < routed.length) slot.owner = routed[cursor++]!;
  }
  const arranged = slots
    .filter((s) => s.owner)
    .map((s) => {
      const entry = s.owner!;
      const time = formatMinutes(s.m);
      const planned = plannedFor.get(entry);
      const label =
        planned && mealWindowAt(s.m) === planned
          ? MEAL_LABEL[planned]
          : scheduleLabelFor({ ...entry, time });
      return { ...entry, time, label };
    });
  return [...arranged, ...fixed].sort(
    (a, b) => parseScheduleMinutes(a.time)! - parseScheduleMinutes(b.time)!,
  );
}

/** Weighted schedule severity (consecutive meals weigh most; never a bare count). */
export const DAILY_SCHEDULE_SEVERITY: Record<DailyScheduleViolationCode, number> = {
  consecutive_food_stops: 3,
  meal_window_mismatch: 2,
  long_stretch_without_break: 2,
};

export function dailyScheduleSeverity(
  plans: ReadonlyArray<{ entries: readonly ScheduleEntry[] }>,
  intent: DailyScheduleIntent = NEUTRAL_DAILY_SCHEDULE_INTENT,
): number {
  return plans.reduce(
    (sum, plan) =>
      sum +
      evaluateDailySchedule(plan.entries, intent).reduce(
        (n, v) => n + DAILY_SCHEDULE_SEVERITY[v.code],
        0,
      ),
    0,
  );
}

export function surplusMealsAbove(intent: DailyScheduleIntent): number {
  return intent.foodie ? 2 : 1;
}

/** True when some day holds more full meals than it needs, so a meal-less day can borrow one. */
export function hasMovableSurplusMeal(
  days: ReadonlyArray<{ entries: ReadonlyArray<{ place: PlaceResult }> }>,
  intent: DailyScheduleIntent = NEUTRAL_DAILY_SCHEDULE_INTENT,
): boolean {
  return days.some(
    (day) => day.entries.filter((e) => isFullMealVenue(e.place)).length > surplusMealsAbove(intent),
  );
}

/**
 * Replan repair for the schedule contract: swap a surplus meal from a meal-heavy day with a
 * stop of a meal-less full day (within `maxMoveM`), then re-anchor meals on days that still
 * violate. Day-fixed entries never change day; time-fixed entries (only via an explicit
 * `isTimeFixed` — no structured time authority exists yet) never change clock. Moves and
 * reorders only — every entry is kept.
 */
export function repairDailyScheduleAcrossDays<
  E extends ScheduleEntry,
  P extends { day: number; entries: readonly E[] },
>(
  plans: readonly P[],
  options: {
    intent?: DailyScheduleIntent;
    distanceM: (a: PlaceResult, b: PlaceResult) => number;
    maxMoveM: number;
    slotPool?: readonly string[];
    isDayFixed?: (entry: E) => boolean;
    isTimeFixed?: (entry: E) => boolean;
    dayWindowFor?: (day: number) => DayWindow | null;
    isClosedAt?: (place: PlaceResult, time: string) => boolean;
  },
): P[] {
  const intent = options.intent ?? NEUTRAL_DAILY_SCHEDULE_INTENT;
  const isTimeFixed = (e: E) => options.isTimeFixed?.(e) ?? false;
  const isDayFixed = (e: E) => isTimeFixed(e) || (options.isDayFixed?.(e) ?? false);
  let current = plans.map((plan) => ({ ...plan, entries: [...plan.entries] }));
  if (!intent.noMeals) {
    const surplusAbove = surplusMealsAbove(intent);
    for (let guard = 0; guard < 8; guard += 1) {
      const receiver = current
        .filter((p) => p.entries.length >= 3 && !p.entries.some((e) => isFullMealVenue(e.place)))
        .sort((a, b) => b.entries.length - a.entries.length)[0];
      if (!receiver) break;
      let best: { from: number; entry: E; distance: number } | null = null;
      for (let index = 0; index < current.length; index += 1) {
        const plan = current[index]!;
        const meals = plan.entries.filter((e) => isFullMealVenue(e.place));
        if (plan === receiver || meals.length <= surplusAbove) continue;
        for (const meal of meals) {
          if (isDayFixed(meal) || meal.place.destinationScope === "nearby_extension") continue;
          const distance = Math.min(
            ...receiver.entries.map((e) => options.distanceM(e.place, meal.place)),
          );
          if (!Number.isFinite(distance) || distance > options.maxMoveM) continue;
          if (!best || distance < best.distance) best = { from: index, entry: meal, distance };
        }
      }
      if (!best) break;
      const { from, entry } = best;
      // Swap with the receiver's movable non-meal stop closest to the donor day, so neither
      // day's stop count (pace capacity) changes and nothing gets trimmed later.
      const donorPlaces = current[from]!.entries.map((e) => e.place);
      const back = receiver.entries
        .filter(
          (e) =>
            !isFullMealVenue(e.place) &&
            !isDayFixed(e) &&
            e.place.destinationScope !== "nearby_extension",
        )
        .sort(
          (a, b) =>
            Math.min(...donorPlaces.map((p) => options.distanceM(p, a.place))) -
            Math.min(...donorPlaces.map((p) => options.distanceM(p, b.place))),
        )[0];
      if (!back) break;
      current = current.map((plan, index) =>
        index === from
          ? { ...plan, entries: plan.entries.map((e) => (e === entry ? { ...back, time: entry.time } : e)) }
          : plan === receiver
            ? { ...plan, entries: plan.entries.map((e) => (e === back ? { ...entry, time: back.time } : e)) }
            : plan,
      );
    }
  }
  return reanchorViolatingDays(current as P[], { ...options, intent, isTimeFixed });
}

/**
 * Re-anchors meals within each day that violates the schedule contract (optionally only the
 * given days). Never moves a stop to another day, never adds or drops one, keeps fixed clocks.
 */
export function reanchorViolatingDays<
  E extends ScheduleEntry,
  P extends { day: number; entries: readonly E[] },
>(
  plans: readonly P[],
  options: {
    intent?: DailyScheduleIntent;
    onlyDays?: ReadonlySet<number>;
    slotPool?: readonly string[];
    isTimeFixed?: (entry: E) => boolean;
    dayWindowFor?: (day: number) => DayWindow | null;
    isClosedAt?: (place: PlaceResult, time: string) => boolean;
  },
): P[] {
  const intent = options.intent ?? NEUTRAL_DAILY_SCHEDULE_INTENT;
  return plans.map((plan) =>
    (options.onlyDays && !options.onlyDays.has(plan.day)) ||
    evaluateDailySchedule(plan.entries, intent).length === 0
      ? plan
      : ({
          ...plan,
          entries: arrangeDayWithMealAnchors(
            [...plan.entries].sort(
              (a, b) => (parseScheduleMinutes(a.time) ?? 0) - (parseScheduleMinutes(b.time) ?? 0),
            ),
            {
              intent,
              slotPool: options.slotPool,
              orderFree: (free) => free,
              isTimeFixed: options.isTimeFixed,
              dayWindow: options.dayWindowFor?.(plan.day) ?? null,
              isClosedAt: options.isClosedAt,
            },
          ),
        } as P),
  );
}
