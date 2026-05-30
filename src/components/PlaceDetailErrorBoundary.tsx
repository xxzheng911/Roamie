import { Component, type ErrorInfo, type ReactNode } from "react";
import { logAppError } from "@/lib/log-error";
import { ExploreSubpageHeader } from "@/components/map/PlaceDetailSheet";
import { resolveLocaleSync } from "@/lib/i18n/resolve-locale";
import { translate } from "@/lib/i18n/translate";

type Props = {
  children: ReactNode;
  title: string;
  onBack: () => void;
};

type State = { error: Error | null };

export class PlaceDetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("[Roamie PlaceDetail] render error", error, {
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      const locale = resolveLocaleSync();
      const msg = (key: string) => translate(locale, key);
      return (
        <div className="min-h-dvh bg-cream">
          <ExploreSubpageHeader title={this.props.title} onBack={this.props.onBack} />
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <p className="text-base font-medium text-foreground">
              {msg("map.placeDetailLoadError") || "無法顯示地點詳情"}
            </p>
            <p className="text-sm text-muted-foreground">
              {msg("map.mapPlaceholderSubtitle") || "請稍後再試"}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground"
                onClick={() => this.setState({ error: null })}
              >
                {msg("map.mapRetry") || "重試"}
              </button>
              <button
                type="button"
                className="rounded-full border border-border px-5 py-2 text-sm"
                onClick={this.props.onBack}
              >
                {msg("common.back") || "返回"}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
