# Chapter 7 — Decision Engine

Version: 1.0  
Status: Planning → Documented

---

## 1. Purpose

決策層。回覆送交 LLM 前必須先經過 Decision Engine。不負責產生文字；負責決定應回答什麼、不應回答什麼、優先考慮哪些因素。

---

## 2. Core Principle

先思考再回答。模擬旅行顧問流程：日期 → 天數 → 季節 → 天氣 → 節慶 → 交通 → DNA → Memory → 預算 → 營業 → 順路 → 最後推薦。

---

## 3. Decision Priority（不可顛倒）

1. 使用者最新需求  
2. Current Trip Context  
3. Travel Memory  
4. Travel DNA  
5. 天氣  
6. 營業時間  
7. 旅行日期  
8. 交通距離  
9. Google Place 資料  
10. AI 推薦理由  

---

## 4–15. Decision Rules (summary)

- **Weather**：雨天降戶外、提室內
- **Time**：餐飲/活動對齊時段
- **Business Hours**：營業中 > 即將營業 > 未營業（需提示）
- **Route**：地理順路，避免折返
- **Duplicate**：中英/別名/Place ID 相同即禁重推
- **Category**：分類純度
- **Budget / Pace / DNA / Local / Quality / Safety**：各自約束推薦
- **Planner**：全檢通過才允許建立行程

---

## 16–17. Decision Output

輸出 Decision Object（Destination、Weather、Style、Priority、Budget、DNA、Goal 等），由 Prompt Builder 組合 Prompt。

---

## 18. Engineering Principle

未來新增推薦邏輯，優先新增 Decision Rule，不得直接修改 Prompt。

---

## Acceptance Criteria

- 能依天氣、營業、時段、DNA、去重、順路決策
- 所有推薦皆經過 Decision Engine
