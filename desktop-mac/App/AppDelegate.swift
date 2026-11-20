import AppKit

/// Block 1 of docs/desktop-swift.md: one window with one web view of the server, the navigation
/// policy and the load watchdog. No network request of its own beyond the web view's.
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var web: WebController!
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
        // UI tests: record what would open in the browser instead of launching it.
        if defaults.bool(forKey: "ZSUITest") {
            openExternal = content.installTestRecorder()
        }
        #endif
        web = WebController(server: server, lockdown: lockdown, lang: lang, openExternal: openExternal)
        content.install(web)
        window.contentView = content

        NSApp.mainMenu = MainMenu.build(lang: lang, target: self)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    @objc func reloadPage(_ sender: Any?) {
        web.reloadPage()
    }
}
