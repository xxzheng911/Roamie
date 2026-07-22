# Chapter 2 — Membership System

Version: 1.0  
Status: Planning → Documented

---

## 1. Membership Philosophy

Free 與 Plus 不是功能完整與功能殘缺的差別。

- Free 提供完整旅遊規劃能力
- Plus 提供真正個人化 AI

Free 必須足夠好用；Plus 必須足夠有價值。

---

## 2. Membership Structure

| Tier | Positioning |
|---|---|
| Free | Roamie AI Travel Assistant |
| Plus | Roamie AI Travel Companion |

兩者共用相同 AI。Plus 多了一層 AI Intelligence Layer。

### Free flow

User → Conversation Engine → Membership Check → Basic AI → Answer

### Plus flow

User → Conversation Engine → Membership Check → Travel Memory → Travel DNA → History Engine → Planner Optimizer → AI Insights → Personalized AI → Answer

---

## 3. Free Membership

適合：偶爾旅行、第一次使用、不需要長期 AI 記憶。

可使用：AI 聊天、景點/美食/住宿/交通推薦、建立與修改完整行程、探索地圖、收藏、地點詳情、天氣、穿搭。

不可使用：Conversation Workspace/History、Travel Memory/DNA、AI Insights、History Engine、Preference Learning、Planner Optimizer、長期 Context、AI 主動推薦、Memory/DNA Snapshot。

---

## 4. Free AI Credit

每月 40 Credits，月底自動重置。

| Action | Credits |
|---|---|
| AI Session | 1 |
| 完整行程生成 | 5 |
| 重新生成另一版本 | 5 |
| AI 大幅修改行程 | 3 |

---

## 5. AI Session Definition

Session 不是一句話扣一次。連續補資訊（目的地、天數、月份、偏好、住宿）算同一個 Session。

結束條件：

1. 超過 30 分鐘沒有聊天
2. 使用者開始新的旅行主題（例如東京 → 北海道）
3. 使用者主動建立新的聊天

---

## 6. AI Credit Reminder

- 剩餘 10：提醒本月額度，並提示 Plus
- 剩餘 5：建議保留給重要規劃
- 剩餘 1：本月最後一次 AI 對話
- 剩餘 0：不可再使用 AI；仍可查看收藏、行程、地圖、詳情；等待下月或升級 Plus

---

## 7–8. Plus Membership & Features

Plus 增加的是 AI Intelligence，不是聊天次數。專屬：Workspace、History、Memory、DNA、Preference Learning、Planner Optimizer、Insights、History Engine、長期 Context、Personalized / Proactive Recommendation、Resume、Memory/DNA Snapshot。

---

## 9. Conversation Workspace

取代目前「行程草稿」定位。名稱：AI Conversation 或 Travel Workspace。僅 Plus 可見；Free 完全不顯示入口。

每次 AI 對話自動建立 Conversation，自動標題（如「東京五天自由行」）。保存完整聊天、推薦、行程、Travel Context、時間戳、Memory/DNA Snapshot。點擊後延續聊天，不是重新開始。

---

## 10–11. Experience & Goal

- Free：聊天結束後消失，下次重新開始
- Plus：建立 Workspace/Memory/DNA/History，半年後仍記得

---

## Acceptance Criteria

- Free/Plus 差異不是聊天次數，而是 AI Intelligence
- Conversation Workspace 為 Plus 專屬
- AI Credits 為每月制度
- 所有 Plus 功能必須透過會員權限控制
- 後續 AI 架構必須建立於此會員制度之上
