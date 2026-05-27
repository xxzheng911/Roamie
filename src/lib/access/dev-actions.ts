import { clearChatHistory } from "@/lib/chat-history";
import { clearChatSession } from "@/lib/chat-session";
import { listItineraries, deleteItinerary } from "@/lib/itinerary-storage";
import { listPlaces, deletePlace } from "@/lib/places-storage";
import { savePreferences } from "@/lib/preferences-storage";
import { clearCompanionModeSelection } from "@/lib/companion-mode-storage";
import { clearOnboardingCompleted } from "@/lib/onboarding-storage";
import { broadcastAccessChange } from "./events";
import { setMockSubscriptionTier, setTestModeOverride } from "./resolve";
import type { SubscriptionState, TestModeOverride } from "./types";

/** Clear AI chat history + session memory */
export async function resetUserMemory(): Promise<void> {
  await clearChatHistory();
  clearChatSession();
}

/** Reset travel preference quiz + personality fields */
export async function resetTravelPreference(): Promise<void> {
  await savePreferences({
    onboarded: false,
    personalityType: undefined,
    personalitySummary: undefined,
    pace: undefined,
    avoid: undefined,
    vibe: undefined,
    budgetMode: undefined,
    interests: undefined,
  });
}

/** Delete all saved places and user-saved trips */
export async function clearSavedCollections(): Promise<void> {
  const [places, trips] = await Promise.all([listPlaces(), listItineraries()]);
  await Promise.all([
    ...places.map((p) => deletePlace(p.id)),
    ...trips.map((t) => deleteItinerary(t.id)),
  ]);
}

export async function forceOnboarding(): Promise<void> {
  // Dev-only: reset companion mode selection & quiz state.
  clearCompanionModeSelection();
  await clearOnboardingCompleted();
  await resetTravelPreference();
}

export function forceFreeMode(): void {
  setTestModeOverride("force-free");
}

export function forcePlusMode(): void {
  setTestModeOverride("force-plus");
}

export function clearTestModeOverride(): void {
  setTestModeOverride("none");
}

export function applyMockSubscription(tier: SubscriptionState): void {
  setMockSubscriptionTier(tier);
}

export function applyTestOverride(mode: TestModeOverride): void {
  setTestModeOverride(mode);
  broadcastAccessChange();
}
