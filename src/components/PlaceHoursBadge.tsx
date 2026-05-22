type Props = {
  statusLabel?: string;
  todayHoursLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
  className?: string;
  /** 地圖卡片：合併為 1 行 */
  compact?: boolean;
};

/** 推薦卡片共用：營業狀態 + 今日營業時間 */
export function PlaceHoursBadge({
  statusLabel,
  todayHoursLabel,
  closingSoonNote,
  nextOpenHint,
  className = "",
  compact = false,
}: Props) {
  const hasStatus = !!statusLabel?.trim();
  const hasHours = !!todayHoursLabel?.trim();
  if (!hasStatus && !hasHours && !closingSoonNote && !nextOpenHint) return null;

  if (compact) {
    const parts = [
      hasStatus ? statusLabel : null,
      hasHours ? todayHoursLabel : null,
      closingSoonNote || null,
      nextOpenHint && statusLabel !== "營業中" ? nextOpenHint : null,
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
      {nextOpenHint && statusLabel !== "營業中" && <p>{nextOpenHint}</p>}
    </div>
  );
}
