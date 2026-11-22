import AppKit

/// What the strip shows for one tab.
struct TabStripItem: Equatable {
    let id: Int
    let title: String
    /// The product's initial and color, or "z" and no color for pages outside the apps.
    let initial: String
    let color: UInt32?
    let active: Bool
    let loaded: Bool
    let unread: Bool
    let recording: Bool
}

@MainActor
protocol TabStripDelegate: AnyObject {
    func stripSelect(_ id: Int)
    func stripClose(_ id: Int)
    func stripNewTab()
    func stripMove(_ id: Int, to index: Int)
    /// A tab dropped away from its strip: onto another window's strip, or a new window there.
    func stripDrop(_ id: Int, atScreen point: NSPoint)
    func stripMenu(_ id: Int, event: NSEvent?, in view: NSView)
}

/// The native tab strip of a window (docs/desktop-tabs.md, "Tira"), in the title bar next to the
/// traffic lights. Native so it draws even when every web view fails. Click selects, the middle
/// button closes, right click opens the tab menu, dragging reorders, dropping away from the strip
/// moves the tab to another window's strip or to a new window. Keyboard (when the strip has
/// focus): arrows, Home, End, Return or Space selects, Delete closes, Shift+F10 opens the menu.
@MainActor
final class TabStripView: NSView {
    static let height: CGFloat = 38
    weak var delegate: TabStripDelegate?
    /// Room for the traffic lights (none in full screen).
    var leadingInset: CGFloat = 78 {
        didSet { needsLayout = true }
    }

    private let lang: Lang
    private(set) var items: [TabStripItem] = []
    private var views: [TabItemView] = []
    private let newButton: NSButton
    private var dragging: TabItemView?
    private var focusIndex: Int?

