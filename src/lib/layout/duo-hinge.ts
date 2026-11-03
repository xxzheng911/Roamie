import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { detectPlatform } from "@/services/platform";

/**
 * iPhone Duo 原生摺疊狀態（ios/App/App/DuoHingePlugin.swift，jsName "DuoHinge"）。
 *
 * - 座標為 WKWebView 座標系（points，1:1 對應 CSS px）。
 * - angle 單位為「度」（原生端已由 radians 換算，四捨五入到 0.1）；未知時為 null。
 * - 只在 Capacitor 原生 iOS 才呼叫外掛；web／Android／SSR 一律回傳 unsupported。
 * - 外掛不存在或呼叫失敗時安靜退回 unsupported（不 throw、不 toast）。
 */

export type DuoHingeStatus = "unknown" | "closed" | "partiallyOpen" | "fullyOpen";

export type DuoHingeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
};

export type DuoHingeState = {
  supported: boolean;
  status: DuoHingeStatus;
  angle: number | null;
  divisions: DuoHingeRect[];
  occlusions: DuoHingeRect[];
};

type DuoHingePlugin = {
  getState(): Promise<unknown>;
  addListener(
    eventName: "hingeChange",
    listener: (data: unknown) => void,
  ): Promise<PluginListenerHandle>;
};

export const UNSUPPORTED_DUO_HINGE_STATE: DuoHingeState = Object.freeze({
  supported: false,
  status: "unknown",
  angle: null,
  divisions: Object.freeze([]) as unknown as DuoHingeRect[],
  occlusions: Object.freeze([]) as unknown as DuoHingeRect[],
}) as DuoHingeState;

const STATUSES: ReadonlySet<string> = new Set(["unknown", "closed", "partiallyOpen", "fullyOpen"]);

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRect(raw: unknown): DuoHingeRect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const x = finiteNumber(r.x);
  const y = finiteNumber(r.y);
  const width = finiteNumber(r.width);
  const height = finiteNumber(r.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height, active: r.active === true };
}

function normalizeRects(raw: unknown): DuoHingeRect[] {
  if (!Array.isArray(raw)) return [];
  const out: DuoHingeRect[] = [];
  for (const item of raw) {
    const rect = normalizeRect(item);
    if (rect) out.push(rect);
  }
  return out;
}

/** 對原生回傳做防禦：非物件、未知 status、NaN／非數字、負寬高都會被修正或丟棄。 */
export function normalizeDuoHingeState(raw: unknown): DuoHingeState {
  if (!raw || typeof raw !== "object") return UNSUPPORTED_DUO_HINGE_STATE;
  const r = raw as Record<string, unknown>;
  if (r.supported !== true) return UNSUPPORTED_DUO_HINGE_STATE;
  const status =
    typeof r.status === "string" && STATUSES.has(r.status)
      ? (r.status as DuoHingeStatus)
      : "unknown";
  return {
    supported: true,
    status,
    angle: finiteNumber(r.angle),
    divisions: normalizeRects(r.divisions),
    occlusions: normalizeRects(r.occlusions),
  };
}

function sameRects(a: DuoHingeRect[], b: DuoHingeRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i];
    const q = b[i];
    if (
      p.x !== q.x ||
      p.y !== q.y ||
      p.width !== q.width ||
      p.height !== q.height ||
      p.active !== q.active
    ) {
      return false;
    }
  }
  return true;
}

export function sameDuoHingeState(a: DuoHingeState, b: DuoHingeState): boolean {
  return (
    a.supported === b.supported &&
    a.status === b.status &&
    a.angle === b.angle &&
    sameRects(a.divisions, b.divisions) &&
    sameRects(a.occlusions, b.occlusions)
  );
}

// ---------------------------------------------------------------------------
// module-level store（給 useSyncExternalStore）

let current: DuoHingeState = UNSUPPORTED_DUO_HINGE_STATE;
const listeners = new Set<() => void>();
let plugin: DuoHingePlugin | null = null;
let nativeHandle: PluginListenerHandle | null = null;
/** 每次開始／停止原生訂閱都 +1，讓晚到的 async 結果可辨識是否已過期。 */
let session = 0;

function isNativeIOS(): boolean {
  try {
    const p = detectPlatform();
    return p.isCapacitor && p.isIOS;
  } catch {
    return false;
  }
}

function getPlugin(): DuoHingePlugin | null {
  if (plugin) return plugin;
  if (!isNativeIOS()) return null;
  try {
    plugin = registerPlugin<DuoHingePlugin>("DuoHinge");
  } catch {
    plugin = null;
  }
  return plugin;
}

function apply(raw: unknown) {
  const next = normalizeDuoHingeState(raw);
  if (sameDuoHingeState(current, next)) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function startNative() {
  const p = getPlugin();
  if (!p) return;
  const mySession = ++session;
  void (async () => {
    try {
      const handle = await p.addListener("hingeChange", (data) => {
        if (mySession === session) apply(data);
      });
      if (mySession !== session) {
        void handle.remove().catch(() => undefined);
        return;
      }
      nativeHandle = handle;
    } catch {
      // 外掛不存在（舊版原生殼）或 addListener 失敗：維持 unsupported
    }
    try {
      const state = await p.getState();
      if (mySession === session) apply(state);
    } catch {
      // 安靜退回 unsupported
    }
  })();
}

function stopNative() {
  session += 1;
  const handle = nativeHandle;
  nativeHandle = null;
  if (handle) void handle.remove().catch(() => undefined);
  // 已無訂閱者：不保留過期狀態，下次訂閱由原生重新回報
  current = UNSUPPORTED_DUO_HINGE_STATE;
}

export function subscribeDuoHinge(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startNative();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopNative();
  };
}

export function getDuoHingeSnapshot(): DuoHingeState {
  return current;
}

export function getDuoHingeServerSnapshot(): DuoHingeState {
  return UNSUPPORTED_DUO_HINGE_STATE;
}
