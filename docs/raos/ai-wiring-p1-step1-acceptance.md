# AI 接線 Priority 1 — Step 1 實機驗收

Status: **待實機勾選**  
Scope: **只開 Recommendation Planner Flag**；其餘 Flag 必須 OFF。

相關自動化：`npm run verify:ai-wiring-p1-step1`

---

## Flag 設定（強制）

### ON（本 Step 唯一）

```js
localStorage.setItem("roamie:rec-engine-planner", "1")
```

或環境變數：`VITE_REC_ENGINE_PLANNER_ENABLED=1`

### 必須 OFF（勿提前開）

```js
localStorage.removeItem("roamie:rec-engine-validator")   // Recommendation Validator
localStorage.removeItem("roamie:itinerary-validator")    // Itinerary Validator
localStorage.removeItem("roamie:pie-planner-search")     // PIE Planner Search
localStorage.removeItem("roamie:pie-facade")             // 可選；非本 Step
```

確認方式（DevTools Console）：

```js
({
  planner: localStorage.getItem("roamie:rec-engine-planner"),
  recValidator: localStorage.getItem("roamie:rec-engine-validator"),
  itineraryValidator: localStorage.getItem("roamie:itinerary-validator"),
  piePlannerSearch: localStorage.getItem("roamie:pie-planner-search"),
})
// 期望：planner === "1"；其餘皆 null
```

### 回退

```js
localStorage.setItem("roamie:rec-engine-planner", "0")
// 或 removeItem("roamie:rec-engine-planner")
```

---

## 入口

Chat → 目的地行程（Style／Must-visit → `generateTripPlanFromStyle` 路徑）。  
Direct「選點後建行程」不在本 Step 範圍。

產品 Style 對照：

| 使用者說法 | App Style key | 顯示 |
|---|---|---|
| 經典地標 | `classic_landmarks` | 經典地標 |
| 美食探索／在地生活 | `local_life` | 在地生活 |
| 慢步調 | `slow_nature` | 慢步調散策 |

---

## Case 1：日本東京 3 天

**前置**：Planner Flag ON；其餘 OFF。

**操作**：Chat 請求「東京 3 天」→ 選 Style（建議先 `經典地標`）→ 生成完整行程。

| # | 檢查項 | Pass |
|---|---|---|
| 1.1 | 無重複 Place ID | ☐ |
| 1.2 | 無重複中文名稱（同名不同寫法也算，如「淺草寺／Sensō-ji」若實為同點） | ☐ |
| 1.3 | 無重複英文／羅馬拼音名稱（若卡片有顯示） | ☐ |
| 1.4 | 無墓地／靈骨塔／殯儀相關 | ☐ |
| 1.5 | 無超市／量販／便利商店當行程點 | ☐ |
| 1.6 | 無永久歇業（名稱或狀態暗示已歇業） | ☐ |
| 1.7 | 每天有早餐／午餐／晚餐槽，且類別合理（早≠酒吧；午≠夜市；晚可餐廳／居酒屋／夜市） | ☐ |
| 1.8 | 夜市、酒吧、居酒屋僅在傍晚／夜間時段 | ☐ |
| 1.9 | 同日路線合理，無明顯跨區大折返（例如 A→遠方 B→又回到 A 附近） | ☐ |

**紀錄**：目的地＿＿＿ Style＿＿＿ 天數＿＿＿ 問題摘要＿＿＿

---

## Case 2：韓國首爾 4 天

**前置**：Planner Flag ON；其餘 OFF。

**操作**：Chat「首爾 4 天」→ 生成（建議 `在地生活` 或 `經典地標`）。

| # | 檢查項 | Pass |
|---|---|---|
| 2.1 | 4 天皆有行程內容（非只有 Day 1） | ☐ |
| 2.2 | 跨天無同一地點重複出現 | ☐ |
| 2.3 | 每天地點數足夠（目視約 ≥ 5；非只有 1–2 點） | ☐ |
| 2.4 | 景點與餐廳比例合理（非整天只有餐廳，也非完全沒有餐食） | ☐ |
| 2.5 | 非四天全部擠在同一行政區／同一商圈（應有區域分散或日與日間變化） | ☐ |

