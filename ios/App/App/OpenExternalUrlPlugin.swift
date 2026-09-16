import UIKit
import Capacitor

/// Scene-safe outbound URL opener. Does not create a scene-less UIWindow or use Capacitor Browser.
@objc(OpenExternalUrlPlugin)
final class OpenExternalUrlPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "OpenExternalUrlPlugin"
    let jsName = "OpenExternalUrl"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    @objc func open(_ call: CAPPluginCall) {
        guard
            let raw = call.getString("url")?.trimmingCharacters(in: .whitespacesAndNewlines),
            let url = URL(string: raw),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https"
        else {
            call.reject("Must provide a valid http(s) URL")
            return
        }

        Task { @MainActor [weak self] in
            let scene = self?.bridge?.viewController?.view.window?.windowScene
                ?? UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .first { $0.activationState == .foregroundActive }

            guard let scene else {
                call.reject("No active window scene")
                return
            }

            let success = await scene.open(url, options: UIScene.OpenExternalURLOptions())
            if success {
                call.resolve()
            } else {
                call.reject("Unable to open URL")
            }
        }
    }
}
