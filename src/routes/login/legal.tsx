import { createFileRoute, redirect } from "@tanstack/react-router";
import { LEGAL_PATHS } from "@/lib/legal-navigation";
import { resolveLegalReturnTarget } from "@/lib/legal-return-target";

/** Preserve previously distributed links without mounting the Login/auth parent UI. */
export const Route = createFileRoute("/login/legal")({
  validateSearch: (search: Record<string, unknown>) => ({
    doc: search.doc === "privacy" ? ("privacy" as const) : ("terms" as const),
    from: resolveLegalReturnTarget(search.from),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: LEGAL_PATHS[search.doc],
      search: { from: search.from },
      replace: true,
      reloadDocument: true,
    });
  },
});
