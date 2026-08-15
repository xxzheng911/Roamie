import { supabaseAdmin } from "@/integrations/supabase/client.server";

export class AdminAuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 500,
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAdminUserIds(): ReadonlySet<string> {
  const raw = process.env.ROAMIE_ADMIN_USER_IDS;
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => UUID_PATTERN.test(value)),
  );
}

export function isAdminUser(userId: string): boolean {
  return readAdminUserIds().has(userId.trim().toLowerCase());
}

export function requireAdminUserId(userId: string): void {
  if (!isAdminUser(userId)) {
    throw new AdminAuthError(403, "Admin access required");
  }
}

export async function requireAdminFromRequest(request: Request): Promise<{ userId: string }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AdminAuthError(401, "Authentication required");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new AdminAuthError(401, "Authentication required");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.id) {
    throw new AdminAuthError(401, "Invalid authentication token");
  }
  requireAdminUserId(data.user.id);
  return { userId: data.user.id };
}
