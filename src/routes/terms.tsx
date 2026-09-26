import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";
import { resolveLegalReturnTarget } from "@/lib/legal-return-target";

export const Route = createFileRoute("/terms")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: resolveLegalReturnTarget(search.from),
  }),
  head: () => ({ meta: [{ title: "Roamie 服務條款" }] }),
  component: TermsPage,
});

function TermsPage() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  return <LegalDocumentPage doc="terms" onBack={() => navigate({ to: from })} />;
}
