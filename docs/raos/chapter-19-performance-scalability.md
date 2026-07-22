# Chapter 19 — Performance & Scalability Framework (PSF)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

定義效能與擴展策略：快速、穩定、可擴展。優先避免不必要 API 呼叫；充分利用快取、背景同步與非同步處理。效能是架構的一部分。

遵守：最少請求、最快回應、最高重用、最低成本。

---

## 3. Performance Goals

| Metric | Target |
|---|---|
| 首頁首次可互動 | < 2s |
| 首頁推薦完成 | < 3s |
| 探索分類切換（快取） | < 1s |
| AI 第一個 Token | < 3s |
| AI 完整回覆 | < 10s（可調） |
| 行程建立 | < 8s |
| 地點詳情（快取） | < 1s |

---

## 4–15. Strategies

多層快取；分類 Cache Policy；Request Deduplication；Background Preloading；Lazy Loading；Parallel Processing；Offline First；Image Optimization；API Quota Management；Smart Refresh；Background Sync；State Persistence。

---

## 16–19. Monitoring, Scalability, Resources, Recovery

監控載入/AI/Place/Directions 時間、Cache Hit、API 成功率、Crash。支援水平擴充、非同步、Queue。限制背景工作/並行 API/圖片下載/AI 任務。Timeout：Retry → Fallback → Cache → Partial Response；不得空白畫面。

---

## 20. Engineering Principle

效能問題優先修改 PSF / Cache / Queue / Background Task。不得透過增加 Prompt 或重複 API 解決問題。

---

## Acceptance Criteria

- 重複請求降低；Place/Weather 智慧快取
- 速度符合目標；支援離線與背景同步
- API 配額可管理；可隨成長擴展
