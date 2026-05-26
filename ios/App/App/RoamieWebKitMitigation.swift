import UIKit
import WebKit
import Capacitor

/*
 iOS 26 WebKit / GPU system warnings (native console — not suppressible from app code):

 | Message | Layer | Action |
 |---------|-------|--------|
 | Could not create a sandbox extension | WebKit/GPU sandbox | Benign on iOS 26 device; ignore |
 | Could not register system wide server: -25204 | CoreAnimation / CARenderServer | Benign when live compositor broken; snapshot renderer bypasses display |
 | CARenderServer failed bootstrap lookup | GPU render server | Same — expected with broken live compositor |
 | Failed to initialize application environment context | WebKit GPU device context | Same |
 | Failed to load a device context | WebKit GPU | Same |
 | Unable to hide query parameters from script | WebKit privacy + capacitor:// scheme | Benign for Capacitor bundled URL |
 | xpc_user_sessions_get_foreground_uid() failed | XPC session lookup (WebKit/GPU) | Benign on device; ignore |

 These do not indicate app logic failure when SNAPSHOT content=true and WINDOW_MIRROR is active.
 */

/// Native log routing: critical always; verbose only when ROAMIE_NATIVE_LOG=1.
enum RoamieNativeLog {
    static var isVerbose: Bool {
        ProcessInfo.processInfo.environment["ROAMIE_NATIVE_LOG"] == "1"
    }

    static func debug(_ message: String) {
        guard isVerbose else { return }
        CAPLog.print(message)
    }

    static func critical(_ message: String) {
        CAPLog.print(message)
    }
}

