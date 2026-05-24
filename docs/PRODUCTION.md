# Roamie Production & App Store Readiness

> **Stack note:** Roamie runs on **TanStack Start + Vite + Cloudflare Workers**, not Next.js. Capacitor wraps the built web bundle for iOS/Android.

## Architecture (implemented foundations)

```
src/
  constants/     app, env, subscription, analytics-events, ai-planning
  providers/     AppProviders, Analytics, Subscription, Platform
  services/      analytics, subscription, affiliate, platform
  hooks/         use-auth, use-i18n (legacy — migrate to providers over time)
  lib/           domain logic, AI, Supabase, maps
  routes/        TanStack Router pages
```

## iOS / TestFlight checklist

**完整步驟請見 [`docs/TESTFLIGHT.md`](./TESTFLIGHT.md).**

### One-time setup

- [ ] Apple Developer account + App ID `com.roamie.app`
- [ ] `npm install` then `npm run cap:add:ios`
- [ ] Open `ios/App/App.xcworkspace` in Xcode
- [ ] Set Team, Bundle ID, Signing (Automatic)
- [ ] Add app icons (`ios/App/App/Assets.xcassets/AppIcon.appiconset`)
- [ ] Configure splash in Capacitor (`capacitor.config.ts` → SplashScreen plugin)
- [ ] Supabase redirect URL: `com.roamie.app://auth/callback` (if using deep links) + production web URL

### Build & TestFlight

```bash
npm run build
npm run cap:sync
npm run cap:open:ios
# Xcode → Product → Archive → Distribute → TestFlight
```

### Pre-submission QA

- [ ] Safe area: notch, Dynamic Island, home indicator (BottomNav uses `env(safe-area-inset-bottom)`)
- [ ] No white flash on launch (inline `#f7f4ef` in root shell + SplashScreen)
- [ ] Keyboard: chat input scrolls above keyboard (`Keyboard` plugin + existing chat inset)
- [ ] OAuth: Apple + Google on device (not just simulator)
- [ ] Offline: graceful message when network unavailable
- [ ] Location permission copy matches App Store privacy labels
- [ ] No secret keys in client bundle (`npm run build` → inspect dist)

## Subscription (RevenueCat)

1. Create products in App Store Connect: `roamie_premium_monthly`, `roamie_premium_yearly`
2. Configure RevenueCat project + entitlements (`premium`)
3. Set `VITE_REVENUECAT_APPLE_KEY` in `.env`
4. Implement `revenueCatAdapter` in `src/services/subscription/index.ts`
5. Server-side: verify receipts for sensitive features (don't trust client only)

## Analytics

- Event names: `src/constants/analytics-events.ts`
- Track via `useAnalytics()` hook
- Wire PostHog/Mixpanel in `src/services/analytics/adapters.ts`

## Security

- OpenAI + Maps keys: server-only (`src/lib/env.server.ts`, API routes)
- Supabase RLS: enabled on all user tables
- Rate limits: `src/lib/rate-limit.server.ts` — wire to KV in Workers production
- Google Maps: restrict key by HTTP referrer (web) + iOS bundle ID (native)

## Affiliate

- Provider registry: `src/services/affiliate/`
- UI must use `buildAffiliateOffer()` / `openAffiliateOffer()` — never hardcode partner URLs in components

## Localization

- Messages: `src/lib/i18n/messages.ts` (zh-TW, en, ja, ko)
- Device locale only for settings (per product decision)
- Future: extract to JSON under `src/locales/` for Crowdin/Lokalise

## Future milestones

- [ ] Android: `npm run cap:add:android`
- [ ] Push notifications (Capacitor + APNs)
- [ ] Offline itinerary cache
- [ ] Collaborative trips
- [ ] Apple Wallet boarding passes
