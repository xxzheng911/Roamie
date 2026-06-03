import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { QaTestLoginButton } from "@/components/qa/QaTestLoginButton";
import { APP_BUILD_NUMBER, APP_MARKETING_VERSION } from "@/constants/app";
import { finishPostAuthRedirect } from "@/lib/auth-post-redirect";
import { copyTextForMobile, toastCopyResult } from "@/lib/debug/clipboard-export";
import { isDiagnosticsModeEnabled } from "@/lib/debug/recommendation-diagnostics";
import { getAllPlacesApiTelemetry } from "@/lib/places-api-telemetry";
import { loadConversationContext } from "@/lib/conversation-context-store";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import { isQaBuildEnabled } from "@/lib/qa-auth/build";

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function JsonPreview({ data }: { data: unknown }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <pre className="max-h-48 overflow-auto rounded-2xl border border-border bg-background p-3 text-[10px] leading-relaxed">
      {text}
    </pre>
  );
}

export function DeveloperToolSections() {
  const navigate = useNavigate();
  const [memoryJson, setMemoryJson] = useState<unknown>(null);
  const [promptJson, setPromptJson] = useState<unknown>(null);
  const [loadingMemory, setLoadingMemory] = useState(false);

  const copyJson = useCallback(async (label: string, data: unknown) => {
    const ok = await copyTextForMobile(JSON.stringify(data, null, 2));
    toastCopyResult(ok);
    if (ok) toast.success(`已複製 ${label}`);
  }, []);

  const loadMemory = useCallback(async () => {
    setLoadingMemory(true);
    try {
      const row = await loadConversationContext();
      setMemoryJson({
        plus_memory: row?.plus_memory ?? null,
        destination: row?.destination ?? null,
        mood: row?.mood ?? null,
        session_extras: row?.session_extras ?? null,
        selected_places: row?.selected_places ?? null,
        updated_at: row?.updated_at ?? null,
      });
      setPromptJson({
        session_extras: row?.session_extras ?? null,
        destination: row?.destination ?? null,
        mood: row?.mood ?? null,
        travel_days: row?.travel_days ?? null,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  const bootInfo =
    typeof window !== "undefined" ? (window.__ROAMIE_BOOT__ ?? null) : null;

  const featureFlags = {
    mode: import.meta.env.MODE,
    marketingVersion: APP_MARKETING_VERSION,
    buildNumber: APP_BUILD_NUMBER,
    VITE_ROAMIE_QA: import.meta.env.VITE_ROAMIE_QA ?? "",
    VITE_ROAMIE_DEVELOPER: import.meta.env.VITE_ROAMIE_DEVELOPER ?? "",
    VITE_DEBUG_DIAGNOSTICS: import.meta.env.VITE_DEBUG_DIAGNOSTICS ?? "",
    VITE_APP_BUILD_VERSION: import.meta.env.VITE_APP_BUILD_VERSION ?? "",
    qaBuildEnabled: isQaBuildEnabled(),
    diagnosticsUiEnabled: isDiagnosticsModeEnabled(),
  };

  const placesTelemetry = getAllPlacesApiTelemetry();

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionTitle>QA Login &amp; Diagnostics</SectionTitle>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          切換至 QA 測試帳號（需 QA build）。若已登入其他帳號，成功後將覆寫 session。
        </p>
        <QaTestLoginButton
          onSuccess={() => {
            void (async () => {
              const to = await resolveStartupPath({ hasSession: true, source: "qa-test-login" });
              finishPostAuthRedirect(to, navigate, "developer-qa-login");
            })();
          }}
        />
      </section>

      <section className="space-y-2">
        <SectionTitle>AI Diagnostics</SectionTitle>
        <p className="rounded-2xl border border-border bg-background px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          解鎖後，首頁 / 地圖 / 聊聊的推薦卡會顯示「QA 推薦診斷」工具列，可匯出 JSON 快照。Server log 關鍵字：
          <code className="mx-1">[RECOMMENDATION_DIAGNOSTICS]</code>
        </p>
      </section>

      <section className="space-y-2">
        <SectionTitle>Memory Viewer</SectionTitle>
        <button
          type="button"
          disabled={loadingMemory}
          onClick={() => void loadMemory()}
          className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm disabled:opacity-50"
        >
          {loadingMemory ? "讀取中…" : "載入 conversation_context"}
        </button>
        {memoryJson ? (
          <>
            <JsonPreview data={memoryJson} />
            <button
              type="button"
              onClick={() => void copyJson("Memory", memoryJson)}
              className="text-xs text-muted-foreground underline"
            >
              複製 JSON
            </button>
          </>
        ) : null}
      </section>

      <section className="space-y-2">
        <SectionTitle>Places API Telemetry</SectionTitle>
        <JsonPreview data={placesTelemetry} />
        <p className="text-[11px] text-muted-foreground">
          即時 client 計數。完整 log 請搜尋 Console：<code>[PLACES_API_SUMMARY]</code>
        </p>
      </section>

      <section className="space-y-2">
        <SectionTitle>API Logs</SectionTitle>
        <JsonPreview
          data={{
            boot: bootInfo,
            hint: "啟用 roamie:boot-diagnostics=1 可輸出 ROAMIE_PHASE log",
          }}
        />
      </section>

      <section className="space-y-2">
        <SectionTitle>Prompt Inspector</SectionTitle>
        {promptJson ? (
          <JsonPreview data={promptJson} />
        ) : (
          <p className="text-xs text-muted-foreground">請先從 Memory Viewer 載入資料</p>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle>Feature Flags</SectionTitle>
        <JsonPreview data={featureFlags} />
      </section>
    </div>
  );

}
