import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bootstrapNativeShell, detectPlatform, type PlatformInfo } from "@/services/platform";

const Ctx = createContext<PlatformInfo | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<PlatformInfo>(() => detectPlatform());

  useEffect(() => {
    setInfo(detectPlatform());
    void bootstrapNativeShell();
  }, []);

  const value = useMemo(() => info, [info]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatform() {
  const ctx = useContext(Ctx);
  if (!ctx) return detectPlatform();
  return ctx;
}