/// WebKit mitigations for iOS 26+ device-context / CARenderServer compositor failures.
enum RoamieWebKitMitigation {
    private static let cream = UIColor(red: 253 / 255, green: 245 / 255, blue: 234 / 255, alpha: 1)

    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["ROAMIE_WK_MITIGATION"] != "0"
    }

    static var iosMajorVersion: Int {
        Int(UIDevice.current.systemVersion.split(separator: ".").first ?? "0") ?? 0
    }

    /// iOS 26.x on device: apply aggressive GPU / privacy-store workarounds by default.
    static var isIOS26OrNewer: Bool {
        iosMajorVersion >= 26
    }

    static var useCustomProcessPool: Bool {
        // Removed: Capacitor CDVWebViewProcessPoolFactory already shares a pool. ROAMIE_WK_CUSTOM_POOL is ignored.
        if ProcessInfo.processInfo.environment["ROAMIE_WK_CUSTOM_POOL"] == "1" {
            RoamieNativeLog.debug("⚡️ [Roamie] WK_CUSTOM_POOL ignored — using system/Capacitor default process pool")
        }
        return false
    }

    static var useNonPersistentDataStore: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_PERSISTENT"] == "1" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_NON_PERSISTENT"] == "1" { return true }
        #if targetEnvironment(simulator)
        return false
        #else
        // iOS 26 device: isolated nonPersistent store avoids GPU device-context reuse bugs.
        return isIOS26OrNewer
        #endif
    }

    /// iOS 26 device: snapshot mirror is the primary renderer; live compositor is probe-only (never auto-restored).
    static var preferSnapshotDisplayOnIOS26: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_FORCE_LIVE"] == "1" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_SNAPSHOT_DISPLAY"] == "0" { return false }
        #if targetEnvironment(simulator)
        return false
        #else
        return isIOS26OrNewer
        #endif
    }

    static var usesSnapshotRendererOnIOS26: Bool { preferSnapshotDisplayOnIOS26 }

    static var useSoftwareLayerRasterization: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_RASTERIZE"] == "0" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_RASTERIZE"] == "1" { return true }
        return isIOS26OrNewer
    }

    static var useSeparateRecoveryProcessPool: Bool { false }

    /// iOS 26: wait for full frame before first paint (incremental path may stall CARenderServer).
    static var suppressesIncrementalRendering: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_SUPPRESS_RENDER"] == "1" { return true }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_SUPPRESS_RENDER"] == "0" { return false }
        return isIOS26OrNewer
    }

    enum LoadStrategy: String {
        case capacitorScheme
        case inlineHTML
        case uikitOnly
    }

    /// Bundled index load path. Default is always Capacitor scheme (capacitor://localhost/...).
    static var loadStrategy: LoadStrategy {
        if let raw = ProcessInfo.processInfo.environment["ROAMIE_WK_LOAD"]?.lowercased() {
            switch raw {
            case "capacitor", "scheme": return .capacitorScheme
            case "inline", "html": return .inlineHTML
            case "uikit", "uikitonly", "native": return .uikitOnly
            case "file", "fileurl":
                RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD fileURL ignored — not supported on device (LSApplicationWorkspace 115); using capacitorScheme")
                return .capacitorScheme
            default: break
            }
        }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_INLINE_HTML"] == "1" { return .inlineHTML }
        if ProcessInfo.processInfo.environment["ROAMIE_UIKIT_ONLY"] == "1" { return .uikitOnly }
        return .capacitorScheme
    }

    static var useInlineHTMLLoad: Bool {
        loadStrategy == .inlineHTML
    }

    static var useUIKitOnlyBoot: Bool {
        loadStrategy == .uikitOnly
    }

    /// Defer first navigation until UIApplication.didBecomeActive (GPU / CARenderServer warm-up).
    static var deferLoadUntilActive: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_DEFER_LOAD"] == "0" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_DEFER_LOAD"] == "1" { return true }
        #if targetEnvironment(simulator)
        return false
        #else
        return isIOS26OrNewer && loadStrategy != .uikitOnly
        #endif
    }

    /// Native UILabel shell above WKWebView when compositor fails (iOS 26 default on).
    static var useNativeBootShell: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_NATIVE_SHELL"] == "0" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_NATIVE_SHELL"] == "1" { return true }
        return isIOS26OrNewer
    }

    static var hideWebViewUnderShell: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_HIDE_WEBVIEW"] == "1" { return true }
        return false
    }

    /// After navigation, capture WKWebView into UIImageView when live compositor fails (iOS 26 default on).
    static var useSnapshotFallback: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_SNAPSHOT"] == "0" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_SNAPSHOT"] == "1" { return true }
        #if targetEnvironment(simulator)
        return false
        #else
        return isIOS26OrNewer
        #endif
    }

    /// Reload + re-snapshot when compositor stays blank after finish.
    static var useCompositorRecovery: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_RECOVERY"] == "0" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_RECOVERY"] == "1" { return true }
        #if targetEnvironment(simulator)
        return false
        #else
        return isIOS26OrNewer
        #endif
    }

    /// Present WK snapshots on UIWindow (bypasses broken WKWebView live compositor on iOS 26).
    static var useWindowMirror: Bool {
        if ProcessInfo.processInfo.environment["ROAMIE_WK_MIRROR"] == "0" { return false }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_MIRROR"] == "1" { return true }
        #if targetEnvironment(simulator)
        return false
        #else
        return isIOS26OrNewer && useSnapshotFallback
        #endif
    }

    static func apply(to configuration: WKWebViewConfiguration, instanceConfiguration: InstanceConfiguration) {
        guard isEnabled else { return }

        if useNonPersistentDataStore {
            configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        }

        configuration.suppressesIncrementalRendering = suppressesIncrementalRendering
        configuration.limitsNavigationsToAppBoundDomains = false

        configuration.allowsInlineMediaPlayback = false
        configuration.allowsAirPlayForMediaPlayback = false
        if #available(iOS 9.0, *) {
            configuration.allowsPictureInPictureMediaPlayback = false
        }
        configuration.mediaTypesRequiringUserActionForPlayback = .all

        if #available(iOS 15.4, *) {
            configuration.preferences.isElementFullscreenEnabled = false
        }
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        if #available(iOS 14.0, *) {
            configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        }

        if isIOS26OrNewer {
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
            if #available(iOS 15.4, *) {
                configuration.preferences.isTextInteractionEnabled = true
            }
            registerSnapshotScriptHandler(on: configuration)
        }

        logApplied()
    }

    private static var snapshotScriptHandlerRegistered = false

    /// JS → native: refresh WINDOW_MIRROR after SPA route / auth UI changes (no live compositor restore).
    private static func registerSnapshotScriptHandler(on configuration: WKWebViewConfiguration) {
        guard isEnabled, usesSnapshotRendererOnIOS26, !snapshotScriptHandlerRegistered else { return }
        configuration.userContentController.add(RoamieSnapshotScriptBridge.shared, name: "roamieSnapshot")
        snapshotScriptHandlerRegistered = true
    }

    /// Alternate WKWebViewConfiguration for off-screen recovery WebView (second process path).
    static func applyRecoveryConfiguration(to configuration: WKWebViewConfiguration) {
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        configuration.suppressesIncrementalRendering = true
        configuration.limitsNavigationsToAppBoundDomains = false
        configuration.allowsInlineMediaPlayback = false
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if #available(iOS 14.0, *) {
            configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        }
    }

    static func configureWebView(_ webView: WKWebView) {
        guard isEnabled else { return }
        applySoftwareRendering(to: webView)
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
    }

    static func stabilizeRendering(_ webView: WKWebView) {
        applySoftwareRendering(to: webView)
    }

    /// Opaque / software-friendly layer stack — avoids GPU alpha compositing on iOS 26.
    static func applySoftwareRendering(to webView: WKWebView) {
        guard isEnabled else { return }
        forceOpaque(webView)

        webView.isOpaque = true
        webView.scrollView.isOpaque = true
        webView.layer.isOpaque = true
        webView.layer.backgroundColor = cream.cgColor
        webView.layer.allowsGroupOpacity = false
        webView.layer.drawsAsynchronously = false
        webView.layer.opacity = 1

        webView.scrollView.layer.isOpaque = true
        webView.scrollView.layer.backgroundColor = cream.cgColor
        webView.scrollView.layer.allowsGroupOpacity = false
        webView.scrollView.layer.drawsAsynchronously = false

        if useSoftwareLayerRasterization, !(isIOS26OrNewer && usesSnapshotRendererOnIOS26) {
            webView.layer.shouldRasterize = true
            webView.layer.rasterizationScale = UIScreen.main.scale
        } else {
            webView.layer.shouldRasterize = false
        }

        if #available(iOS 13.0, *) {
            webView.layer.contentsFormat = .RGBA8Uint
        }
    }

    static func forceOpaque(_ webView: WKWebView) {
        guard isEnabled else { return }
        webView.isOpaque = true
        webView.backgroundColor = cream
        webView.scrollView.backgroundColor = cream
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = cream
        }
    }

    private static func logApplied() {
        #if targetEnvironment(simulator)
        let runtime = "simulator"
        #else
        let runtime = "device"
        #endif
        RoamieNativeLog.debug(
            "⚡️ [Roamie] WK_MITIGATION applied runtime=\(runtime) ios=\(UIDevice.current.systemVersion) " +
                "ios26=\(isIOS26OrNewer) nonPersistent=\(useNonPersistentDataStore) " +
                "customPool=\(useCustomProcessPool) suppressRender=\(suppressesIncrementalRendering) " +
                "load=\(loadStrategy.rawValue) deferLoad=\(deferLoadUntilActive) " +
                "nativeShell=\(useNativeBootShell) snapshot=\(useSnapshotFallback) " +
                "windowMirror=\(useWindowMirror) recovery=\(useCompositorRecovery) " +
                "snapshotRenderer=\(usesSnapshotRendererOnIOS26) rasterize=\(useSoftwareLayerRasterization)"
        )
    }

    /// Wait for a few display frames before first WK navigation (CARenderServer warm-up).
    static func runAfterDisplayWarmup(on ios26Only: Bool = true, _ block: @escaping () -> Void) {
        #if targetEnvironment(simulator)
        block()
        return
        #else
        guard !ios26Only || isIOS26OrNewer else {
            block()
            return
        }
        if ProcessInfo.processInfo.environment["ROAMIE_WK_DISPLAY_WARMUP"] == "0" {
            block()
            return
        }
        var frames = 0
        let proxy = RoamieDisplayLinkProxy { link in
            frames += 1
            if frames >= 3 {
                link.invalidate()
                RoamieNativeLog.debug("⚡️ [Roamie] DISPLAY_WARMUP frames=\(frames) — starting WK load")
                block()
            }
        }
        let link = CADisplayLink(target: proxy, selector: #selector(RoamieDisplayLinkProxy.tick))
        link.add(to: .main, forMode: .common)
        #endif
    }

    static func flushRendering(_ webView: WKWebView) {
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        webView.scrollView.setNeedsLayout()
        webView.scrollView.layoutIfNeeded()
        CATransaction.flush()
    }

    /// Skip live compositor nudges on iOS 26 snapshot renderer (reduces CARenderServer churn).
    static func nudgeCompositorIfNeeded(_ webView: WKWebView) {
        guard isEnabled else { return }
        if isIOS26OrNewer && usesSnapshotRendererOnIOS26 { return }
        nudgeCompositor(webView)
    }

    /// Hidden WKWebView under mirror: no layer rasterization / async draw.
    static func relaxLiveCompositorForSnapshotInput(_ webView: WKWebView) {
        guard isEnabled else { return }
        webView.layer.shouldRasterize = false
        webView.layer.drawsAsynchronously = false
    }

    /// Post-navigation compositor nudge for iOS 26 WebContent paint stalls.
    static func nudgeCompositor(_ webView: WKWebView) {
        flushRendering(webView)
        webView.setNeedsDisplay()
        let scrollView = webView.scrollView
        let offset = scrollView.contentOffset
        scrollView.setContentOffset(CGPoint(x: offset.x, y: offset.y + 0.5), animated: false)
        scrollView.setContentOffset(offset, animated: false)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            flushRendering(webView)
        }
    }
}

