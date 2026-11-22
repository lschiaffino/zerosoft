#if DEBUG
import AppKit

/// UI tests only (`-ZSUITest YES`, Debug builds): tiny labels that tell the tests what the native
/// side did, in a panel of their own so they stay readable whichever window or tab is in front
/// (and while every window is closed). The panel ignores the mouse and is not in the Window menu.
///
/// - `zs-test-external`: the last URL that would have opened in the browser.
/// - `zs-test-ready`, `zs-test-bridge`: the bridge's `ready` report and its refusals by reason.
/// - `zs-test-login`, `zs-test-badge`, `zs-test-notify`, `zs-test-deeplink`: block 3.
/// - `zs-test-tabs`: every window and its tabs (`TabSession.summary`); `zs-test-session`: how
///   many times the session was written to disk.
/// - Block 5: `zs-test-settings` (AppSettings.summary), `zs-test-prefs` (TabPrefs.summary),
///   `zs-test-loginitem` (the fake login item), `zs-test-notif` (how often the permission was
///   asked and its answer), `zs-test-requests` (the Settings window's requests, in order).
@MainActor
final class TestPanel {
    private let panel: NSPanel
    private var labels: [String: NSTextField] = [:]
    private var rejections: [BridgeRejection: Int] = [:]
    private var logins = 0
    private var links = 0

    init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 120, height: 8),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isExcludedFromWindowsMenu = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]
        panel.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 120, height: 8))
        if let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: screen.minX, y: screen.minY))
        }
        for (id, initial) in [
            ("zs-test-external", "none"), ("zs-test-ready", "none"), ("zs-test-bridge", "rejected end"),
            ("zs-test-login", "none"), ("zs-test-badge", "none"), ("zs-test-notify", "none"),
            ("zs-test-deeplink", "none"), ("zs-test-tabs", "tabs end"), ("zs-test-session", "saved 0"),
            ("zs-test-settings", "none"), ("zs-test-prefs", "none"), ("zs-test-loginitem", "none"),
            ("zs-test-notif", "notif asked=0"), ("zs-test-requests", "requests end"),
        ] {
            let label = NSTextField(labelWithString: initial)
            label.frame = NSRect(x: CGFloat(labels.count) * 5, y: 0, width: 4, height: 4)
            label.alphaValue = 0.02
            label.setAccessibilityIdentifier(id)
            panel.contentView?.addSubview(label)
            labels[id] = label
        }
        panel.orderFrontRegardless()
    }

    func set(_ id: String, _ value: String) {
        labels[id]?.stringValue = value
    }

    func external(_ url: URL) {
        set("zs-test-external", url.absoluteString)
    }

    /// Bridge recorders of one tab's web controller.
    func watch(_ web: WebController) {
        web.onBridgeReady = { [weak self] report in self?.set("zs-test-ready", "ready \(report.summary) end") }
        web.onBridgeReject = { [weak self] reason in self?.rejected(reason) }
    }

    private func rejected(_ reason: BridgeRejection) {
        rejections[reason, default: 0] += 1
        let order: [BridgeRejection] = [.origin, .malformed, .tooLarge, .unknownCommand, .badArgs, .unavailable]
        let parts = order.compactMap { r in rejections[r].map { "\(r.rawValue)=\($0)" } }
        set("zs-test-bridge", (["rejected"] + parts + ["end"]).joined(separator: " "))
    }

    func watch(auth: AuthController, notifier: Notifier) {
        auth.onOutcome = { [weak self] tag in
            guard let self else { return }
            logins += 1
            set("zs-test-login", "login \(logins) \(tag)")
        }
        notifier.onBadge = { [weak self] label in self?.set("zs-test-badge", "badge \(label)") }
        notifier.onPageNotification = { [weak self] title, body, show in
            self?.set("zs-test-notify", "notify \(title)|\(body ?? "-")|\(show ? "shown" : "app-active")")
        }
    }

    private var requests: [String] = []

    func watch(settings model: SettingsModel, login: FakeLoginItem, permission: FakeNotificationPermission) {
        set("zs-test-settings", model.settings.summary)
        set("zs-test-loginitem", "login-item \(login.state.rawValue)")
        login.onChange = { [weak self] state in self?.set("zs-test-loginitem", "login-item \(state.rawValue)") }
        permission.onChange = { [weak self] asked, access in self?.set("zs-test-notif", "notif asked=\(asked) \(access.rawValue)") }
        model.onRequest = { [weak self] fact in
            guard let self else { return }
            requests.append(fact)
            set("zs-test-requests", (["requests"] + requests.suffix(12) + ["end"]).joined(separator: " | "))
        }
    }

    func deepLink(_ what: String) {
        links += 1
        set("zs-test-deeplink", "link \(links) \(what)")
    }
}
#endif
