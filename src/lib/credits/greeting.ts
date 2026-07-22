import {
  resolveCreditsGreetingStage,
  type CreditsGreetingStage,
} from "./constants";
import { isCreditsFeatureEnabled } from "./feature-flag";
import { fetchCreditAccount, getCachedCreditAccount, usableCredits } from "./account";

export type CreditsGreetingCopy = {
  stage: CreditsGreetingStage;
  /** Primary greeting body (may include soft/hard reminders) */
  content: string;
};

type GreetingI18n = {
  stage1: string;
  stage2: string;
  stage3: string;
  stage4: string;
};

/**
 * Build chat greeting for first entry / reset only.
 * Plus or flag-off → stage 1 (normal greeting).
 */
export function buildCreditsGreetingContent(
  copy: GreetingI18n,
  availableCredits: number,
  opts: { isPlus: boolean; creditsEnabled: boolean },
): CreditsGreetingCopy {
  const stage = resolveCreditsGreetingStage(availableCredits, {
    isPlus: opts.isPlus,
    creditsEnabled: opts.creditsEnabled,
  });
  // Each stage is a full greeting — never prepend stage1 (avoids duplicate openers).
  switch (stage) {
    case 2:
      return { stage, content: copy.stage2 };
    case 3:
      return { stage, content: copy.stage3 };
    case 4:
      return { stage, content: copy.stage4 };
    default:
      return { stage: 1, content: copy.stage1 };
  }
}

export async function resolveCreditsGreeting(
  copy: GreetingI18n,
  opts: { isPlus: boolean },
): Promise<CreditsGreetingCopy> {
  const creditsEnabled = isCreditsFeatureEnabled();
  if (!creditsEnabled || opts.isPlus) {
    return buildCreditsGreetingContent(copy, FREE_HINT, {
      isPlus: opts.isPlus,
      creditsEnabled,
    });
  }

  let account = getCachedCreditAccount();
  if (!account) {
    account = await fetchCreditAccount();
  }
  const available = account ? usableCredits(account) : FREE_HINT;
  return buildCreditsGreetingContent(copy, available, {
    isPlus: false,
    creditsEnabled: true,
  });
}

/** Hint used when account not yet loaded — assume full allotment (stage 1). */
const FREE_HINT = 20;