/// Custom WKWebView with iOS 26 compositor lifecycle hooks.
final class RoamieWKWebView: WKWebView {
    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, RoamieWebKitMitigation.isEnabled else { return }
        RoamieWebKitMitigation.applySoftwareRendering(to: self)
        RoamieWebKitMitigation.flushRendering(self)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard RoamieWebKitMitigation.isIOS26OrNewer else { return }
        guard RoamieWebKitMitigation.useSoftwareLayerRasterization,
              !RoamieWebKitMitigation.usesSnapshotRendererOnIOS26 else { return }
        layer.rasterizationScale = UIScreen.main.scale
    }
}

/// UIKit fallback — small non-blocking diagnostic banner (does not cover WebKit layer).
enum RoamieNativeBootShell {
    private static let tag = 982_451

    static func attach(to container: UIView, above sibling: UIView?, title: String = "Roamie", subtitle: String) {
        let shell: UIView
        if let existing = container.viewWithTag(tag) {
            shell = existing
        } else {
            shell = UIView()
            shell.tag = tag
            shell.backgroundColor = UIColor(red: 253 / 255, green: 245 / 255, blue: 234 / 255, alpha: 0.92)
            shell.layer.cornerRadius = 12
            shell.layer.borderWidth = 1
            shell.layer.borderColor = UIColor(red: 107 / 255, green: 99 / 255, blue: 92 / 255, alpha: 0.25).cgColor
            shell.isUserInteractionEnabled = false
            shell.translatesAutoresizingMaskIntoConstraints = false

            let titleLabel = UILabel()
            titleLabel.text = title
            titleLabel.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
            titleLabel.textColor = UIColor(red: 42 / 255, green: 37 / 255, blue: 32 / 255, alpha: 1)

            let subLabel = UILabel()
            subLabel.text = subtitle
            subLabel.font = UIFont.systemFont(ofSize: 12, weight: .regular)
            subLabel.textColor = UIColor(red: 107 / 255, green: 99 / 255, blue: 92 / 255, alpha: 1)
            subLabel.numberOfLines = 2

            let noteLabel = UILabel()
            noteLabel.text = "Native diagnostic (non-blocking)"
            noteLabel.font = UIFont.systemFont(ofSize: 10, weight: .regular)
            noteLabel.textColor = UIColor(red: 107 / 255, green: 99 / 255, blue: 92 / 255, alpha: 0.75)

            let stack = UIStackView(arrangedSubviews: [titleLabel, subLabel, noteLabel])
            stack.axis = .vertical
            stack.alignment = .leading
            stack.spacing = 2
            stack.translatesAutoresizingMaskIntoConstraints = false
            stack.isLayoutMarginsRelativeArrangement = true
            stack.layoutMargins = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
            shell.addSubview(stack)

            NSLayoutConstraint.activate([
                stack.topAnchor.constraint(equalTo: shell.topAnchor),
                stack.leadingAnchor.constraint(equalTo: shell.leadingAnchor),
                stack.trailingAnchor.constraint(equalTo: shell.trailingAnchor),
                stack.bottomAnchor.constraint(equalTo: shell.bottomAnchor),
            ])

            if let sibling, sibling.superview === container {
                container.insertSubview(shell, aboveSubview: sibling)
            } else {
                container.addSubview(shell)
            }

            let topAnchor: NSLayoutYAxisAnchor
            if #available(iOS 11.0, *) {
                topAnchor = container.safeAreaLayoutGuide.topAnchor
            } else {
                topAnchor = container.topAnchor
            }
            NSLayoutConstraint.activate([
                shell.topAnchor.constraint(equalTo: topAnchor, constant: 8),
                shell.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
                shell.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -12),
            ])
        }

        RoamieNativeLog.debug("⚡️ [Roamie] NATIVE_BOOT_SHELL attached container=\(type(of: container)) blocking=false")
    }

    static func detach(from container: UIView) {
        container.viewWithTag(tag)?.removeFromSuperview()
    }
}

