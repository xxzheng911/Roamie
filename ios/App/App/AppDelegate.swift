import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 清除 live-reload / Cordova deploy 殘留路徑（真機重裝後 KeyValueStore 仍可能殘留）
        KeyValueStore.standard["serverBasePath"] = nil as String?
        #if targetEnvironment(simulator)
        RoamieNativeLog.debug("⚡️ [Roamie] RUNTIME=simulator")
        #else
        RoamieNativeLog.debug("⚡️ [Roamie] RUNTIME=device model=\(UIDevice.current.model) ios=\(UIDevice.current.systemVersion)")
        #endif
        RoamieBundledWebProbe.logPackagedIndexHtml()
        if let window = window {
            window.backgroundColor = UIColor(red: 253 / 255, green: 245 / 255, blue: 234 / 255, alpha: 1)
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if url.scheme == "roamie" {
            RoamieNativeLog.debug("⚡️ [Roamie] OPEN_URL scheme=roamie url=\(url.absoluteString)")
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    /// iPhone: portrait only. iPad: all orientations declared in Info.plist (App Store requirement).
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        if UIDevice.current.userInterfaceIdiom == .pad {
            return [.portrait, .portraitUpsideDown, .landscapeLeft, .landscapeRight]
        }
        return .portrait
    }

}

/// 原生 Xcode log（不依賴 WKWebView console 轉發）
enum RoamieBundledWebProbe {
    static func logPackagedIndexHtml() {
        guard let indexPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "public") else {
            RoamieNativeLog.critical("⚡️ [Roamie] BUNDLED_INDEX_MISSING — public/index.html 不在 App bundle")
            return
        }
        do {
            let html = try String(contentsOfFile: indexPath, encoding: .utf8)
            RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX path=\(indexPath) bytes=\(html.utf8.count)")
            if let marker = html.range(of: "roamie-build\" content=\"") {
                let rest = html[marker.upperBound...]
                if let end = rest.firstIndex(of: "\"") {
                    RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX build=\(rest[..<end])")
                }
            }
            if let marker = html.range(of: "src=\"./assets/index-") {
                let rest = html[marker.upperBound...]
                if let end = rest.firstIndex(of: "\"") {
                    RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX entry=index-\(rest[..<end])")
                }
            }
            if html.contains("Ultra minimal HTML test") {
                if html.contains("roamie-probe\" content=\"INDEX_HTML_LOADED\"") {
                    RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX mode=ultra-minimal-html probe=meta INDEX_HTML_LOADED (zero script)")
                } else {
                    RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX mode=ultra-minimal-html (zero JS, no probe meta)")
                }
            } else if html.contains("roamie-probe\" content=\"INDEX_HTML_LOADED\"") {
                RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX probe=INDEX_HTML_LOADED (meta, no script)")
            } else if html.contains("<script") && html.contains("INDEX_HTML_LOADED") {
                RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_INDEX probe=INDEX_HTML_LOADED (inline script)")
            } else if !html.contains("INDEX_HTML_LOADED") {
                RoamieNativeLog.critical("⚡️ [Roamie] BUNDLED_INDEX WARN — 缺少 INDEX_HTML_LOADED probe")
            }
            let assetsDir = (indexPath as NSString).deletingLastPathComponent.appending("/assets")
            if let entries = try? FileManager.default.contentsOfDirectory(atPath: assetsDir) {
                let indexChunks = entries.filter { $0.hasPrefix("index-") && $0.hasSuffix(".js") }
                RoamieNativeLog.debug("⚡️ [Roamie] BUNDLED_ASSETS index_chunks=\(indexChunks.joined(separator: ","))")
            }
        } catch {
            RoamieNativeLog.critical("⚡️ [Roamie] BUNDLED_INDEX_READ_ERROR \(error.localizedDescription)")
        }
    }

    static func probeWebView(_ webView: WKWebView?, label: String) {
        guard let webView else {
            RoamieNativeLog.debug("⚡️ [Roamie] DOM_PROBE \(label) webView=nil")
            return
        }
        let url = webView.url?.absoluteString ?? "(nil)"
        RoamieNativeLog.debug("⚡️ [Roamie] DOM_PROBE \(label) url=\(url)")
        // NOTE: Do not evaluate JavaScript on device startup.
        // When WebContent is already struggling, evaluateJavaScript often worsens unresponsiveness
        // and obscures the original cause. Use URL-only probes instead.
    }
}

