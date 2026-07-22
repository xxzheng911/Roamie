# Chapter 1 — Product Vision & Membership Philosophy

Version: 1.0  
Status: Planning → Documented

---

## 1. Product Vision

Roamie 並不是一個 AI Chat App，也不是一般的旅遊規劃 App。

Roamie 的核心定位為：

> 「世界上最懂你的 AI Travel Companion。」

Roamie 的 AI 不只是回答問題，而是陪伴使用者規劃每一次旅行，並且隨著每一次聊天、規劃、收藏、完成旅行，逐漸了解使用者，成為每位使用者專屬的 AI 旅行顧問。

Roamie 的目標不是回答「去哪裡」。

而是回答：

「依照你的旅行習慣，你最適合去哪裡。」

AI 的價值不是一次性的回答，而是持續累積旅行經驗。

---

## 2. AI Design Philosophy

### Principle 1

AI 必須像旅行顧問。不是客服、不是搜尋引擎、更不是一般聊天機器人。AI 回答時應該具有旅行規劃能力，而不是單純回答問題。

### Principle 2

AI 必須主動思考。在回答之前先分析：使用者需求、天氣、季節、節慶、花季、當地文化、營業時間、地點距離、交通方式、使用者旅行偏好。完成分析後才開始回答。

### Principle 3

AI 永遠延續聊天。不應該一直重新開始。除非使用者主動修改，否則應延續已知目的地、天數與既有資訊。

### Principle 4

AI 必須避免重複推薦。應依旅行歷史推薦新的目的地與體驗，持續提升旅行品質。

### Principle 5

AI 應該越用越懂使用者。不是每次都像第一次聊天。

---

## 3. Membership Philosophy

Roamie 的會員制度不是「限制 Free，逼使用者付費」，而是讓 Free 使用者也能完整完成旅行規劃。Plus 提供的是「真正個人化 AI」。

Free 與 Plus 都可以：AI 聊天、景點/美食推薦、建立完整行程。

差異在於：Plus 的 AI 會持續學習並記住使用者。

---

## 4. Free Membership

定位：AI Travel Assistant

可使用：AI 聊天、景點/餐廳/住宿/交通推薦、建立完整行程、探索地圖、收藏、地點詳情、天氣、穿搭建議。

限制：AI 不會長期記住任何事情。

---

## 5. Plus Membership

定位：AI Travel Companion

每一次聊天 AI 都會：學習偏好、更新 Travel Memory / Travel DNA / History、建立 Conversation Workspace、保存聊天與旅行規劃、優化下一次推薦。

Plus 的價值不是更多聊天次數，而是越來越了解使用者。

---

## 6. Free vs Plus Philosophy

- Free：像旅行助手。每次聊天都是新的開始。
- Plus：像真正的旅行夥伴。永遠記得使用者，永遠延續旅行故事。

---

## 7. Monthly AI Credit Philosophy

採用 Monthly AI Credits，而非每日次數限制。旅行通常集中規劃，每日限制容易打斷體驗。

- Free：每月固定 AI Credits
- Plus：合理使用（Fair Use），不顯示剩餘額度

---

## 8. Product Goal

- 第一次使用：AI 是旅行助手
- 第三次：開始了解使用者
- 第十次：已知道旅行偏好
- 半年後：能主動推薦新的旅行方式
- 一年後：成為真正的旅行夥伴

---

## 9. Engineering Principles

1. 不允許破壞既有 AI 架構。
2. 新功能必須模組化。
3. Free 與 Plus 必須透過會員權限控制，不可僅依靠 UI 隱藏。
4. AI 必須具有可擴充性。
5. 所有 AI 能力應建立於統一 RAOS 之上。
6. Travel Memory、Travel DNA、Conversation Workspace、Planner Optimizer、AI Insights 必須為獨立模組。

---

## Acceptance Criteria

- Cursor 必須理解 Roamie 並不是 ChatGPT。
- Cursor 必須理解 Free 與 Plus 的定位差異。
- Cursor 必須理解 AI 的核心理念是「旅行夥伴」而非聊天工具。
- 後續所有 AI 功能都必須依照本章理念設計。