/// CADisplayLink helper (target for display warmup).
private final class RoamieDisplayLinkProxy: NSObject {
    private let handler: (CADisplayLink) -> Void

    init(handler: @escaping (CADisplayLink) -> Void) {
        self.handler = handler
    }

    @objc func tick(_ link: CADisplayLink) {
        handler(link)
    }
}

/// Second WKWebView: load bundled HTML off-screen when primary compositor path fails.
enum RoamieRecoveryWebView {
    private static weak var hostedView: WKWebView?
    private static var loadToken = 0

    static func captureBundledSnapshot(hostWindow: UIWindow?, frame: CGRect, completion: @escaping (UIImage?) -> Void) {
        guard let publicURL = Bundle.main.url(forResource: "public", withExtension: nil) else {
            completion(nil)
            return
        }
        let indexURL = publicURL.appendingPathComponent("index.html")
        guard let html = try? String(contentsOf: indexURL, encoding: .utf8) else {
            completion(nil)
            return
        }

        teardown()

        let config = WKWebViewConfiguration()
        RoamieWebKitMitigation.applyRecoveryConfiguration(to: config)
        let recovery = RoamieWKWebView(frame: frame, configuration: config)
        recovery.isHidden = true
        recovery.alpha = 1
        RoamieWebKitMitigation.applySoftwareRendering(to: recovery)

        if let hostWindow {
            recovery.frame = frame
            hostWindow.insertSubview(recovery, at: 0)
        }

        hostedView = recovery
        loadToken += 1
        let token = loadToken
        RoamieNativeLog.debug("⚡️ [Roamie] RECOVERY_WK loadHTMLString bytes=\(html.utf8.count)")

        recovery.loadHTMLString(html, baseURL: publicURL)

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            guard token == loadToken, let recovery = hostedView else {
                completion(nil)
                return
            }
            RoamieCompositorFallback.takeSnapshot(from: recovery, label: "recovery_wk") { image in
                teardown()
                completion(image)
            }
        }
    }

    static func teardown() {
        hostedView?.removeFromSuperview()
        hostedView = nil
    }
}

// MARK: - iOS 26 snapshot renderer (mirror = primary display; WKWebView = input/JS)

/// Snapshot-first on iOS 26: WINDOW_MIRROR is the formal display path; live compositor is never auto-restored.
enum RoamieCompositorFallback {
    private enum DisplayMode: String {
        case booting
        case snapshotRenderer
        case liveLegacy
    }

    private static let windowMirrorTag = 982_453
    private static let windowPlaceholderTag = 982_454
    private static let cream = UIColor(red: 253 / 255, green: 245 / 255, blue: 234 / 255, alpha: 1)

    private static weak var boundWebView: WKWebView?
    private static var mode: DisplayMode = .booting
    private static var snapshotInFlight = false
    private static var capturesThisNavigation = 0
    private static var pendingEvaluations: [Timer] = []
    private static var loggedOnce = Set<String>()
    private static var lastCapturedURL: String?
    private static var lastSpaCaptureAt: Date?