**紀錄**：Style＿＿＿ 問題摘要＿＿＿

---

## Case 3：使用者排除條件

**前置**：Planner Flag ON；其餘 OFF。建議目的地：東京或台北（熟悉即可）。

**操作（同一對話或連續回合）**：

1. 「不要火鍋」後再生成／刷新行程相關推薦  
2. 「不要義式」  
3. 「想找安靜咖啡廳」

| # | 檢查項 | Pass |
|---|---|---|
| 3.1 | 行程／推薦中未再出現火鍋店 | ☐ |
| 3.2 | 未再出現義式／義大利餐廳為主的點 | ☐ |
| 3.3 | 咖啡相關結果偏向安靜咖啡廳（非吵雜酒吧／夜店誤標） | ☐ |
| 3.4 | Planner Flag ON 未讓排除條件失效（與你印象中的 OFF 行為一致即可） | ☐ |

**紀錄**：實際輸入句＿＿＿ 問題摘要＿＿＿

---

## Case 4：同一目的地切換 Style

**前置**：Planner Flag ON；其餘 OFF。  
**目的地**：固定同一城市（建議東京或首爾）。

依序生成（可新對話或重新選 Style）：

1. 經典地標（`classic_landmarks`）  
2. 在地生活／美食探索（`local_life`）  
3. 慢步調散策（`slow_nature`）

| # | 檢查項 | Pass |
|---|---|---|
| 4.1 | 三份行程的**主要景點集合**有明顯差異（非幾乎同一組點只換順序） | ☐ |
| 4.2 | 餐食／節奏感受有差異（經典偏地標；在地偏街巷／生活；慢步調偏自然／鬆散） | ☐ |
| 4.3 | 未因 Planner Flag 導致三 Style「內容趨同」 | ☐ |

**提示**：差異應來自 Style 搜尋＋組裝＋ Engine Profile hint；若幾乎相同請記錄重疊地點名稱。

**紀錄**：重疊地點＿＿＿ 問題摘要＿＿＿

---

## Case 5：Flag OFF 回歸

**操作**：

```js
localStorage.setItem("roamie:rec-engine-planner", "0")
// 確認其他 Flag 仍為 OFF
```

對 **Case 1 相同條件**（東京 3 天、同一 Style）再生成一次。

| # | 檢查項 | Pass |
|---|---|---|
| 5.1 | 行程可正常生成、無白屏／錯誤 toast | ☐ |
| 5.2 | 仍有多日／餐食結構（Legacy 路徑可用） | ☐ |
| 5.3 | 與 Flag ON 相比允許順序不同；重點是 **無功能回歸** | ☐ |
| 5.4 | Console／Network 無新增未處理 exception | ☐ |

**之後**：若要繼續 Step 1 觀察，可再設回 `"1"`；**不要**開 Validator Flags。

---

## 總結勾選

| Case | 結果 | 簽名／日期 |
|---|---|---|
| Case 1 東京 3 天 | ☐ Pass / ☐ Fail | |
| Case 2 首爾 4 天 | ☐ Pass / ☐ Fail | |
| Case 3 排除條件 | ☐ Pass / ☐ Fail | |
| Case 4 Style 差異 | ☐ Pass / ☐ Fail | |
| Case 5 Flag OFF 回歸 | ☐ Pass / ☐ Fail | |

**全部 Pass 後** → 才進入 Priority 1 **Step 2**（只開 `roamie:rec-engine-validator`；Planner 可維持 ON，但一次只新增驗證一個 Flag 的行為差異時，建議對照紀錄清楚）。

**任一 Fail** → 保持只開 Planner Flag，回報失敗 Case 編號＋截圖／地點名稱；**不要**開 Step 2 Flags。

---

## 非目標（本 Step）

- 不開 Recommendation Validator / Itinerary Validator / PIE Search  
- 不改 Chat／Explore／Home 商業邏輯  
- 不新增 Engine／Validator  
- 不做 P3.2+  
