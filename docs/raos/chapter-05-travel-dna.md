# Chapter 5 — Travel DNA

Version: 1.0  
Status: Planning → Documented

---

## 1. Purpose

Travel DNA 是個人化分析系統。Memory 記錄資料；DNA 分析旅行人格。不直接儲存聊天內容。根據 Memory、歷史、收藏、搜尋、行程與行為持續更新。Plus 專屬。

---

## 2. Design Philosophy

不由使用者自行設定，也不只靠測驗。AI 透過長期觀察自動推論。DNA 動態更新，不是永久固定。

---

## 3. Data Sources

Travel Memory、Conversation、收藏、建立/完成/修改行程、探索地圖、搜尋、停留時間、AI 對話、旅行偏好測驗。

---

## 4–5. DNA Categories & Weight

可包含：Explorer、Cafe Lover、Food Hunter、Nature Lover、Photographer、Luxury/Budget Traveler、Slow/Adventure Traveler、Nightlife/History/Shopping Lover、Family/Solo/Couple Traveler、Road Trip、Relaxation、Culture Explorer、Local Experience Lover、Hidden Gem Explorer 等。

每位使用者可同時擁有多種 DNA，並依權重排序（例如 Cafe Lover 92%）。

---

## 6–8. Dynamic Learning & Usage

DNA 必須持續更新；保存 Evolution 紀錄。影響首頁、探索排序、景點/餐廳/行程/修改、Insights、Optimizer、Suggestions。未來所有 AI 推薦皆優先參考 DNA。

---

## 9–11. Recommendation Style & Visibility

不應直接說「你是 Cafe Lover」，而應自然描述觀察與安排。個人頁可查看加權結果。使用者可保留 / 降低權重 / 忽略 / 重新分析。

---

## 12. Privacy

僅供 AI 推薦。不得提供第三方、廣告用途或販售。

---

## 13. Engineering Principle

獨立於 Memory、Conversation Engine、Planner Optimizer。為分析層：不得直接修改 Memory 或 Prompt。Conversation Engine 先取得 DNA，再決定回覆策略。

---

## 14. Future Expansion

可新增 Travel Mood、Confidence、Budget Score、Food Diversity、Adventure/Photography Score、Country/City/Transport/Accommodation Preference 等，皆須可獨立新增。

---

## Acceptance Criteria

- 能根據長期行為建立旅行人格
- DNA 持續更新，不是固定標籤
- 推薦依 DNA 權重調整
- DNA 與 Memory 完全分離
- 未來所有 AI 推薦皆可依 DNA 個人化
