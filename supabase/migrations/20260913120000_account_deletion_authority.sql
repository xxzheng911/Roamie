-- Server-only, retry-safe account deletion progress. Rows disappear with auth.users.
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN ('apple', 'google', 'email')),
  status text NOT NULL DEFAULT 'authenticated' CHECK (status IN (
    'authenticated', 'apple_revoke_complete', 'storage_complete', 'analytics_complete',
    'external_cleanup_complete'
  )),
  apple_revoke_completed_at timestamptz,
  storage_completed_at timestamptz,
  analytics_completed_at timestamptz,
  external_cleanup_completed_at timestamptz,
  last_error_code text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS account_deletion_requests_set_updated_at
  ON public.account_deletion_requests;
CREATE TRIGGER account_deletion_requests_set_updated_at
  BEFORE UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_requests TO service_role;

COMMENT ON TABLE public.account_deletion_requests IS
  'Service-role-only retry state; never stores Apple tokens or authorization codes.';

-- Short-lived, non-identifying receipt for the response-loss edge case: after
-- auth.users is gone, the same deletion request can still resolve as completed.
CREATE TABLE IF NOT EXISTS public.account_deletion_receipts (
  request_id uuid PRIMARY KEY,
  user_id_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.account_deletion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_receipts TO service_role;

COMMENT ON TABLE public.account_deletion_receipts IS
  'Service-role-only 24-hour idempotency receipts; stores a SHA-256 user-id hash, never credentials.';
