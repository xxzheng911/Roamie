# Chapter 4 — Travel Memory

Version: 1.0  
Status: Planning → Documented

---

## 1. Purpose

Travel Memory 是 Roamie Plus 最重要的核心功能之一。不是聊天紀錄，也不是 AI Conversation。目的是讓 AI 真正了解使用者。

隨著每一次旅行、聊天、收藏、建立行程，AI 逐步累積旅行習慣，並在未來推薦中使用。僅屬於 Plus。

---

## 2. Design Philosophy

不是記住每一句聊天，而是記住真正有價值的旅行資訊。必須是結構化資料，而不是大量聊天文字。

例：「我喜歡安靜一點。」→ `Travel Style: Quiet`

---

## 3. Memory Categories

Destination Memory、Travel Style、Food Preference、Accommodation、Transportation、Budget、Travel Pace、Companion、Weather、Activity、Shopping、Photo Preference、Favorite/Disliked Places、Visited Countries/Cities、Travel History、Favorite Restaurants/Cafes/Attractions。

---

## 4–12. Category Rules (summary)

- **Destination**：記住去過哪裡；優先避免重複推薦，除非使用者主動要求。
- **Travel Style**：可同時保存多種偏好並更新權重。
- **Food**：喜歡/不喜歡；規劃時自動避開，不需再問。
- **Budget**：學習平均預算區間。
- **Transportation / Accommodation / Companion / Weather**：依習慣排序與調整。
- **Favorite**：從收藏類型反推偏好。

---

## 13. Behavior Learning

來源不只聊天，還包含：收藏、建立/修改/刪除行程、搜尋、探索地圖點擊、詳情、停留時間、完成旅行。

---

## 14. Memory Update

採累積機制。單次提及不足以定論；多次出現才提高權重，避免偶然誤判。

---

## 15. User Control

Plus 可查看、修改、刪除、重設。AI 不可強制保存錯誤資訊。

---

## 16. Privacy

僅用於 Roamie AI 推薦。不得作為廣告用途，不得分享給第三方。

---

## 17. Engineering Principle

獨立模組。不得直接寫入 Prompt。Conversation Engine 先讀取 Memory，再組合 Prompt。

---

## Acceptance Criteria

- AI 能持續學習旅行偏好
- 不需反覆詢問相同問題
- 可依旅行歷史推薦新目的地
- 可依收藏與行為優化
- Memory 可獨立維護，不影響 Conversation Engine
