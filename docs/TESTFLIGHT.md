# Roamie TestFlight 首次打包指南

> **架構說明（重要）**  
> Roamie 使用 **TanStack Start SSR**（Cloudflare Workers），不是純靜態 SPA。  
> `npm run build` 產生的 `dist/client` **沒有完整 SPA 入口**，API 與 server functions 需連到**已部署的生產環境**。  
>  
> TestFlight **第一版**採 **Capacitor 原生殼 + 遠端載入生產 URL**（非高風險 SPA 重構）。  
> 原生殼仍提供：App Icon、Splash、Safe Area、Keyboard、StatusBar、未來推播等能力。

---

## 前置條件

- [ ] Apple Developer Program（年費帳號）
- [ ] macOS + Xcode 15+
- [ ] Node.js 20+
- [ ] Roamie **已部署至 Cloudflare**（取得 HTTPS 網址，例如 `https://roamie.example.com`）

---

---

## iOS Simulator 本機開發

1. 終端 A：`npm run dev`（確認 `http://localhost:8080` 可開）
2. `.env` 設定：
   ```bash
   CAPACITOR_DEV_SERVER_URL=http://localhost:8080
   ```
   實機請改用 Vite 的 Network URL，例如：
   ```bash
   CAPACITOR_DEV_SERVER_URL=http://192.168.0.60:8080
   ```
3. 同步設定（**每次改 capacitor.config 後必跑**）：
   ```bash
   npm run cap:sync:ios:dev
   ```
4. Xcode Run

若仍卡在「正在連線…」，代表 WebView 載入的是 bundled 占位頁，而非 dev server — 請確認 `ios/App/App/capacitor.config.json` 內有 `server.url`。

---

## Step 1 — 設定生產 URL

在 `.env` 加入（**不要 commit `.env`**）：

```bash
CAPACITOR_SERVER_URL=https://你的生產網域.com
VITE_APP_ORIGIN=https://你的生產網域.com
```

Supabase Dashboard → Authentication → URL Configuration：

- **Site URL**：`https://你的生產網域.com`
- **Redirect URLs**：
  - `https://你的生產網域.com/auth/callback`
  - `http://localhost:8080/auth/callback`（本機開發）

Google Cloud Console → OAuth iOS client（若使用 Google 登入）：

- Bundle ID：`com.roamie.app`

Apple Sign In：在 Apple Developer → Identifiers → App ID 啟用 Sign in with Apple。

---

## Step 2 — Production Build 驗證

```bash
npm install
npm run build
node scripts/capacitor-prepare.mjs
```

預期：

- `dist/client/index.html` 已產生（Capacitor 占位用）
- 若已設定 `CAPACITOR_SERVER_URL`，prepare 腳本會印出 URL

---

## Step 3 — 產生 iOS 專案（首次）

```bash
npm run cap:add:ios    # 只需執行一次
npm run cap:sync       # build + prepare + sync
npm run cap:open:ios   # 開啟 Xcode
```

---

## Step 4 — Xcode 設定

1. 選 Target **App** → **Signing & Capabilities**
   - Team：你的 Apple Developer Team
   - Bundle Identifier：`com.roamie.app`
   - Automatically manage signing：✓

2. **General**
   - Display Name：`Roamie`
   - Version：`1.0.0`（對應 `src/constants/app.ts`）
   - Build：`1`

3. **App Icons**
   - `ios/App/App/Assets.xcassets/AppIcon.appiconset`
   - 需 1024×1024 及多尺寸（可用 [appicon.co](https://appicon.co) 產生）

4. **Info.plist 權限說明**（App Store 審核必備）  
   文案來源：`scripts/ios-permission-strings.json` → 執行 `npm run ios:permissions` 產生各語系 `InfoPlist.strings`（`en` / `zh-Hant` / `ja` / `ko`）。  
   系統會依 **裝置語言** 自動選擇，無需寫死英文。

   | Key | 用途 |
   |-----|------|
   | `NSLocationWhenInUseUsageDescription` | 定位（天氣、附近推薦） |
   | `NSLocationAlwaysAndWhenInUseUsageDescription` | 定位（同上，Always 備用） |
   | `NSCameraUsageDescription` | 相機（頭像／封面） |
   | `NSPhotoLibraryUsageDescription` | 相簿讀取 |
   | `NSPhotoLibraryAddUsageDescription` | 相簿寫入 |

   **通知權限**：iOS 系統通知對話框文字由 Apple 提供，無法透過 Info.plist 自訂；僅定位／相機／相簿可本地化。

5. **Sign in with Apple** capability（若使用 Apple 登入）

---

## Step 5 — Archive & TestFlight

1. Xcode 頂部裝置選 **Any iOS Device (arm64)**
2. **Product → Archive**
3. Organizer → **Distribute App** → **App Store Connect** → **Upload**
4. [App Store Connect](https://appstoreconnect.apple.com) → 建立 App → TestFlight → 新增測試人員

---

## Step 6 — TestFlight 實機 QA

- [ ] 冷啟動無白屏（Splash `#f7f4ef`）
- [ ] 底部導覽不被 Home Indicator 遮擋
- [ ] Apple / Google 登入完整流程
- [ ] 旅行偏好測驗完成後個人頁即時更新
- [ ] 地圖定位、AI 對話、探索推薦
- [ ] 聊天鍵盤不遮擋輸入框
- [ ] 飛航模式：顯示合理錯誤（非白屏 crash）

---

## 常見問題

### Q: 為什麼不能離線使用？
A: SSR 架構下 AI / Maps / Server Functions 需連線。離線模式屬 Phase 2（需快取策略 + 離線 UI）。

### Q: `cap sync` 後 App 開啟是空白？
A: 確認 `CAPACITOR_SERVER_URL` 指向**可公開存取**的 HTTPS 生產網址，且 Cloudflare 部署成功。

### Q: OAuth 登入後無法回到 App？
A: 確認 Supabase Redirect URL 包含生產網域 `/auth/callback`；TestFlight v1 使用 WebView 載入生產 URL，與 Web 版相同流程。

---

## 上架 App Store 前仍需處理

- [ ] App Store Connect 隱私問卷（資料收集：位置、帳號、使用狀況）
- [ ] 年齡分級、支援 URL、隱私權政策 URL
- [ ] 審核用測試帳號（若需登入）
- [ ] Google Maps API key 限制 iOS bundle `com.roamie.app`
- [ ] 螢幕截圖（6.7" / 6.5" / iPad 若支援）

---

## 指令速查

```bash
npm run build                  # Production build
npm run cap:sync               # Build + iOS sync
npm run cap:open:ios           # Open Xcode
npm run lint                   # ESLint
```
