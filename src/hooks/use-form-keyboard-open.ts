import { useKeyboardOverlay } from "@/hooks/use-keyboard-overlay";

/** 表單頁：鍵盤 overlay + 隱藏 Tab Bar（shared keyboard helper） */
export function useFormKeyboardOpen(htmlClass: string): ReturnType<typeof useKeyboardOverlay> {
  return useKeyboardOverlay({
    pageClass: htmlClass,
    routeHint: htmlClass,
  });
}
