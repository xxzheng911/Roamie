import UIKit
import Capacitor

/// iPhone Duo 摺疊狀態：hinge 狀態／角度與 reserved regions（division 摺痕、occlusion 遮擋）。
/// - 座標：bridge.webView 的座標系（points，對應 CSS px）。
/// - iOS 27.1 以前或沒有 hinge／region 的裝置：回傳 supported=false。
/// - 所有 UIKit 存取都在主執行緒（@MainActor）。
/// - @unchecked Sendable：可變狀態只在 @MainActor 方法內讀寫；`[weak self]` 只為了跨進
///   `Task { @MainActor }`／KVO／NotificationCenter／DispatchQueue 的 @Sendable closure 再回到主執行緒。
@objc(DuoHingePlugin)
final class DuoHingePlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
    let identifier = "DuoHingePlugin"
    let jsName = "DuoHinge"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    private static let angleThresholdDegrees: Double = 2
    private static let logPrefix = "⚡️ [Roamie] DUO_HINGE"

    /// `UIHingeInteraction`（以 AnyObject 保存，避免 iOS 15 上出現 27.1 型別的 stored property）。
    private var hingeInteraction: AnyObject?
    private weak var observedView: UIView?
    private var boundsObservation: NSKeyValueObservation?
    private var frameObservation: NSKeyValueObservation?
    private var activeObserver: NSObjectProtocol?
    private var refreshScheduled = false

    private var hingeStatus = "unknown"
    private var hingeAngleDegrees: Double?
    private var hasHinge = false
    private var lastSent: DuoHingeSnapshot?

    deinit {
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
        }
    }

    override func load() {
        Task { @MainActor [weak self] in
            self?.installIfNeeded()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self else {
                call.resolve(DuoHingeSnapshot.unsupported.toJS())
                return
            }
            self.installIfNeeded()
            call.resolve(self.currentSnapshot().toJS())
        }
    }

    // MARK: - Install

    @MainActor
    private func installIfNeeded() {
        guard hingeInteraction == nil, let webView = bridge?.webView else { return }
        guard #available(iOS 27.1, *) else {
            RoamieNativeLog.debug("\(Self.logPrefix) unsupported reason=ios<27.1")
            return
        }

        let interaction = UIHingeInteraction { [weak self] _, update in
            guard let self else { return }
            if let hinge = update.hinge {
                self.hasHinge = true
                self.hingeStatus = Self.statusName(hinge.status)
                let degrees = Double(hinge.angle) * 180 / Double.pi
                self.hingeAngleDegrees = degrees.isFinite ? (degrees * 10).rounded() / 10 : nil
            } else {
                self.hasHinge = false
                self.hingeStatus = "unknown"
                self.hingeAngleDegrees = nil
            }
            self.emitIfChanged(reason: "hinge")
        }
        webView.addInteraction(interaction)
        hingeInteraction = interaction
        observedView = webView

        // KVO：webView 的 bounds／frame 變化（開合、旋轉、trait 變化造成的重新排版）時重新查 reserved regions。
        // 不 subclass webView、不改 SceneDelegate。
        boundsObservation = webView.observe(\.bounds, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.scheduleRefresh(reason: "bounds") }
        }
        frameObservation = webView.observe(\.frame, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.scheduleRefresh(reason: "frame") }
        }
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.scheduleRefresh(reason: "active") }
        }

        RoamieNativeLog.debug("\(Self.logPrefix) installed")
        scheduleRefresh(reason: "install")
    }

    /// 同一輪 run loop 內多次 KVO 只查一次（等 layout 完成後再查）。
    @MainActor
    private func scheduleRefresh(reason: String) {
        guard !refreshScheduled else { return }
        refreshScheduled = true
        DispatchQueue.main.async { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.refreshScheduled = false
                self.emitIfChanged(reason: reason)
            }
        }
    }

    // MARK: - Snapshot

    @MainActor
    private func currentSnapshot() -> DuoHingeSnapshot {
        guard #available(iOS 27.1, *), let view = observedView ?? bridge?.webView else {
            return .unsupported
        }
        let divisions = Self.regions(of: view, kind: .division)
        let occlusions = Self.regions(of: view, kind: .occlusion)
        let supported = hasHinge || !divisions.isEmpty || !occlusions.isEmpty
        guard supported else { return .unsupported }
        return DuoHingeSnapshot(
            supported: true,
            status: hasHinge ? hingeStatus : "unknown",
            angle: hasHinge ? hingeAngleDegrees : nil,
            divisions: divisions,
            occlusions: occlusions
        )
    }

    @available(iOS 27.1, *)
    @MainActor
    private static func regions(of view: UIView, kind: UIView.ReservedRegion.Kind) -> [DuoHingeRect] {
        view.reservedRegions(kind: kind, options: .includeInactive).compactMap { region in
            let f = region.frame
            guard f.origin.x.isFinite, f.origin.y.isFinite, f.width.isFinite, f.height.isFinite,
                  f.width >= 0, f.height >= 0 else { return nil }
            return DuoHingeRect(
                x: round2(Double(f.origin.x)),
                y: round2(Double(f.origin.y)),
                width: round2(Double(f.width)),
                height: round2(Double(f.height)),
                active: region.isActive
            )
        }
    }

    @available(iOS 27.1, *)
    private static func statusName(_ status: UIHinge.Status) -> String {
        switch status {
        case .closed: return "closed"
        case .partiallyOpen: return "partiallyOpen"
        case .fullyOpen: return "fullyOpen"
        default: return "unknown"
        }
    }

    private static func round2(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    // MARK: - Emit

    /// 只有內容改變才送：supported／status／regions 任何不同即送；只有角度不同時，變化 ≥ 2° 才送。
    @MainActor
    private func emitIfChanged(reason: String) {
        let next = currentSnapshot()
        if let last = lastSent {
            if last == next { return }
            if last.sameExceptAngle(next), let a = last.angle, let b = next.angle,
               abs(a - b) < Self.angleThresholdDegrees {
                return
            }
        }
        lastSent = next
        RoamieNativeLog.debug("\(Self.logPrefix) \(next.logDescription) reason=\(reason)")
        notifyListeners("hingeChange", data: next.toJS())
    }
}

