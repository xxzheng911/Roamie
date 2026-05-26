import { formatErrorDetail } from "@/lib/log-error";
import { renderRoamieErrorHtml } from "@/lib/app-error-html";

/** @deprecated 使用 renderRoamieErrorHtml；保留相容名稱 */
export function renderErrorPage(detail?: string): string {
  return renderRoamieErrorHtml(detail);
}

export function renderErrorPageFromUnknown(error: unknown): string {
  return renderRoamieErrorHtml(formatErrorDetail(error) ?? undefined);
}
