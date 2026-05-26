import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { logAppError } from "@/lib/log-error";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("[Roamie Map] render error", error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[calc(100dvh-4.25rem)] flex-col items-center justify-center gap-4 bg-secondary px-8 text-center">
          <p className="font-display text-lg">探索地圖暫時無法顯示</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {this.state.error.message || "發生未預期的錯誤，請稍後再試。"}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-full border border-border bg-card px-5 py-2.5 text-sm"
            >
              重試
            </button>
            <Link
              to="/"
              className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              回首頁
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
