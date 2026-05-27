# QA 測試登入（無 Google / Apple）

## 用途

- 僅供 **本機 dev** 或 **TestFlight debug** 建置
- 一鍵建立／登入 **裝置專屬測試帳號**（信箱 `@qa.internal.roamie.app`）
- 不經 OAuth、不收集真實個資
- 登入後顯示 **`DEV TEST USER`** 標籤
- 可在「我」個人頁切換 **Free / Plus**（與開發者工具）

## 啟用方式

### 1. `.env`（本機 + Worker）

```env
VITE_ROAMIE_QA=1
ROAMIE_QA_AUTH_ENABLED=1
# 選填：自訂測試帳號密碼種子（server only）
# ROAMIE_QA_AUTH_SECRET=your-long-random-string
```

執行：

```bash
npm run sync:env
npm run deploy    # 或 npm run dev
```

### 2. TestFlight / 真機 bundled

```bash
ROAMIE_QA_BUILD=1 npm run ios:release
```

並確認 Worker 已部署且 `ROAMIE_QA_AUTH_ENABLED=1`（`npm run deploy` 會從 `.env` 同步 secrets）。

### 3. 正式 App Store

**不要**設定 `VITE_ROAMIE_QA=1` 或 `ROAMIE_QA_AUTH_ENABLED=1`。

## 使用流程

1. 開啟 https://roamie.tw/login（或 App 登入頁）
2. 點 **「測試登入（QA · 無需 Google / Apple）」**
3. 進入首頁後，頂部應有 **DEV TEST USER** 標籤
4. **我** → 訂閱方案（測試）切換 Free / Plus
5. **設定** → **QA 開發者工具**（重置 onboarding、清除收藏等）

## 可測功能

| 區塊 | 路徑 |
|------|------|
| 首頁 | `/` |
| 聊聊 | `/chat` |
| 探索地圖 | `/map` |
| 收藏 | `/saved` |
| 規劃新行程 | `/plan` |
| 行程詳情 | `/saved/:tripId` |
| 個人頁 | `/profile` |
| 旅行偏好測驗 | `/preference-quiz` |

## 測試網址

| 環境 | URL |
|------|-----|
| 正式 Web | https://roamie.tw |
| 登入頁 | https://roamie.tw/login |
| QA API | `POST https://roamie.tw/api/qa-auth` |
| workers.dev 備援 | https://roamie.vvbwb6bw52.workers.dev |

## 安全說明

- Client 需帶 `X-Roamie-QA-Build: 1`（僅 QA build 編入）
- Server 需 `ROAMIE_QA_AUTH_ENABLED=1`
- 測試帳號 metadata 標記 `is_qa_test: true`
- 同一裝置 ID 對應固定測試信箱，方便重複登入
