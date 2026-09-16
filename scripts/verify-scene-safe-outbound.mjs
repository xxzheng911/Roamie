/**
 * Scene-safe outbound URL contract after Xcode 27 / UIScene.
 * Run: npm run verify:scene-safe-outbound
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDirectionsUrl,
  buildDirectionsUrlFromQuery,
  buildPlaceMapsUrl,
} from "../src/lib/maps-navigation.ts";
import { resolveNavigationDirectionsUrl } from "../src/hooks/use-place-navigation.ts";
import { OAUTH_BROWSER_PRESENTATION_STYLE } from "../src/lib/auth-oauth.ts";

const read = (path) => readFileSync(path, "utf8");

const mapsNav = read("src/lib/maps-navigation.ts");
const openExternal = read("src/lib/open-external-url.ts");
const openNative = read("src/lib/open-external-url-native.ts");
const plugin = read("ios/App/App/OpenExternalUrlPlugin.swift");
const appDelegate = read("ios/App/App/AppDelegate.swift");
const sceneDelegate = read("ios/App/App/SceneDelegate.swift");
const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
const infoPlist = read("ios/App/App/Info.plist");
const tripCard = read("src/components/saved/TripLocationCard.tsx");
const placeNav = read("src/components/PlaceNavButtons.tsx");
const placeDetail = read("src/components/map/PlaceDetailSheet.tsx");
const preview = read("src/components/map/NavigationPreviewSheet.tsx");
const japanTransit = read("src/lib/saved-trip/japan-transit-maps.ts");
const affiliate = read("src/lib/affiliate/affiliate-links.ts");
const tabelog = read("src/lib/open-tabelog-external.ts");
const subscription = read("src/lib/open-subscription-settings.ts");
const oauth = read("src/lib/auth-oauth.ts");
const oauthDeepLink = read("src/lib/auth-oauth-deep-link.ts");
const iosOAuth = read("src/lib/ios-oauth-native.ts");
const chat = read("src/routes/_app.chat.tsx");
const navHook = read("src/hooks/use-place-navigation.ts");

function sourceBetween(src, start, end) {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing region ${start}`);
  return src.slice(from, to);
}

// 1. native maps must not use Browser fullscreen
assert.match(mapsNav, /openExternalUrl/);
assert.doesNotMatch(mapsNav, /Browser\.open|presentationStyle: "fullscreen"/);
assert.doesNotMatch(openExternal, /Browser\.open|presentationStyle: "fullscreen"/);

// 2. no scene-less UIWindow
assert.match(plugin, /await scene\.open\(url, options: UIScene\.OpenExternalURLOptions\(\)\)/);
assert.match(plugin, /viewController\?\.view\.window\?\.windowScene/);
assert.match(plugin, /activationState == \.foregroundActive/);
assert.doesNotMatch(plugin, /UIWindow\(frame:|UIWindow\.init\(frame:|makeKeyAndVisible/);
assert.doesNotMatch(plugin, /Browser\.open|presentVC|tmpWindow/);

// 3–4. directions / search URL contracts
const dest = { lat: 35.7148, lng: 139.7967 };
const origin = { lat: 25.033, lng: 121.5654 };
assert.equal(
  buildDirectionsUrl(dest),
  "https://www.google.com/maps/dir/?api=1&destination=35.7148%2C139.7967",
);
assert.equal(
  buildDirectionsUrl(dest, { origin, travelMode: "walking" }),
  "https://www.google.com/maps/dir/?api=1&destination=35.7148%2C139.7967&origin=25.033%2C121.5654&travelmode=walking",
);
assert.equal(
  buildDirectionsUrlFromQuery("浅草寺"),
  "https://www.google.com/maps/dir/?api=1&destination=%E6%B5%85%E8%8D%89%E5%AF%BA",
);
assert.equal(
  buildPlaceMapsUrl(dest.lat, dest.lng, "Sensoji", "ChIJ123"),
  "https://www.google.com/maps/search/?api=1&query=Sensoji&query_place_id=ChIJ123",
);

// 5–10. navigation call sites share openExternal
assert.match(tripCard, /onClick=\{\(\) => openExternal\(navUrl\)\}/);
assert.match(placeDetail, /onClick=\{onNavigate\}/);
assert.match(preview, /onClick=\{onStartNavigation\}/);
assert.match(placeNav, /openExternal\(navUrl\)/);
assert.match(placeNav, /openExternal\(mapsUrl\)/);
assert.match(japanTransit, /void openExternal\(url\)/);
assert.match(placeDetail, /void openExternal\(googleMapsExternalUrl\)/);
assert.match(chat, /void openExternal\(buildPlaceMapsUrl/);
assert.doesNotMatch(chat, /window\.open\(buildPlaceMapsUrl/);

// 11. affiliate external link
assert.match(affiliate, /await openExternalUrl\(openUrl\)/);
assert.doesNotMatch(affiliate, /Browser\.open|presentationStyle: "fullscreen"/);

// 12–13. OAuth presentation + callback / Browser.close
assert.equal(OAUTH_BROWSER_PRESENTATION_STYLE, "popover");
assert.match(oauth, /canUseIosNativeOAuth\(\)/);
assert.match(oauth, /openIosNativeOAuth\(url\)/);
assert.match(oauth, /Browser\.open\(\{ url, presentationStyle: OAUTH_BROWSER_PRESENTATION_STYLE \}\)/);
assert.doesNotMatch(oauth, /presentationStyle: "fullscreen"/);
assert.match(oauth, /await Browser\.close\(\)/);
assert.match(oauth, /export async function finalizeOAuthBrowserReturn/);
assert.match(oauthDeepLink, /finalizeOAuthBrowserReturn\(\)/);
assert.match(iosOAuth, /mode: "oauth-start"/);
assert.match(sceneDelegate, /func scene\(_ scene: UIScene, openURLContexts/);
assert.match(sceneDelegate, /ApplicationDelegateProxy\.shared\.application/);

// 14. subscription / account external flow
assert.match(subscription, /openExternalUrl\(url\)/);
assert.doesNotMatch(subscription, /Browser\.open/);
assert.match(appDelegate, /AppStore\.showManageSubscriptions\(in: activeScene\)/);

// 15. Web fallback
assert.match(openExternal, /window\.open\(trimmed, "_blank", "noopener,noreferrer"\)/);
assert.match(openNative, /registerPlugin<OpenExternalUrlPlugin>\("OpenExternalUrl"\)/);

// 16–19. startNavigation silent-return fixes
assert.equal(resolveNavigationDirectionsUrl({ destination: dest }), buildDirectionsUrl(dest));
assert.equal(
  resolveNavigationDirectionsUrl({ destination: dest, origin: null, selectedMode: null }),
  buildDirectionsUrl(dest),
);
assert.equal(
  resolveNavigationDirectionsUrl({ destination: dest, selectedMode: "walk" }),
  buildDirectionsUrl(dest, { travelMode: "walking" }),
);
assert.equal(
  resolveNavigationDirectionsUrl({ destination: dest, origin, selectedMode: "transit" }),
  buildDirectionsUrl(dest, { origin, travelMode: "transit" }),
);
assert.equal(resolveNavigationDirectionsUrl({ destination: null, origin, selectedMode: "walk" }), null);
assert.match(navHook, /toast\.message\(t\(effectiveAppLocale\(\), "map\.noCoordsRoute"\)\)/);
assert.doesNotMatch(
  sourceBetween(navHook, "const startNavigation = useCallback", "}, [destination, origin, selectedMode]);"),
  /if \(!origin \|\| !destination \|\| !selectedMode\) return/,
);

// 20. UIScene inbound deep links unchanged; plugin registered in capacitorDidLoad
assert.match(sceneDelegate, /forwardOpenURL\(context\.url/);
assert.match(sceneDelegate, /forwardUserActivity\(userActivity\)/);
assert.doesNotMatch(sceneDelegate, /OpenExternalUrl|Browser\.open|tmpWindow/);
assert.match(appDelegate, /registerPluginInstance\(OpenExternalUrlPlugin\(\)\)/);
assert.match(appDelegate, /registerPluginInstance\(SubscriptionManagementPlugin\(\)\)/);
assert.match(pbxproj, /OpenExternalUrlPlugin.swift in Sources/);
assert.match(infoPlist, /UIApplicationSceneManifest/);
assert.match(pbxproj, /TARGETED_DEVICE_FAMILY = 1;/);
assert.doesNotMatch(pbxproj, /TARGETED_DEVICE_FAMILY = "1,2"/);

assert.match(tabelog, /openExternalUrl\(normalized\)/);
assert.doesNotMatch(tabelog, /Browser\.open/);

console.log("verify:scene-safe-outbound passed");
