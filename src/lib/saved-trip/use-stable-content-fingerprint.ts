import { useRef } from "react";

/**
 * 僅在 depSignatures 內容變更時重算指紋，避免 object reference 變動導致 useMemo 重算。
 */
export function useStableContentFingerprint(
  compute: () => string,
  depSignatures: readonly string[],
): string {
  const signature = depSignatures.join("\u0001");
  const cache = useRef({ signature: "", fingerprint: "" });
  if (cache.current.signature !== signature) {
    cache.current.signature = signature;
    cache.current.fingerprint = compute();
  }
  return cache.current.fingerprint;
}
