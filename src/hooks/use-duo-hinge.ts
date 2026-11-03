import { useSyncExternalStore } from "react";
import {
  getDuoHingeServerSnapshot,
  getDuoHingeSnapshot,
  subscribeDuoHinge,
  type DuoHingeState,
} from "@/lib/layout/duo-hinge";

/**
 * iPhone Duo 原生摺疊狀態（狀態、角度、摺痕／遮擋區）。
 * 非原生 iOS、iOS 27.1 以前、外掛不存在或 SSR 時回傳 supported:false。
 */
export function useDuoHinge(): DuoHingeState {
  return useSyncExternalStore(subscribeDuoHinge, getDuoHingeSnapshot, getDuoHingeServerSnapshot);
}
