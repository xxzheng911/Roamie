import { registerPlugin } from "@capacitor/core";

type SubscriptionManagementPlugin = {
  showManageSubscriptions(): Promise<void>;
};

const SubscriptionManagement =
  registerPlugin<SubscriptionManagementPlugin>("SubscriptionManagement");

export async function tryNativeSubscriptionManagement(): Promise<boolean> {
  if (!window.Capacitor?.isNativePlatform?.()) return false;

  try {
    await SubscriptionManagement.showManageSubscriptions();
    return true;
  } catch (error) {
    console.info(
      "[Roamie] native subscription management unavailable; using browser fallback",
      error instanceof Error ? error.name : "unknown",
    );
    return false;
  }
}
