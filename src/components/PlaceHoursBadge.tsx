type Props = {
  statusLabel?: string;
  todayHoursLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
  className?: string;
};

/** 推薦卡片共用：營業狀態 + 今日營業時間 */
export function PlaceHoursBadge({
  statusLabel,
  todayHoursLabel,
  closingSoonNote,
  nextOpenHint,
  className = "",
}: Props) {
  const hasStatus = !!statusLabel?.trim();
  const hasHours = !!todayHoursLabel?.trim();
  if (!hasStatus && !hasHours && !closingSoonNote && !nextOpenHint) return null;

  return (
    <div className={`space-y-0.5 text-[11px] text-muted-foreground ${className}`}>
      {hasStatus && (
        <p>
          <span className="text-foreground/80">{statusLabel}</span>
        </p>
      )}
      {hasHours && <p>{todayHoursLabel}</p>}
      {closingSoonNote && <p className="text-clay/90">{closingSoonNote}</p>}
      {nextOpenHint && statusLabel !== "營業中" && <p>{nextOpenHint}</p>}
    </div>
  );
}
