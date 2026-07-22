import { supabase } from "@/integrations/supabase/client";
import type { CreditAccount, CreditsEnvironment } from "./types";

type RpcAccountPayload = {
  user_id: string;
  plan: string;
  monthly_limit: number;
  available_credits: number;
  reserved_credits: number;
  period_start: string;
  period_end: string;
  last_reset_at: string | null;
  created_at: string;
  updated_at: string;
  override_active?: boolean;
  formal_available_credits?: number;
  formal_reserved_credits?: number;
  environment?: string;
};

function mapAccount(row: RpcAccountPayload): CreditAccount {
  return {
    user_id: row.user_id,
    plan: row.plan === "plus" ? "plus" : "free",
    monthly_limit: row.monthly_limit,
    /** Effective balance: Debug Override wins when active */
    available_credits: row.available_credits,
    reserved_credits: row.reserved_credits,
    period_start: row.period_start,
    period_end: row.period_end,
    last_reset_at: row.last_reset_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    override_active: Boolean(row.override_active),
    formal_available_credits: row.formal_available_credits ?? row.available_credits,
    formal_reserved_credits: row.formal_reserved_credits ?? row.reserved_credits,
    environment: (row.environment === "debug" ? "debug" : "production") as CreditsEnvironment,
  };
}

let memorySnapshot: CreditAccount | null = null;

export function getCachedCreditAccount(): CreditAccount | null {
  return memorySnapshot;
}

export function setCachedCreditAccount(account: CreditAccount | null): void {
  memorySnapshot = account;
}

export async function fetchCreditAccount(): Promise<CreditAccount | null> {
  const { data, error } = await supabase.rpc("credits_get_account");
  if (error) {
    console.warn("[CREDITS_GET_ACCOUNT]", error.message);
    return memorySnapshot;
  }
  if (!data) return memorySnapshot;
  const account = mapAccount(data as RpcAccountPayload);
  memorySnapshot = account;
  return account;
}

/** Usable = effective available − effective reserved (Override preferred by server). */
export function usableCredits(account: CreditAccount | null | undefined): number {
  if (!account) return 0;
  return Math.max(0, account.available_credits - account.reserved_credits);
}