    private static let maxCapturesPerNavigation = 2
    private static let snapshotTimeout: TimeInterval = 12
    private static let spaCaptureMinInterval: TimeInterval = 1.5

    // MARK: Public API

    static func bind(_ webView: WKWebView) {
        boundWebView = webView
    }

    static func onNavigationStarted(_ webView: WKWebView) {
        guard isActive else { return }
        bind(webView)
        capturesThisNavigation = 0

        if usesSnapshotRenderer, mode == .snapshotRenderer, lastMirrorImage() != nil {
            configureWebViewForInput(webView)
            logOnce("nav_start_keep_mirror", "⚡️ [Roamie] SNAPSHOT_RENDERER nav_start — keeping last frame until finish")
            return
        }

        mode = .booting
        showBootPlaceholder(on: webView)
    }

    static func onNavigationFinished(_ webView: WKWebView) {
        guard isActive else { return }
        bind(webView)
        configureWebViewForInput(webView)
        cancelPendingEvaluations()

        if usesSnapshotRenderer {
            logOnce("snapshot_renderer", "⚡️ [Roamie] SNAPSHOT_RENDERER active — mirror display, WKWebView input")
            scheduleEvaluation(after: 1.0, reason: "nav_finish")
            scheduleBootMirrorCatchupIfNeeded()
            return
        }

        logOnce("nav_finish_legacy", "⚡️ [Roamie] COMPOSITOR nav_finish — legacy live evaluation")
        scheduleEvaluation(after: 0.45, reason: "nav_finish")
    }

    static func onProcessTerminated(_ webView: WKWebView) {
        guard isActive else { return }
        bind(webView)
        capturesThisNavigation = 0
        logOnce("process_terminated", "⚡️ [Roamie] SNAPSHOT_RENDERER process_terminated — reload then re-capture on finish")
        if let last = lastMirrorImage() {
            activateSnapshotRenderer(reason: "process_terminated_stale", snapshot: last)
        }
        webView.reload()
    }

    static func onHostViewAppeared(_ webView: WKWebView) {
        guard isActive else { return }
        bind(webView)
        configureWebViewForInput(webView)
        if mode == .booting {
            showBootPlaceholder(on: webView)
        }
    }

    static func teardown() {
        cancelPendingEvaluations()
        detachWindowMirror()
        RoamieRecoveryWebView.teardown()
        boundWebView?.window?.viewWithTag(windowPlaceholderTag)?.removeFromSuperview()
        boundWebView?.alpha = 1
        boundWebView?.isUserInteractionEnabled = true
        boundWebView = nil
        mode = .booting
        snapshotInFlight = false
        capturesThisNavigation = 0
        lastCapturedURL = nil
        lastSpaCaptureAt = nil
    }

    /// SPA / auth UI refresh — rate-limited, does not count toward nav capture cap, never restores live compositor.
    static func requestSpaSnapshotRefresh(force: Bool = false) {
        guard isActive, usesSnapshotRenderer, boundWebView != nil else { return }
        guard mode == .snapshotRenderer || mode == .booting else { return }

        let now = Date()
        if !force,
           let last = lastSpaCaptureAt,
           now.timeIntervalSince(last) < spaCaptureMinInterval {
            return
        }
        lastSpaCaptureAt = now

        captureSnapshot(label: "spa_ui", countsTowardCap: false) { image in
            guard let image, imageHasContent(image) else { return }
            activateSnapshotRenderer(reason: "spa_ui", snapshot: image)
        }
    }

