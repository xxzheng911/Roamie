import assert from "node:assert/strict";
import {
  canResumeFailedExternalRequest,
  isPreflightOnlyState,
} from "../src/lib/account-deletion/account-deletion.server.ts";

const base = {
  request_id: "00000000-0000-4000-8000-000000000001",
  status: "authenticated",
  attempt_count: 1,
  last_error_code: null,
  apple_revoke_completed_at: null,
  storage_completed_at: null,
  analytics_completed_at: null,
  external_cleanup_completed_at: null,
};

assert.equal(isPreflightOnlyState({ ...base, last_error_code: "recent_auth_required" }), true);
assert.equal(
  isPreflightOnlyState({ ...base, last_error_code: "apple_recent_auth_required" }),
  true,
);
assert.equal(
  isPreflightOnlyState({
    ...base,
    last_error_code: "recent_auth_required",
    storage_completed_at: new Date().toISOString(),
  }),
  false,
);
assert.equal(
  canResumeFailedExternalRequest({
    ...base,
    status: "storage_complete",
    storage_completed_at: new Date().toISOString(),
    last_error_code: "account_collaboration_cleanup_failed",
  }),
  true,
);
assert.equal(
  canResumeFailedExternalRequest({
    ...base,
    status: "analytics_complete",
    analytics_completed_at: new Date().toISOString(),
    last_error_code: "revenuecat_customer_delete_failed",
  }),
  true,
);
assert.equal(
  canResumeFailedExternalRequest({
    ...base,
    status: "apple_revoke_complete",
    apple_revoke_completed_at: new Date().toISOString(),
    last_error_code: "account_storage_delete_failed",
  }),
  true,
);
assert.equal(
  canResumeFailedExternalRequest({
    ...base,
    last_error_code: "account_storage_delete_failed",
  }),
  true,
);
assert.equal(
  canResumeFailedExternalRequest({
    ...base,
    last_error_code: "account_deletion_already_in_progress",
  }),
  false,
);
assert.equal(canResumeFailedExternalRequest(base), false);

console.info("Account deletion state repair regression: PASS");
