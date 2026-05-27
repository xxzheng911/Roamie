import { Component, type ErrorInfo, type ReactNode } from "react";
import { logAppError } from "@/lib/log-error";
import { MapExploreMapFallback } from "@/components/map/MapExploreMapFallback";
import { resolveLocaleSync } from "@/lib/i18n/resolve-locale";
import { translate } from "@/lib/i18n/translate";

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
      const locale = resolveLocaleSync();
      const msg = (key: string) => translate(locale, key);
      return (
        <div className="map-page relative min-h-[calc(100dvh-4.25rem)] overflow-hidden bg-cream">
          <MapExploreMapFallback
            title={msg("map.mapPlaceholderTitle")}
            subtitle={msg("map.mapPlaceholderSubtitle")}
            onRetry={() => this.setState({ error: null })}
            retryLabel={msg("map.mapRetry")}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
