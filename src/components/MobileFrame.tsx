import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** iPhone Duo（右側直欄）：不限寬、不套手機外框；未傳時 className 與修改前相同 */
  fullBleed?: boolean;
};

export function MobileFrame({ children, fullBleed = false }: Props) {
  return (
    <div className="mobile-frame-outer flex min-h-[100dvh] w-full justify-center bg-[oklch(0.93_0.02_75)] grain md:bg-transparent">
      <div
        className={
          fullBleed
            ? "mobile-frame-inner relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background"
            : "mobile-frame-inner relative flex h-[100dvh] w-full max-w-[440px] flex-col overflow-hidden bg-background shadow-lift md:my-6 md:h-[min(900px,100dvh)] md:rounded-[3rem] md:border md:border-border"
        }
      >
        {children}
      </div>
    </div>
  );
}