    init(lang: Lang) {
        self.lang = lang
        newButton = NSButton(frame: NSRect(x: 0, y: 0, width: 28, height: 28))
        super.init(frame: NSRect(x: 0, y: 0, width: 600, height: Self.height))
        newButton.bezelStyle = .regularSquare
        newButton.isBordered = false
        newButton.image = NSImage(systemSymbolName: "plus", accessibilityDescription: Strings.text(.menuNewTab, lang))
        newButton.imageScaling = .scaleProportionallyDown
        newButton.contentTintColor = .secondaryLabelColor
        newButton.toolTip = Strings.text(.menuNewTab, lang)
        newButton.setAccessibilityLabel(Strings.text(.menuNewTab, lang))
        newButton.setAccessibilityIdentifier("zs-new-tab")
        newButton.target = self
        newButton.action = #selector(newTab)
        addSubview(newButton)
        setAccessibilityElement(true)
        setAccessibilityRole(.tabGroup)
        setAccessibilityLabel(Strings.text(.tabsLabel, lang))
        setAccessibilityIdentifier("zs-tab-strip")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    @objc private func newTab() {
        delegate?.stripNewTab()
    }

    func update(_ next: [TabStripItem]) {
        guard dragging == nil else {
            items = next
            return
        }
        let old = Dictionary(uniqueKeysWithValues: views.map { ($0.item.id, $0) })
        var fresh: [TabItemView] = []
        for item in next {
            let view = old[item.id] ?? TabItemView(strip: self, item: item, lang: lang)
            view.item = item
            if view.superview !== self { addSubview(view) }
            fresh.append(view)
        }
        for view in views where !fresh.contains(where: { $0 === view }) { view.removeFromSuperview() }
        views = fresh
        items = next
        if let f = focusIndex, f >= views.count { focusIndex = views.isEmpty ? nil : views.count - 1 }
        needsLayout = true
        refreshAccessibility()
    }

    override func layout() {
        super.layout()
        layoutTabs(animated: false)
    }

    private var tabWidth: CGFloat {
        let available = bounds.width - leadingInset - 8 - 36
        guard !views.isEmpty else { return 0 }
        return max(48, min(220, available / CGFloat(views.count)))
    }

    private func layoutTabs(animated: Bool, except: TabItemView? = nil, shift: [ObjectIdentifier: CGFloat] = [:]) {
        let w = tabWidth
        let h: CGFloat = 28
        let y = (bounds.height - h) / 2
        for (i, view) in views.enumerated() where view !== except {
            let x = leadingInset + CGFloat(i) * w + (shift[ObjectIdentifier(view)] ?? 0)
            let frame = NSRect(x: x, y: y, width: w - 2, height: h)
            if animated {
                view.animator().frame = frame
            } else {
                view.frame = frame
            }
        }
        newButton.frame = NSRect(x: leadingInset + CGFloat(views.count) * w + 2, y: (bounds.height - 28) / 2, width: 28, height: 28)
    }

    private func refreshAccessibility() {
        for (i, view) in views.enumerated() {
            view.setAccessibilityIdentifier("zs-tab-\(i)")
            view.focused = window?.firstResponder === self && focusIndex == i
        }
    }

    // MARK: Empty area: drag the window, double-click zooms

    override var mouseDownCanMoveWindow: Bool { false }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
            switch action {
            case "Minimize": window?.performMiniaturize(nil)
            case "None": break
            default: window?.performZoom(nil)
            }
            return
        }
        window?.performDrag(with: event)
    }

    // MARK: Dragging a tab

    func index(of view: TabItemView) -> Int? {
        views.firstIndex { $0 === view }
    }

    /// Runs the drag of `view` from `event` until the button goes up. Returns without doing
    /// anything for a plain click.
    func track(_ view: TabItemView, from event: NSEvent) {
        guard let window, let from = index(of: view) else { return }
        let start = convert(event.locationInWindow, from: nil)
        let origin = view.frame.origin
        let width = tabWidth
        var started = false
        var outside = false
        var target = from
        var last = event
        while let ev = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            last = ev
            if ev.type == .leftMouseUp { break }
            let p = convert(ev.locationInWindow, from: nil)
            let dx = p.x - start.x, dy = p.y - start.y
            if !started {
                guard hypot(dx, dy) >= 4 else { continue }
                started = true
                dragging = view
                addSubview(view, positioned: .above, relativeTo: nil)
                view.alphaValue = 0.9
            }
            // Far enough from the strip, the tab leaves it (another window, or a new one).
            outside = !bounds.insetBy(dx: -28, dy: -28).contains(p)
            view.frame.origin = NSPoint(x: origin.x + dx, y: origin.y + (outside ? dy : 0))
            // The new place: the dragged tab's center against the others' centers.
            let center = origin.x + width / 2 + dx
            target = from
            for (i, other) in views.enumerated() where other !== view {
                let mid = leadingInset + CGFloat(i) * width + width / 2
                if i < from, center < mid { target = min(target, i) }
                if i > from, center > mid { target = max(target, i) }
            }
            var shift: [ObjectIdentifier: CGFloat] = [:]
            for (i, other) in views.enumerated() where other !== view && !outside {
                if i > from, i <= target { shift[ObjectIdentifier(other)] = -width }
                if i < from, i >= target { shift[ObjectIdentifier(other)] = width }
            }
            layoutTabs(animated: true, except: view, shift: shift)
        }
        guard started else { return }
        view.alphaValue = 1
        dragging = nil
        let id = view.item.id
        if outside {
            let screen = window.convertPoint(toScreen: last.locationInWindow)
            update(items)
            delegate?.stripDrop(id, atScreen: screen)
        } else if target != from {
            // At once on screen; the controller confirms with the next update.
            var next = items
            let moved = next.remove(at: from)
            next.insert(moved, at: target)
            update(next)
            delegate?.stripMove(id, to: target)
        } else {
            update(items)
        }
    }

    /// The strip's frame on screen (where a dropped tab joins this window).
    var screenFrame: NSRect? {
        guard let window else { return nil }
        return window.convertToScreen(convert(bounds, to: nil))
    }

    func select(_ view: TabItemView) {
        if !view.item.active { delegate?.stripSelect(view.item.id) }
    }

    func close(_ view: TabItemView) {
        delegate?.stripClose(view.item.id)
    }

    func menu(_ view: TabItemView, _ event: NSEvent?) {
        delegate?.stripMenu(view.item.id, event: event, in: view)
    }

    // MARK: Keyboard

    override var acceptsFirstResponder: Bool { true }
    override var canBecomeKeyView: Bool { NSApp.isFullKeyboardAccessEnabled }

    override func becomeFirstResponder() -> Bool {
        focusIndex = items.firstIndex { $0.active } ?? 0
        refreshAccessibility()
        return true
    }

    override func resignFirstResponder() -> Bool {
        refreshAccessibility()
        DispatchQueue.main.async { [weak self] in self?.refreshAccessibility() }
        return true
    }

    override func keyDown(with event: NSEvent) {
        guard !views.isEmpty else { return super.keyDown(with: event) }
        let i = min(focusIndex ?? 0, views.count - 1)
        let shift = event.modifierFlags.contains(.shift)
        switch Int(event.keyCode) {
        case 124: focusIndex = (i + 1) % views.count // right
        case 123: focusIndex = (i - 1 + views.count) % views.count // left
        case 115: focusIndex = 0 // home
        case 119: focusIndex = views.count - 1 // end
        case 36, 76, 49: select(views[i]) // return, enter, space
        case 51, 117: close(views[i]) // delete, forward delete
        case 109 where shift: menu(views[i], nil) // Shift+F10
        case 110: menu(views[i], nil) // the menu key
        default: return super.keyDown(with: event)
        }
        refreshAccessibility()
    }
}

/// One tab in the strip: product icon, title, close button. An accessibility tab button
/// (`zs-tab-<index>`) whose value is 1 when it is in front.
@MainActor
final class TabItemView: NSView {
    private unowned let strip: TabStripView
    private let lang: Lang
    private let icon = NSTextField(labelWithString: "")
    private let label = NSTextField(labelWithString: "")
    private let closeButton = NSButton(frame: .zero)
    private var hovering = false {
        didSet { refresh() }
    }

