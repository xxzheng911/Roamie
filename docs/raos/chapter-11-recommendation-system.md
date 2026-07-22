# Chapter 11 — Recommendation System

Version: 1.1  
Status: Planning → Documented（Pipeline 已定；實作見 R0+）

完整設計與遷移：[`recommendation-engine-design.md`](./recommendation-engine-design.md)

---

## 1–2. Purpose & Philosophy

所有推薦功能的核心系統。首頁、探索、AI 聊天、行程、附近、個人化、Insights 共用同一套邏輯；不同頁面僅呈現方式不同。不得各自維護推薦邏輯。

推薦依當下旅行情境排序，每次重新分析所在地、時間、日期、城市、Memory、DNA、Current Trip、Weather、Hours、Holiday、Season、Budget、Companion。

---

## 3. Recommendation Pipeline（正式）

```
normalize → filter → deduplicate → score → rank → diversify → explain → validate
```

| Stage | 職責 |
|---|---|
| normalize | 資料標準化 |
| filter | 營業時間、黑名單、類別排除等 |
| deduplicate | 移除重複地點（中英文名稱、同 Place ID、同地標不同名稱等） |
| score | 計算推薦分數 |
| rank | 依分數排序 |
| diversify | 避免同類型連續推薦 |
| explain | 結構化 `RecommendationReason`（如營業中／距離近／評分高）；UI/AI 決定文案 |
| validate | 交由 RAOS Validator Engine 做最後檢查 |

表面經 **Adapter** 接入 Engine；**Planner 僅接收排序結果，不負責推薦。**  
權重由 **Recommendation Profile**（general/food/night/cafe/nature/shopping）管理，不寫死於 Engine。

---

## 4. Sources & Ranking

來源：Places、Directions、Distance Matrix、Weather、Festival、Local Events、Memory、DNA、Favorites、Insights。

長期建議權重（**勿一次導入**）：DNA 30%、Memory 20%、距離 15%、營業 10%、Rating 10%、評論 5%、熱門 5%、季節 3%、天氣 2%。

R1 小階段：R1.1 Profile 四因子 → R1.2 Memory/DNA（僅 Suggestion/Signal）→ R1.3 Weather/Season/Festival → R1.4 Learning/Feedback/Insight。  
Memory/DNA **不直接控制排序**；最終分數由 Engine 統一計算。每完成一個 R1.x 停止待確認。

---

## 5–13. Surfaces (summary)

Home 依時間/天氣/DNA；Explore 嚴格分類；Chat 依 Trip/Context/DNA/Memory；Planner 重順路/營業/Pace/Budget/Meal/Balance（排序由 Engine 提供）；Nearby 重距離與交通合理性。另有 Time/Season/Weather/Personalized 規則。

遷移順序：R0 = Explore only → R1.x 加權 → 其後 Chat / Home / Planner（見 design doc）。

---

## 14–17. Diversity, Exclusion, Refresh, Learning

保持多樣性；預設排除低品質/非觀光地點；刷新保留已喜歡；行為持續影響排序。對應 Pipeline 的 filter / deduplicate / diversify，以及 Learning Feedback Engine。

---

## 18. Engineering Principle

共用模組 + Adapter。禁止首頁一套、探索一套、AI 一套。Feature Flag 預設 OFF；ON/OFF 行為一致才擴表面。

---

## Acceptance Criteria

- 統一 Pipeline 排序；依時間/天氣/季節調整
- 符合 DNA/Memory（R1+）；多樣且排除低品質
- 最終經 Validator；持續學習使用者行為
