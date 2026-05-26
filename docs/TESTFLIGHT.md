# Roamie TestFlight 首次打包指南

> **架構說明**  
> Roamie 使用 **TanStack Start**（Cloudflare Workers）。  
> **TestFlight / 正式版**採 **Capacitor bundled 模式**：`dist/client` 內建 SPA 入口，**不需** `npm run dev` 或 `npm run ios:sim`。  
> AI / server functions / 地圖等仍需要**網路**（連到 Supabase 與已部署的 API）。

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
# 正式 Web 網域確定後再填（選用；iOS TestFlight 不依賴此值）
# VITE_APP_ORIGIN=https://your-production-domain.com
```

Supabase Dashboard → Authentication → URL Configuration：

- **Site URL**：可先設 `http://localhost:8080`（本機）或之後的正式 HTTPS 網域
- **Redirect URLs**（至少加入）：
  - `roamie://auth/callback`（**iOS TestFlight / 真機必備** — Google、Apple、Supabase OAuth 統一）
  - `http://localhost:8080/auth/callback`（本機 Vite）
  - 正式網域確定後再補：`https://<你的網域>/auth/callback`（透過 `VITE_APP_ORIGIN` 設定，非寫死）
- **Apple Sign In**：Supabase Authorized Client IDs 需含 `com.shuode.roamie`（原生）與 `com.roamie.service`（Web）

Google Cloud Console → OAuth iOS client（若使用 Google 登入）：

- Bundle ID：`com.shuode.roamie`

Apple Sign In：在 Apple Developer → Identifiers → App ID 啟用 Sign in with Apple。

### OAuth 除錯（Xcode / Safari Web Inspector）

登入流程會輸出 `[auth]` 日誌，包含：

- `oauth.start`：`provider`、`redirectTo`（原生為 `roamie://auth/callback`）、`callbackUrl`
- `oauth.authorize_url`：Supabase 導向 Google/Apple 的網址（token 已 redact）
- `oauth.deep_link`：TestFlight 從 `roamie://auth/callback?code=…` 回到 App
- `oauth.callback_opened` / `session.ok` / `session.failed`
- `apple.native.start`：Bundle ID `com.shuode.roamie`、Supabase `redirectURI`

**Google（iOS）**：Supabase OAuth → 系統瀏覽器 → `roamie://auth/callback` → App 內 `/auth/callback` 兌換 PKCE code。

**Apple（iOS 真機/TestFlight）**：原生 Sign in with Apple → `signInWithIdToken`（不走 mock）。

建置前請確認 `.env`：`VITE_APPLE_SIGN_IN_ENABLED=true`（否則 Apple 按鈕會停用）。

---

## Step 2 — Production Build（TestFlight 必跑）

```bash
npm install
npm run ios:release
```

等同於：`npm run build` → 產生 bundled `index.html` → `cap sync ios` → 驗證無 `server.url`。

預期：

- `dist/client/index.html` 含 `<script type="module" …>`（**不是**「npm run ios:sim」占位頁）
- `dist/client/index.html` 含 `$_TSR` SPA bootstrap（TanStack Start 離線啟動必需；缺了會只剩奶油色背景）
- `ios/App/App/capacitor.config.json` **沒有** `server.url`
- `ios/App/App/public/` 已同步最新 assets

### 若 TestFlight 只有奶油色空白畫面

代表 WebView 載入了 bundled JS，但 **缺少 TanStack Start 的 `window.$_TSR` SSR 啟動資料**（production 下 hydration 會靜默失敗）。請重新執行 `npm run ios:release`，並確認 `ios/App/App/public/index.html` 內有 `$_TSR` 區塊。

若 ErrorBoundary 顯示 `undefined is not an object (evaluating 'g?.routes[_.routeId]')`，代表 `$_TSR` 的 manifest 缺少 `routes: {}`（`manifest?.routes[routeId]` 在 `routes` 為 undefined 時會 crash）。請重新 `npm run ios:release` 並確認 index.html 含 `manifest:{routes:{}}`。

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
   - Bundle Identifier：`com.shuode.roamie`
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
   - Xcode → Target → **Signing & Capabilities** → **Sign in with Apple**
   - 專案已含 `ios/App/App/App.entitlements`
   - Supabase → Auth → Apple → **Authorized Client IDs** 需包含：
     - `com.shuode.roamie`（iOS 原生 / TestFlight）
     - `com.roamie.service`（Web OAuth，若有）
   - `.env` 建置前：`VITE_APPLE_SIGN_IN_ENABLED=true`

---

## Step 5 — Archive & TestFlight

**螢幕方向**：**iPhone** 僅直向（`UISupportedInterfaceOrientations` 只有 `UIInterfaceOrientationPortrait`；執行期 `PortraitBridgeViewController` 亦鎖 portrait）。**iPad** 的 `UISupportedInterfaceOrientations~ipad` 須含 Portrait / Upside Down / Landscape Left / Right（App Store 上架要求）；Xcode → Target **App** → General → Deployment Info 請分別確認 iPhone 與 iPad 勾選與 Info.plist 一致。

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
- [ ] **直向鎖定**：實機橫放仍維持直向（首頁、聊天、地圖、收藏、個人、登入、onboarding、sheet/modal 皆不轉橫向）
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
- [ ] Google Maps API key 限制 iOS bundle `com.shuode.roamie`
- [ ] 螢幕截圖（6.7" / 6.5" / iPad 若支援）

---

## 指令速查

```bash
npm run build                  # Production build
npm run cap:sync               # Build + iOS sync
npm run cap:open:ios           # Open Xcode
npm run lint                   # ESLint
```
