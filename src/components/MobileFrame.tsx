import { ReactNode } from "react";

export function MobileFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-frame-outer flex min-h-[100dvh] w-full justify-center bg-[oklch(0.93_0.02_75)] grain md:bg-transparent">
      <div className="mobile-frame-inner relative flex h-[100dvh] w-full max-w-[440px] flex-col overflow-hidden bg-background shadow-lift md:my-6 md:h-[min(900px,100dvh)] md:rounded-[3rem] md:border md:border-border">
        {children}
      </div>
    </div>
  );
}
