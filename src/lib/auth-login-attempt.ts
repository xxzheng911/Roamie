export function shouldIgnoreLoginFailure(input: {
  attempt: number;
  currentAttempt: number;
  succeeded: boolean;
  hasSession: boolean;
}): boolean {
  return input.attempt !== input.currentAttempt || input.succeeded || input.hasSession;
}
