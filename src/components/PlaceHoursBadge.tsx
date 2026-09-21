import { placeOpeningStatusLabel, type OpeningStateInput } from "@/lib/normalized-opening-status";
import { useI18n } from "@/hooks/use-i18n";
import { openingCopyDisplay } from "@/lib/native-qa-display";
type Props = {
  place?: OpeningStateInput;
  statusLabel?: string;
  todayHoursLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
  className?: string;
  /** 地圖卡片：合併為 1 行 */
  compact?: boolean;
  openLabel?: string;
};

/** 推薦卡片共用：營業狀態 + 今日營業時間 */
export function PlaceHoursBadge({
  place,
  statusLabel,
  todayHoursLabel,
  closingSoonNote,
  nextOpenHint,
  className = "",
  compact = false,
  openLabel,
}: Props) {
  const { locale, t } = useI18n();
  statusLabel = place ? placeOpeningStatusLabel(place, locale) : statusLabel ? placeOpeningStatusLabel({ openStatusLabel: statusLabel }, locale) : undefined;
  todayHoursLabel = openingCopyDisplay(todayHoursLabel, locale);
  closingSoonNote = openingCopyDisplay(closingSoonNote, locale);
  nextOpenHint = openingCopyDisplay(nextOpenHint, locale);
  openLabel = openingCopyDisplay(openLabel, locale) ?? t("place.open");
  const hasStatus = !!statusLabel?.trim();
  const hasHours = !!todayHoursLabel?.trim();
  if (!hasStatus && !hasHours && !closingSoonNote && !nextOpenHint) return null;

  if (compact) {
    const showHours =
      hasHours && todayHoursLabel!.trim() !== (statusLabel ?? "").trim();
    const parts = [
      hasStatus ? statusLabel : null,
      showHours ? todayHoursLabel : null,
      closingSoonNote || null,
      nextOpenHint && statusLabel !== openLabel ? nextOpenHint : null,
    ].filter(Boolean);
    return (
      <p className={`line-clamp-1 text-[10px] leading-snug text-muted-foreground ${className}`}>
        {parts.join(" · ")}
      </p>
    );
  }

  return (
    <div className={`space-y-0.5 text-[11px] text-muted-foreground ${className}`}>
      {hasStatus && (
        <p>
          <span className="text-foreground/80">{statusLabel}</span>
        </p>
      )}
      {hasHours && <p>{todayHoursLabel}</p>}
      {closingSoonNote && <p className="text-clay/90">{closingSoonNote}</p>}
      {nextOpenHint && statusLabel !== openLabel && <p>{nextOpenHint}</p>}
    </div>
  );
}
