import AppKit
import os
import WebKit

/// Where the session lives: `session.json` in the app's Application Support folder (inside the
/// sandbox container). Written atomically, readable only by the user.
struct SessionStore {
    let url: URL

    static func standard(testing: Bool) -> SessionStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("zerosoft", isDirectory: true)
        return SessionStore(url: dir.appendingPathComponent(testing ? "session-uitest.json" : "session.json"))
    }

    func read() -> Data? {
        try? Data(contentsOf: url)
    }

    func write(_ data: Data) {
        let dir = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        do {
            try data.write(to: url, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            TabsController.log.notice("session not saved")
        }
    }

    func remove() {
        try? FileManager.default.removeItem(at: url)
    }
}

/// Windows and tabs (block 4 of docs/desktop-swift.md, docs/desktop-tabs.md): the session model
/// (TabSession) connected to the real windows (BrowserWindowController) and one WebController
/// per loaded tab. Port of tabs.rs.
///
/// - Every tab's web controller comes from the same factory as the first one, so each has the
///   navigation policy, the bridge checks, the watchdog and the Lockdown setting. A tab's path
///   always goes through `TabSession.allowedPath`, so a tab never loads another origin.
/// - Lazy restore: each window loads only its tab in front; the others load when clicked.
///   Tabs not looked at for `suspendMinutes` lose their web view (never the one in front, never
///   one recording) and reload when clicked.
/// - Deep links and notification clicks load their page in the tab in front of the last focused
///   window, as the Tauri app does (`navigate_active`).
@MainActor
final class TabsController: NSObject, TabStripDelegate, NSMenuItemValidation {
    nonisolated static let log = Logger(subsystem: "ai.zerosoft.mac", category: "tabs")

    private(set) var session: TabSession
    private let server: String
    private let lang: Lang
    private let store: SessionStore
    private let makeWeb: () -> WebController
    private var webs: [Int: WebController] = [:]
    private var windows: [String: BrowserWindowController] = [:]
    /// The app window that was key last.
    private var focused = TabSession.main
    private var saveTask: Task<Void, Never>?
    private var suspendTimer: Timer?
    private var terminating = false

    /// Wires a new web controller to the app (sign-in, notifications, test recorders).
    var configure: (WebController) -> Void = { _ in }
    /// UI tests: the session after every change, and each write to disk.
    var onChange: ((TabSession) -> Void)?
    var onSaved: (() -> Void)?
    /// Meetings (block 7): wires a tab's web controller with its id; a tab's web view went away
    /// (closed, suspended, its window closed); the tab in front of a window may have changed; a
    /// tab that must not be suspended (it records).
    var configureTab: (Int, WebController) -> Void = { _, _ in }
    var onTabGone: (Int) -> Void = { _ in }
    var onFrontChange: () -> Void = {}
    var keepAlive: (Int) -> Bool = { _ in false }

    init(server: String, lang: Lang, store: SessionStore, makeWeb: @escaping () -> WebController) {
        self.server = server
        self.lang = lang
        self.store = store
        self.makeWeb = makeWeb
        session = TabSession(server: server)
        super.init()
    }

    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    // MARK: Launch and quit

