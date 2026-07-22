# Chapter 8 — Planner Optimizer

Version: 1.1  
Status: Planning → Documented

**職責邊界契約（強制）：** [planner-contract.md](./planner-contract.md)  
整合階段：[planner-recommendation-integration.md](./planner-recommendation-integration.md)

---

## 1–2. Purpose & Principle

行程最佳化引擎。不負責產生景點；負責把已找到的地點排成可實際旅行的行程。是所有 AI 行程規劃的最後一道品質檢查（在 Validator 之前的規劃側）。

找到景點後不得立即建立行程；必須先經 Optimizer。

候選排序由 **Recommendation Engine** 完成；Planner **不得**重新排序或自建推薦分數（見 Contract）。

---

## 3. Planning Flow

候選景點 → Route Optimization → Business Hours → Meal Planning → Travel Pace → Duplicate → Category → Schedule Validation → Final Itinerary

---

## 4–15. Rules (summary)

- 半日 2–4 / 全日 4–7 主要景點；多日依 Pace
- 每日早午晚；Nightlife 可加 bar/居酒屋/宵夜；禁不合理餐次堆疊
- 類別平衡；Directions/Distance Matrix 最少移動
- 營業時間檢查；停留時間依類型與 Pace
- 交通時間同步；Place ID/中英/Alias 去重
- 排除墓地、普通公園、量販/超市、封閉、低評、私人住宅
- 天氣與 Pace 調整；多日均分熱門與體驗
- 重新生成保留鎖定/收藏/固定項
- A/B/C 須明顯差異，非只換順序

---

## 16–18. Final Validation & Engineering

建立前再檢：順路、營業、重複、天氣、預算、DNA、天數。獨立模組；不直接寫 Prompt、不直接改 Conversation。

---

## Acceptance Criteria

- 不重複、符營業、依距離排序、符節奏與餐食
- 第二版與第一版明顯不同
- 行程可直接實際旅行