    var focused = false {
        didSet { if focused != oldValue { needsDisplay = true } }
    }

    var item: TabStripItem {
        didSet { if item != oldValue { refresh() } }
    }

    init(strip: TabStripView, item: TabStripItem, lang: Lang) {
        self.strip = strip
        self.item = item
        self.lang = lang
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 6
        icon.alignment = .center
        icon.font = .systemFont(ofSize: 9, weight: .bold)
        icon.wantsLayer = true
        icon.layer?.cornerRadius = 4
        icon.setAccessibilityElement(false)
        label.lineBreakMode = .byTruncatingTail
        label.font = .systemFont(ofSize: 12)
        label.setAccessibilityElement(false)
        closeButton.bezelStyle = .regularSquare
        closeButton.isBordered = false
        closeButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: Strings.text(.menuCloseTab, lang))
        closeButton.imageScaling = .scaleProportionallyDown
        closeButton.contentTintColor = .secondaryLabelColor
        closeButton.toolTip = Strings.text(.menuCloseTab, lang)
        closeButton.setAccessibilityLabel(Strings.text(.menuCloseTab, lang))
        closeButton.target = self
        closeButton.action = #selector(closeTab)
        addSubview(icon)
        addSubview(label)
        addSubview(closeButton)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect], owner: self))
        refresh()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    @objc private func closeTab() {
        strip.close(self)
    }

    private var extras: [String] {
        [
            item.recording ? Strings.text(.tabRecording, lang) : nil,
            item.unread ? Strings.text(.tabUnread, lang) : nil,
            !item.loaded && !item.active ? Strings.text(.tabSuspended, lang) : nil,
        ].compactMap { $0 }
    }

    private func refresh() {
        icon.stringValue = item.initial
        if let color = item.color {
            icon.layer?.backgroundColor = NSColor(srgbRed: CGFloat((color >> 16) & 0xFF) / 255, green: CGFloat((color >> 8) & 0xFF) / 255, blue: CGFloat(color & 0xFF) / 255, alpha: 1).cgColor
            icon.textColor = .white
        } else {
            icon.layer?.backgroundColor = NSColor.quaternaryLabelColor.cgColor
            icon.textColor = .labelColor
        }
        label.stringValue = (item.recording ? "\u{25CF} " : "") + item.title
        label.textColor = item.loaded || item.active ? .labelColor : .secondaryLabelColor
        closeButton.isHidden = !(item.active || hovering)
        let words = ([item.title] + extras).joined(separator: ". ")
        toolTip = ([item.title] + extras).joined(separator: "\n")
        setAccessibilityLabel(words)
        layer?.backgroundColor = item.active ? NSColor.controlBackgroundColor.withAlphaComponent(0.9).cgColor
            : hovering ? NSColor.quaternaryLabelColor.cgColor : NSColor.clear.cgColor
        needsLayout = true
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        let h = bounds.height
        icon.frame = NSRect(x: 8, y: (h - 16) / 2, width: 16, height: 16)
        let closeSize: CGFloat = 16
        closeButton.frame = NSRect(x: bounds.width - closeSize - 6, y: (h - closeSize) / 2, width: closeSize, height: closeSize)
        let right = closeButton.isHidden && bounds.width < 90 ? bounds.width - 6 : closeButton.frame.minX - 4
        label.frame = NSRect(x: 30, y: (h - 16) / 2, width: max(0, right - 30), height: 16)
        label.isHidden = bounds.width < 64
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if item.unread && !item.recording {
            NSColor.controlAccentColor.setFill()
            NSBezierPath(ovalIn: NSRect(x: 20, y: bounds.height / 2 + 3, width: 6, height: 6)).fill()
        }
        if focused {
            NSColor.keyboardFocusIndicatorColor.setStroke()
            let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
            path.lineWidth = 2
            path.stroke()
        }
    }

    override var mouseDownCanMoveWindow: Bool { false }

    override func mouseEntered(with event: NSEvent) {
        hovering = true
    }

    override func mouseExited(with event: NSEvent) {
        hovering = false
    }

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.control) {
            strip.menu(self, event)
            return
        }
        strip.select(self)
        strip.track(self, from: event)
    }

    override func rightMouseDown(with event: NSEvent) {
        strip.menu(self, event)
    }

    override func otherMouseUp(with event: NSEvent) {
        if event.buttonNumber == 2 { strip.close(self) }
    }

    // MARK: Accessibility

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .radioButton }
    override func accessibilitySubrole() -> NSAccessibility.Subrole? { .tabButtonSubrole }
    override func accessibilityValue() -> Any? { item.active ? 1 : 0 }
    override func isAccessibilitySelected() -> Bool { item.active }

    override func accessibilityPerformPress() -> Bool {
        strip.select(self)
        return true
    }

    override func accessibilityPerformShowMenu() -> Bool {
        strip.menu(self, nil)
        return true
    }
}
