import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  ensureEffectiveLocationBootstrap,
  getEffectiveLocationSnapshot,
  subscribeEffectiveLocation,
} from "@/lib/effective-location";

export function useEffectiveLocation() {
  useLayoutEffect(() => {
    void ensureEffectiveLocationBootstrap();
  }, []);

  return useSyncExternalStore(
    subscribeEffectiveLocation,
    getEffectiveLocationSnapshot,
    getEffectiveLocationSnapshot,
  );
}
