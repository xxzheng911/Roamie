import { Copy, Download } from "lucide-react";
import { detectPlatform } from "@/services/platform";
import {
  copyDiagnosticsSnapshot,
  downloadDiagnosticsJson,
  isDiagnosticsModeEnabled,
  type DiagnosticsExportMeta,
  type RecommendationDiagnosticSnapshot,
} from "@/lib/debug/recommendation-diagnostics";

type Props = {
  scope: string;
  items: RecommendationDiagnosticSnapshot[];
  downloadPayload: Parameters<typeof downloadDiagnosticsJson>[0];
  exportMeta?: DiagnosticsExportMeta;
  className?: string;
  emptyHint?: string;
};

/** QA / debug：複製快照與下載 diagnostics.json（TestFlight 可見，非僅 DEV） */
export function RecommendationDiagnosticsToolbar({
  scope,
  items,
  downloadPayload,
  exportMeta,
  className,
  emptyHint = "尚無地點卡時仍可匯出，會包含此則回覆狀態與錯誤說明。",
}: Props) {
  if (!isDiagnosticsModeEnabled()) return null;

  const hasItems = items.length > 0;

  return (
    <div
      className={
        className ??
        "mb-2 flex flex-col items-end gap-1 rounded-xl border border-amber-300/80 bg-amber-50/95 px-3 py-2"
      }
    >
      <p className="w-full text-[10px] font-medium text-amber-950/80">QA 推薦診斷 · {scope}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copyDiagnosticsSnapshot(scope, items, exportMeta);
          }}
          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] text-amber-900 disabled:opacity-40"
        >
          <Copy className="h-3 w-3" />
          複製診斷快照
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void downloadDiagnosticsJson({
              ...downloadPayload,
              export_meta: exportMeta ?? downloadPayload.export_meta,
            });
          }}
          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] text-amber-900 disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          下載 diagnostics.json
        </button>
      </div>
      {!hasItems ? <p className="w-full text-[10px] text-amber-900/70">{emptyHint}</p> : null}
      {hasItems && detectPlatform().isCapacitor ? (
        <p className="w-full text-[10px] text-amber-900/60">
          iOS：下載會開啟分享面板，可選「儲存到檔案」；或直接複製後貼到備忘錄。
        </p>
      ) : null}
    </div>
  );
}
