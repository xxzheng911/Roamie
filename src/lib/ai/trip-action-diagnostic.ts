/** Diagnostic metadata only; never an input to creation policy. */
export const actionSources = ['plan_ai_button', 'chat_generate_trip', 'chat_regenerate', 'style_selection', 'style_preview', 'manual_plan', 'unknown'] as const;
export type TripActionSource = typeof actionSources[number];
export type TripActionDiagnostic = { actionSource: TripActionSource; actionToken: string };
export function receiveTripAction(actionSource: TripActionSource, hasCreateAuthority = false): TripActionDiagnostic {
  const action = { actionSource, actionToken: crypto.randomUUID().replaceAll('-', '').slice(0, 8) };
  logTripAction('action_received', action, hasCreateAuthority);
  return action;
}
export function logTripAction(stage: 'action_received' | 'action_bound' | 'planner_started' | 'handoff_received', action: TripActionDiagnostic | undefined, hasCreateAuthority: boolean, correlationToken?: string): void {
  try {
    const bound = typeof correlationToken === 'string' && /^[a-f0-9]{8}$/.test(correlationToken);
    console.warn(`[AI_TRIP_ACTION_SOURCE] ${stage}`, JSON.stringify({
      actionSource: actionSources.includes(action?.actionSource as TripActionSource) ? action!.actionSource : 'unknown',
      hasCreateAuthority: hasCreateAuthority === true,
      actionToken: /^[a-f0-9]{8}$/.test(action?.actionToken ?? '') ? action!.actionToken : undefined,
      correlationToken: bound ? correlationToken : undefined,
      generationBound: bound,
    }));
  } catch { /* Diagnostics cannot affect control flow. */ }
}
export function chatActionSource(value: string): TripActionSource {
  if (/^(生成行程|生成完整行程|幫我生成)$/.test(value)) return 'chat_generate_trip';
  if (value === '重新生成') return 'chat_regenerate';
  return 'unknown';
}
