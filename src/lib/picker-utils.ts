/** ISO date (YYYY-MM-DD) helpers for Roamie pickers */

export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatMonthYear(d: Date): string {
  return `${d.getMonth() + 1}月 ${d.getFullYear()}`;
}

/** 5月22日；withYear 時為 2026年5月22日 */
export function formatDateShort(iso: string, options?: { withYear?: boolean }): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  const year = options?.withYear ? `${d.getFullYear()}年` : "";
  return `${year}${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 5月22日 週四 */
export function formatDateWithWeekday(iso: string): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  return `${formatDateShort(iso)} 週${WEEKDAY_LABELS[d.getDay()]}`;
}

export type DateRangeValue = { start: string; end: string };

export function formatDateRangeLabel(
  start: string,
  end: string,
  options?: { withYear?: boolean },
): string {
  if (!start && !end) return "";
  if (start && end && start !== end) {
    return `${formatDateShort(start, options)} – ${formatDateShort(end, options)}`;
  }
  const one = start || end;
  return one ? formatDateShort(one, options) : "";
}

export function isSameISO(a: string, b: string): boolean {
  return a === b;
}

export function compareISO(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isInRange(iso: string, start: string, end: string): boolean {
  if (!start || !end) return false;
  const s = start <= end ? start : end;
  const e = start <= end ? end : start;
  return iso >= s && iso <= e;
}

export function normalizeRange(start: string, end: string): { start: string; end: string } {
  if (!start) return { start: end, end };
  if (!end) return { start, end: start };
  return start <= end ? { start, end } : { start: end, end: start };
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso) ?? new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function calendarCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const total = daysInMonth(year, month);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Normalize HH:mm */
export function normalizeTime(value: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "10:00";
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function formatTimeDisplay(value: string): string {
  return normalizeTime(value);
}

export function formatDurationMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} 分鐘`;
  if (m === 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分`;
}

export function parseDurationToMinutes(hours: number, minutes: number): number {
  return Math.max(15, Math.min(480, hours * 60 + minutes));
}

export function splitDurationMinutes(total: number): { hours: number; minutes: number } {
  const clamped = Math.max(15, Math.min(480, total));
  const rounded = Math.round(clamped / 15) * 15;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return { hours, minutes };
}
