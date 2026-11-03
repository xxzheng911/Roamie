import { useSyncExternalStore } from "react";
import { getDuoHingeSnapshot, subscribeDuoHinge } from "@/lib/layout/duo-hinge";
import {
  classifyDuoPosture,
  DUO_POSTURE_NONE,
  NOT_DUO_FLAT_PORTRAIT,
  NOT_DUO_LAPTOP,
  sameDuoPosture,
  type DuoFlatPortrait,
  type DuoLaptop,
  type DuoPosture,
} from "@/lib/layout/duo-laptop";

/**
 * iPhone Duo「筆電半開」姿勢：結合原生摺疊狀態（與 useDuoHinge 同一個 store）與 viewport 寬高。
 *
 * - 全站共用一組訂閱（module-level store），_app 與各頁面拿到的結果一致、同時切換。
 * - 旋轉動畫期間原生會連續送出方向互相矛盾的過渡狀態：計算結果必須連續穩定 STABLE_MS 才套用，
 *   期間任何變化都重新計時，避免版型閃爍。第一次訂閱時直接採用當下結果（無舊版型可閃爍）。
 * - 結果相同時回傳同一物件，不觸發 re-render。
 * - 非原生 iOS、SSR、不支援時恆為 { laptop: false }。
 *
 * 「直向攤平」（useDuoFlatPortrait）與筆電共用同一個 module-level store（#H3-3，見下方）。
 */

const STABLE_MS = 150;
const UNCERTAIN_FALLBACK_MS = 1000;

/**
 * #H3-3：筆電與直向攤平合為單一「上下版型」store（遲滯判斷）。
 * - classifyDuoPosture 回傳 null（不確定的過渡狀態）：維持目前版型、不提交；重設穩定計時（不確定期間
 *   不計入 STABLE_MS，之後回到同一明確結果須重新穩定），但保留最後一次明確的 pending 結果。
 * - 有 pending 且不確定連續持續 UNCERTAIN_FALLBACK_MS（自進入不確定起算）→ 提交該 pending（不等於 current 時），
 *   避免合起後停在不確定而卡在舊版型；期間收到明確結果即取消 fallback，回到 current 清空 pending，
 *   否則以新結果重新計時。沒有 pending 時不確定一律不動作、不排程計時器。
 * - 明確的新結果穩定 STABLE_MS 才提交；期間明確結果改變就以新結果重新計時，回到 current 則取消。
 *   計時到期時：當下不確定→不提交、轉入 fallback；當下為另一明確結果→重新計時；等於 current→取消。
 * - 筆電與直向攤平由同一次提交互換，useDuoLaptop／useDuoFlatPortrait 在同一次 render 一起改變，
 *   不會經過「兩者皆否」的手機版型。
 * - 第一次訂閱直接採用當下結果；當下不確定時視為 none（沒有舊版型可維持）。
 */
type PostureSnapshot = {
  posture: DuoPosture;
  laptop: DuoLaptop;
  flat: DuoFlatPortrait;
};

function toSnapshot(posture: DuoPosture): PostureSnapshot {
  if (posture.posture === "laptop") {
    return {
      posture,
      laptop: Object.freeze({
        laptop: true,
        foldTop: posture.foldTop,
        foldBottom: posture.foldBottom,
      }),
      flat: NOT_DUO_FLAT_PORTRAIT,
    };
  }
  if (posture.posture === "flat-portrait") {
    return {
      posture,
      laptop: NOT_DUO_LAPTOP,
      flat: Object.freeze({
        flat: true,
        foldTop: posture.foldTop,
        foldBottom: posture.foldBottom,
      }),
    };
  }
  return { posture: DUO_POSTURE_NONE, laptop: NOT_DUO_LAPTOP, flat: NOT_DUO_FLAT_PORTRAIT };
}

const INITIAL_SNAPSHOT = toSnapshot(DUO_POSTURE_NONE);

