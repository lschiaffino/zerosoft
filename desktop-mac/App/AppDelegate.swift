import AppKit
import WebKit

/// Windows with tabs, each tab a web view of the server with the navigation policy and the load
/// watchdog (blocks 1, 2 and 4 of docs/desktop-swift.md); Google sign-in, `zerosoft://` links,
/// notifications and the Dock badge (block 3). The app's own requests go only to the server: the
/// token exchange and the badge poll (NativeHTTP).
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var tabs: TabsController!
    private var auth: AuthController!
    private var notifier: Notifier!
    private var server = Server.defaultOrigin
    /// The tabs exist (a link that arrives before waits in `launchLink`).
    private var started = false
    /// A link that arrived before the windows existed (the app was launched by it).
    private var launchLink: URL?
    /// UI tests: what each deep link did.
    private var onDeepLink: ((String) -> Void)?
    private let lang = Lang.pick(Locale.preferredLanguages)
    /// The page of the first window when there is no saved session.
    private var firstPath = TabSession.home
    #if DEBUG
    private var testPanel: TestPanel?
    #endif

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
        // No macOS window tabs: the app has its own strip.
        NSWindow.allowsAutomaticWindowTabbing = false

        var openExternal: (URL) -> Void = { NSWorkspace.shared.open($0) }
        var testing = false
        #if DEBUG
        testing = defaults.bool(forKey: "ZSUITest")
        if testing {
            let panel = TestPanel()
            testPanel = panel
            // UI tests: record what would open in the browser instead of launching it.
            openExternal = { [weak panel] url in panel?.external(url) }
        }
        #endif
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let info = BridgeInfo(version: version, store: Self.storeBuild, lockdown: lockdown)
        let lang = self.lang
        let http = NativeHTTP(server: server)
        let auth = AuthController(server: server, lang: lang, http: http)
        let notifier = Notifier(server: server, http: http)
        self.auth = auth
        self.notifier = notifier

        let store = SessionStore.standard(testing: testing)
        let tabs = TabsController(server: server, lang: lang, store: store) {
            WebController(server: server, lockdown: lockdown, info: info, lang: lang, openExternal: openExternal)
        }
        self.tabs = tabs
        tabs.configure = { [weak auth, weak notifier] web in
            web.onStartLogin = { auth?.begin() }
            web.onNotify = { title, body in notifier?.pageNotification(title: title, body: body) }
        }
        auth.onSignedIn = { [weak tabs, weak notifier] in
            tabs?.signedIn()
            notifier?.restart()
        }
        notifier.openPath = { [weak tabs] url in tabs?.navigateActive(url) }
        notifier.onUnread = { [weak tabs] products in tabs?.setUnread(products) }
        #if DEBUG
        if testing, let panel = testPanel {
            let configure = tabs.configure
            tabs.configure = { [weak panel] web in
                configure(web)
                panel?.watch(web)
            }
            panel.watch(auth: auth, notifier: notifier)
            onDeepLink = { [weak panel] what in panel?.deepLink(what) }
            var saves = 0
            tabs.onChange = { [weak panel] session in panel?.set("zs-test-tabs", "tabs \(session.summary) end") }
            tabs.onSaved = { [weak panel] in
                saves += 1
                panel?.set("zs-test-session", "saved \(saves)")
            }
            notifier.useSystemCenter = false
            auth.testBrowser = TestBrowser.follow
            // Each test starts with no session file unless it asks to keep one (the relaunch
            // test), or hands one over to check what a restore accepts.
            if !defaults.bool(forKey: "ZSKeepSession") { store.remove() }
            if let given = defaults.string(forKey: "ZSTestSession").flatMap({ Data(base64Encoded: $0) }) { store.write(given) }
            // The fixture's main page is the server root; a fresh session opens it instead of
            // the home page.
            if let path = defaults.string(forKey: "ZSStartPath") { firstPath = path }
        }
        #endif

        NSApp.mainMenu = MainMenu.build(lang: lang, tabs: tabs)
        NSApp.activate(ignoringOtherApps: true)
        #if DEBUG
        if testing {
            // Each UI test starts signed out: no session cookie left by an earlier test.
            Task { @MainActor in
                let data = WKWebsiteDataStore.default()
                await data.removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantPast)
                self.startTabs()
            }
            return
        }
        #endif
        startTabs()
    }

    private func startTabs() {
        let first = launchLink.flatMap(appPage).map(TabsController.path(of:))
        launchLink = nil
        tabs.start(launchPath: first, firstPath: firstPath)
        started = true
        notifier.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        tabs?.willTerminate()
    }

    // MARK: Deep links

    /// `zerosoft://` links (CFBundleURLTypes). Only `open` with a safe app path does anything:
    /// it shows that page of the configured server in the tab in front. A sign-in callback is
    /// accepted only by the ASWebAuthenticationSession that asked for it, so a link with one is
    /// ignored here.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls.prefix(1) {
            guard started else {
                launchLink = url
                return
            }
            if let page = appPage(url) {
                tabs.navigateActive(page)
            } else {
                tabs.showLast()
            }
        }
    }

    /// The server page a link opens, or nil (and the reason for the tests).
    private func appPage(_ url: URL) -> URL? {
        switch DeepLink.parse(url) {
        case let .open(path)?:
            guard let target = DeepLink.target(for: path, server: server) else {
                onDeepLink?("refused \(url.absoluteString)")
                return nil
            }
            onDeepLink?("open \(path)")
            return target
        case .auth?:
            onDeepLink?("ignored auth")
            return nil
        case nil:
            onDeepLink?("refused \(url.absoluteString)")
            return nil
        }
    }

    /// The Mac App Store build (`STORE` compilation condition, block 10) hides purchase links.
    #if STORE
    static let storeBuild = true
    #else
    static let storeBuild = false
    #endif

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !tabs.hasVisibleWindow { tabs.showLast() }
        return true
    }

    /// Dock menu: New Window.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        let item = menu.addItem(withTitle: Strings.text(.menuNewWindow, lang), action: #selector(TabsController.newWindowAction(_:)), keyEquivalent: "")
        item.target = tabs
        return menu
    }
}
