import { useState } from "react";
import { Copy, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { copyTextForMobile, toastCopyResult } from "@/lib/debug/clipboard-export";
import { isQaBuildEnabled } from "@/lib/qa-auth/build";
import { signInAsQaTestUser, type QaLoginDiagnosticSnapshot } from "@/lib/qa-auth/client";
import { APP_BUILD_NUMBER, APP_MARKETING_VERSION } from "@/constants/app";

type Props = {
  disabled?: boolean;
  onSuccess?: () => void;
};

export function QaTestLoginButton({ disabled, onSuccess }: Props) {
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<QaLoginDiagnosticSnapshot>({
    step: "idle",
    apiBaseUrl: null,
    requestUrl: null,
    httpStatus: null,
    responseBody: null,
    errorMessage: null,
    hasSession: false,
    envMode: import.meta.env.MODE,
    buildVersion: `${APP_MARKETING_VERSION} (${APP_BUILD_NUMBER})`,
    created_at: new Date().toISOString(),
  });

  if (!isQaBuildEnabled()) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          setDiagnostics((prev) => ({
            ...prev,
            step: "tap_received",
            envMode: import.meta.env.MODE,
            buildVersion: `${APP_MARKETING_VERSION} (${APP_BUILD_NUMBER})`,
            created_at: new Date().toISOString(),
          }));
          setBusy(true);
          void signInAsQaTestUser({ onDiagnostics: setDiagnostics })
            .then((result) => {
              if (!result.ok) {
                toast.error(result.message);
                return;
              }
              toast.success("已登入 QA 測試帳號");
              onSuccess?.();
            })
            .finally(() => setBusy(false));
        }}
        className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-dashed border-amber-500/60 bg-amber-500/10 py-3.5 text-[14px] font-medium text-amber-900 transition active:scale-[0.98] disabled:opacity-50 dark:text-amber-100"
      >
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
        {busy ? "測試登入中…" : "測試登入（QA · 無需 Google / Apple）"}
      </button>
      <div className="rounded-2xl border border-amber-300/80 bg-amber-50/90 p-2 text-[11px] leading-relaxed text-amber-950">
        <div className="mb-1 flex items-center justify-between">
          <p className="font-medium">QA 診斷</p>
          <button
            type="button"
            onClick={() => {
              const text = JSON.stringify(diagnostics, null, 2);
              void copyTextForMobile(text).then((ok) => {
                if (ok) toast.success("已複製 QA 診斷");
                else toastCopyResult(false);
              });
            }}
            className="inline-flex items-center gap-1 rounded-full border border-amber-400/70 bg-amber-100 px-2 py-0.5 text-[10px]"
          >
            <Copy className="h-3 w-3" />
            複製 QA 診斷
          </button>
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      </div>
    </div>
  );
}
