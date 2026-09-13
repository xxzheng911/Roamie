import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LegalDocumentPage, type LegalDocumentKind } from "@/components/LegalDocumentPage";
import { resolveLegalReturnTarget } from "@/lib/legal-return-target";

type LegalSearch = {
  doc: LegalDocumentKind;
  from?: string;
};

function parseLegalSearch(search: Record<string, unknown>): LegalSearch {
  return {
    doc: search.doc === "privacy" ? "privacy" : "terms",
    from: typeof search.from === "string" ? search.from : undefined,
  };
}

export const Route = createFileRoute("/login/legal")({
  validateSearch: parseLegalSearch,
  component: LoginLegalPage,
});

function LoginLegalPage() {
  const { doc, from } = Route.useSearch();
  const navigate = useNavigate();
  const backTarget = resolveLegalReturnTarget(from);

  return <LegalDocumentPage doc={doc} onBack={() => navigate({ to: backTarget, replace: true })} />;
}
