# Chapter 14 — Travel Agent Framework (TAF)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

任務執行框架。不負責對話、推薦、行程排序。負責判斷 AI 是否需要主動執行旅行任務，讓 Roamie 從 Assistant 升級為 Agent。

AI 持續觀察旅行狀態；條件符合時主動提出建議，甚至完成部分任務。

---

## 3. Agent Flow

User → Conversation → Context → Decision → **TAF** → Task Queue → Execution → Validator → User Notification

---

## 4–13. Agents (summary)

Travel Planner / Weather / Transportation / Accommodation / Budget / Schedule / Reminder / Safety / Knowledge / Recommendation / Local Intelligence。

例：出發前三天連雨 → Weather Alert；分析 JR Pass；Check-in 提醒；預算超支替代；停業/天氣/交通 → Replanning；護照簽證票券提醒；旅遊警示。

---

## 14–18. Monitoring, Priority, Control

行程建立後持續監控。優先級：Critical(Safety) → High(Travel Impact) → Medium(Optimization) → Low(Suggestion)。

使用者可接受 / 延後 / 忽略 / 永久關閉某類提醒。Agent 可協作。重大變更需使用者確認；不直接修改 Memory/DNA/Conversation。

---

## 19–20. Future & Engineering

可新增 Flight/Hotel Price/Reservation/Visa/Packing/Currency/Expense/Companion 等。任務協調層：建立、分派、追蹤、完成；共用同一架構。

---

## Acceptance Criteria

- 能主動建立任務與依階段提醒
- 能因天氣/交通/住宿變化提出建議
- 使用者可管理提醒
- 從聊天工具升級為旅行任務代理人
- 可持續擴充
