import { AlertCircle } from "lucide-react";

type Props = {
  title?: string;
  message: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** system：一般提示樣式（登入頁）；brand：保留品牌插畫（callback 等） */
  variant?: "system" | "brand";
};

/** 登入失敗提示 */
export function AuthSignInError({
  title = "登入沒有完成",
  message,
  hint,
  onRetry,
  retryLabel = "再試一次",
  variant = "brand",
}: Props) {
  if (variant === "system") {
    return (
      <div
        role="alert"
        className="w-full rounded-2xl border border-border bg-secondary/60 px-4 py-3.5 text-left"
      >
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[320px] rounded-3xl border border-border/80 bg-card/90 px-5 py-6 text-center shadow-soft">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
        <AlertCircle className="h-5 w-5 text-clay" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {hint ? (
        <p className="mt-2 rounded-xl bg-secondary/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
          {hint}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 w-full rounded-full bg-ink py-3 text-sm font-medium text-background"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