private struct DuoHingeRect: Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let active: Bool

    func toJS() -> JSObject {
        ["x": x, "y": y, "width": width, "height": height, "active": active]
    }

    var logDescription: String {
        "(\(x),\(y),\(width)x\(height)\(active ? "" : ",inactive"))"
    }
}

private struct DuoHingeSnapshot: Equatable {
    let supported: Bool
    let status: String
    let angle: Double?
    let divisions: [DuoHingeRect]
    let occlusions: [DuoHingeRect]

    static let unsupported = DuoHingeSnapshot(
        supported: false, status: "unknown", angle: nil, divisions: [], occlusions: []
    )

    func sameExceptAngle(_ other: DuoHingeSnapshot) -> Bool {
        supported == other.supported && status == other.status &&
            divisions == other.divisions && occlusions == other.occlusions
    }

    func toJS() -> JSObject {
        var obj: JSObject = [
            "supported": supported,
            "status": status,
            "divisions": divisions.map { $0.toJS() as JSValue } as JSArray,
            "occlusions": occlusions.map { $0.toJS() as JSValue } as JSArray
        ]
        if let angle {
            obj["angle"] = angle
        } else {
            obj["angle"] = NSNull()
        }
        return obj
    }

    var logDescription: String {
        let angleText = angle.map { String(format: "%.1f", $0) } ?? "nil"
        let div = divisions.map(\.logDescription).joined(separator: " ")
        let occ = occlusions.map(\.logDescription).joined(separator: " ")
        return "supported=\(supported) status=\(status) angle=\(angleText) " +
            "divisions=\(divisions.count)[\(div)] occlusions=\(occlusions.count)[\(occ)]"
    }
}