    /// Restores the last session (paths checked against the allowlist) or opens one window on
    /// the home page. `launchPath`, a deep link that launched the app, replaces the page of the
    /// first window's tab in front.
    func start(launchPath: String?, firstPath: String = TabSession.home) {
        session = TabSession.decode(store.read(), server: server)
        if session.windows.isEmpty { session.newWindow(firstPath) }
        if let launchPath, let first = session.windows.first {
            session.setPath(first.active, launchPath)
        }
        for w in session.windows { build(w.label) }
        if let first = session.windows.first {
            focused = first.label
            windows[first.label]?.showAndFocus()
        }
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.suspendIdle() }
        }
        timer.tolerance = 10
        RunLoop.main.add(timer, forMode: .common)
        suspendTimer = timer
        changed()
    }

    func willTerminate() {
        terminating = true
        saveNow()
    }

    // MARK: Windows

    private var primaryTop: CGFloat {
        NSScreen.screens.first?.frame.maxY ?? 0
    }

    private func frame(for label: String) -> NSRect {
        let size = NSSize(width: 1200, height: 800)
        if let b = session.window(label)?.bounds {
            let rect = NSRect(x: b.x, y: primaryTop - b.y - b.h, width: b.w, height: b.h)
            if NSScreen.screens.contains(where: { $0.visibleFrame.intersects(rect.insetBy(dx: 40, dy: 40)) }) { return rect }
        }
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        // A new window cascades from the one in front.
        if label != TabSession.main, let key = windows[focused]?.window ?? NSApp.keyWindow {
            var rect = key.frame.offsetBy(dx: 28, dy: -28)
            if !screen.contains(rect) { rect.origin = NSPoint(x: screen.minX + 40, y: screen.maxY - rect.height - 40) }
            return rect
        }
        let w = min(size.width, screen.width), h = min(size.height, screen.height)
        return NSRect(x: screen.midX - w / 2, y: screen.midY - h / 2, width: w, height: h)
    }

    /// Creates the window of a session entry and loads its tab in front.
    private func build(_ label: String) {
        guard windows[label] == nil, let w = session.window(label) else { return }
        let controller = BrowserWindowController(label: label, frame: frame(for: label), lang: lang, tabs: self)
        windows[label] = controller
        show(w.active, focus: true)
        controller.window?.orderFront(nil)
    }

    private func keyLabel() -> String {
        if let key = NSApp.keyWindow, let match = windows.values.first(where: { $0.window === key }) { return match.label }
        if session.window(focused) != nil { return focused }
        return session.windows.first?.label ?? TabSession.main
    }

    private func showWindow(_ label: String) {
        windows[label]?.showAndFocus()
    }

    /// Dock click, a deep link: the last focused window.
    func showLast() {
        if session.windows.isEmpty {
            newWindow(TabSession.home)
            return
        }
        showWindow(keyLabel())
    }

    var hasVisibleWindow: Bool {
        windows.values.contains { $0.window?.isVisible == true }
    }

    /// Closes a window; the only one hides with its tabs. Hiding is done here and not through a
    /// refused performClose, which would beep.
    private func closeWindow(_ label: String) {
        guard let window = windows[label]?.window else { return }
        if session.windows.count <= 1 {
            window.orderOut(nil)
        } else {
            window.performClose(nil)
        }
    }

    /// The window the menu acts on, when one is on screen. With every window hidden, Close Tab,
    /// Close Window and the tab switches do nothing (they would act on tabs nobody sees).
    private var visibleLabel: String? {
        let label = keyLabel()
        return windows[label]?.window?.isVisible == true ? label : nil
    }

    func windowShouldClose(_ label: String) -> Bool {
        // The only window hides instead (as before: dictation and the menu bar item keep going).
        if session.windows.count <= 1 {
            windows[label]?.window?.orderOut(nil)
            return false
        }
        return true
    }

    func windowWillClose(_ label: String) {
        guard !terminating, let w = session.window(label) else { return }
        for t in w.tabs { dropWeb(t.id) }
        session.removeWindow(label)
        // AppKit is still inside the close of this window: release its controller afterwards.
        let closing = windows.removeValue(forKey: label)
        closing?.window?.delegate = nil
        DispatchQueue.main.async { _ = closing }
        if focused == label { focused = session.windows.first?.label ?? TabSession.main }
        saveNow()
        changed()
    }

    func windowDidBecomeKey(_ label: String) {
        focused = label
        if let id = session.activeOf(label) { session.update(id) { $0.unread = false } }
        refresh(label)
    }

    func windowMoved(_ label: String) {
        guard let window = windows[label]?.window, !window.styleMask.contains(.fullScreen), !window.isMiniaturized else { return }
        let f = window.frame
        session.setBounds(label, TabBounds(x: f.minX, y: primaryTop - f.maxY, w: f.width, h: f.height))
        saveSoon()
    }

    // MARK: Tabs and web views

    /// The web controller of a tab, created (and its page loaded) when it has none: new,
    /// restored or suspended. Its content goes into the tab's window.
    @discardableResult
    private func ensureWeb(_ id: Int) -> WebController? {
        guard let label = session.windowOf(id), let wc = windows[label] else { return nil }
        if let web = webs[id] {
            wc.adopt(web.content)
            return web
        }
        let url = session.url(of: id) ?? URL(string: server + TabSession.home)!
        let web = makeWeb()
        configure(web)
        web.onTabs = { [weak self] action, path, title, n in self?.pageAction(from: id, action, path: path, title: title, n: n) }
        web.onOpenInNewTab = { [weak self] url in self?.openFrom(id, url: url, place: .next) }
        configureTab(id, web)
        webs[id] = web
        wc.adopt(web.content)
        web.start(at: url)
        let time = now
        session.update(id) {
            $0.loaded = true
            $0.lastActive = time
        }
        return web
    }

    private func dropWeb(_ id: Int) {
        guard let web = webs.removeValue(forKey: id) else { return }
        web.teardown()
        onTabGone(id)
    }

    /// Brings a tab to the front of its window.
    func show(_ id: Int, focus: Bool = true) {
        guard let label = session.windowOf(id), let wc = windows[label] else { return }
        session.activate(id, now: now)
        guard let web = ensureWeb(id) else { return }
        wc.display(web.content)
        if focus { wc.window?.makeFirstResponder(web.webView) }
        refresh(label)
        saveSoon()
    }

    /// A new tab in a window (or a new window when that one is full).
    func openIn(_ label: String, path: String, place: TabPlace) {
        guard TabSession.allowedPath(path, server: server) else { return }
        guard let id = session.addTab(label, path: path, place: place) else {
            newWindow(path)
            return
        }
        if place == .background {
            ensureWeb(id)
            refresh(label)
            saveSoon()
        } else {
            show(id)
        }
    }

    private func openFrom(_ id: Int, url: URL, place: TabPlace) {
        guard Server.origin(of: url) == server, let label = session.windowOf(id) else { return }
        openIn(label, path: Self.path(of: url), place: place)
    }

    func newWindow(_ path: String, bounds: TabBounds? = nil) {
        guard TabSession.allowedPath(path, server: server), let (label, _) = session.newWindow(path, bounds: bounds) else { return }
        build(label)
        showWindow(label)
        saveSoon()
    }

    func closeTab(_ id: Int) {
        guard let label = session.windowOf(id), let w = session.window(label) else { return }
        if w.tabs.count == 1 {
            // The last tab closes the window (and the last window hides).
            closeWindow(label)
            return
        }
        dropWeb(id)
        if let r = session.closeTab(id), let next = r.next { show(next) }
        refresh(label)
        saveSoon()
    }

    func reopenClosed() {
        guard let (label, id) = session.reopen(fallback: keyLabel()) else { return }
        show(id)
        showWindow(label)
    }

    func select(_ label: String, _ n: Int) {
        if let id = session.nth(label, n) { show(id) }
    }

    func cycle(_ label: String, _ delta: Int) {
        if let id = session.cycle(label, delta) { show(id) }
    }

    func duplicate(_ id: Int) {
        guard let label = session.windowOf(id), let path = session.get(id)?.path else { return }
        session.activate(id, now: now)
        openIn(label, path: path, place: .next)
    }

    func closeOthers(_ id: Int) {
        guard let label = session.windowOf(id), let w = session.window(label) else { return }
        show(id)
        for t in w.tabs where t.id != id { closeTab(t.id) }
    }

    func detach(_ id: Int, atScreen point: NSPoint? = nil) {
        guard let from = session.windowOf(id) else { return }
        let size = windows[from]?.window?.frame.size ?? NSSize(width: 1100, height: 760)
        let bounds = point.map { TabBounds(x: Double($0.x - 120), y: Double(primaryTop - $0.y - 14), w: size.width, h: size.height) }
        guard let r = session.detach(id, bounds: bounds) else { return }
        if let next = r.next { show(next, focus: false) }
        refresh(r.from)
        build(r.window)
        showWindow(r.window)
        saveSoon()
    }

    private func moveBetween(_ id: Int, to: String, index: Int) {
        guard let r = session.moveTab(id, to: to, index: index) else { return }
        if let next = r.next { show(next, focus: false) }
        show(id)
        showWindow(to)
        if r.empty {
            windows[r.from]?.window?.close()
        } else {
            refresh(r.from)
        }
        saveSoon()
    }

    private func suspendIdle() {
        let ids = session.discardable(now: now)
        guard !ids.isEmpty else { return }
        var touched = Set<String>()
        for id in ids {
            // A call or a recording with the camera or the microphone on is never suspended,
            // whatever the page told the bridge.
            if let web = webs[id], web.webView.cameraCaptureState != .none || web.webView.microphoneCaptureState != .none { continue }
            // Nor the tab that captures the computer's audio or reported a recording (block 7).
            if keepAlive(id) { continue }
            dropWeb(id)
            session.update(id) { $0.loaded = false }
            if let label = session.windowOf(id) { touched.insert(label) }
        }
        touched.forEach(refresh)
    }

    // MARK: From outside the page

    /// A deep link or a notification click (already checked with DeepLink.target): the page in
    /// the tab in front of the last focused window.
    func navigateActive(_ url: URL) {
        let path = Self.path(of: url)
        guard Server.origin(of: url) == server, TabSession.allowedPath(path, server: server) else { return }
        let label = keyLabel()
        guard let id = session.activeOf(label) else {
            newWindow(path)
            return
        }
        session.setPath(id, path)
        if let web = webs[id] {
            web.open(url)
        } else {
            show(id)
        }
        refresh(label)
        showWindow(label)
        saveSoon()
    }

    /// Settings › Tabs: the new preferences, saved right away. Restore off also drops the saved
    /// windows from the file (TabSession.encoded).
    func setPrefs(_ prefs: TabPrefs) {
        guard prefs != session.prefs else { return }
        session.prefs = prefs
        changed()
        saveNow()
        suspendIdle()
    }

    /// After a sign-in or a sign-out: the front tab goes to the home page, the other loaded tabs
    /// reload their page with the new session (tabs.rs `reload_all`).
    func signedIn() {
        let front = session.activeOf(keyLabel())
        if let home = URL(string: server + TabSession.home) { navigateActive(home) }
        for (id, web) in webs where id != front {
            if let url = session.url(of: id) { web.open(url) }
        }
    }

    /// "Something new" dots per product (badge poll).
    func setUnread(_ products: Set<String>) {
        let focus = NSApp.isActive ? keyLabel() : nil
        if session.setUnread(products, focused: focus) { session.windows.map(\.label).forEach(refresh) }
    }

    var activeWeb: WebController? {
        session.activeOf(keyLabel()).flatMap { webs[$0] }
    }

    // MARK: Meetings (block 7)

    /// The tab has a live web view.
    func hasWeb(_ id: Int) -> Bool {
        webs[id] != nil
    }

    /// The tab is the one the person is using: in front of its window, that window key and on
    /// screen, the app in front (tabs.rs `tab_in_use`). The computer's audio starts only from it.
    func tabInUse(_ id: Int) -> Bool {
        guard NSApp.isActive, let label = session.windowOf(id), session.activeOf(label) == id,
              let window = windows[label]?.window else { return false }
        return window.isKeyWindow && window.isVisible && !window.isMiniaturized
    }

    /// The recording tab is in view (tabs.rs `recording_in_front`): the floating indicator hides.
    func isInFront(_ id: Int) -> Bool {
        tabInUse(id)
    }

    /// The red dot of the tab that records (one at a time; nil clears it).
    func setRecording(_ id: Int?) {
        var touched = Set<String>()
        for t in session.allTabs where t.recording != (t.id == id) {
            session.update(t.id) { $0.recording = (t.id == id) }
            if let label = session.windowOf(t.id) { touched.insert(label) }
        }
        touched.forEach(refresh)
    }

    /// "Open" of the indicator: that tab in front of its window, the window in front.
    func focus(_ id: Int) -> Bool {
        guard let label = session.windowOf(id) else { return false }
        show(id)
        showWindow(label)
        return true
    }

    /// "Stop" of the indicator: the page gets `zerosoft:stop-recording`.
    func stopRecording(in id: Int) {
        webs[id]?.dispatchStopRecording()
    }

    // MARK: From the page (bridge `tabs`)

    private func pageAction(from id: Int, _ action: TabsAction, path: String?, title: String?, n: Int?) {
        guard let label = session.windowOf(id) else { return }
        let allowed = path.flatMap { TabSession.allowedPath($0, server: server) ? $0 : nil }
        if action == .state {
            var changed = false
            if let allowed { changed = session.setPath(id, allowed) || changed }
            if let title { changed = session.setTitle(id, title) || changed }
            if changed {
                refresh(label)
                saveSoon()
            }
            return
        }
        // Everything else comes from a click or a key in the page: only the tab in front of its
        // window acts (a page behind cannot switch or open tabs).
        guard session.activeOf(label) == id else { return }
        switch action {
        case .open:
            guard let p = allowed else { return }
            if session.prefs.links == .window { newWindow(p) } else { openIn(label, path: p, place: .background) }
        case .openTab:
            if let p = allowed { openIn(label, path: p, place: .next) }
        case .openWindow:
            if let p = allowed { newWindow(p) }
        case .menu:
            if let p = allowed { linkMenu(from: id, path: p) }
        case .select:
            if let n, (1 ... 9).contains(n) { select(label, n) }
        case .next:
            cycle(label, 1)
        case .prev:
            cycle(label, -1)
        case .state:
            break
        }
    }

    /// Right click on a link of the app: open in a new tab or window, copy.
    private func linkMenu(from id: Int, path: String) {
        guard let label = session.windowOf(id), let window = windows[label]?.window, let view = window.contentView else { return }
        let menu = NSMenu()
        menu.autoenablesItems = false
        let info = LinkInfo(tab: id, path: path)
        for (key, action) in [(StringKey.menuOpenInNewTab, #selector(linkInNewTab(_:))), (.menuOpenInNewWindow, #selector(linkInNewWindow(_:)))] {
            let item = menu.addItem(withTitle: Strings.text(key, lang), action: action, keyEquivalent: "")
            item.target = self
            item.representedObject = info
        }
        menu.addItem(.separator())
        let copy = menu.addItem(withTitle: Strings.text(.menuCopyLink, lang), action: #selector(copyLink(_:)), keyEquivalent: "")
        copy.target = self
        copy.representedObject = info
        let point = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        menu.popUp(positioning: nil, at: point, in: view)
    }

    private final class LinkInfo: NSObject {
        let tab: Int
        let path: String
        init(tab: Int, path: String) {
            self.tab = tab
            self.path = path
        }
    }

    @objc private func linkInNewTab(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? LinkInfo, let label = session.windowOf(info.tab) else { return }
        openIn(label, path: info.path, place: .next)
    }

    @objc private func linkInNewWindow(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? LinkInfo else { return }
        newWindow(info.path)
    }

    @objc private func copyLink(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? LinkInfo, let url = TabSession.url(for: info.path, server: server) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
    }

    /// path + query + fragment of a URL of the server.
    static func path(of url: URL) -> String {
        TabSession.pathOf(url)
    }

    // MARK: Strip

    private func refresh(_ label: String) {
        guard let wc = windows[label], let w = session.window(label) else { return }
        let fallback = Strings.text(.tabNewTitle, lang)
        let items = w.tabs.map { t -> TabStripItem in
            let product = TabSession.products[TabSession.product(of: t.path)]
            return TabStripItem(
                id: t.id,
                title: TabSession.displayTitle(t, fallback: fallback),
                initial: product.map { String($0.name.prefix(1)) } ?? "z",
                color: product?.color,
                active: t.id == w.active,
                loaded: t.loaded,
                unread: t.unread,
                recording: t.recording
            )
        }
        let front = items.first { $0.active }
        // The Window menu lists windows by this title.
        wc.render(items, title: front.map { $0.title == fallback ? "zerosoft" : $0.title } ?? "zerosoft")
        changed()
    }

    private func changed() {
        onChange?(session)
        onFrontChange()
    }

    func stripSelect(_ id: Int) {
        show(id)
    }

    func stripClose(_ id: Int) {
        closeTab(id)
    }

    func stripNewTab() {
        openIn(keyLabel(), path: TabSession.home, place: .end)
    }

    func stripMove(_ id: Int, to index: Int) {
        guard let label = session.windowOf(id), session.moveTab(id, to: label, index: index) != nil else { return }
        refresh(label)
        saveSoon()
    }

    func stripDrop(_ id: Int, atScreen point: NSPoint) {
        guard let from = session.windowOf(id) else { return }
        for (label, wc) in windows where label != from {
            guard let window = wc.window, window.isVisible, !window.isMiniaturized,
                  let strip = wc.strip.screenFrame, strip.insetBy(dx: 0, dy: -8).contains(point) else { continue }
            moveBetween(id, to: label, index: session.window(label)?.tabs.count ?? 0)
            return
        }
        detach(id, atScreen: point)
    }

    func stripMenu(_ id: Int, event: NSEvent?, in view: NSView) {
        guard let label = session.windowOf(id) else { return }
        let count = session.window(label)?.tabs.count ?? 0
        let menu = NSMenu()
        menu.autoenablesItems = false
        func add(_ key: StringKey, _ action: Selector, enabled: Bool = true) {
            let item = menu.addItem(withTitle: Strings.text(key, lang), action: action, keyEquivalent: "")
            item.target = self
            item.tag = id
            item.isEnabled = enabled
        }
        add(.menuNewTab, #selector(tabMenuNew(_:)))
        add(.menuDuplicateTab, #selector(tabMenuDuplicate(_:)))
        add(.menuMoveToNewWindow, #selector(tabMenuDetach(_:)), enabled: count > 1)
        menu.addItem(.separator())
        add(.menuCloseTab, #selector(tabMenuClose(_:)))
        add(.menuCloseOtherTabs, #selector(tabMenuCloseOthers(_:)), enabled: count > 1)
        menu.addItem(.separator())
        add(.menuReopenTab, #selector(reopenClosedTab(_:)), enabled: !session.closed.isEmpty)
        if let event {
            NSMenu.popUpContextMenu(menu, with: event, for: view)
        } else {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.bounds.height), in: view)
        }
    }

    @objc private func tabMenuNew(_ sender: NSMenuItem) {
        if let label = session.windowOf(sender.tag) { openIn(label, path: TabSession.home, place: .end) }
    }

    @objc private func tabMenuDuplicate(_ sender: NSMenuItem) { duplicate(sender.tag) }
    @objc private func tabMenuDetach(_ sender: NSMenuItem) { detach(sender.tag) }
    @objc private func tabMenuClose(_ sender: NSMenuItem) { closeTab(sender.tag) }
    @objc private func tabMenuCloseOthers(_ sender: NSMenuItem) { closeOthers(sender.tag) }

    // MARK: Menu bar (File, View, Window) and the Dock menu

    /// A key window that is not one of ours (About, an alert): Close Tab and Close Window close
    /// it instead, as the standard item would.
    private var foreignKeyWindow: NSWindow? {
        guard let key = NSApp.keyWindow, !windows.values.contains(where: { $0.window === key }) else { return nil }
        return key
    }

    @objc func newTab(_ sender: Any?) {
        let label = keyLabel()
        openIn(label, path: TabSession.home, place: .end)
        showWindow(label)
    }

    @objc func newWindowAction(_ sender: Any?) {
        newWindow(TabSession.home)
    }

    @objc func reopenClosedTab(_ sender: Any?) {
        reopenClosed()
    }

    @objc func closeTabAction(_ sender: Any?) {
        if let other = foreignKeyWindow {
            other.performClose(nil)
            return
        }
        if let label = visibleLabel, let id = session.activeOf(label) { closeTab(id) }
    }

    @objc func closeWindowAction(_ sender: Any?) {
        if let other = foreignKeyWindow {
            other.performClose(nil)
            return
        }
        if let label = visibleLabel { closeWindow(label) }
    }

    @objc func nextTab(_ sender: Any?) {
        if let label = visibleLabel { cycle(label, 1) }
    }

    @objc func previousTab(_ sender: Any?) {
        if let label = visibleLabel { cycle(label, -1) }
    }

    /// Cmd+1...Cmd+9 (the item's tag).
    @objc func selectTabByNumber(_ sender: NSMenuItem) {
        if let label = visibleLabel { select(label, sender.tag) }
    }

    @objc func reloadPage(_ sender: Any?) {
        activeWeb?.reloadPage()
    }

    @objc func goBack(_ sender: Any?) {
        activeWeb?.goBack()
    }

    @objc func goForward(_ sender: Any?) {
        activeWeb?.goForward()
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(reopenClosedTab(_:)): return !session.closed.isEmpty
        case #selector(goBack(_:)): return visibleLabel != nil && activeWeb?.webView.canGoBack == true
        case #selector(goForward(_:)): return visibleLabel != nil && activeWeb?.webView.canGoForward == true
        case #selector(nextTab(_:)), #selector(previousTab(_:)):
            return visibleLabel.flatMap { session.window($0)?.tabs.count }.map { $0 > 1 } ?? false
        case #selector(closeTabAction(_:)), #selector(closeWindowAction(_:)):
            return foreignKeyWindow != nil || visibleLabel != nil
        case #selector(selectTabByNumber(_:)), #selector(reloadPage(_:)): return visibleLabel != nil
        default: return true
        }
    }

    // MARK: Saving

    private func saveSoon() {
        saveTask?.cancel()
        saveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    private func saveNow() {
        saveTask?.cancel()
        saveTask = nil
        store.write(session.encoded())
        onSaved?()
    }
}