/// iPhone portrait lock；強制使用 App bundle 內 public/（忽略 ionic_built_snapshots 殘留路徑）。
/// 勿呼叫 webView.load — 會打斷 Capacitor scheme 初始導航並回到 about:blank。
class PortraitBridgeViewController: CAPBridgeViewController {
    private var navForwarder: RoamieWKNavigationForwarder?
    private var pendingInlineHTML: (html: String, baseURL: URL)?
    private var pendingCapacitorLoad = false
    private var didPerformLoad = false
    private var activeObserver: NSObjectProtocol?

    deinit {
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
        }
        RoamieCompositorFallback.teardown()
    }

    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        RoamieWebKitMitigation.apply(to: config, instanceConfiguration: instanceConfiguration)
        return config
    }

    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = RoamieWKWebView(frame: frame, configuration: configuration)
        RoamieWebKitMitigation.configureWebView(webView)
        return webView
    }

    override open func instanceDescriptor() -> InstanceDescriptor {
        KeyValueStore.standard["serverBasePath"] = nil as String?
        let descriptor = super.instanceDescriptor()
        if let publicURL = Bundle.main.url(forResource: "public", withExtension: nil) {
            descriptor.appLocation = publicURL
        }
        return descriptor
    }

    override open func viewDidLoad() {
        // Skip CAPBridgeViewController.viewDidLoad() — its loadWebView() is final in Capacitor 7.
        roamieLoadBundledWebContent()
    }

    private func roamieLoadBundledWebContent() {
        guard let capBridge = bridge as? CapacitorBridge, let webView = webView else {
            performCapacitorLoad()
            attachNativeBootShellIfNeeded()
            return
        }

        if RoamieWebKitMitigation.useUIKitOnlyBoot {
            RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD uikit-only — skipping WebKit navigation (diagnostic)")
            capBridge.webViewDelegationHandler.willLoadWebview(webView)
            webView.isHidden = true
            attachNativeBootShellIfNeeded()
            return
        }

        RoamieWebKitMitigation.configureWebView(webView)

        let strategy = RoamieWebKitMitigation.loadStrategy
        if strategy == .inlineHTML {
            let fileURL = capBridge.config.appStartFileURL
            let baseURL = capBridge.config.appLocation
            guard FileManager.default.fileExists(atPath: fileURL.path),
                  let html = try? String(contentsOf: fileURL, encoding: .utf8) else {
                RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD inline fallback — index.html missing, using capacitor scheme")
                scheduleCapacitorLoad()
                return
            }
            if RoamieWebKitMitigation.deferLoadUntilActive && UIApplication.shared.applicationState != .active {
                pendingInlineHTML = (html, baseURL)
                RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD deferred until active strategy=inlineHTML")
                registerActiveLoadObserver()
                return
            }
            performInlineLoad(html: html, baseURL: baseURL, webView: webView)
            return
        }

        scheduleCapacitorLoad()
    }

    private func scheduleCapacitorLoad() {
        if RoamieWebKitMitigation.deferLoadUntilActive && UIApplication.shared.applicationState != .active {
            pendingCapacitorLoad = true
            RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD deferred until active strategy=capacitorScheme")
            registerActiveLoadObserver()
            return
        }
        performCapacitorLoad()
    }

    private func performCapacitorLoad() {
        guard !didPerformLoad else { return }
        didPerformLoad = true
        pendingCapacitorLoad = false
        pendingInlineHTML = nil
        if let bridge = bridge as? CapacitorBridge {
            let url = bridge.config.appStartServerURL.absoluteString
            RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD strategy=capacitorScheme url=\(url)")
        }
        RoamieWebKitMitigation.runAfterDisplayWarmup { [weak self] in
            guard let self, let webView = self.webView else { return }
            if RoamieWebKitMitigation.isIOS26OrNewer {
                RoamieCompositorFallback.bind(webView)
            }
            if let capBridge = self.bridge as? CapacitorBridge {
                capBridge.webViewDelegationHandler.willLoadWebview(webView)
            }
            self.loadWebView()
            DispatchQueue.main.async {
                RoamieWebKitMitigation.nudgeCompositorIfNeeded(webView)
            }
        }
    }

    private func performInlineLoad(html: String, baseURL: URL, webView: WKWebView) {
        guard !didPerformLoad else { return }
        didPerformLoad = true
        pendingInlineHTML = nil
        if let capBridge = bridge as? CapacitorBridge {
            capBridge.webViewDelegationHandler.willLoadWebview(webView)
        }
        RoamieWebKitMitigation.forceOpaque(webView)
        RoamieNativeLog.debug("⚡️ [Roamie] WK_LOAD strategy=inlineHTML bytes=\(html.utf8.count) base=\(baseURL.path)")
        webView.loadHTMLString(html, baseURL: baseURL)
        DispatchQueue.main.async {
            RoamieWebKitMitigation.nudgeCompositorIfNeeded(webView)
        }
    }

    private func registerActiveLoadObserver() {
        guard activeObserver == nil else { return }
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.performPendingLoadIfNeeded()
        }
    }

    private func performPendingLoadIfNeeded() {
        guard !didPerformLoad else { return }
        if pendingCapacitorLoad {
            performCapacitorLoad()
            return
        }
        if let pending = pendingInlineHTML, let webView = webView {
            performInlineLoad(html: pending.html, baseURL: pending.baseURL, webView: webView)
        }
    }

    private func attachNativeBootShellIfNeeded() {
        // Boot shell is owned by RoamieCompositorFallback placeholder on iOS 26.
        guard RoamieWebKitMitigation.useNativeBootShell, !RoamieWebKitMitigation.isIOS26OrNewer else { return }
        guard let container = view ?? webView?.superview else { return }
        RoamieNativeBootShell.attach(
            to: container,
            above: webView,
            subtitle: "Ultra minimal HTML test (no scripts)"
        )
    }

    override open func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        attachNativeBootShellIfNeeded()
    }

    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        performPendingLoadIfNeeded()
        if RoamieWebKitMitigation.isIOS26OrNewer, let webView = webView {
            RoamieCompositorFallback.bind(webView)
            RoamieCompositorFallback.onHostViewAppeared(webView)
            RoamieCompositorFallback.reelevateInputIfNeeded(webView)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                RoamieCompositorFallback.reelevateInputIfNeeded(webView)
                RoamieWebKitMitigation.nudgeCompositorIfNeeded(webView)
            }
        }
    }

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        if let bridge = bridge {
            let startURL = bridge.config.appStartServerURL
            let indexPath = bridge.config.appStartFileURL.path
            let indexExists = FileManager.default.fileExists(atPath: indexPath)
            RoamieNativeLog.debug("⚡️ [Roamie] BRIDGE appLocation=\(bridge.config.appLocation.path)")
            RoamieNativeLog.debug("⚡️ [Roamie] BRIDGE startURL=\(startURL.absoluteString) indexPath=\(indexPath) indexExists=\(indexExists)")
        }
        guard let webView = webView else { return }
        if let capBridge = bridge as? CapacitorBridge {
            let forwarder = RoamieWKNavigationForwarder(capacitor: capBridge.webViewDelegationHandler)
            navForwarder = forwarder
            webView.navigationDelegate = forwarder
            webView.uiDelegate = forwarder
        }
        RoamieWebKitMitigation.configureWebView(webView)
        if RoamieWebKitMitigation.isIOS26OrNewer {
            RoamieCompositorFallback.bind(webView)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in
            guard let self, let webView = self.webView else { return }
            let url = webView.url?.absoluteString ?? "(nil)"
            RoamieNativeLog.debug(
                "⚡️ [Roamie] NAV_CHECK t+6s url=\(url) mode=\(RoamieCompositorFallback.currentMode) " +
                    "webAlpha=\(webView.alpha) windowMirror=\(RoamieCompositorFallback.isWindowMirrorVisible)"
            )
            if url.contains("about:blank") {
                RoamieNativeLog.critical("⚡️ [Roamie] DEVICE_BLANK — index.html 未 commit")
            }
        }
    }

    override open var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        if UIDevice.current.userInterfaceIdiom == .pad {
            return [.portrait, .portraitUpsideDown, .landscapeLeft, .landscapeRight]
        }
        return .portrait
    }

    override open var shouldAutorotate: Bool {
        return UIDevice.current.userInterfaceIdiom == .pad
    }
}
