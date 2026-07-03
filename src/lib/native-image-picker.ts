import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

/** Sheet 關閉後等待原生 picker present（iOS 建議 ≥300ms） */
export const NATIVE_IMAGE_PICKER_DELAY_MS = 300;

/** @deprecated 使用 NATIVE_IMAGE_PICKER_DELAY_MS */
export function nativeImagePickerDelayMs(): number {
  return isCapacitorNativeShell() ? NATIVE_IMAGE_PICKER_DELAY_MS : 320;
}

/** iOS WKWebView：暫時解除 scroll lock，讓原生相簿 / 相機可以彈出（web file input 備用） */
export function unlockDocumentScrollForNativePicker(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const prevHtml = html.style.overflow;
  const prevBody = body.style.overflow;

  html.style.overflow = "";
  body.style.overflow = "";

  return () => {
    if (prevHtml) html.style.overflow = prevHtml;
    else html.style.removeProperty("overflow");

    if (prevBody) body.style.overflow = prevBody;
    else body.style.removeProperty("overflow");
  };
}

/**
 * Web 備用：觸發隱藏 file input。
 * iOS Capacitor 應優先使用 @capacitor/camera，勿依賴此方法。
 */
export function safeTriggerFileInput(
  input: HTMLInputElement | null | undefined,
  onError?: (error: unknown) => void,
): void {
  if (!input) {
    onError?.(new Error("picker input missing"));
    return;
  }

  const restoreScroll = unlockDocumentScrollForNativePicker();
  const finish = () => window.setTimeout(restoreScroll, 2500);

  try {
    input.click();
  } catch (error) {
    onError?.(error);
  } finally {
    finish();
  }
}
