# Chapter 6 — Context Engine

Version: 1.0  
Status: Planning → Documented

---

## 1. Purpose

Context Engine 是上下文管理中心。所有 AI 回覆都必須先經過 Context Engine。不得只依最後一句話回答。

必須整合：本次聊天、已建立行程、Conversation Workspace（Plus）、Travel Memory（Plus）、Travel DNA（Plus）。

> Context Engine 是 AI 的大腦。Conversation Engine 是 AI 的嘴巴。

---

## 2–3. Core Principle & Sources

整合 Current Conversation、Current Trip、Workspace、Memory、DNA、User Settings、Preference、Weather、Season、Festival、Holiday、Location、Time 後才交給 AI。

---

## 4. Current Trip Context

每次聊天建立 Current Trip（Destination、Country、Date、Days、Budget、Companion、Transportation、Travel Style 等），持續到旅行完成或開始新旅行。

---

## 5. Topic Tracking

同一主題（住宿、美食、夜景、修改第三天）皆屬同一 Trip，不得重新開始。

---

## 6. Intent Recognition

必須理解「全部」「第二個」「可以」等指代，對應上一輪選項或問題。

---

## 7. Missing Information

只問真正缺少的資訊；已知東京五天時，不應重新全部詢問。

---

## 8–9. Context Update & Conflict

每輪更新 Context。新舊衝突時優先採用最新資訊，不得同時存在矛盾值。

---

## 10–11. Multi-turn & Negative Context

跨多輪不得遺失資訊。否定語（不要/不喜歡/避免/排除）寫入 Current Context，直到旅行結束。

---

## 12. Context Expiration

Current Trip 結束時清除 Trip Context。Memory / DNA 不清除。Workspace（Plus）保留。

---

## 13. Prompt Builder

Context Engine 不直接回答，而是產生 Prompt（Current Context、Travel Context、Memory、DNA、User Goal、Current Intent、Conversation History）交給 LLM。

---

## 14. Engineering Principle

不得直接修改 Prompt；應修改 Context、Prompt Builder、Conversation Engine。

---

## Acceptance Criteria

- 不重複問目的地；不忘記日期
- 理解「第二個」「全部」「可以」與否定語句
- 跨多輪維持 Context
- 未來所有 AI 功能皆透過 Context Engine 運作