let current: PostureSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();
let unsubscribeHinge: (() => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let pending: DuoPosture | null = null;

function compute(): DuoPosture | null {
  if (typeof window === "undefined") return DUO_POSTURE_NONE;
  return classifyDuoPosture(getDuoHingeSnapshot(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

function clearStableTimer() {
  if (pendingTimer != null) clearTimeout(pendingTimer);
  pendingTimer = null;
}

function clearFallback() {
  if (fallbackTimer != null) clearTimeout(fallbackTimer);
  fallbackTimer = null;
}

function clearPending() {
  clearStableTimer();
  clearFallback();
  pending = null;
}

function commit(next: DuoPosture) {
  clearPending();
  if (sameDuoPosture(current.posture, next)) return;
  current = toSnapshot(next);
  listeners.forEach((listener) => listener());
}

function schedule(next: DuoPosture) {
  clearPending();
  pending = next;
  pendingTimer = setTimeout(onStable, STABLE_MS);
}

/** 進入不確定：重設穩定計時、保留 pending；有 pending 才排程 fallback（已在計時中則延續，不重設）。 */
function enterUncertain() {
  clearStableTimer();
  if (pending == null || fallbackTimer != null) return;
  fallbackTimer = setTimeout(onUncertainFallback, UNCERTAIN_FALLBACK_MS);
}

function onUncertainFallback() {
  fallbackTimer = null;
  const last = pending;
  if (last == null) return;
  // 明確結果應已由 handleChange 取消 fallback；保險起見到期時若已明確，照一般規則處理
  if (compute() != null) {
    handleChange();
    return;
  }
  commit(last);
}

function onStable() {
  pendingTimer = null;
  const last = pending;
  if (last == null) return;
  const stable = compute();
  // 到期時不確定：不提交，轉入 fallback
  if (stable == null) {
    enterUncertain();
    return;
  }
  if (sameDuoPosture(last, stable)) {
    commit(last);
    return;
  }
  if (sameDuoPosture(current.posture, stable)) {
    clearPending();
    return;
  }
  schedule(stable);
}

function handleChange() {
  const next = compute();
  // 不確定：維持目前版型；重設穩定計時但保留 pending，有 pending 時排程 fallback
  if (next == null) {
    enterUncertain();
    return;
  }
  clearFallback();
  if (sameDuoPosture(current.posture, next)) {
    clearPending();
    return;
  }
  // 同一明確結果且仍在穩定計時中：不重設；不確定之後回來（計時已被重設）則重新計時
  if (pending && pendingTimer != null && sameDuoPosture(pending, next)) return;
  schedule(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeHinge = subscribeDuoHinge(handleChange);
    window.addEventListener("resize", handleChange);
    window.addEventListener("orientationchange", handleChange);
    commit(compute() ?? DUO_POSTURE_NONE);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("resize", handleChange);
    window.removeEventListener("orientationchange", handleChange);
    unsubscribeHinge?.();
    unsubscribeHinge = null;
    clearPending();
    current = INITIAL_SNAPSHOT;
  };
}

const getLaptopSnapshot = (): DuoLaptop => current.laptop;
const getLaptopServerSnapshot = (): DuoLaptop => NOT_DUO_LAPTOP;
const getFlatSnapshot = (): DuoFlatPortrait => current.flat;
const getFlatServerSnapshot = (): DuoFlatPortrait => NOT_DUO_FLAT_PORTRAIT;

/** 筆電半開（API 不變）：由上下版型 store 衍生，非筆電時恆為 NOT_DUO_LAPTOP。 */
export function useDuoLaptop(): DuoLaptop {
  return useSyncExternalStore(subscribe, getLaptopSnapshot, getLaptopServerSnapshot);
}

/**
 * iPhone Duo 直向攤平（fullyOpen、直向、橫向分界或 viewport 中線）：與 useDuoLaptop 同一個 store、同一次切換。
 * 雙欄的優先序由呼叫端處理。非原生 iOS、SSR、不支援時恆為 { flat: false }。
 */
export function useDuoFlatPortrait(): DuoFlatPortrait {
  return useSyncExternalStore(subscribe, getFlatSnapshot, getFlatServerSnapshot);
}

function getDuoDeviceSnapshot(): boolean {
  return getDuoHingeSnapshot().supported;
}

function getDuoDeviceServerSnapshot(): boolean {
  return false;
}

/**
 * 是否為 iPhone Duo（原生 iOS 且裝置有 hinge）：只讀 hinge store 的 supported。
 * 非原生 iOS、SSR、外掛不存在時恆為 false。
 */
export function useDuoDevice(): boolean {
  return useSyncExternalStore(subscribeDuoHinge, getDuoDeviceSnapshot, getDuoDeviceServerSnapshot);
}
