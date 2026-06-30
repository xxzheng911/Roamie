import { Component, type ErrorInfo, type ReactNode } from "react";
import { RoamieAppErrorFallback } from "@/components/RoamieAppErrorFallback";
import { formatErrorDetail, logAppError, logAppErrorDetail } from "@/lib/log-error";

type Props = {
  children: ReactNode;
  routeLabel?: string;
};

type State = { error: Error | null };

/** 攔截 Provider／子樹 render 錯誤，避免落入預設英文錯誤頁 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentLine =
      info.componentStack
        ?.split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";

    logAppErrorDetail(error, {
      route: typeof window !== "undefined" ? window.location.pathname : "",
      component: componentLine,
      componentStack: info.componentStack ?? "",
      propsSnapshot: {
        routeLabel: this.props.routeLabel ?? "",
      },
    });
    logAppError("[Roamie] AppErrorBoundary", error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      const detail = formatErrorDetail(this.state.error);

      return (
        <RoamieAppErrorFallback
          title="Roamie 暫時無法啟動"
          message="App 初始化時發生錯誤。請重試，或重新啟動。"
          detail={detail}
          onRetry={() => this.setState({ error: null }, () => window.location.reload())}
          onHome={() => {
            this.setState({ error: null }, () => {
              window.location.href = "/login";
            });
          }}
        />
      );
    }

    return this.props.children;
  }
}
