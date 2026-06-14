#!/usr/bin/env node
/**
 * Roamie: add Geolocation.purgeAllWatches() to clear orphaned native watchPosition
 * callbacks after HMR / WebView reload (stops continuous TO JS on home).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = resolve(
  root,
  "node_modules/@capacitor/geolocation/ios/Sources/GeolocationPlugin/GeolocationPlugin.swift",
);

if (!existsSync(pluginPath)) {
  console.warn("[patch-geolocation] skip — GeolocationPlugin.swift not found");
  process.exit(0);
}

let source = readFileSync(pluginPath, "utf8");
if (source.includes("purgeAllWatches")) {
  process.exit(0);
}

const pluginMethodsNeedle = `.init(name: "clearWatch", returnType: CAPPluginReturnPromise),
        .init(name: "checkPermissions", returnType: CAPPluginReturnPromise),`;

const pluginMethodsPatch = `.init(name: "clearWatch", returnType: CAPPluginReturnPromise),
        .init(name: "purgeAllWatches", returnType: CAPPluginReturnPromise),
        .init(name: "checkPermissions", returnType: CAPPluginReturnPromise),`;

if (!source.includes(pluginMethodsNeedle)) {
  console.warn("[patch-geolocation] skip — unexpected GeolocationPlugin.swift shape");
  process.exit(0);
}

source = source.replace(pluginMethodsNeedle, pluginMethodsPatch);

const clearWatchNeedle = `        callbackManager?.clearWatchCallbackIfExists(callbackId)

        if (callbackManager?.watchCallbacks.isEmpty) ?? false {
            locationService?.stopMonitoringLocation()
            locationCancellable?.cancel()
            locationCancellable = nil
            locationInitialized = false
        }

        callbackManager?.sendSuccess(call)
    }`;

const clearWatchPatch = `        callbackManager?.clearWatchCallbackIfExists(callbackId)
        stopMonitoringIfNoWatchCallbacks()
        callbackManager?.sendSuccess(call)
    }

    /// Clears every orphaned watchPosition callback (e.g. after HMR / WebView reload).
    @objc func purgeAllWatches(_ call: CAPPluginCall) {
        shouldSetupBindings()
        let cleared = purgeAllWatchCallbacks()
        callbackManager?.sendSuccess(call, with: ["cleared": cleared])
    }`;

if (!source.includes(clearWatchNeedle)) {
  console.warn("[patch-geolocation] skip — clearWatch block not found");
  process.exit(0);
}

source = source.replace(clearWatchNeedle, clearWatchPatch);

const handleLocationNeedle = `        default: break
        }
    }
}`;

const handleLocationPatch = `        default: break
        }
    }

    func purgeAllWatchCallbacks() -> Int {
        guard let ids = callbackManager?.watchCallbacks.keys.map({ $0 }), !ids.isEmpty else {
            stopMonitoringIfNoWatchCallbacks()
            return 0
        }
        for id in ids {
            callbackManager?.clearWatchCallbackIfExists(id)
        }
        stopMonitoringIfNoWatchCallbacks()
        return ids.count
    }

    func stopMonitoringIfNoWatchCallbacks() {
        if (callbackManager?.watchCallbacks.isEmpty) ?? false {
            locationService?.stopMonitoringLocation()
            locationCancellable?.cancel()
            locationCancellable = nil
            locationInitialized = false
        }
    }
}`;

if (!source.endsWith(handleLocationNeedle) && !source.includes("func purgeAllWatchCallbacks()")) {
  const idx = source.lastIndexOf(handleLocationNeedle);
  if (idx === -1) {
    console.warn("[patch-geolocation] skip — handleLocationRequest tail not found");
    process.exit(0);
  }
  source = source.slice(0, idx) + handleLocationPatch + source.slice(idx + handleLocationNeedle.length);
}

writeFileSync(pluginPath, source);
console.info("[patch-geolocation] applied purgeAllWatches to Capacitor Geolocation");
