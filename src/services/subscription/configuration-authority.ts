/** Same-user SDK calls may overlap; identity transitions wait for outstanding calls. */
export function createSubscriptionConfigurationAuthority(
  configureIdentity: (userId: string) => Promise<void>,
) {
  let configuredUserId: string | null = null;
  let admission: Promise<void> | null = null;
  const operations = new Set<Promise<unknown>>();

  // Serialize admission, not SDK operations. Acquiring the lease must be atomic with
  // configuration; otherwise simultaneous A/B requests can repeatedly reconfigure each other.
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const attempt = admission ? admission.then(work) : work();
    const settled = attempt.then(
      () => undefined,
      () => undefined,
    );
    admission = settled;
    void settled.then(() => {
      if (admission === settled) admission = null;
    });
    return attempt;
  };

  const configure = async (userId: string, signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted();
    if (!userId) throw new Error("revenuecat_user_id_missing");
    if (configuredUserId === userId) return;
    if (operations.size) await Promise.allSettled([...operations]);
    signal?.throwIfAborted();
    // A failed native transition must invalidate the old identity shortcut.
    configuredUserId = null;
    await configureIdentity(userId);
    configuredUserId = userId;
  };

  const ensureConfigured = (userId: string, signal?: AbortSignal): Promise<void> =>
    enqueue(() => configure(userId, signal));

  const runForIdentity = async <T>(
    userId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const lease = await enqueue(async () => {
      await configure(userId, signal);
      signal?.throwIfAborted();
      const result = Promise.resolve().then(operation);
      operations.add(result);
      void result.then(
        () => operations.delete(result),
        () => operations.delete(result),
      );
      // An envelope prevents the admission queue from awaiting the SDK operation.
      return { result };
    });
    return lease.result;
  };

  const clearConfiguredIdentity = (clearIdentity: () => Promise<void>): Promise<void> =>
    enqueue(async () => {
      await Promise.allSettled([...operations]);
      // The native bridge may still hold an identity after a failed transition.
      await clearIdentity();
      configuredUserId = null;
    });

  return {
    ensureConfigured,
    runForIdentity,
    clearConfiguredIdentity,
    getConfiguredUserId: () => configuredUserId,
  };
}
