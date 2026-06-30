import { useEffect, useState, type RefObject } from "react";

/** 元素進入 viewport（含 rootMargin）後回傳 true，且只觸發一次 */
export function useInViewport(
  ref: RefObject<Element | null>,
  options?: { rootMargin?: string; disabled?: boolean },
): boolean {
  const disabled = options?.disabled === true;
  const [visible, setVisible] = useState(disabled);

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin: options?.rootMargin ?? "120px", threshold: 0.01 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [disabled, options?.rootMargin]);

  return visible;
}
