export type LatestRequestToken = Readonly<{
  sequence: number;
  scope: string;
}>;

export type LatestRequestGuard = {
  begin(scope: string): LatestRequestToken;
  isCurrent(token: LatestRequestToken): boolean;
  invalidate(): void;
};

/** Guards UI state from stale async completions without relying on transport abort support. */
export function createLatestRequestGuard(): LatestRequestGuard {
  let sequence = 0;
  let active: LatestRequestToken | null = null;
  return {
    begin(scope) {
      active = { sequence: ++sequence, scope };
      return active;
    },
    isCurrent(token) {
      return active?.sequence === token.sequence && active.scope === token.scope;
    },
    invalidate() {
      active = null;
      sequence += 1;
    },
  };
}
