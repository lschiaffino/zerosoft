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
/// - Block 6: `zs-test-dictation` (how many dictation events and the last one), `zs-test-phase`
///   (idle, recording, working), `zs-test-hotkey` (the dictation shortcut's registration),
///   `zs-test-mic` and `zs-test-paste` (the fake permissions: how often asked, the answer, the
///   keystrokes), `zs-test-pending` (saved dictations), `zs-test-dictset`
///   (AppSettings.dictationSummary), `zs-test-hud` (what the HUD shows).
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
            ("zs-test-dictation", "events 0 none"), ("zs-test-phase", "phase idle"), ("zs-test-hotkey", "none"),
            ("zs-test-mic", "mic asked=0"), ("zs-test-paste", "paste asked=0"), ("zs-test-pending", "pending 0"),
            ("zs-test-dictset", "none"), ("zs-test-hud", "hidden"),
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

    private var dictationEvents = 0

    func watch(dictation: DictationController, mic: FakeMicrophonePermission, paste: FakePastePermission) {
        let report = { [weak self, weak dictation] in
            guard let self, let dictation else { return }
            self.set("zs-test-phase", "phase \(dictation.machine.phase.rawValue)")
            self.set("zs-test-pending", "pending \(dictation.pendingCount)")
            self.set("zs-test-dictset", dictation.settings.dictationSummary)
            self.set("zs-test-hud", dictation.hudSummary)
        }
        let onChange = dictation.onChange
        dictation.onChange = {
            onChange()
            report()
        }
        dictation.onOutcome = { [weak self] what in
            guard let self else { return }
            if what.hasPrefix("hotkey ") {
                set("zs-test-hotkey", what)
                return
            }
            dictationEvents += 1
            set("zs-test-dictation", "events \(dictationEvents) \(what)")
            report()
        }
        set("zs-test-mic", "mic asked=0 \(mic.current().rawValue)")
        mic.onChange = { [weak self] asked, access in self?.set("zs-test-mic", "mic asked=\(asked) \(access.rawValue)") }
        let paint = { [weak self, weak paste] in
            guard let self, let paste else { return }
            self.set("zs-test-paste", "paste asked=\(paste.asked) \(paste.approved() ? "allowed" : "off") keys=\(paste.keys)")
        }
        paint()
        paste.onChange = paint
        report()
    }

    func deepLink(_ what: String) {
        links += 1
        set("zs-test-deeplink", "link \(links) \(what)")
    }
}
#endif
