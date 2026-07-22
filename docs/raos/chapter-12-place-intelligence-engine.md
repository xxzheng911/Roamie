# Chapter 12 — Place Intelligence Engine (PIE)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

所有地點資料的核心管理系統。AI 聊天、行程、探索、首頁附近、收藏、詳情、Directions、Affiliate、圖片皆須透過 PIE。

任何模組不得直接呼叫 Google Places。

Google Places 提供原始資料；PIE 提供適合旅行規劃的高品質地點（搜尋、驗證、排序、過濾、圖片、快取、品質控制）。

---

## 3. Place Pipeline

Request → Search → Matching → Validation → Dedup → Quality Filter → Image Resolver → Cache → Recommendation → Planner → UI

---

## 4–16. Capabilities (summary)

- 搜尋優先城市中心，避免小地標誤判整城
- Matching 找唯一 Place；多筆依 Quality/Review/Popularity/Category/Suitability
- Validation 檢查 Place ID、名稱、地址、座標、類別、評分、營業、圖片
- Dedup：Place ID + Alias + 中英 + 座標
- Category 正規化；Quality Filter 預設排除非旅遊地點
- Travel Suitability Score；Business Intelligence；Image 優先序；多層 Cache
- Nearby 不只 GPS；Detail 統一；Affiliate 由 PIE 判斷；Refresh 保留高品質

---

## 18–19. Engineering & Future

所有 Place API 必須經過 PIE。未來可新增 Crowd/Noise/Family/Pet/Wheelchair/Sunset/Photography/Rain/Local Favorite/Night View 等，不影響既有架構。

---

## Acceptance Criteria

- 所有地點由 PIE 管理；不重複；資料一致
- 圖片來源統一；API 成本降低；推薦品質提高
- Place API 不再分散於各模組
