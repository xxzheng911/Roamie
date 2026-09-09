export function createSubscriptionConfigurationAuthority(
  configureIdentity: (userId: string) => Promise<void>,
) {
  let configuredUserId: string | null = null;
  let configurePromise: Promise<void> | null = null;

  const ensureConfigured = async (userId: string): Promise<void> => {
    if (!userId) throw new Error("revenuecat_user_id_missing");
    if (configuredUserId === userId) return;

    if (configurePromise) {
      await configurePromise;
      if (configuredUserId === userId) return;
      return ensureConfigured(userId);
    }

    const attempt = configureIdentity(userId);
    configurePromise = attempt;
    try {
      await attempt;
      configuredUserId = userId;
    } finally {
      if (configurePromise === attempt) configurePromise = null;
    }
  };

  const clearConfiguredIdentity = async (clearIdentity: () => Promise<void>): Promise<void> => {
    if (configurePromise) {
      await configurePromise;
      return clearConfiguredIdentity(clearIdentity);
    }
    if (!configuredUserId) return;

    const identityBeingCleared = configuredUserId;
    const attempt = clearIdentity();
    configurePromise = attempt;
    try {
      await attempt;
      if (configuredUserId === identityBeingCleared) configuredUserId = null;
    } finally {
      if (configurePromise === attempt) configurePromise = null;
    }
  };

  return {
    ensureConfigured,
    clearConfiguredIdentity,
    getConfiguredUserId() {
      return configuredUserId;
    },
  };
}