    /// One-time catch-up after index.html nav — JS bundle may paint after first nav_finish snapshot.
    private static func scheduleBootMirrorCatchupIfNeeded() {
        guard isActive, usesSnapshotRenderer else { return }
        logOnce("boot_catchup", "⚡️ [Roamie] SNAPSHOT_RENDERER boot catchup scheduled")
        for delay in [1.5, 3.0, 5.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                requestSpaSnapshotRefresh(force: true)
            }
        }
    }

    static var isWindowMirrorVisible: Bool {
        guard let window = boundWebView?.window else { return false }
        let mirror = window.viewWithTag(windowMirrorTag)
        return mirror != nil && mirror?.isHidden == false
    }

    static var currentMode: String {
        switch mode {
        case .snapshotRenderer: return "mirror"
        case .liveLegacy: return "live"
        case .booting: return "booting"
        }
    }

    // MARK: Private

    private static var isActive: Bool {
        RoamieWebKitMitigation.useSnapshotFallback &&
            RoamieWebKitMitigation.useWindowMirror &&
            RoamieWebKitMitigation.isIOS26OrNewer
    }

    private static var usesSnapshotRenderer: Bool {
        isActive && RoamieWebKitMitigation.usesSnapshotRendererOnIOS26
    }

    private static func logOnce(_ key: String, _ message: String) {
        guard !loggedOnce.contains(key) else { return }
        loggedOnce.insert(key)
        RoamieNativeLog.debug(message)
    }

    private static func logState(_ message: String) {
        RoamieNativeLog.debug(message)
    }

    private static func logCriticalOnce(_ key: String, _ message: String) {
        guard !loggedOnce.contains(key) else { return }
        loggedOnce.insert(key)
        RoamieNativeLog.critical(message)
    }

    private static func cancelPendingEvaluations() {
        pendingEvaluations.forEach { $0.invalidate() }
        pendingEvaluations.removeAll()
    }

    private static func scheduleEvaluation(after delay: TimeInterval, reason: String) {
        let timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            evaluateDisplayPath(reason: reason)
        }
        pendingEvaluations.append(timer)
    }

    /// WKWebView stays interactive under the non-interactive mirror overlay.
    private static func configureWebViewForInput(_ webView: WKWebView) {
        RoamieWebKitMitigation.applySoftwareRendering(to: webView)
        webView.isHidden = false
        webView.isUserInteractionEnabled = true
        webView.scrollView.isScrollEnabled = true
        if mode == .snapshotRenderer {
            webView.alpha = 0.01
            RoamieWebKitMitigation.relaxLiveCompositorForSnapshotInput(webView)
        } else {
            webView.alpha = 1
        }
    }

    private static func showBootPlaceholder(on webView: WKWebView) {
        webView.alpha = 1
        RoamieWebKitMitigation.forceOpaque(webView)
        guard let window = webView.window else { return }
        window.backgroundColor = cream

        let placeholder: UIView
        if let existing = window.viewWithTag(windowPlaceholderTag) {
            placeholder = existing
        } else {
            placeholder = UIView(frame: window.bounds)
            placeholder.tag = windowPlaceholderTag
            placeholder.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            placeholder.backgroundColor = cream
            placeholder.isUserInteractionEnabled = false
            window.insertSubview(placeholder, at: 0)
            logOnce("placeholder", "⚡️ [Roamie] SNAPSHOT_RENDERER boot placeholder (cream)")
        }
        placeholder.frame = window.bounds
        placeholder.isHidden = false
    }

    private static func hideBootPlaceholder() {
        boundWebView?.window?.viewWithTag(windowPlaceholderTag)?.isHidden = true
        if let window = boundWebView?.window {
            RoamieNativeBootShell.detach(from: window)
        }
    }

    private static func evaluateDisplayPath(reason: String) {
        guard isActive, boundWebView != nil else { return }

        if usesSnapshotRenderer {
            refreshSnapshotForNavigation(reason: reason)
            return
        }

        guard let webView = boundWebView else { return }
        evaluateLegacyLivePath(reason: reason, webView: webView)
    }

    /// One capture per navigation (+ one retry). No timers, no auto live restore.
    private static func refreshSnapshotForNavigation(reason: String) {
        guard let webView = boundWebView else { return }
        let url = webView.url?.absoluteString ?? ""

        if capturesThisNavigation >= maxCapturesPerNavigation {
            logOnce("capture_cap", "⚡️ [Roamie] SNAPSHOT_RENDERER capture cap — keeping current mirror frame")
            if mode != .snapshotRenderer, let last = lastMirrorImage() {
                activateSnapshotRenderer(reason: "cap_keep", snapshot: last)
            }
            return
        }

        if reason == "nav_finish", url == lastCapturedURL, mode == .snapshotRenderer, lastMirrorImage() != nil {
            logOnce("capture_skip_same_url", "⚡️ [Roamie] SNAPSHOT_RENDERER skip duplicate capture url=\(url)")
            return
        }

        captureSnapshot(label: reason) { image in
            if let image, imageHasContent(image), let webView = boundWebView {
                lastCapturedURL = webView.url?.absoluteString
                probeLiveCompositorDiagnostic(webView)
                activateSnapshotRenderer(reason: reason, snapshot: image)
                return
            }

            if reason != "nav_finish-retry", capturesThisNavigation < maxCapturesPerNavigation {
                scheduleEvaluation(after: 1.5, reason: "nav_finish-retry")
                return
            }

            guard let webView = boundWebView else { return }
            tryRecoveryWebViewSnapshot(for: webView)
        }
    }

    private static func tryRecoveryWebViewSnapshot(for webView: WKWebView) {
        logOnce("recovery_wk", "⚡️ [Roamie] SNAPSHOT_RENDERER primary blank — recovery WebView")
        RoamieRecoveryWebView.captureBundledSnapshot(hostWindow: webView.window, frame: webView.bounds) { image in
            guard let webView = boundWebView else { return }
            if let image, imageHasContent(image) {
                activateSnapshotRenderer(reason: "recovery_webview", snapshot: image)
            } else {
                logCriticalOnce("recovery_blank", "⚡️ [Roamie] SNAPSHOT_RENDERER recovery blank — boot placeholder")
                showBootPlaceholder(on: webView)
            }
        }
    }

    /// Legacy path when ROAMIE_WK_FORCE_LIVE=1 (non-iOS26 snapshot renderer mode).
    private static func evaluateLegacyLivePath(reason: String, webView: WKWebView) {
        configureWebViewForInput(webView)
        RoamieWebKitMitigation.nudgeCompositor(webView)
        webView.alpha = 1

        if liveCompositorHasContent(webView) {
            mode = .liveLegacy
            detachWindowMirror()
            hideBootPlaceholder()
            logOnce("live_legacy", "⚡️ [Roamie] COMPOSITOR mode=live (legacy FORCE_LIVE)")
            return
        }

        captureSnapshot(label: reason) { image in
            if let image, imageHasContent(image) {
                activateSnapshotRenderer(reason: reason, snapshot: image)
            } else {
                showBootPlaceholder(on: webView)
            }
        }
    }

    private static func activateSnapshotRenderer(reason: String, snapshot: UIImage) {
        guard let webView = boundWebView else { return }
        mode = .snapshotRenderer
        configureWebViewForInput(webView)
        hideBootPlaceholder()
        cancelPendingEvaluations()
        presentWindowMirror(snapshot)
        logOnce("mirror_on", "⚡️ [Roamie] COMPOSITOR mode=mirror (\(reason)) — snapshot renderer, no auto-live")
    }

    private static func presentWindowMirror(_ image: UIImage) {
        guard let webView = boundWebView, let window = webView.window else { return }

        let mirror: UIImageView
        if let existing = window.viewWithTag(windowMirrorTag) as? UIImageView {
            mirror = existing
        } else {
            mirror = UIImageView(frame: window.bounds)
            mirror.tag = windowMirrorTag
            mirror.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            mirror.isUserInteractionEnabled = false
            mirror.isAccessibilityElement = false
            mirror.contentMode = .scaleToFill
            mirror.backgroundColor = cream
            window.addSubview(mirror)
            logOnce("window_mirror", "⚡️ [Roamie] WINDOW_MIRROR active (input passes through to WKWebView)")
        }
        mirror.frame = window.bounds
        mirror.image = image
        mirror.isHidden = false
        window.bringSubviewToFront(mirror)
        configureWebViewForInput(webView)
    }

    private static func detachWindowMirror() {
        boundWebView?.window?.viewWithTag(windowMirrorTag)?.removeFromSuperview()
    }

    private static func lastMirrorImage() -> UIImage? {
        (boundWebView?.window?.viewWithTag(windowMirrorTag) as? UIImageView)?.image
    }

    /// Diagnostic only — never switches display back to live on iOS 26.
    private static func probeLiveCompositorDiagnostic(_ webView: WKWebView) {
        let priorAlpha = webView.alpha
        webView.alpha = 1
        let liveHasPixels = drawHierarchyHasContent(webView)
        webView.alpha = priorAlpha
        logOnce(
            "live_probe",
            "⚡️ [Roamie] SNAPSHOT_RENDERER live_probe=\(liveHasPixels) (diagnostic only, staying on mirror)"
        )
    }

    private static func liveCompositorHasContent(_ webView: WKWebView) -> Bool {
        let priorAlpha = webView.alpha
        webView.alpha = 1
        let hasContent = drawHierarchyHasContent(webView)
        webView.alpha = priorAlpha
        return hasContent
    }

    // MARK: Snapshot capture (minimal frequency)

    static func takeSnapshot(from webView: WKWebView, label: String, completion: @escaping (UIImage?) -> Void) {
        takeSnapshotImpl(from: webView, label: label, completion: completion)
    }

    private static func captureSnapshot(label: String, countsTowardCap: Bool = true, completion: @escaping (UIImage?) -> Void) {
        guard let webView = boundWebView, isActive else {
            completion(nil)
            return
        }
        guard !snapshotInFlight else {
            completion(nil)
            return
        }

        snapshotInFlight = true
        if countsTowardCap {
            capturesThisNavigation += 1
        }

        takeSnapshotImpl(from: webView, label: label) { image in
            snapshotInFlight = false
            completion(image)
        }
    }

    fileprivate static func takeSnapshotImpl(from webView: WKWebView, label: String, completion: @escaping (UIImage?) -> Void) {
        var completed = false
        let finish: (UIImage?) -> Void = { image in
            guard !completed else { return }
            completed = true
            if let image, imageHasContent(image) {
                logState(
                    "⚡️ [Roamie] SNAPSHOT \(label) ok size=\(Int(image.size.width))x\(Int(image.size.height)) " +
                        "content=\(imageHasContent(image)) captures=\(capturesThisNavigation)"
                )
            } else {
                logCriticalOnce("snapshot_fail_\(label)", "⚡️ [Roamie] SNAPSHOT \(label) failed")
            }
            completion(image)
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + snapshotTimeout) {
            if !completed {
                logOnce("snapshot_slow", "⚡️ [Roamie] SNAPSHOT \(label) slow")
                finish(drawHierarchySnapshot(from: webView))
            }
        }

        let config = WKSnapshotConfiguration()
        config.rect = CGRect(origin: .zero, size: webView.bounds.size)
        webView.takeSnapshot(with: config) { image, error in
            if let error {
                logCriticalOnce("snapshot_err_\(label)", "⚡️ [Roamie] SNAPSHOT \(label) error=\(error.localizedDescription)")
                finish(drawHierarchySnapshot(from: webView))
                return
            }
            guard let image, image.size.width > 1, image.size.height > 1 else {
                finish(drawHierarchySnapshot(from: webView))
                return
            }
            finish(image)
        }
    }

    private static func drawHierarchySnapshot(from webView: WKWebView) -> UIImage? {
        let size = webView.bounds.size
        guard size.width > 1, size.height > 1 else { return nil }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = UIScreen.main.scale
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            webView.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: true)
        }
    }

    private static func drawHierarchyHasContent(_ webView: WKWebView) -> Bool {
        guard let image = drawHierarchySnapshot(from: webView) else { return false }
        return imageHasContent(image)
    }

    private static func imageHasContent(_ image: UIImage) -> Bool {
        guard let cg = image.cgImage else { return true }
        let width = min(cg.width, 64)
        let height = min(cg.height, 64)
        guard width > 0, height > 0 else { return false }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let ctx = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return true }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        let creamR = 253, creamG = 245, creamB = 234
        var nonBackground = 0
        for i in stride(from: 0, to: pixels.count, by: 16) {
            let r = Int(pixels[i]), g = Int(pixels[i + 1]), b = Int(pixels[i + 2])
            if abs(r - creamR) > 18 || abs(g - creamG) > 18 || abs(b - creamB) > 18 {
                nonBackground += 1
            }
        }
        return nonBackground > 2
    }
}

