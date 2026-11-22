import AppKit
import os
import UserNotifications

/// Native notifications and the Dock badge (docs/desktop-swift.md, section 4.7).
///
/// - Page notifications (the `window.Notification` shim, bridge `notify`): the title and body the
///   page chose, shown only while the app is not in front.
/// - The badge poll: GET /api/desktop/badge every 30 s and when the app comes to the front. The
///   count goes to the Dock; new items become notifications with their title only (Badge.parse
///   never reads an item's body), and a click opens the item's page.
/// - Permission is asked the first time there is something to show, not at launch.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "notify")
    nonisolated private static let pathKey = "path"

    private let server: String
    private let http: NativeHTTP
    private var since: String?
    private var seen: [String] = []
    private var timer: Timer?
    private var polling = false
    /// A poll asked for while another was in flight runs right after it.
    private var pollAgain = false
    /// Bumped by `restart()`: an answer for an older session is dropped.
    private var generation = 0
    /// One permission request shared by every delivery.
    private var authorization: Task<Void, Never>?
    /// Opens an app path in the web view (already checked with DeepLink.target).
    var openPath: (URL) -> Void = { _ in }
    /// Products with something unread: the dots on their tabs (block 4).
    var onUnread: (Set<String>) -> Void = { _ in }
    /// UI tests: every badge update and every page notification decision.
    var onBadge: ((String) -> Void)?
    var onPageNotification: ((String, String?, Bool) -> Void)?
    /// UI tests turn the system center off (no permission prompt on the runner).
    var useSystemCenter = true

    init(server: String, http: NativeHTTP) {
        self.server = server
        self.http = http
    }

    func start() {
        if useSystemCenter { UNUserNotificationCenter.current().delegate = self }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.poll() }
        }
        let timer = Timer(timeInterval: Badge.pollSeconds, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.poll() }
        }
        timer.tolerance = 5
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        Task { await poll() }
    }

    /// After a sign-in: a new session starts from scratch.
    func restart() {
        generation += 1
        since = nil
        seen = []
        Task { await poll() }
    }

    // MARK: Page notifications

    func pageNotification(title: String, body: String?) {
        let show = PageNotification.shouldShow(appActive: NSApp.isActive)
        onPageNotification?(title, body, show)
        guard show else { return }
        deliver(id: UUID().uuidString, title: title.isEmpty ? "zerosoft" : title, body: body, path: nil)
    }

    // MARK: Badge

    func poll() async {
        guard !polling else {
            pollAgain = true
            return
        }
        polling = true
        repeat {
            pollAgain = false
            await pollOnce()
        } while pollAgain
        polling = false
    }

    private func pollOnce() async {
        guard let url = Badge.requestURL(server: server, since: since) else { return }
        let asked = generation
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (status, body) = await http.send(request, withSession: true), asked == generation else { return }
        if status == 401 {
            // Signed out: no count, and the next session starts without `since`.
            since = nil
            setBadge(0)
            onUnread([])
            return
        }
        guard status == 200, let update = Badge.parse(body) else { return }
        setBadge(update.total)
        onUnread(update.unread)
        for item in Badge.toShow(update, since: since, appActive: NSApp.isActive, seen: Set(seen)) {
            deliver(id: item.id, title: item.title, body: nil, path: item.path)
        }
        seen = Array((seen + update.notifications.map(\.id)).suffix(200))
        if let now = update.now { since = now }
    }

    private func setBadge(_ total: Int) {
        let label = Badge.label(total)
        NSApp.dockTile.badgeLabel = label.isEmpty ? nil : label
        onBadge?(label.isEmpty ? "0" : label)
    }

    // MARK: Delivery

    private func deliver(id: String, title: String, body: String?, path: String?) {
        guard useSystemCenter else { return }
        let center = UNUserNotificationCenter.current()
        let content = UNMutableNotificationContent()
        content.title = title
        if let body, !body.isEmpty { content.body = body }
        if let path { content.userInfo = [Self.pathKey: path] }
        let request = UNNotificationRequest(identifier: "zs-\(id)", content: content, trigger: nil)
        let authorization = self.authorization ?? Task {
            let settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = try? await center.requestAuthorization(options: [.alert, .sound])
            }
        }
        self.authorization = authorization
        Task {
            await authorization.value
            do {
                try await center.add(request)
            } catch {
                Self.log.notice("notification not shown")
            }
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    /// A click: the item's page in the web view, checked again (the path is ours, but it is read
    /// back from the system).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let path = response.notification.request.content.userInfo[Self.pathKey] as? String
        Task { @MainActor in
            NSApp.activate(ignoringOtherApps: true)
            if let path, let url = DeepLink.target(for: path, server: self.server) { self.openPath(url) }
        }
        completionHandler()
    }

    /// In front, the page shows its own notices.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }
}
