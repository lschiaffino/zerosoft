import AppKit
import QuartzCore

/// The floating recording indicator (indicator.rs, block 7 of docs/desktop-swift.md): while a
/// meeting records or the computer's audio is captured and the recording tab is not in front, a
/// small black rectangle with a pulsing red dot stays above other apps on every Space. Click:
/// opens the recording. Hover: it widens to the left and shows the time. Right click: Open, Stop,
/// Hide until the next recording. It can be dragged anywhere and remembers where it was left.
/// A non-activating `NSPanel` (public API, guideline 2.5.1): it never takes the focus from the
/// app of the call.
@MainActor
final class RecordingIndicator {
    private let panel: IndicatorPanel
    private let view: IndicatorView
    private let lang: Lang
    var onOpen: () -> Void = {}
    var onStop: () -> Void = {}
    var onHide: () -> Void = {}
    /// The closed indicator's new bottom-left corner after a drag.
    var onMoved: (IndicatorPosition) -> Void = { _ in }
    /// Where the person left it (Settings), read when it shows.
    var saved: () -> IndicatorPosition? = { nil }
    private var startedAt: Double = 0
    private var clock: Timer?

    init(lang: Lang) {
        self.lang = lang
        let size = NSSize(width: RecordingIndicatorRules.width, height: RecordingIndicatorRules.height)
        panel = IndicatorPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        // Hide zerosoft (Cmd+H) must not take a recording's mark off the screen (2.5.14).
        panel.canHide = false
        panel.isExcludedFromWindowsMenu = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovable = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.identifier = NSUserInterfaceItemIdentifier("zs-indicator-panel")
        view = IndicatorView(frame: NSRect(origin: .zero, size: size))
        view.label = Strings.text(.indRecording, lang) + ". " + Strings.text(.indClick, lang)
        panel.contentView = view
        view.onClick = { [weak self] in self?.onOpen() }
        view.onMenu = { [weak self] event in self?.menu(event) }
        view.onHover = { [weak self] inside in self?.expand(inside) }
        view.onDrag = { [weak self] dx, dy in self?.drag(dx, dy) }
        view.onDragEnd = { [weak self] in self?.dragEnded() }
    }

    var isVisible: Bool { panel.isVisible }

    /// Shows it for a capture that started at `startedAt` (ms since 1970).
    func show(startedAt: Double) {
        self.startedAt = startedAt
        guard !panel.isVisible else { return }
        view.expanded = false
        panel.setContentSize(NSSize(width: RecordingIndicatorRules.width, height: RecordingIndicatorRules.height))
        panel.setFrameOrigin(origin())
        panel.orderFrontRegardless()
    }

    func hide() {
        guard panel.isVisible else { return }
        expand(false)
        panel.orderOut(nil)
    }

    /// Where the person left it while it is on a screen; otherwise the top right of the screen
    /// with the mouse.
    private func origin() -> NSPoint {
        let screens = NSScreen.screens.map { (x: Double($0.frame.minX), y: Double($0.frame.minY), width: Double($0.frame.width), height: Double($0.frame.height)) }
        if let p = saved(), RecordingIndicatorRules.onScreen(x: p.x, y: p.y, screens: screens) {
            return NSPoint(x: p.x, y: p.y)
        }
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        let area = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let m = RecordingIndicatorRules.margin
        return NSPoint(x: area.maxX - RecordingIndicatorRules.width - m, y: area.maxY - RecordingIndicatorRules.height - m)
    }

    /// Widens to the left (the right edge stays) and shows the time, or closes again.
    private func expand(_ open: Bool) {
        guard view.expanded != open else { return }
        view.expanded = open
        var frame = panel.frame
        let dx = RecordingIndicatorRules.openWidth - RecordingIndicatorRules.width
        frame.origin.x += open ? -dx : dx
        frame.size.width = open ? RecordingIndicatorRules.openWidth : RecordingIndicatorRules.width
        panel.setFrame(frame, display: true)
        clock?.invalidate()
        clock = nil
        if open {
            tick()
            let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            clock = timer
        }
    }

    private func tick() {
        view.time = RecordingIndicatorRules.elapsed(ms: Date().timeIntervalSince1970 * 1000 - startedAt)
    }