/// JS bridge: `webkit.messageHandlers.roamieSnapshot.postMessage({ reason })`
@objc final class RoamieSnapshotScriptBridge: NSObject, WKScriptMessageHandler {
    static let shared = RoamieSnapshotScriptBridge()

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "roamieSnapshot" else { return }
        DispatchQueue.main.async {
            RoamieCompositorFallback.requestSpaSnapshotRefresh()
        }
    }
}

/// Legacy shim — prefer RoamieCompositorFallback directly.
enum RoamieWebSnapshotFallback {
    static func stopPeriodicRefresh() {
        RoamieCompositorFallback.teardown()
    }

    static var isWindowMirrorVisible: Bool {
        RoamieCompositorFallback.isWindowMirrorVisible
    }
}

enum RoamieWKNavLog {
    static func nav(_ label: String, webView: WKWebView) {
        let url = webView.url?.absoluteString ?? "(nil)"
        RoamieNativeLog.debug(
            "⚡️ [Roamie] WK_NAV \(label) url=\(url) loading=\(webView.isLoading) progress=\(String(format: "%.2f", webView.estimatedProgress))"
        )
    }

    static func action(_ navigationAction: WKNavigationAction) {
        let req = navigationAction.request.url?.absoluteString ?? "(nil)"
        RoamieNativeLog.debug("⚡️ [Roamie] WK_NAV action type=\(navigationAction.navigationType.rawValue) req=\(req)")
    }

