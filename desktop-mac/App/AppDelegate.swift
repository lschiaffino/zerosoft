import AppKit

/// One window with one web view of the server, the navigation policy and the load watchdog
/// (blocks 1 and 2 of docs/desktop-swift.md); Google sign-in, `zerosoft://` links, notifications
/// and the Dock badge (block 3). The app's own requests go only to the server: the token
/// exchange and the badge poll (NativeHTTP).
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var web: WebController!
    private var auth: AuthController!
    private var notifier: Notifier!
    private var server = Server.defaultOrigin
    /// A link that arrived before the window existed (the app was launched by it).
    private var launchLink: URL?
    /// UI tests: what each deep link did.
    private var onDeepLink: ((String) -> Void)?
    private let lang = Lang.pick(Locale.preferredLanguages)

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let defaults = UserDefaults.standard
        let server = Server.resolve(defaults.string(forKey: Server.defaultsKey))
        self.server = server
        let lockdown = LockdownSetting(raw: defaults.string(forKey: LockdownSetting.defaultsKey))

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "zerosoft"
        window.minSize = NSSize(width: 480, height: 360)
        window.isReleasedWhenClosed = false
        window.backgroundColor = .windowBackgroundColor
        window.center()
        // The window owns its geometry; nothing else restores it.
        window.setFrameAutosaveName("main")
        self.window = window

        let content = MainContentView(frame: window.contentLayoutRect)
        var openExternal: (URL) -> Void = { NSWorkspace.shared.open($0) }
        #if DEBUG
        let testing = defaults.bool(forKey: "ZSUITest")
        // UI tests: record what would open in the browser instead of launching it.
        if testing {
            openExternal = content.installTestRecorder()
        }
        #endif
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let info = BridgeInfo(version: version, store: Self.storeBuild, lockdown: lockdown)
        let web = WebController(server: server, lockdown: lockdown, info: info, lang: lang, openExternal: openExternal)
        self.web = web
        let http = NativeHTTP(server: server)
        let auth = AuthController(server: server, lang: lang, http: http)
        let notifier = Notifier(server: server, http: http)
        self.auth = auth
        self.notifier = notifier
        auth.window = window
        auth.onSignedIn = { [weak web, weak notifier] in
            if let url = URL(string: server + "/app") { web?.open(url) }
            notifier?.restart()
        }
        notifier.openPath = { [weak self] url in self?.show(url) }
        web.onStartLogin = { [weak auth] in auth?.begin() }
        web.onNotify = { [weak notifier] title, body in notifier?.pageNotification(title: title, body: body) }
        #if DEBUG
        if testing {
            content.installBridgeRecorder(web)
            onDeepLink = content.installBlock3Recorders(auth: auth, notifier: notifier)
            notifier.useSystemCenter = false
            auth.testBrowser = TestBrowser.follow
        }
        #endif
        content.install(web)
        window.contentView = content

        NSApp.mainMenu = MainMenu.build(lang: lang, target: self)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let first = launchLink.flatMap(appPage)
        launchLink = nil
        web.start(at: first)
        notifier.start()
    }

    // MARK: Deep links

    /// `zerosoft://` links (CFBundleURLTypes). Only `open` with a safe app path does anything:
    /// it shows that page of the configured server. A sign-in callback is accepted only by the
    /// ASWebAuthenticationSession that asked for it, so a link with one is ignored here.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls.prefix(1) {
            guard web != nil else {
                launchLink = url
                return
            }
            if let page = appPage(url) {
                show(page)
            } else {
                window.makeKeyAndOrderFront(nil)
            }
        }
    }

    /// The server page a link opens, or nil (and the reason for the tests).
    private func appPage(_ url: URL) -> URL? {
        switch DeepLink.parse(url) {
        case let .open(path)?:
            guard let target = DeepLink.target(for: path, server: server) else {
                onDeepLink?("refused")
                return nil
            }
            onDeepLink?("open \(path)")
            return target
        case .auth?:
            onDeepLink?("ignored auth")
            return nil
        case nil:
            onDeepLink?("refused")
            return nil
        }
    }

    private func show(_ url: URL) {
        web.open(url)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// The Mac App Store build (`STORE` compilation condition, block 10) hides purchase links.
    #if STORE
    static let storeBuild = true
    #else
    static let storeBuild = false
    #endif

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    @objc func reloadPage(_ sender: Any?) {
        web.reloadPage()
    }
}
