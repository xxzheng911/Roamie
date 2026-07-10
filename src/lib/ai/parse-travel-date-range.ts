/** Parse date ranges like 11/15~11/16 or 2026-11-15~11-16 into ISO dates and day count. */
export function parseTravelDateRangeFromText(
  text: string,
  refDate = new Date(),
): { startDate?: string; endDate?: string; days?: number } {
  const t = text.trim();
  if (!t) return {};

  const rangeMatch = t.match(
    /((?:\d{4}[\/\-年])?\d{1,2}[\/\-月]\d{1,2})\s*[~～至到\-—–]\s*((?:\d{4}[\/\-年])?\d{1,2}[\/\-月]\d{1,2})/,
  );
  if (!rangeMatch?.[1] || !rangeMatch[2]) return {};

  const start = parsePartialDate(rangeMatch[1], refDate);
  const end = parsePartialDate(rangeMatch[2], refDate, start?.year);
  if (!start || !end) return {};

  const startIso = toIsoDate(start.year, start.month, start.day);
  const endIso = toIsoDate(end.year, end.month, end.day);
  if (!startIso || !endIso) return {};

  const startMs = Date.parse(`${startIso}T00:00:00`);
  const endMs = Date.parse(`${endIso}T00:00:00`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return {};

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.min(30, Math.max(1, Math.round((endMs - startMs) / dayMs) + 1));

  return { startDate: startIso, endDate: endIso, days };
}

type ParsedPartialDate = { year: number; month: number; day: number };

function parsePartialDate(
  raw: string,
  refDate: Date,
  fallbackYear?: number,
): ParsedPartialDate | undefined {
  const normalized = raw.replace(/年|月/g, "/").replace(/-/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;

  let year: number;
  let month: number;
  let day: number;

  if (parts.length >= 3) {
    year = Number.parseInt(parts[0]!, 10);
    month = Number.parseInt(parts[1]!, 10);
    day = Number.parseInt(parts[2]!, 10);
  } else {
    year = fallbackYear ?? refDate.getFullYear();
    month = Number.parseInt(parts[0]!, 10);
    day = Number.parseInt(parts[1]!, 10);
    if (month > 31 && day <= 12) {
      [month, day] = [day, month];
    }
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  return { year, month, day };
}

function toIsoDate(year: number, month: number, day: number): string | undefined {
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return undefined;
  }
  return d.toISOString().slice(0, 10);
}
