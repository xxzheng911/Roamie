import { useSyncExternalStore } from "react";
import {
  getUserMediaSnapshot,
  subscribeUserMedia,
  type UserMediaSnapshot,
} from "@/lib/user-media/user-media-store";

export function useUserMediaStore(): UserMediaSnapshot {
  return useSyncExternalStore(subscribeUserMedia, getUserMediaSnapshot, getUserMediaSnapshot);
}
