import { resolveApiUrl } from "@/lib/api-url";
import { getClientAuthSession } from "@/lib/auth-session";
import { reauthenticateAppleForAccountDeletion } from "@/lib/auth-apple-native";
import type { AuthProviderKind } from "@/lib/auth-provider";

export type AccountDeletionResult = { ok: true } | { ok: false; code: string; cancelled?: boolean };

export async function deleteCurrentAccount(
  provider: AuthProviderKind,
  requestId: string,
): Promise<AccountDeletionResult> {
  console.info("ACCOUNT_DELETION_CLIENT", { requestId, stage: "started" });
  const session = await getClientAuthSession({ skipWarm: true });
  if (!session?.access_token) {
    console.info("ACCOUNT_DELETION_CLIENT", { requestId, stage: "unauthorized" });
    return { ok: false, code: "account_deletion_unauthorized" };
  }
  let apple: { identityToken: string; authorizationCode: string } | undefined;
  if (provider === "apple") {
    const reauth = await reauthenticateAppleForAccountDeletion();
    if (!reauth.ok) return { ok: false, code: reauth.message, cancelled: reauth.cancelled };
    apple = { identityToken: reauth.identityToken, authorizationCode: reauth.authorizationCode };
  }
  const response = await fetch(resolveApiUrl("/api/account/delete"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId, apple }),
  });
  const body = (await response.json().catch(() => ({}))) as { completed?: boolean; error?: string };
  console.info("ACCOUNT_DELETION_CLIENT", {
    requestId,
    stage: body.completed ? "completed" : "failed",
    status: response.status,
    errorCode: body.completed ? undefined : (body.error ?? "account_deletion_failed"),
  });
  return body.completed
    ? { ok: true }
    : { ok: false, code: body.error ?? "account_deletion_failed" };
}
