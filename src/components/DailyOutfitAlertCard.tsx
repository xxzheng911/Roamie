type Props = {
  dayNumber: number;
  message: string;
  className?: string;
};

/** 僅在該日有特殊穿搭差異時顯示的簡短提醒 */
export function DailyOutfitAlertCard({ dayNumber, message, className = "" }: Props) {
  return (
    <div
      className={`rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/40 ${className}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-amber-800/90 dark:text-amber-200/90">
        第 {dayNumber} 天當日提醒
      </p>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">{message}</p>
    </div>
  );
}
