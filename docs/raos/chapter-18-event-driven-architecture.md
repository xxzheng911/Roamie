# Chapter 18 — Event-Driven Architecture (EDA)

Version: 1.0  
Status: Planning → Documented

---

## 1–3. Purpose, Philosophy, Flow

模組之間不得直接互相通知。所有資料變更透過 Event Bus。目標：畫面與 AI 模組保持同步。

任何狀態改變都應視為 Event。

User Action → Application → Publish Event → Event Bus → Subscribers → State Update → UI Refresh

任何模組皆不得直接呼叫其他模組更新 UI。

---

## 4–5. Event Bus & Structure

Publish → Queue → Subscribe → Handle。可支援 Local / Cloud / Background Event。

欄位：Event ID、Type、Timestamp、Source、Target（Optional）、Payload、Priority、Correlation ID、Schema Version。

---

## 6–15. Event Catalog (summary)

Trip / TripDay / TripPlace、Conversation/Workspace、AI、Memory/DNA、User、Place、Weather、Agent 等事件族系。

---

## 16–22. Priority, Subscription, Sync, Offline, Replay

優先級：Critical → High → Medium → Low。各模組只訂閱需要的事件。狀態經 State Manager 統一更新。離線暫存；可 Event Replay；統一 Logging；Subscriber 錯誤不得拖垮其他訂閱者（Retry / DLQ 可選）。

---

## 23–24. Future & Engineering

可支援跨裝置、共編、即時通知、Webhook、Agent Collaboration、Analytics Pipeline。任何資料變更都應 Publish Event；EDA 為唯一事件傳遞機制。

---

## Acceptance Criteria

- 模組透過 Event Bus 同步
- UI 與 AI 狀態一致
- 支援離線事件與重播
- 新功能可透過事件擴充
