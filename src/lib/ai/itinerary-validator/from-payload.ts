/**
 * 將 Persistence／選點行程轉成 ComposedDayPlan-like，供 Itinerary Validator 使用。
 * 刻意不 import ai-day-plan-source，避免循環依賴。
 */

import type { ItineraryComposedDayPlanLike, ItineraryPlanEntryLike } from "@/lib/ai/itinerary-validator/types";
import type { PlaceResult } from "@/lib/place-result";
import type { RoamieItineraryItem } from "@/lib/ai/types";

function itemToPlace(item: RoamieItineraryItem): PlaceResult {
  return {
    id: item.googlePlaceId?.trim() || item.placeName || item.title,
    name: item.placeName || item.title,
    address: item.address ?? null,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    photoName: item.photoName ?? null,
    primaryType: item.placeType ?? null,
    types: item.types ?? (item.placeType ? [item.placeType] : null),
    businessStatus: item.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: false,
  } as PlaceResult;
}

function slotLabelFromItem(item: RoamieItineraryItem): string {
  const t = (item.time ?? "").trim();
  const type = (item.placeType ?? "").toLowerCase();
  const title = `${item.title ?? ""} ${item.placeName ?? ""}`;
  if (/早餐|breakfast/i.test(title) || type.includes("breakfast")) return "早餐";
  if (/午餐|lunch/i.test(title)) return "午餐";
  if (/晚餐|dinner/i.test(title)) return "晚餐";
  if (/咖啡|cafe|coffee/i.test(title) || type.includes("cafe")) return "咖啡";
  if (/restaurant|food|餐廳|餐/.test(type)) {
    const minutes = (() => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return 12 * 60;
      return Number(m[1]) * 60 + Number(m[2]);
    })();
    if (minutes < 10 * 60) return "早餐";
    if (minutes < 15 * 60) return "午餐";
    if (minutes >= 17 * 60) return "晚餐";
  }
  return item.title?.trim() || "景點";
}

/**
 * 由 Roamie itinerary items 組裝 day plans（不修改原 items）。
 */
export function composedPlansFromItineraryItems(
  items: readonly RoamieItineraryItem[],
  requestedDays: number,
  startDate?: string,
): ItineraryComposedDayPlanLike[] {
  const dateOrder: string[] = [];
  if (startDate?.trim()) {
    const start = new Date(`${startDate.trim()}T12:00:00`);
    for (let i = 0; i < requestedDays; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dateOrder.push(d.toISOString().slice(0, 10));
    }
  }

  const byDay = new Map<number, ItineraryPlanEntryLike[]>();
  for (const item of items) {
    let day =
      item.dayIndex != null && Number.isFinite(item.dayIndex)
        ? Math.floor(item.dayIndex) + 1
        : 0;
    if (day < 1) {
      const date = item.date?.trim();
      if (date && dateOrder.length) {
        const idx = dateOrder.indexOf(date);
        day = idx >= 0 ? idx + 1 : 1;
      } else {
        day = 1;
      }
    }
    const place = itemToPlace(item);
    const entry: ItineraryPlanEntryLike = {
      time: (item.time ?? "10:00").trim() || "10:00",
      label: slotLabelFromItem(item),
      name: place.name ?? item.title,
      place,
    };
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }

  const plans: ItineraryComposedDayPlanLike[] = [];
  for (let day = 1; day <= Math.max(1, requestedDays); day += 1) {
    plans.push({ day, entries: byDay.get(day) ?? [] });
  }
  return plans;
}

/**
 * 將 Auto Repair 後的 composed plans 寫回 itinerary items（時間／日期／dayIndex）。
 * 以 placeId／名稱對應既有 item，保留照片與 combination metadata。
 */
export function applyComposedPlansToItineraryItems(
  items: readonly RoamieItineraryItem[],
  plans: readonly ItineraryComposedDayPlanLike[],
  startDate?: string,
): RoamieItineraryItem[] {
  const dateOrder: string[] = [];
  if (startDate?.trim()) {
    const start = new Date(`${startDate.trim()}T12:00:00`);
    for (let i = 0; i < plans.length; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dateOrder.push(d.toISOString().slice(0, 10));
    }
  } else {
    for (const item of items) {
      const d = item.date?.trim();
      if (d && !dateOrder.includes(d)) dateOrder.push(d);
    }
  }

  const byKey = new Map<string, RoamieItineraryItem[]>();
  const keyOf = (id: string, name: string) => {
    const pid = id.trim();
    if (pid) return `id:${pid}`;
    return `name:${name.trim().toLowerCase().replace(/\s+/g, "")}`;
  };
  for (const item of items) {
    const key = keyOf(
      item.googlePlaceId ?? "",
      item.placeName || item.title || "",
    );
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }

  const dateByDay = new Map<number, string>();
  for (let i = 0; i < dateOrder.length; i += 1) {
    dateByDay.set(i + 1, dateOrder[i]!);
  }

  const out: RoamieItineraryItem[] = [];
  for (const plan of [...plans].sort((a, b) => a.day - b.day)) {
    const safeDay =
      Number.isFinite(plan.day) && plan.day >= 1
        ? Math.floor(plan.day)
        : 1;
    const date =
      dateByDay.get(safeDay) ??
      dateOrder[0] ??
      startDate?.trim() ??
      "";
    for (const entry of plan.entries) {
      const place = entry.place;
      const key = keyOf(place.id ?? "", place.name ?? entry.name);
      const bucket = byKey.get(key);
      const base = bucket?.shift();
      if (base) {
        out.push({
          ...base,
          time: entry.time || base.time,
          date: date || base.date,
          dayIndex: safeDay - 1,
          title: base.title || entry.name,
          placeName: base.placeName || entry.name,
        });
      } else {
        out.push({
          date,
          time: entry.time || "10:00",
          title: entry.name,
          description: "",
          placeName: entry.name,
          lat: place.lat ?? undefined,
          lng: place.lng ?? undefined,
          address: place.address ?? entry.name,
          googlePlaceId: place.id || undefined,
          placeType: place.primaryType ?? undefined,
          types: place.types ?? undefined,
          dayIndex: safeDay - 1,
          photoName: place.photoName ?? null,
          rating: place.rating ?? null,
          userRatingCount: place.userRatingCount ?? null,
          placeSnapshotSource: "selected_place",
        });
      }
    }
  }
  return out;
}

/** 由 day → place count 陣列（1-indexed days） */
export function dayCountsFromItineraryItems(
  items: readonly RoamieItineraryItem[],
  requestedDays: number,
  startDate?: string,
): number[] {
  return composedPlansFromItineraryItems(items, requestedDays, startDate).map(
    (p) => p.entries.length,
  );
}
