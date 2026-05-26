import { RoamieMascotFigure } from "@/components/onboarding/RoamieMascotFigure";

type Props = {
  title?: string;
  message?: string;
  detail?: string | null;
  onRetry?: () => void;
  onHome?: () => void;
  retryLabel?: string;
  homeLabel?: string;
};

/** 全 App 錯誤／啟動失敗時的 Roamie 品牌 fallback（非系統白屏） */
export function RoamieAppErrorFallback({
  title = "Roamie 暫時無法啟動",
  message = "可能是連線或設定問題。你可以重試，或從頭開始載入。",
  detail = null,
  onRetry,
  onHome,
  retryLabel = "重新整理",
  homeLabel = "重新啟動",
}: Props) {
  const handleRetry = onRetry ?? (() => window.location.reload());
  const handleHome =
    onHome ??
    (() => {
      window.location.href = "/login";
    });

  return (
    <div className="roamie-splash flex min-h-[100dvh] flex-col items-center justify-center px-6 py-10">
      <div className="roamie-splash__gradient pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 flex max-w-sm flex-col items-center text-center">
        <RoamieMascotFigure
          pose="wave"
          variant="splash"
          motion="fade-in"
          className="roamie-splash__character--welcome"
        />
        <h1 className="mt-6 font-display text-xl text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        {detail ? (
          <p className="mt-3 max-h-24 w-full overflow-y-auto rounded-2xl bg-card/80 px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground">
            {detail}
          </p>
        ) : null}
        <div className="mt-6 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lift"
          >
            {retryLabel}
          </button>
          <button
            type="button"
            onClick={handleHome}
            className="rounded-full border border-border bg-card px-6 py-3 text-sm font-medium text-foreground"
          >
            {homeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
