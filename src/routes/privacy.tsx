import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";

export const Route = createFileRoute("/privacy")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === "/login" ? ("/login" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Roamie 隱私權政策" },
      {
        name: "description",
        content: "Roamie 隱私權政策與資料使用說明。",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  return <LegalDocumentPage doc="privacy" onBack={() => navigate({ to: from ?? "/support" })} />;
}
