import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronLeft, Loader2, Lock, Luggage, Plus } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { formatTripWorkspaceTemplate, getTripPackingCopy } from "@/lib/i18n/trip-workspace-copy";
import {
  createPackingCategory,
  createPackingItem,
  ensurePackingOtherCategory,
  loadTripPacking,
  newPackingRequestId,
  peekTripPacking,
  restorePackingCategory,
  restorePackingItem,
  softDeletePackingCategory,
  softDeletePackingItem,
  subscribeTripPackingCache,
  tripPackingErrorCode,
  updatePackingCategory,
  updatePackingItem,
  updateTripPackingCache,
  type PackingCategory,
  type PackingData,
  type PackingErrorCode,
  type PackingItem,
  type PackingItemPatch,
} from "@/lib/trip/trip-packing";
import { cn } from "@/lib/utils";
import {
  clearTripPackingFromOverview,
  markTripPackingBackToOverview,
  readTripPackingFromOverview,
} from "@/components/trip/expenses/expenses-return";
import { DeletePackingCategoryDialog } from "./DeletePackingCategoryDialog";
import { PackingCategoriesSheet } from "./PackingCategoriesSheet";
import { PackingIcon } from "./PackingIcon";
import { PackingItemSheet } from "./PackingItemSheet";
import {
  computePackingProgress,
  defaultPackingMoveTarget,
  groupPackingItems,
  isValidPackingName,
  movePackingEntry,
  nextPackingSortIndex,
  PACKING_ITEM_NAME_MAX,
  packingCategoryLabel,
  packingProgressPercent,
  packingSortChanges,
  visiblePackingItems,
  type PackingIconKey,
} from "./packing-model";
import { packingDefaultNames, packingErrorMessage } from "./packing-text";

/** 回到前景時重新讀取的最短間隔（同頁 30 秒內最多一次） */
const FOREGROUND_REFETCH_MS = 30_000;
const UNDO_TOAST_MS = 6_000;
const MOVE_RELOAD_TIMEOUT_MS = 8000;

// ── 快取更新輔助 ───────────────────────────────────────────────────────────
function withItem(d: PackingData, row: PackingItem): PackingData {
  const rest = d.items.filter((i) => i.id !== row.id);
  return { ...d, items: row.deleted_at ? rest : [...rest, row] };
}

