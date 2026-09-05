import type { BudgetMode } from "@/lib/preferences-storage";

export type BudgetScope = "trip" | "meal" | "lodging" | "transport" | "activity";
export type BudgetContextSource = "explicit" | "trip" | "plus_profile" | "default";

export type ExplicitBudgetConstraint = {
  mode?: BudgetMode;
  unrestricted?: boolean;
  scope?: BudgetScope;
};

export type BudgetContext = {
  spendingPreference?: BudgetMode;
  tripMode?: BudgetMode;
  explicitMode?: BudgetMode;
  unrestricted?: boolean;
  scope?: BudgetScope;
  effectiveMode?: BudgetMode;
  source: BudgetContextSource;
};

export function parseExplicitBudgetConstraint(text: string): ExplicitBudgetConstraint | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const scope: BudgetScope = /(?:飯店|旅館|住宿|房價)/i.test(normalized)
    ? "lodging"
    : /(?:晚餐|午餐|早餐|宵夜|餐廳|吃|用餐|這餐)/i.test(normalized)
      ? "meal"
      : "trip";

  if (/(?:預算不限|不限預算|價格不限|不在意價格)/i.test(normalized)) {
    return { unrestricted: true, scope };
  }
  if (/(?:省錢|平價|便宜一點|便宜些|小資|低預算)/i.test(normalized)) {
    return { mode: "budget", scope };
  }
  if (/(?:一般預算|正常預算)/i.test(normalized)) {
    return { mode: "standard", scope };
  }
  if (/(?:品質好一點|有質感一點|品質感)/i.test(normalized)) {
    return { mode: "quality", scope };
  }
  if (/(?:預算高一點|奢華|豪華|luxury)/i.test(normalized)) {
    return { mode: "luxury", scope };
  }
  return null;
}

export function resolveBudgetContext(input: {
  spendingPreference?: BudgetMode;
  tripMode?: BudgetMode;
  explicit?: ExplicitBudgetConstraint | null;
  requestScope?: BudgetScope;
}): BudgetContext {
  const explicitApplies =
    Boolean(input.explicit) &&
    (!input.requestScope ||
      input.explicit?.scope === "trip" ||
      input.explicit?.scope === input.requestScope);

  if (explicitApplies && input.explicit?.unrestricted) {
    return {
      spendingPreference: input.spendingPreference,
      tripMode: input.tripMode,
      unrestricted: true,
      scope: input.explicit.scope,
      source: "explicit",
    };
  }
  if (explicitApplies && input.explicit?.mode) {
    return {
      spendingPreference: input.spendingPreference,
      tripMode: input.tripMode,
      explicitMode: input.explicit.mode,
      scope: input.explicit.scope,
      effectiveMode: input.explicit.mode,
      source: "explicit",
    };
  }
  if (input.tripMode) {
    return {
      spendingPreference: input.spendingPreference,
      tripMode: input.tripMode,
      effectiveMode: input.tripMode,
      source: "trip",
    };
  }
  if (input.spendingPreference) {
    return {
      spendingPreference: input.spendingPreference,
      effectiveMode: input.spendingPreference,
      source: "plus_profile",
    };
  }
  return { effectiveMode: "standard", source: "default" };
}

export function budgetModeToPlannerTier(mode: BudgetMode | undefined): "low" | "medium" | "high" {
  if (mode === "budget") return "low";
  if (mode === "luxury") return "high";
  return "medium";
}
