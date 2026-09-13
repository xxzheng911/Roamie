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
  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 border-b border-border/70 pb-8 sm:mb-12 sm:pb-10">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-primary">
            Roamie Travel
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Roamie 支援
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
            如果你在使用 Roamie 時遇到問題，可以透過以下方式取得協助。
          </p>
        </header>

        <div className="space-y-5 sm:space-y-6">
          <SupportSection title="聯絡我們">
            <p>
              客服信箱：
              <a
                className="font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
                href={`mailto:${ROAMIE_CONTACT_EMAIL}`}
              >
                {ROAMIE_CONTACT_EMAIL}
              </a>
            </p>
          </SupportSection>

          <SupportSection title="訂閱與 Roamie Plus">
            <ul className="list-disc space-y-2 pl-5 marker:text-primary">
              <li>Roamie Plus 透過 Apple App Store 訂閱。</li>
              <li>已購買的訂閱可在 App 內使用「恢復購買」。</li>
              <li>若更換帳號，可使用相同 App Store 購買身分恢復有效訂閱。</li>
              <li>若訂閱已取消，Plus 權益會持續到目前付費期間結束。</li>
            </ul>
          </SupportSection>

          <SupportSection title="帳號與資料">
            <ul className="list-disc space-y-2 pl-5 marker:text-primary">
              <li>使用者可直接在 App 內刪除帳號。</li>
              <li>刪除帳號會移除行程、收藏、個人偏好、頭像等 Roamie 帳號資料。</li>
              <li>Apple App Store 訂閱不會因刪除 Roamie 帳號自動取消。</li>
            </ul>
          </SupportSection>

          <SupportSection title="常見問題">
            <div className="divide-y divide-border/70">
              {frequentlyAskedQuestions.map((item) => (
                <div className="py-4 first:pt-0 last:pb-0" key={item.title}>
                  <h3 className="font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1">{item.answer}</p>
                </div>
              ))}
            </div>
          </SupportSection>

          <SupportSection title="隱私權政策">
            <p>
              關於資料蒐集、使用與帳號刪除方式，請參閱
              <a
                className="ml-1 font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
                href={PRIVACY_POLICY_URL}
              >
                Roamie 隱私權政策
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
