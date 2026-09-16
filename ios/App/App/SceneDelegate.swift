import UIKit
import Capacitor

/// Storyboard-based UIScene entry for Xcode 27 / iOS 27 SDK.
/// Window + `PortraitBridgeViewController` still come from `Main.storyboard`.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard scene is UIWindowScene else { return }

        // UISceneStoryboardFile = Main creates the window and root VC before this callback.
        // Do not allocate a UIWindow or CAPBridgeViewController here.
        window?.backgroundColor = UIColor(red: 253 / 255, green: 245 / 255, blue: 234 / 255, alpha: 1)

        // Capacitor 7.6.5: CAPBridgeViewController.loadView() already ran capacitorDidLoad(),
        // so App plugin observers exist. JS has not started. Forwarding now:
        // - sets ApplicationDelegateProxy.lastURL for App.getLaunchUrl()
        // - posts capacitorOpenURL with retainUntilConsumed appUrlOpen
        // Immediate re-forward later would double-deliver; Capacitor 8.5 SceneDelegateProxy
        // delay is not available and not needed with this storyboard load order.
        for context in connectionOptions.urlContexts {
            forwardOpenURL(context.url, options: openURLOptions(from: context.options))
        }
        for userActivity in connectionOptions.userActivities {
            forwardUserActivity(userActivity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            forwardOpenURL(context.url, options: openURLOptions(from: context.options))
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forwardUserActivity(userActivity)
    }

    private func forwardOpenURL(_ url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) {
        if url.scheme == "roamie" {
            RoamieNativeLog.debug("⚡️ [Roamie] OPEN_URL scheme=roamie url=\(url.absoluteString)")
        }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: options)
    }

    private func forwardUserActivity(_ userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    private func openURLOptions(from sceneOptions: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let sourceApplication = sceneOptions.sourceApplication {
            options[.sourceApplication] = sourceApplication
        }
        if let annotation = sceneOptions.annotation {
            options[.annotation] = annotation
        }
        options[.openInPlace] = sceneOptions.openInPlace
        return options
    }
}
