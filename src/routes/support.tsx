import { useI18n } from "@/hooks/use-i18n";
import { createFileRoute } from "@tanstack/react-router";
import { ROAMIE_CONTACT_EMAIL } from "@/constants/contact";

const PRIVACY_POLICY_URL = "/privacy";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Roamie 支援" },
      {
        name: "description",
        content: "Roamie 客服與使用支援，包括帳號、訂閱、行程與常見問題。",
      },
    ],
  }),
  component: SupportPage,
});

const frequentlyAskedQuestions = [
  {
    title: "無法登入",
    answer: "請確認網路連線後重新開啟 App，再使用原本的 Apple 或 Google 帳號登入。",
  },
  {
    title: "無法恢復購買",
    answer:
      "請確認裝置使用原本的 App Store 購買身分，並在 App 內選擇「恢復購買」。若仍未恢復，請聯絡我們。",
  },
  {
    title: "行程或收藏沒有顯示",
    answer: "請先確認登入的是原本的 Roamie 帳號，並在網路連線正常時重新開啟 App。",
  },
  {
    title: "定位權限相關",
    answer:
      "定位權限用於附近推薦、距離與地圖相關功能。你仍可在未授權定位時使用帳號、行程與收藏功能。",
  },
  {
    title: "完全離線時可以使用哪些功能？",
    answer:
      "完全離線時，部分已快取的行程與收藏仍可查看；地圖、附近推薦及其他即時資料需待網路恢復後載入。",
  },
] as const;

function SupportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {title}
      </h2>
      <div className="mt-4 space-y-3 text-[15px] leading-7 text-muted-foreground sm:text-base">
        {children}
      </div>
    </section>
  );
}

function SupportPage() {
  const { t: uiT } = useI18n();

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 border-b border-border/70 pb-8 sm:mb-12 sm:pb-10">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-primary">
            Roamie Travel
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {uiT("productionUi.pf9905ed894")}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
            {uiT("productionUi.pcd69bbcab7")}
          </p>
        </header>

        <div className="space-y-5 sm:space-y-6">
          <SupportSection title={uiT("productionUi.pae305ba895")}>
            <p>
              {uiT("productionUi.p38514140e3")}
              <a
                className="font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
                href={`mailto:${ROAMIE_CONTACT_EMAIL}`}
              >
                {ROAMIE_CONTACT_EMAIL}
              </a>
            </p>
          </SupportSection>

          <SupportSection title={uiT("productionUi.pb2fecc9d50")}>
            <ul className="list-disc space-y-2 pl-5 marker:text-primary">
              <li>{uiT("productionUi.pba9333853a")}</li>
              <li>{uiT("productionUi.p85a6c42ad4")}</li>
              <li>{uiT("productionUi.p0b52230bce")}</li>
              <li>{uiT("productionUi.p1916b3bada")}</li>
            </ul>
          </SupportSection>

          <SupportSection title={uiT("productionUi.pa6733c3559")}>
            <ul className="list-disc space-y-2 pl-5 marker:text-primary">
              <li>{uiT("productionUi.pac93b4b669")}</li>
              <li>{uiT("productionUi.pf8a8a7b329")}</li>
              <li>{uiT("productionUi.p7db3f60c0a")}</li>
            </ul>
          </SupportSection>

          <SupportSection title={uiT("productionUi.pf92d99c762")}>
            <div className="divide-y divide-border/70">
              {frequentlyAskedQuestions.map((item) => (
                <div className="py-4 first:pt-0 last:pb-0" key={item.title}>
                  <h3 className="font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1">{item.answer}</p>
                </div>
              ))}
            </div>
          </SupportSection>

          <SupportSection title={uiT("productionUi.p5d1a4adc5d")}>
            <p>
              {uiT("productionUi.pa99818b942")}
              <a
                className="ml-1 font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
                href={PRIVACY_POLICY_URL}
              >
                {uiT("productionUi.pace240822b")}
              </a>
              。
            </p>
          </SupportSection>
        </div>

        <footer className="mt-12 border-t border-border/70 pt-8 text-center text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Roamie Travel</p>
          <p>© 2026 Roamie Travel</p>
        </footer>
      </div>
    </main>
  );
}
