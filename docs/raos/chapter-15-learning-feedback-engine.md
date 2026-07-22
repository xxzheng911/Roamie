# Chapter 15 — Learning & Feedback Engine (LFE)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

持續學習系統。不負責對話、推薦、建行程。分析每一次推薦與互動結果，持續改善未來決策。目標不是記住更多資料，而是提升推薦品質。

每一次互動都是下一次推薦的學習機會。

---

## 3. Learning Flow

User Action → Event Collection → Behavior Analysis → Learning Engine → Memory Update → DNA Adjustment → Recommendation Optimization → Future Improvement

---

## 4–9. Sources & Evaluation

來源：對話、建/改/再生成行程、收藏、點擊、導航、分享、完成旅行、搜尋、探索、首頁互動。

正向：加入行程、收藏、導航、詳情停留、分享、相似搜尋、完成後保留。  
負向：立即刪除、重新生成、略過、多次忽略、取消收藏、修改 AI 安排。

建立 Recommendation Result；分析 Planner 被改熱點；Conversation KPI（追問數、完成率、再生率）。

---

## 10–16. DNA Evidence, Confidence, Patterns

LFE 不直接改 DNA，只提供 Evidence。Memory 具 Confidence Score。可發現長期模式、小幅探索實驗、匿名 Global Learning。使用者明確回饋為高權重。追蹤 Acceptance/Completion/Regeneration/Favorite 等 KPI。

---

## 17–19. Privacy & Engineering

不得提供第三方、販售、廣告用途。為分析層；不得直接修改 Conversation/Decision/Planner/Memory/DNA；僅提供 Evidence。未來可擴充 Emotion/Voice/Image/Budget Prediction/Group/Seasonal Evolution。

---

## Acceptance Criteria

- 能依使用結果改善推薦
- Memory/DNA 更新有明確依據
- 能分析長期模式；回饋可影響推薦
- KPI 可追蹤；低耦合高擴充