function withItemPatched(d: PackingData, id: string, patch: Partial<PackingItem>): PackingData {
  return { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

function withCategory(d: PackingData, row: PackingCategory): PackingData {
  const rest = d.categories.filter((c) => c.id !== row.id);
  const categories = row.deleted_at ? rest : [...rest, row];
  categories.sort(
    (a, b) => a.sort_index - b.sort_index || a.created_at.localeCompare(b.created_at),
  );
  return { ...d, categories };
}

function withoutCategory(d: PackingData, id: string): PackingData {
  return {
    categories: d.categories.filter((c) => c.id !== id),
    items: d.items.filter((i) => i.category_id !== id),
  };
}

function isEnter(e: KeyboardEvent<HTMLInputElement>): boolean {
  // 輸入法組字中的 Enter 不送出
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

type ItemSheetState = {
  open: boolean;
  session: number;
  itemId: string | null;
  formKey: number;
  conflictNotice: boolean;
};

const CLOSED_ITEM_SHEET: ItemSheetState = {
  open: false,
  session: 0,
  itemId: null,
  formKey: 0,
  conflictNotice: false,
};

type Props = { tripId: string };

export function TripPackingScreen({ tripId }: Props) {
  const { locale } = useI18n();
  const copy = getTripPackingCopy(locale);
  const navigate = useNavigate();
  const router = useRouter();

  const cached = useSyncExternalStore(
    subscribeTripPackingCache,
    () => peekTripPacking(tripId),
    () => peekTripPacking(tripId),
  );
  const [loadError, setLoadError] = useState<PackingErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 行李頁掛載時讀取「從總覽進入」標記並立即消費（記在 state）
  const [fromOverview] = useState(() => readTripPackingFromOverview(tripId));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [toggling, setToggling] = useState<ReadonlySet<string>>(() => new Set());
  // 行內新增：每個分類的輸入草稿；adderOpen＝目前展開輸入框的分類（"__empty__"＝沒有任何分類時）
  const [adderOpen, setAdderOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const draftRequestIdsRef = useRef(new Map<string, { text: string; id: string }>());
  const [itemSheet, setItemSheet] = useState<ItemSheetState>(CLOSED_ITEM_SHEET);
  const [savingItem, setSavingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PackingCategory | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const inflightRef = useRef<Promise<PackingData | null> | null>(null);
  const loadSeqRef = useRef(0);
  const lastForegroundFetchRef = useRef(Date.now());
  const mountedRef = useRef(true);
  const lastSheetItemRef = useRef<PackingItem | null>(null);
  // 「移到其他分類」中途失敗時已移走的物品（未自動移回），供重試後的復原一併移回
  const partialMoveRef = useRef<{
    categoryId: string;
    moved: Array<{ id: string; sort_index: number; targetId: string }>;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 消費「從總覽進入」標記；離開時留下「返回總覽」標記供行程頁還原捲動
  useEffect(() => {
    clearTripPackingFromOverview();
    if (!fromOverview) return;
    return () => markTripPackingBackToOverview(tripId);
  }, [fromOverview, tripId]);

  const defaultNames = useMemo(() => packingDefaultNames(copy), [copy]);
  const labelOf = useCallback(
    (c: PackingCategory) => packingCategoryLabel(c, defaultNames),
    [defaultNames],
  );
  const errorText = useCallback(
    (e: unknown) => packingErrorMessage(tripPackingErrorCode(e), copy),
    [copy],
  );

  // ── 讀取 ─────────────────────────────────────────────────────────────
  // fresh＝true（寫入之後）：一定發出新的讀取，不沿用寫入前發出的進行中讀取。
  const reload = useCallback(
    (fresh = false): Promise<PackingData | null> => {
      if (!fresh && inflightRef.current) return inflightRef.current;
      const seq = ++loadSeqRef.current;
      setRefreshing(true);
      const p = loadTripPacking(tripId)
        .then(({ data }) => {
          if (mountedRef.current && seq === loadSeqRef.current) setLoadError(null);
          return data;
        })
        .catch((e) => {
          const code = tripPackingErrorCode(e);
          console.warn("[TRIP_PACKING] load failed", code, e);
          if (mountedRef.current && seq === loadSeqRef.current) setLoadError(code);
          return null;
        })
        .finally(() => {
          if (seq === loadSeqRef.current) {
            inflightRef.current = null;
            if (mountedRef.current) setRefreshing(false);
          }
        });
      inflightRef.current = p;
      return p;
    },
    [tripId],
  );
  const reloadAfterWrite = useCallback(() => reload(true), [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // App 回到前景（同頁 30 秒內最多一次）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastForegroundFetchRef.current < FOREGROUND_REFETCH_MS) return;
      lastForegroundFetchRef.current = now;
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const categories = useMemo(() => cached?.categories ?? [], [cached]);
  const items = useMemo(
    () => (cached ? visiblePackingItems(cached.items, cached.categories) : []),
    [cached],
  );
  const groups = useMemo(() => groupPackingItems(categories, items), [categories, items]);
  const progress = useMemo(() => computePackingProgress(items), [items]);

  const patchCache = useCallback(
    (updater: (d: PackingData) => PackingData) => updateTripPackingCache(tripId, updater),
    [tripId],
  );

  // ── 返回 ─────────────────────────────────────────────────────────────
  const goBack = () => {
    if (fromOverview && router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void navigate({
      to: "/saved/$tripId",
      params: { tripId },
      search: { view: "overview" },
      replace: true,
    });
  };

  // ── 勾選（樂觀更新，失敗回滾） ─────────────────────────────────────────
  const toggleItem = async (item: PackingItem) => {
    if (toggling.has(item.id)) return;
    setToggling((prev) => new Set(prev).add(item.id));
    const next = !item.is_checked;
    patchCache((d) => withItemPatched(d, item.id, { is_checked: next }));
    try {
      const row = await updatePackingItem(item.id, item.version, { is_checked: next });
      patchCache((d) => withItem(d, row));
    } catch (e) {
      const code = tripPackingErrorCode(e);
      console.warn("[TRIP_PACKING] toggle failed", code, e);
      patchCache((d) => withItemPatched(d, item.id, { is_checked: item.is_checked }));
      toast.error(code === "packing_conflict" ? copy.errorConflict : copy.errorToggle);
      if (code === "packing_conflict") void reloadAfterWrite();
    } finally {
      if (mountedRef.current) {
        setToggling((prev) => {
          const s = new Set(prev);
          s.delete(item.id);
          return s;
        });
      }
    }
  };

  // ── 行內新增物品（Enter 連續新增；重試沿用同一個 client_request_id） ─────────
  const requestIdFor = (key: string, text: string): string => {
    const prev = draftRequestIdsRef.current.get(key);
    if (prev && prev.text === text) return prev.id;
    const id = newPackingRequestId();
    draftRequestIdsRef.current.set(key, { text, id });
    return id;
  };

  const addItem = async (key: string, category: PackingCategory | null) => {
    if (addingKey) return;
    const text = (drafts[key] ?? "").trim();
    if (!text) return;
    if (!isValidPackingName(text, PACKING_ITEM_NAME_MAX)) {
      toast.error(copy.validationName);
      return;
    }
    setAddingKey(key);
    const requestId = requestIdFor(key, text);
    // 實際承載草稿的輸入框 key；空狀態建立「其他」後轉為「其他」的 id
    let activeKey = key;
    try {
      let target = category;
      if (!target) {
        // 已無任何分類：先復原或新建「其他」
        target = await ensurePackingOtherCategory(tripId);
        const ensured = target;
        patchCache((d) => withCategory(d, ensured));
        // 空狀態輸入框會隨「其他」出現而消失：立即把草稿與 client_request_id 轉到「其他」，
        // 不等 insert 結果，失敗時在「其他」重試可沿用同一個 client_request_id
        const ensuredId = ensured.id;
        activeKey = ensuredId;
        const entry = draftRequestIdsRef.current.get(key);
        draftRequestIdsRef.current.delete(key);
        if (entry) draftRequestIdsRef.current.set(ensuredId, entry);
        if (mountedRef.current) {
          setDrafts((prev) => {
            const { [key]: moved, ...rest } = prev;
            return { ...rest, [ensuredId]: moved ?? text };
          });
          setAddingKey(ensuredId);
          setAdderOpen(ensuredId);
          // 復原的「其他」若先前是收起狀態，展開讓草稿輸入框可見
          setCollapsed((prev) => {
            if (!prev.has(ensuredId)) return prev;
            const s = new Set(prev);
            s.delete(ensuredId);
            return s;
          });
        }
      }
      const targetId = target.id;
      const current =
        peekTripPacking(tripId)?.items.filter((i) => i.category_id === targetId) ?? [];
      const row = await createPackingItem(tripId, {
        category_id: targetId,
        name: text,
        quantity: 1,
        note: null,
        sort_index: nextPackingSortIndex(current),
        client_request_id: requestId,
      });
      // 只重設這一筆的 id；送出中已輸入的下一筆會在送出時取得新 id
      if (draftRequestIdsRef.current.get(activeKey)?.id === requestId) {
        draftRequestIdsRef.current.delete(activeKey);
      }
      patchCache((d) => withItem(d, row));
      if (mountedRef.current) {
        // 只在草稿仍是剛送出的文字時清空，保留使用者在送出中已輸入的下一個名稱
        setDrafts((prev) =>
          (prev[activeKey] ?? "").trim() === text ? { ...prev, [activeKey]: "" } : prev,
        );
      }
    } catch (e) {
      const code = tripPackingErrorCode(e);
      console.warn("[TRIP_PACKING] add item failed", code, e);
      toast.error(packingErrorMessage(code, copy));
      if (code === "packing_category_deleted" || code === "packing_category_not_found") {
        draftRequestIdsRef.current.delete(activeKey);
        void reloadAfterWrite();
      }
    } finally {
      if (mountedRef.current) setAddingKey(null);
    }
  };

  // ── 物品編輯 Sheet ───────────────────────────────────────────────────
  const sheetItem = itemSheet.itemId
    ? (items.find((i) => i.id === itemSheet.itemId) ?? lastSheetItemRef.current)
    : null;
  if (sheetItem) lastSheetItemRef.current = sheetItem;

  const closeItemSheet = () => setItemSheet((s) => ({ ...s, open: false }));

  const openItem = (item: PackingItem) => {
    lastSheetItemRef.current = item;
    setItemSheet((s) => ({
      open: true,
      session: s.session + 1,
      itemId: item.id,
      formKey: 0,
      conflictNotice: false,
    }));
  };

  const handleItemConflict = async (itemId: string) => {
    const data = await reloadAfterWrite();
    if (!mountedRef.current) return;
    const latest = data?.items.find((i) => i.id === itemId);
    if (data && !latest) {
      toast.error(copy.errorConflict);
      closeItemSheet();
      return;
    }
    if (latest) lastSheetItemRef.current = latest;
    setItemSheet((s) => ({ ...s, formKey: s.formKey + 1, conflictNotice: true }));
  };

  const saveItem = async (item: PackingItem, patch: PackingItemPatch) => {
    if (savingItem) return;
    if (Object.keys(patch).length === 0) {
      closeItemSheet();
      return;
    }
    if (patch.category_id) {
      const targetId = patch.category_id;
      patch = {
        ...patch,
        sort_index: nextPackingSortIndex(items.filter((i) => i.category_id === targetId)),
      };
    }
    setSavingItem(true);
    try {
      const row = await updatePackingItem(item.id, item.version, patch);
      patchCache((d) => withItem(d, row));
      if (mountedRef.current) closeItemSheet();
    } catch (e) {
      const code = tripPackingErrorCode(e);
      console.warn("[TRIP_PACKING] save item failed", code, e);
      if (code === "packing_conflict") {
        await handleItemConflict(item.id);
      } else {
        toast.error(packingErrorMessage(code, copy));
        if (code === "packing_category_deleted" || code === "packing_category_not_found") {
          void reloadAfterWrite();
        }
      }
    } finally {
      if (mountedRef.current) setSavingItem(false);
    }
  };

  const undoDeleteItem = async (itemId: string) => {
    try {
      const row = await restorePackingItem(itemId);
      patchCache((d) => withItem(d, row));
      toast.success(copy.restored);
    } catch (e) {
      toast.error(errorText(e));
    }
    void reloadAfterWrite();
  };

  const deleteItem = async (item: PackingItem) => {
    if (deletingItem) return;
    setDeletingItem(true);
    try {
      await softDeletePackingItem(item.id);
      patchCache((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }));
      if (mountedRef.current) closeItemSheet();
      toast(formatTripWorkspaceTemplate(copy.itemDeleted, { name: item.name }), {
        duration: UNDO_TOAST_MS,
        action: { label: copy.undo, onClick: () => void undoDeleteItem(item.id) },
      });
    } catch (e) {
      const code = tripPackingErrorCode(e);
      console.warn("[TRIP_PACKING] delete item failed", code, e);
      toast.error(packingErrorMessage(code, copy));
      void reloadAfterWrite();
    } finally {
      if (mountedRef.current) setDeletingItem(false);
    }
  };

  // ── 編輯分類 ─────────────────────────────────────────────────────────
  const renameCategory = async (category: PackingCategory, name: string) => {
    patchCache((d) => withCategory(d, { ...category, name }));
    try {
      const row = await updatePackingCategory(category.id, { name });
      patchCache((d) => withCategory(d, row));
    } catch (e) {
      console.warn("[TRIP_PACKING] rename category failed", e);
      patchCache((d) => withCategory(d, category));
      toast.error(errorText(e));
      void reloadAfterWrite();
    }
  };

  const changeCategoryIcon = async (category: PackingCategory, iconKey: PackingIconKey) => {
    patchCache((d) => withCategory(d, { ...category, icon_key: iconKey }));
    try {
      const row = await updatePackingCategory(category.id, { icon_key: iconKey });
      patchCache((d) => withCategory(d, row));
    } catch (e) {
      console.warn("[TRIP_PACKING] change icon failed", e);
      patchCache((d) => withCategory(d, category));
      toast.error(errorText(e));
      void reloadAfterWrite();
    }
  };

  // 排序：依新順序重新編號，一列一個 update（只送 sort_index 有變的分類）
  const moveCategory = async (index: number, direction: -1 | 1) => {
    if (reordering) return;
    const ordered = movePackingEntry(categories, index, index + direction);
    const changes = packingSortChanges(ordered);
    if (changes.length === 0) return;
    setReordering(true);
    const bySort = new Map(changes.map((c) => [c.id, c.sort_index]));
    patchCache((d) => ({
      ...d,
      categories: ordered.map((c) =>
        bySort.has(c.id) ? { ...c, sort_index: bySort.get(c.id)! } : c,
      ),
    }));
    try {
      for (const change of changes) {
        const row = await updatePackingCategory(change.id, { sort_index: change.sort_index });
        patchCache((d) => withCategory(d, row));
      }
    } catch (e) {
      console.warn("[TRIP_PACKING] reorder failed", e);
      toast.error(errorText(e));
      void reloadAfterWrite();
    } finally {
      if (mountedRef.current) setReordering(false);
    }
  };

  const addCategory = async (name: string, iconKey: PackingIconKey): Promise<boolean> => {
    if (addingCategory) return false;
    setAddingCategory(true);
    try {
      const row = await createPackingCategory(tripId, {
        name,
        icon_key: iconKey,
        sort_index: nextPackingSortIndex(categories),
      });
      patchCache((d) => withCategory(d, row));
      return true;
    } catch (e) {
      console.warn("[TRIP_PACKING] add category failed", e);
      toast.error(errorText(e));
      return false;
    } finally {
      if (mountedRef.current) setAddingCategory(false);
    }
  };

  // ── 刪除分類 ─────────────────────────────────────────────────────────
  const openDeleteCategory = (category: PackingCategory) => {
    // 刪除對象換成另一個分類：先前中途失敗的移動紀錄不再沿用
    if (partialMoveRef.current && partialMoveRef.current.categoryId !== category.id) {
      partialMoveRef.current = null;
    }
    setDeleteTarget(category);
    setDeleteOpen(true);
  };
  const deleteItems = deleteTarget ? items.filter((i) => i.category_id === deleteTarget.id) : [];
  const deleteTargets = deleteTarget ? categories.filter((c) => c.id !== deleteTarget.id) : [];
  const defaultMoveTarget = deleteTarget
    ? defaultPackingMoveTarget(categories, deleteTarget.id)
    : null;

  const undoDeleteCategory = async (category: PackingCategory) => {
    try {
      const row = await restorePackingCategory(category.id);
      patchCache((d) => withCategory(d, row));
      toast.success(copy.restored);
    } catch (e) {
      toast.error(errorText(e));
    }
    void reloadAfterWrite();
  };

  // 空分類，或「連同物品一起刪除」：軟刪除分類（伺服器連帶軟刪除其物品），復原時一起恢復
  const deleteCategorySimple = async () => {
    const category = deleteTarget;
    if (!category || deletingCategory) return;
    const label = labelOf(category);
    setDeletingCategory(true);
    try {
      await softDeletePackingCategory(category.id);
      patchCache((d) => withoutCategory(d, category.id));
      if (mountedRef.current) setDeleteOpen(false);
      toast(formatTripWorkspaceTemplate(copy.categoryDeleted, { name: label }), {
        duration: UNDO_TOAST_MS,
        action: { label: copy.undo, onClick: () => void undoDeleteCategory(category) },
      });
    } catch (e) {
      console.warn("[TRIP_PACKING] delete category failed", e);
      toast.error(errorText(e));
      void reloadAfterWrite();
    } finally {
      if (mountedRef.current) setDeletingCategory(false);
    }
  };

  // 「移到其他分類」：先逐件移動物品，全部成功後才軟刪除分類（否則伺服器會連帶刪除未移走的物品）
  const deleteCategoryMove = async (targetId: string) => {
    const category = deleteTarget;
    if (!category || deletingCategory) return;
    const target = categories.find((c) => c.id === targetId);
    if (!target) return;
    const label = labelOf(category);
    const targetLabel = labelOf(target);
    const toMove = items
      .filter((i) => i.category_id === category.id)
      .sort((a, b) => a.sort_index - b.sort_index);
    const base = nextPackingSortIndex(items.filter((i) => i.category_id === targetId));
    // 先前中途失敗已移走的物品（同一分類）：重試只移動剩下的，復原時一併移回
    const prior =
      partialMoveRef.current?.categoryId === category.id ? partialMoveRef.current.moved : [];
    const moved: Array<{ id: string; sort_index: number; targetId: string }> = [...prior];
    // 同一物品再次移動（例如被其他裝置移回後重試）：只保留最新目標，原排序沿用第一次的紀錄
    const recordMoved = (id: string, sortIndex: number) => {
      const i = moved.findIndex((m) => m.id === id);
      if (i >= 0) moved[i] = { id, sort_index: moved[i].sort_index, targetId };
      else moved.push({ id, sort_index: sortIndex, targetId });
    };
    setDeletingCategory(true);
    try {
      for (const [n, item] of toMove.entries()) {
        const row = await updatePackingItem(item.id, item.version, {
          category_id: targetId,
          sort_index: base + n,
        });
        recordMoved(item.id, item.sort_index);
        patchCache((d) => withItem(d, row));
      }
    } catch (e) {
      const code = tripPackingErrorCode(e);
      console.warn("[TRIP_PACKING] move items failed", code, e);
      // 重讀後補記「已寫入但回應遺失」的物品：已在目標分類者視同已移動，復原時一併移回
      // 重讀最多等 8 秒：逾時就先解除忙碌並顯示錯誤（重讀仍在背景完成並更新畫面）
      const fresh = await Promise.race([
        reloadAfterWrite(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), MOVE_RELOAD_TIMEOUT_MS)),
      ]);
      if (fresh) {
        for (const item of toMove) {
          const latest = fresh.items.find((i) => i.id === item.id);
          if (latest && latest.category_id === targetId) recordMoved(item.id, item.sort_index);
        }
      }
      partialMoveRef.current = { categoryId: category.id, moved };
      const movedToTarget = moved.filter((m) => m.targetId === targetId).length;
      if (movedToTarget > 0) {
        const template =
          code === "packing_conflict"
            ? copy.errorMovePartialConflict
            : code === "network"
              ? copy.errorMovePartialNetwork
              : copy.errorMovePartial;
        toast.error(
          formatTripWorkspaceTemplate(template, { count: movedToTarget, target: targetLabel }),
        );
      } else {
        toast.error(code === "packing_conflict" ? copy.errorMoveFailed : errorText(e));
      }
      if (mountedRef.current) setDeletingCategory(false);
      return;
    }
    try {
      await softDeletePackingCategory(category.id);
      patchCache((d) => withoutCategory(d, category.id));
      if (partialMoveRef.current?.categoryId === category.id) partialMoveRef.current = null;
      if (mountedRef.current) setDeleteOpen(false);
      // 先前重試時已有物品移到別的分類：提示一併說明分散到哪些分類
      const elsewhere = new Map<string, number>();
      for (const m of moved) {
        if (m.targetId !== targetId)
          elsewhere.set(m.targetId, (elsewhere.get(m.targetId) ?? 0) + 1);
      }
      const elsewhereParts = [...elsewhere].flatMap(([id, count]) => {
        const c = categories.find((x) => x.id === id);
        return c
          ? [
              formatTripWorkspaceTemplate(copy.categoryMovedElsewherePart, {
                count,
                target: labelOf(c),
              }),
            ]
          : [];
      });
      toast(
        elsewhereParts.length > 0
          ? formatTripWorkspaceTemplate(copy.categoryDeletedMovedSplit, {
              name: label,
              target: targetLabel,
              others: elsewhereParts.join(copy.categoryMovedElsewhereSeparator),
            })
          : formatTripWorkspaceTemplate(copy.categoryDeletedMoved, {
              name: label,
              target: targetLabel,
            }),
        {
          duration: UNDO_TOAST_MS,
          action: { label: copy.undo, onClick: () => void undoDeleteCategoryMove(category, moved) },
        },
      );
    } catch (e) {
      console.warn("[TRIP_PACKING] delete category after move failed", e);
      toast.error(errorText(e));
      void reloadAfterWrite();
    } finally {
      if (mountedRef.current) setDeletingCategory(false);
    }
  };

  // 復原「移到其他分類」：先復原分類，再把物品移回原分類（使用目前最新版本）
  const undoDeleteCategoryMove = async (
    category: PackingCategory,
    moved: Array<{ id: string; sort_index: number; targetId: string }>,
  ) => {
    try {
      const restored = await restorePackingCategory(category.id);
      patchCache((d) => withCategory(d, restored));
      for (const m of moved) {
        const latest = peekTripPacking(tripId)?.items.find((i) => i.id === m.id);
        // 只移回仍在當初移入分類的物品；使用者之後已手動移走的不動
        if (!latest || latest.category_id !== m.targetId) continue;
        const row = await updatePackingItem(latest.id, latest.version, {
          category_id: category.id,
          sort_index: m.sort_index,
        });
        patchCache((d) => withItem(d, row));
      }
      toast.success(copy.restored);
    } catch (e) {
      console.warn("[TRIP_PACKING] undo move failed", e);
      toast.error(errorText(e));
    }
    void reloadAfterWrite();
  };

  // ── 畫面 ─────────────────────────────────────────────────────────────
  const initialLoading = cached == null && !loadError;
  const percent = packingProgressPercent(progress);

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const renderAdder = (key: string, category: PackingCategory | null, label: string) =>
    adderOpen === key ? (
      <div className="flex items-center gap-2 px-3 py-2">
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={drafts[key] ?? ""}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
          onKeyDown={(e) => {
            if (isEnter(e)) {
              e.preventDefault();
              void addItem(key, category);
            } else if (e.key === "Escape") {
              setAdderOpen(null);
            }
          }}
          onBlur={() => {
            if (!(drafts[key] ?? "").trim() && addingKey !== key) setAdderOpen(null);
          }}
          placeholder={copy.addItemPlaceholder}
          aria-label={formatTripWorkspaceTemplate(copy.addItemLabel, { name: label })}
          enterKeyHint="enter"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {addingKey === key ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setAdderOpen(key)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-muted-foreground"
      >
        <Plus className="h-4 w-4" />
        {copy.addItem}
      </button>
    );

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          aria-label={copy.back}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-foreground">{copy.title}</h1>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            {copy.privateNote}
          </p>
        </div>
        {refreshing && cached != null ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
            aria-label={copy.refreshing}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setCategoriesOpen(true)}
          disabled={cached == null}
          className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
        >
          {copy.editCategories}
        </button>
      </header>

      <div className="flex-1 px-5 pb-8 pt-4">
        {initialLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy.loading}
          </div>
        ) : cached == null && loadError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {loadError === "network" ? copy.errorNetwork : copy.loadFailed}
            </p>
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-foreground"
            >
              {copy.retry}
            </button>
          </div>
        ) : (
          <>
            {loadError ? (
              <div
                role="alert"
                className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2"
              >
                <span className="min-w-0 text-xs text-destructive">
                  {loadError === "network" ? copy.errorNetwork : copy.loadFailed}
                </span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground"
                >
                  {copy.retry}
                </button>
              </div>
            ) : null}

            <section className="rounded-2xl border border-border bg-card px-4 py-3">
              <p className="text-sm font-medium tabular-nums text-foreground">
                {formatTripWorkspaceTemplate(copy.progress, {
                  checked: progress.checked,
                  total: progress.total,
                })}
              </p>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.checked}
                aria-label={copy.title}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </section>

            {groups.length === 0 ? (
              <div className="mt-4">
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <Luggage className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-foreground">{copy.emptyTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{copy.emptyBody}</p>
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  {renderAdder("__empty__", null, copy.defaultOther)}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {groups.map(({ category, items: catItems }) => {
                  const label = labelOf(category);
                  const isCollapsed = collapsed.has(category.id);
                  const catProgress = computePackingProgress(catItems);
                  const panelId = `packing-cat-${category.id}`;
                  return (
                    <section
                      key={category.id}
                      className="overflow-hidden rounded-2xl border border-border bg-card"
                    >
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(category.id)}
                        aria-expanded={!isCollapsed}
                        aria-controls={panelId}
                        aria-label={formatTripWorkspaceTemplate(
                          isCollapsed ? copy.expand : copy.collapse,
                          { name: label },
                        )}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                          <PackingIcon iconKey={category.icon_key} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {label}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatTripWorkspaceTemplate(copy.categoryProgress, {
                            checked: catProgress.checked,
                            total: catProgress.total,
                          })}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                      </button>
                      {isCollapsed ? null : (
                        <div id={panelId} className="border-t border-border">
                          {catItems.length > 0 ? (
                            <ul>
                              {catItems.map((item) => (
                                <PackingItemRow
                                  key={item.id}
                                  item={item}
                                  copy={copy}
                                  busy={toggling.has(item.id)}
                                  onToggle={() => void toggleItem(item)}
                                  onOpen={() => openItem(item)}
                                />
                              ))}
                            </ul>
                          ) : null}
                          <div className={catItems.length > 0 ? "border-t border-border" : ""}>
                            {renderAdder(category.id, category, label)}
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <PackingItemSheet
        open={itemSheet.open}
        onOpenChange={(open) => (open ? undefined : closeItemSheet())}
        copy={copy}
        sessionKey={itemSheet.session}
        formKey={itemSheet.formKey}
        conflictNotice={itemSheet.conflictNotice}
        item={sheetItem}
        categories={categories}
        labelOf={labelOf}
        saving={savingItem}
        deleting={deletingItem}
        onSave={(item, patch) => void saveItem(item, patch)}
        onDelete={(item) => void deleteItem(item)}
      />

      <PackingCategoriesSheet
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        copy={copy}
        categories={categories}
        labelOf={labelOf}
        reordering={reordering}
        adding={addingCategory}
        onRename={(c, name) => void renameCategory(c, name)}
        onChangeIcon={(c, key) => void changeCategoryIcon(c, key)}
        onMove={(index, dir) => void moveCategory(index, dir)}
        onDelete={openDeleteCategory}
        onAdd={addCategory}
      />

      <DeletePackingCategoryDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deletingCategory) return;
          // 關閉對話框：放棄先前中途失敗的移動紀錄，之後復原不會動到使用者再手動調整的物品
          if (!open) partialMoveRef.current = null;
          setDeleteOpen(open);
        }}
        copy={copy}
        category={deleteTarget}
        label={deleteTarget ? labelOf(deleteTarget) : ""}
        itemCount={deleteItems.length}
        targets={deleteTargets}
        defaultTargetId={defaultMoveTarget?.id ?? null}
        labelOf={labelOf}
        busy={deletingCategory}
        onDeleteEmpty={() => void deleteCategorySimple()}
        onDeleteMove={(targetId) => void deleteCategoryMove(targetId)}
        onDeleteAll={() => void deleteCategorySimple()}
      />
    </div>
  );
}

function PackingItemRow({
  item,
  copy,
  busy,
  onToggle,
  onOpen,
}: {
  item: PackingItem;
  copy: ReturnType<typeof getTripPackingCopy>;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const checked = item.is_checked;
  return (
    <li className="flex items-center gap-1 border-b border-border pl-3 last:border-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={item.name}
        aria-busy={busy || undefined}
        onClick={onToggle}
        className="flex h-10 w-8 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full border transition-colors duration-150",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/50 bg-transparent",
          )}
        >
          {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3 text-left transition-opacity duration-150",
          checked && "opacity-50",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm text-foreground", checked && "line-through")}>
            {item.name}
          </span>
          {item.note ? (
            <span className="block truncate text-xs text-muted-foreground">{item.note}</span>
          ) : null}
        </span>
        {item.quantity > 1 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTripWorkspaceTemplate(copy.quantityBadge, { count: item.quantity })}
          </span>
        ) : null}
      </button>
    </li>
  );
}
