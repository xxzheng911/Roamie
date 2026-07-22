import { supabase } from "@/integrations/supabase/client";
import {
  clearTestModeOverride,
  forceFreeMode,
  forcePlusMode,
} from "@/lib/access/dev-actions";
import { broadcastAccessChange } from "@/lib/access/events";
import { fetchCreditAccount, setCachedCreditAccount } from "./account";
import { DEBUG_CREDIT_PRESETS, FREE_MONTHLY_CREDITS } from "./constants";
import { isCreditsFeatureEnabled } from "./feature-flag";

export { DEBUG_CREDIT_PRESETS };

export type CreditsDebugResult = {
  ok: boolean;
  available_credits?: number;
  reserved_credits?: number;
  formal_available_credits?: number;
  formal_reserved_credits?: number;
  override_active?: boolean;
  environment?: string;
  plan?: string;
  deducted?: number;
  message?: string;
};

/**
 * Debug Credits Override — writes credit_debug_overrides only.
 * Never mutates formal credit_accounts.available_credits.
 * Runtime prefers Override when present.
 */
export async function debugSetCredits(available: number): Promise<CreditsDebugResult> {
  if (!DEBUG_CREDIT_PRESETS.includes(available as (typeof DEBUG_CREDIT_PRESETS)[number])) {
    return { ok: false, message: `preset must be one of ${DEBUG_CREDIT_PRESETS.join(",")}` };
  }
  const { data, error } = await supabase.rpc("credits_debug_set", {
    p_available: available,
    p_force_plan: "free",
  });
  if (error) return { ok: false, message: error.message };
  const result = (data ?? { ok: false }) as CreditsDebugResult;
  if (result.ok) {
    forceFreeMode();
    broadcastAccessChange();
    await fetchCreditAccount();
  }
  return result;
}

export async function debugResetCredits(): Promise<CreditsDebugResult> {
  const { data, error } = await supabase.rpc("credits_debug_reset");
  if (error) return { ok: false, message: error.message };
  const result = (data ?? { ok: false }) as CreditsDebugResult;
  if (result.ok) {
    forceFreeMode();
    broadcastAccessChange();
    await fetchCreditAccount();
  }
  return result;
}

export async function debugDeductOneCredit(): Promise<CreditsDebugResult> {
  const { data, error } = await supabase.rpc("credits_debug_deduct", { p_amount: 1 });
  if (error) return { ok: false, message: error.message };
  const result = (data ?? { ok: false }) as CreditsDebugResult;
  if (result.ok) await fetchCreditAccount();
  return result;
}

/** Clear Credits Debug Override → Runtime reads formal credits again. */
export async function debugClearCreditsOverride(): Promise<CreditsDebugResult> {
  const { data, error } = await supabase.rpc("credits_debug_clear_override");
  if (error) return { ok: false, message: error.message };
  const result = (data ?? { ok: false }) as CreditsDebugResult;
  setCachedCreditAccount(null);
  await fetchCreditAccount();
  return result;
}

/** Subscription Debug: Auto — read real Apple / Supabase subscription */
export function debugSubscriptionAuto(): void {
  clearTestModeOverride();
  broadcastAccessChange();
}

export function debugForceFree(): void {
  forceFreeMode();
  broadcastAccessChange();
}

export function debugForcePlus(): void {
  forcePlusMode();
  broadcastAccessChange();
}

/**
 * Clear subscription Force override (→ Auto) and Credits Debug Override.
 */
export async function debugClearOverride(): Promise<void> {
  clearTestModeOverride();
  broadcastAccessChange();
  await debugClearCreditsOverride();
}

export function creditsDebugStatusLine(opts: {
  available?: number | null;
  formalAvailable?: number | null;
  overrideActive?: boolean;
  hasPlusAccess: boolean;
  subscriptionMode?: "auto" | "force-free" | "force-plus";
}): string {
  const flag = isCreditsFeatureEnabled() ? "ON" : "OFF";
  const plan = opts.hasPlusAccess ? "Plus" : "Free";
  const avail =
    typeof opts.available === "number" ? String(opts.available) : "?";
  const formal =
    typeof opts.formalAvailable === "number" ? String(opts.formalAvailable) : "?";
  const ov = opts.overrideActive ? "override" : "formal";
  const sub = opts.subscriptionMode ?? "auto";
  return (
    `Credits flag=${flag} · plan=${plan} · effective=${avail}/${FREE_MONTHLY_CREDITS}` +
    ` (${ov}) · formal=${formal} · sub=${sub}`
  );
}
