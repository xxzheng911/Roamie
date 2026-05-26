import type { ReactNode } from "react";

export function markSessionBootstrapped(): void {
  // Kept for compatibility; cold-start gate removed.
}

export function clearSessionBootstrapForDev(): void {
  // Kept for compatibility; cold-start gate removed.
}

type Props = { children: ReactNode };

export function StartupGate({ children }: Props) {
  return children;
}