    static func error(_ label: String, _ error: Error, webView: WKWebView) {
        RoamieNativeLog.critical(
            "⚡️ [Roamie] WK_NAV \(label) \(describe(error)) url=\(webView.url?.absoluteString ?? "(nil)")"
        )
    }

    private static func describe(_ error: Error) -> String {
        let ns = error as NSError
        var parts: [String] = []
        parts.append("domain=\(ns.domain)")
        parts.append("code=\(ns.code)")
        parts.append("desc=\(ns.localizedDescription)")
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            parts.append("underlying=\(underlying.domain)(\(underlying.code))")
        }
        return parts.joined(separator: " ")
    }
}

@objc final class RoamieWKNavigationForwarder: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let capacitor: WebViewDelegationHandler

    init(capacitor: WebViewDelegationHandler) {
        self.capacitor = capacitor
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        capacitor.webView(webView, didStartProvisionalNavigation: navigation)
        RoamieWebKitMitigation.forceOpaque(webView)
        RoamieCompositorFallback.onNavigationStarted(webView)
        RoamieWKNavLog.nav("start", webView: webView)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        RoamieWKNavLog.nav("commit", webView: webView)
        if !(RoamieWebKitMitigation.isIOS26OrNewer && RoamieWebKitMitigation.usesSnapshotRendererOnIOS26) {
            RoamieWebKitMitigation.stabilizeRendering(webView)
            RoamieWebKitMitigation.flushRendering(webView)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        capacitor.webView(webView, didFinish: navigation)
        if !(RoamieWebKitMitigation.isIOS26OrNewer && RoamieWebKitMitigation.usesSnapshotRendererOnIOS26) {
            RoamieWebKitMitigation.stabilizeRendering(webView)
        }
        webView.isHidden = false
        RoamieWebKitMitigation.nudgeCompositorIfNeeded(webView)
        RoamieWKNavLog.nav("finish", webView: webView)
        RoamieCompositorFallback.onNavigationFinished(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        capacitor.webView(webView, didFailProvisionalNavigation: navigation, withError: error)
        RoamieWKNavLog.error("fail_provisional", error, webView: webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        capacitor.webView(webView, didFail: navigation, withError: error)
        RoamieWKNavLog.error("fail", error, webView: webView)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        capacitor.webViewWebContentProcessDidTerminate(webView)
        RoamieWKNavLog.nav("process_terminated", webView: webView)
        RoamieCompositorFallback.onProcessTerminated(webView)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        RoamieWKNavLog.action(navigationAction)
        capacitor.webView(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
    }

    @available(iOS 15, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }

    @available(iOS 15, *)
    func webView(
        _ webView: WKWebView,
        requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }
}
