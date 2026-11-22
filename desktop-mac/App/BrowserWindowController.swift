import AppKit

/// One app window: the native tab strip in the title bar and, below it, the content of the tab
/// in front (TabContentView: its web view with the native overlay). The contents of other loaded
/// tabs of this window stay in the host, hidden, so switching tabs keeps their state. Built and
/// driven by TabsController; the window's label is its id in the session.
@MainActor
final class BrowserWindowController: NSWindowController, NSWindowDelegate {
    let label: String
    let strip: TabStripView
    private let host = NSView()
    private weak var tabs: TabsController?
    private var shown: TabContentView?

    init(label: String, frame: NSRect, lang: Lang, tabs: TabsController) {
        self.label = label
        self.tabs = tabs
        strip = TabStripView(lang: lang)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "zerosoft"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // Our own strip, not macOS window tabs (docs/desktop-tabs.md: no product icon, no dots).
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 480, height: 360)
        window.isReleasedWhenClosed = false
        window.backgroundColor = .windowBackgroundColor
        window.setFrame(frame, display: false)
        super.init(window: window)
        window.delegate = self

        let root = NSView(frame: NSRect(origin: .zero, size: frame.size))
        root.autoresizesSubviews = true
        let h = TabStripView.height
        strip.frame = NSRect(x: 0, y: root.bounds.height - h, width: root.bounds.width, height: h)
        strip.autoresizingMask = [.width, .minYMargin]
        strip.delegate = tabs
        host.frame = NSRect(x: 0, y: 0, width: root.bounds.width, height: root.bounds.height - h)
        host.autoresizingMask = [.width, .height]
        root.addSubview(host)
        root.addSubview(strip)
        window.contentView = root
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Puts a tab's content in this window (hidden unless it is the one shown). A content view
    /// that was in another window moves here with its page.
    func adopt(_ content: TabContentView) {
        if content.superview !== host {
            content.removeFromSuperview()
            content.frame = host.bounds
            content.autoresizingMask = [.width, .height]
            content.isHidden = content !== shown
            host.addSubview(content)
        }
    }

    /// Shows one tab's content and hides the others.
    func display(_ content: TabContentView) {
        adopt(content)
        shown = content
        content.frame = host.bounds
        for view in host.subviews { view.isHidden = view !== content }
    }

    func render(_ items: [TabStripItem], title: String) {
        strip.update(items)
        window?.title = title
    }

    func showAndFocus() {
        guard let window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        tabs?.windowShouldClose(label) ?? true
    }

    func windowWillClose(_ notification: Notification) {
        tabs?.windowWillClose(label)
    }

    func windowDidBecomeKey(_ notification: Notification) {
        tabs?.windowDidBecomeKey(label)
    }

    func windowDidMove(_ notification: Notification) {
        tabs?.windowMoved(label)
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        tabs?.windowMoved(label)
    }

    func windowDidResize(_ notification: Notification) {
        if window?.inLiveResize != true { tabs?.windowMoved(label) }
    }

    func windowWillEnterFullScreen(_ notification: Notification) {
        strip.leadingInset = 8
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        strip.leadingInset = 78
    }
}
