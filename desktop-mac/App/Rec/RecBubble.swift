import AppKit
import QuartzCore

/// Rec's camera bubble (ui/recbubble.* of the Tauri app; block 8 of docs/desktop-swift.md): the
/// face, round and mirrored, above every app on every Space, while the page records the whole
/// screen with the camera. The screen recording records it where the person leaves it (the page
/// stops drawing the face in the video meanwhile). Drag it anywhere; on hover, Bigger or Smaller
/// and Hide.
///
/// A non-activating `NSPanel` with the camera's `AVCaptureVideoPreviewLayer` (section 4.2): no
/// web page and no recording of its own. Unlike the bar it is shared with screen captures: it is
/// what puts the face in the video.
@MainActor
final class RecBubble {
    enum Action {
        case size
        case hide
    }

    private let panel: RecPanel
    private let view: BubbleView
    var onAction: (Action) -> Void = { _ in }
    /// Where the person left it, for this run of the app (rec_overlay.rs `PLACES.bubble`).
    private(set) var moved: NSPoint?

    init(lang: Lang) {
        let side = RecLayout.small
        panel = RecPanel(
            contentRect: NSRect(x: 0, y: 0, width: side, height: side),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isExcludedFromWindowsMenu = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovable = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.identifier = NSUserInterfaceItemIdentifier("zs-recbubble-panel")
        view = BubbleView(frame: NSRect(x: 0, y: 0, width: side, height: side), lang: lang)
        panel.contentView = view
        view.onSize = { [weak self] in self?.onAction(.size) }
        view.onHide = { [weak self] in self?.onAction(.hide) }
        view.onDrag = { [weak self] dx, dy in self?.drag(dx, dy) }
        view.onDragEnd = { [weak self] in self?.moved = self?.panel.frame.origin }
    }

    var isVisible: Bool { panel.isVisible }
    var frame: NSRect { panel.frame }

    /// Shows `camera` (its preview layer) at the remembered place, or `origin()` the first time.
    func show(camera: CALayer, size: Double, large: Bool, origin: () -> NSPoint) {
        view.setCamera(camera)
        view.large = large
        if !panel.isVisible {
            let o = moved ?? origin()
            panel.setFrame(NSRect(x: o.x, y: o.y, width: size, height: size), display: true)
            panel.orderFrontRegardless()
        }
    }

    func hide() {
        guard panel.isVisible else { return }
        panel.orderOut(nil)
        view.setCamera(nil)
    }

    /// A new size that keeps the bubble's nearest corner where it is.
    func resize(to size: Double, large: Bool, area: RecLayout.Area) {
        view.large = large
        guard panel.isVisible else { return }
        let f = panel.frame
        let p = RecLayout.resizeKeepingCorner(Double(f.minX), Double(f.minY), old: Double(f.width), new: size, in: area)
        panel.setFrame(NSRect(x: p.x, y: p.y, width: size, height: size), display: true)
        moved = panel.frame.origin
    }

    /// The remembered place, kept on the screen it is on.
    func keepOnScreen(_ area: RecLayout.Area, size: Double) {
        guard let p = moved else { return }
        let fitted = RecLayout.fit(Double(p.x), Double(p.y), width: size, height: size, in: area)
        moved = NSPoint(x: fitted.x, y: fitted.y)
    }

    private func drag(_ dx: CGFloat, _ dy: CGFloat) {
        var origin = panel.frame.origin
        origin.x += dx
        origin.y += dy
        panel.setFrameOrigin(origin)
    }
}

/// The round face with the two hover buttons.
private final class BubbleView: NSView {
    var onSize: () -> Void = {}
    var onHide: () -> Void = {}
    var onDrag: (CGFloat, CGFloat) -> Void = { _, _ in }
    var onDragEnd: () -> Void = {}
    var large = false {
        didSet { paintSize() }
    }

    private let lang: Lang
    private let face = CALayer()
    private var camera: CALayer?
    private let size = RecButton()
    private let hide = RecButton()
    private var tracking: NSTrackingArea?
    private var downAt: NSPoint?
    private var dragged = false

    init(frame: NSRect, lang: Lang) {
        self.lang = lang
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        face.backgroundColor = NSColor.black.cgColor
        face.masksToBounds = true
        face.borderColor = NSColor.white.withAlphaComponent(0.85).cgColor
        face.borderWidth = 3
        layer?.addSublayer(face)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
        setAccessibilityLabel(Strings.text(.recBubble, lang))
        setAccessibilityIdentifier("zs-recbubble")
        toolTip = Strings.text(.recBubble, lang)
        for (b, name, id, action) in [
            (size, "arrow.up.left.and.arrow.down.right", "zs-recbubble-size", #selector(tapSize)),
            (hide, "eye.slash", "zs-recbubble-hide", #selector(tapHide)),
        ] {
            b.image = NSImage(systemSymbolName: name, accessibilityDescription: nil)
            b.isBordered = false
            b.imagePosition = .imageOnly
            b.contentTintColor = .white
            b.wantsLayer = true
            b.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.6).cgColor
            b.layer?.cornerRadius = 14
            b.target = self
            b.action = action
            b.setAccessibilityIdentifier(id)
            b.alphaValue = 0
            addSubview(b)
        }
        hide.setAccessibilityLabel(Strings.text(.recHideCamera, lang))
        hide.toolTip = Strings.text(.recHideCamera, lang)
        paintSize()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func accessibilityChildren() -> [Any]? { [size, hide] }

    func setCamera(_ layer: CALayer?) {
        guard layer !== camera else { return }
        camera?.removeFromSuperlayer()
        camera = layer
        if let layer { face.addSublayer(layer) }
        needsLayout = true
    }

    private func paintSize() {
        size.image = NSImage(systemSymbolName: large ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", accessibilityDescription: nil)
        let text = Strings.text(large ? .recSmaller : .recBigger, lang)
        size.setAccessibilityLabel(text)
        size.toolTip = text
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let inset = bounds.insetBy(dx: 4, dy: 4)
        face.frame = inset
        face.cornerRadius = inset.width / 2
        camera?.frame = face.bounds
        CATransaction.commit()
        let b: CGFloat = 28
        hide.frame = NSRect(x: bounds.midX - b - 3, y: 14, width: b, height: b)
        size.frame = NSRect(x: bounds.midX + 3, y: 14, width: b, height: b)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { showButtons(true) }
    override func mouseExited(with event: NSEvent) { if downAt == nil { showButtons(false) } }

    private func showButtons(_ on: Bool) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.15
            size.animator().alphaValue = on ? 1 : 0
            hide.animator().alphaValue = on ? 1 : 0
        }
    }

    @objc private func tapSize() { onSize() }
    @objc private func tapHide() { onHide() }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

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
        if dragged { onDragEnd() }
    }
}
