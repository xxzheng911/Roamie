import type { CreditsFeatureType } from "./constants";

export type CreditsPlan = "free" | "plus";

export type CreditsEnvironment = "debug" | "production";

export type CreditLedgerStatus = "reserved" | "committed" | "rolled_back" | "skipped";

export type CreditAccount = {
  user_id: string;
  plan: CreditsPlan;
  monthly_limit: number;
  /** Effective available (Debug Override preferred when active) */
  available_credits: number;
  reserved_credits: number;
  period_start: string;
  period_end: string;
  last_reset_at: string | null;
  created_at: string;
  updated_at: string;
  /** True when credit_debug_overrides row exists */
  override_active?: boolean;
  formal_available_credits?: number;
  formal_reserved_credits?: number;
  environment?: CreditsEnvironment;
};

export type CreditsCheckResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  available_credits?: number;
  reserved_credits?: number;
  usable_credits?: number;
  required?: number;
  plan?: CreditsPlan;
  override_active?: boolean;
  environment?: CreditsEnvironment | string;
};

export type CreditsReserveResult = {
  ok: boolean;
  idempotent?: boolean;
  ledger_id?: string | null;
  status?: CreditLedgerStatus | string;
  amount?: number;
  skipped?: boolean;
  reason?: string;
  available_credits?: number;
  reserved_credits?: number;
  usable_credits?: number;
  required?: number;
  plan?: CreditsPlan;
  override_active?: boolean;
  environment?: CreditsEnvironment | string;
};

export type CreditsCommitResult = {
  ok: boolean;
  idempotent?: boolean;
  skipped?: boolean;
  ledger_id?: string | null;
  status?: string;
  amount?: number;
  reason?: string;
  available_credits?: number;
  reserved_credits?: number;
  override_active?: boolean;
  environment?: CreditsEnvironment | string;
};

export type CreditsRollbackResult = CreditsCommitResult & {
  noop?: boolean;
};

export type CreditsOperationHandle = {
  featureType: CreditsFeatureType;
  requestId: string;
  idempotencyKey: string;
  ledgerId: string | null;
  amount: number;
  skipped: boolean;
  /** true when feature flag off, Plus, or reserve skipped */
  inactive: boolean;
  commit: () => Promise<CreditsCommitResult>;
  rollback: () => Promise<CreditsRollbackResult>;
};

export type BeginCreditsOptions = {
  featureType: CreditsFeatureType;
  requestId: string;
  /** Defaults to requestId */
  idempotencyKey?: string;
  /** Effective Plus (includes Debug Force Plus) */
  hasPlusAccess: boolean;
  metadata?: Record<string, unknown>;
  amount?: number;
};

export type BeginCreditsResult =
  | { blocked: false; handle: CreditsOperationHandle }
  | {
      blocked: true;
      reason: "insufficient" | "unauthenticated" | "error";
      required: number;
      available: number;
      message: string;
    };