    private func drag(_ dx: CGFloat, _ dy: CGFloat) {
        var origin = panel.frame.origin
        origin.x += dx
        origin.y += dy
        panel.setFrameOrigin(origin)
    }

    private func dragEnded() {
        let closedX = panel.frame.minX + (view.expanded ? RecordingIndicatorRules.openWidth - RecordingIndicatorRules.width : 0)
        onMoved(IndicatorPosition(x: Double(closedX), y: Double(panel.frame.minY)))
    }

    private func menu(_ event: NSEvent) {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for (key, id, action) in [
            (StringKey.indOpen, "open", #selector(IndicatorMenuTarget.open(_:))),
            (.indStop, "stop", #selector(IndicatorMenuTarget.stop(_:))),
            (.indHide, "hide", #selector(IndicatorMenuTarget.hide(_:))),
        ] {
            if id == "hide" { menu.addItem(.separator()) }
            let item = menu.addItem(withTitle: Strings.text(key, lang), action: action, keyEquivalent: "")
            item.target = target
            item.setAccessibilityIdentifier("zs-indicator-\(id)")
        }
        NSMenu.popUpContextMenu(menu, with: event, for: view)
    }

    private lazy var target = IndicatorMenuTarget(owner: self)

    fileprivate func menuOpen() { onOpen() }
    fileprivate func menuStop() { onStop() }
    fileprivate func menuHide() { onHide() }
}

@MainActor
private final class IndicatorMenuTarget: NSObject {
    weak var owner: RecordingIndicator?

    init(owner: RecordingIndicator) {
        self.owner = owner
    }

    @objc func open(_ sender: Any?) { owner?.menuOpen() }
    @objc func stop(_ sender: Any?) { owner?.menuStop() }
    @objc func hide(_ sender: Any?) { owner?.menuHide() }
}

/// Never key or main: clicks reach it without activating zerosoft.
private final class IndicatorPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// The black rectangle, the red dot (pulsing unless Reduce Motion is on) and, when hovered, the
/// time. An accessibility button: "Recording. Click to open the recording".
private final class IndicatorView: NSView {
    var onClick: () -> Void = {}
    var onMenu: (NSEvent) -> Void = { _ in }
    var onHover: (Bool) -> Void = { _ in }
    var onDrag: (CGFloat, CGFloat) -> Void = { _, _ in }
    var onDragEnd: () -> Void = {}
    var label = "" {
        didSet { setAccessibilityLabel(label) }
    }

    var expanded = false {
        didSet { needsLayout = true; timeField.isHidden = !expanded }
    }

    var time = "" {
        didSet { timeField.stringValue = time }
    }

    private let dot = CALayer()
    private let timeField = NSTextField(labelWithString: "")
    private var tracking: NSTrackingArea?
    private var downAt: NSPoint?
    private var dragged = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.88).cgColor
        layer?.cornerRadius = 8
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        layer?.borderWidth = 0.5
        dot.backgroundColor = NSColor.systemRed.cgColor
        dot.cornerRadius = 5
        layer?.addSublayer(dot)
        timeField.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        timeField.textColor = .white
        timeField.isHidden = true
        timeField.setAccessibilityElement(false)
        addSubview(timeField)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityIdentifier("zs-indicator")
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.35
            pulse.duration = 0.9
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            dot.add(pulse, forKey: "pulse")
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        let size: CGFloat = 10
        // The dot stays at the right edge; the time fills the space it opens on the left.
        dot.frame = NSRect(x: bounds.maxX - 17 - size / 2, y: bounds.midY - size / 2, width: size, height: size)
        timeField.sizeToFit()
        timeField.frame.origin = NSPoint(x: 10, y: bounds.midY - timeField.frame.height / 2)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseEntered(with event: NSEvent) { onHover(true) }
    override func mouseExited(with event: NSEvent) { if downAt == nil { onHover(false) } }

    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        dragged = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = downAt else { return }
        let now = NSEvent.mouseLocation
        if !dragged, hypot(now.x - start.x, now.y - start.y) < 3 { return }
        dragged = true
        onDrag(now.x - start.x, now.y - start.y)
        downAt = now
    }

    override func mouseUp(with event: NSEvent) {
        defer { downAt = nil }
        if dragged {
            onDragEnd()
        } else {
            onClick()
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        onMenu(event)
    }

    override func accessibilityPerformPress() -> Bool {
        onClick()
        return true
    }
}
