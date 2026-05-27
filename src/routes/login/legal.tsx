import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LegalDocumentPage, type LegalDocumentKind } from "@/components/LegalDocumentPage";

type LegalSearch = {
  doc: LegalDocumentKind;
};

function parseLegalSearch(search: Record<string, unknown>): LegalSearch {
  return {
    doc: search.doc === "privacy" ? "privacy" : "terms",
  };
}

export const Route = createFileRoute("/login/legal")({
  validateSearch: parseLegalSearch,
  component: LoginLegalPage,
});

function LoginLegalPage() {
  const { doc } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <LegalDocumentPage doc={doc} onBack={() => navigate({ to: "/login", replace: true })} />
  );
}
