import { useCallback, useEffect, useRef } from "react";

/** Invalidates UI completions only; never cancels a StoreKit transaction. */
export function useSubscriptionOperation(userId: string | undefined) {
  const scope = useRef({ userId, generation: 0, mounted: false });
  if (scope.current.userId !== userId) {
    scope.current.userId = userId;
    scope.current.generation += 1;
  }
  useEffect(() => {
    const lifetime = scope.current;
    lifetime.mounted = true;
    return () => {
      lifetime.mounted = false;
      lifetime.generation += 1;
    };
  }, []);
  return useCallback(() => {
    const generation = ++scope.current.generation;
    const identity = scope.current.userId;
    return () =>
      scope.current.mounted &&
      scope.current.generation === generation &&
      scope.current.userId === identity;
  }, []);
}
