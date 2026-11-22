import AppKit
import QuartzCore

/// Rec's floating control bar (rec_overlay.rs and ui/recbar.* of the Tauri app; block 8 of
/// docs/desktop-swift.md): a red dot and the clock, the state, the microphone (its level; a click
/// mutes or unmutes), show or hide the camera bubble, pause or resume, restart and discard (each
/// asks first, in the bar), and Finish. A click on the bar outside its buttons opens the
/// recording; a drag moves it.
///
/// A non-activating `NSPanel` above other apps on every Space (public API, guideline 2.5.1) that
/// never takes the focus from the app being recorded, and is left out of screen captures
/// (`sharingType = .none`, section 2.2), so it is never in the video. While it shows, the
/// recording is marked (guideline 2.5.14); the person cannot hide it.
@MainActor
final class RecBar {
    enum Action: String {
        case pause, resume, stop, restart, discard, mute, unmute, open
        case cameraShow = "camera-show"
        case cameraHide = "camera-hide"
    }

    private let panel: RecPanel
    private let view: RecBarView
    private let lang: Lang
    var onAction: (Action) -> Void = { _ in }
    /// Where the person left it, for this run of the app (rec_overlay.rs `PLACES.bar`).
    private(set) var moved: NSPoint?
    private var state: RecView?
    private var clock: Timer?
    private var shortcutKeys: (toggle: String, stop: String)?

    init(lang: Lang) {
        self.lang = lang
        let size = NSSize(width: RecLayout.barWidth, height: RecLayout.barHeight)
        panel = RecPanel(
            contentRect: NSRect(origin: .zero, size: size),
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
        // Never in the recording (NSWindowSharingNone, as content_protected in the Tauri app).
        panel.sharingType = .none
        panel.identifier = NSUserInterfaceItemIdentifier("zs-recbar-panel")
        panel.setAccessibilityIdentifier("zs-recbar")
        panel.setAccessibilityLabel(Strings.text(.recControls, lang))
        view = RecBarView(frame: NSRect(origin: .zero, size: size), lang: lang)
        panel.contentView = view
        view.onAction = { [weak self] action in self?.onAction(action) }
        view.onDrag = { [weak self] dx, dy in self?.drag(dx, dy) }
        view.onDragEnd = { [weak self] in self?.moved = self?.panel.frame.origin }
    }

    var isVisible: Bool { panel.isVisible }
    var frame: NSRect { panel.frame }
    /// "none" when the bar is left out of screen captures (UI tests).
    var sharing: String { panel.sharingType == .none ? "none" : "shared" }

    /// The shortcuts registered while recording, for the tooltips (nil: none).
    func setShortcuts(_ keys: (toggle: String, stop: String)?) {
        shortcutKeys = keys
        if let state { view.paint(state, shortcuts: keys) }
    }

    /// Shows the bar for `state` at `origin` (the first time) and paints it.
    func show(_ state: RecView, origin: () -> NSPoint) {
        self.state = state
        view.paint(state, shortcuts: shortcutKeys)
        if !panel.isVisible {
            panel.setFrameOrigin(moved ?? origin())
            panel.orderFrontRegardless()
        }
        clock?.invalidate()
        clock = nil
        tick()
        if state.phase == .recording {
            let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            clock = timer
        }
    }

    func hide() {
        state = nil
        clock?.invalidate()
        clock = nil
        view.confirm(nil)
        guard panel.isVisible else { return }
        panel.orderOut(nil)
    }

    /// The microphone level (0 to 1) from the recording page.
    func setLevel(_ level: Double) {
        view.level = CGFloat(min(max(level, 0), 1))
    }

    /// The saved position, when it is still on a screen (rec_overlay.rs `fit`).
    func keepOnScreen(_ area: RecLayout.Area) {
        guard let p = moved else { return }
        let fitted = RecLayout.fit(Double(p.x), Double(p.y), width: RecLayout.barWidth, height: RecLayout.barHeight, in: area)
        moved = NSPoint(x: fitted.x, y: fitted.y)
    }

    private func tick() {
        guard let state else { return }
        view.time = RecordingIndicatorRules.elapsed(ms: state.elapsed(nowMs: Date().timeIntervalSince1970 * 1000))
    }

    private func drag(_ dx: CGFloat, _ dy: CGFloat) {
        var origin = panel.frame.origin
        origin.x += dx
        origin.y += dy
        panel.setFrameOrigin(origin)
    }
}

/// Never key or main: clicks reach it without activating zerosoft.
final class RecPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// A button of a floating panel: the first click counts (the panel never becomes key).
final class RecButton: NSButton {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

private final class RecBarView: NSView {
    var onAction: (RecBar.Action) -> Void = { _ in }
    var onDrag: (CGFloat, CGFloat) -> Void = { _, _ in }
    var onDragEnd: () -> Void = {}
    var time = "" {
        didSet { clock.stringValue = time }
    }

    var level: CGFloat = 0 {
        didSet { layoutLevel() }
    }

    private let lang: Lang
    private let dot = CALayer()
    private let clock = NSTextField(labelWithString: "0:00")
    private let stateLabel = NSTextField(labelWithString: "")
    private let levelTrack = CALayer()
    private let levelFill = CALayer()
    private let mic = RecButton()
    private let camera = RecButton()
    private let pause = RecButton()
    private let restart = RecButton()
    private let discard = RecButton()
    private let finish = RecButton()
    private let main = NSStackView()
    private let confirmRow = NSStackView()
    private let ask = NSTextField(labelWithString: "")
    private let keep = RecButton()
    private let yes = RecButton()
    private var asking: RecBar.Action?
    private var view: RecView?
    private var downAt: NSPoint?
    private var dragged = false

    init(frame: NSRect, lang: Lang) {
        self.lang = lang
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.88).cgColor
        layer?.cornerRadius = 12
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        layer?.borderWidth = 0.5

        dot.backgroundColor = NSColor.systemRed.cgColor
        dot.cornerRadius = 5
        layer?.addSublayer(dot)
        clock.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        clock.textColor = .white
        clock.setAccessibilityIdentifier("zs-recbar-clock")
        stateLabel.font = .systemFont(ofSize: 11)
        stateLabel.textColor = NSColor.white.withAlphaComponent(0.7)
        stateLabel.setAccessibilityIdentifier("zs-recbar-state")

        style(mic, "zs-recbar-mic", #selector(tapMic))
        style(camera, "zs-recbar-camera", #selector(tapCamera))
        style(pause, "zs-recbar-pause", #selector(tapPause))
        style(restart, "zs-recbar-restart", #selector(tapRestart))
        style(discard, "zs-recbar-discard", #selector(tapDiscard))
        restart.image = symbol("arrow.counterclockwise")
        discard.image = symbol("trash")
        finish.title = t(.recFinish)
        finish.bezelStyle = .rounded
        finish.bezelColor = .systemRed
        finish.contentTintColor = .white
        finish.font = .systemFont(ofSize: 12, weight: .semibold)
        finish.target = self
        finish.action = #selector(tapFinish)
        finish.setAccessibilityIdentifier("zs-recbar-finish")

        let text = NSStackView(views: [clock, stateLabel])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 0
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        main.orientation = .horizontal
        main.spacing = 6
        main.alignment = .centerY
        main.setViews([text, spacer, mic, camera, pause, restart, discard, finish], in: .leading)
        main.edgeInsets = NSEdgeInsets(top: 0, left: 26, bottom: 0, right: 8)

        ask.font = .systemFont(ofSize: 12, weight: .medium)
        ask.textColor = .white
        ask.setAccessibilityIdentifier("zs-recbar-ask")
        ask.lineBreakMode = .byTruncatingTail
        keep.title = t(.recKeep)
        keep.bezelStyle = .rounded
        keep.target = self
        keep.action = #selector(tapKeep)
        keep.setAccessibilityIdentifier("zs-recbar-keep")
        yes.bezelStyle = .rounded
        yes.bezelColor = .systemRed
        yes.contentTintColor = .white
        yes.target = self
        yes.action = #selector(tapYes)
        yes.setAccessibilityIdentifier("zs-recbar-confirm")
        let gap = NSView()
        gap.setContentHuggingPriority(.defaultLow, for: .horizontal)
        confirmRow.orientation = .horizontal
        confirmRow.spacing = 6
        confirmRow.alignment = .centerY
        confirmRow.setViews([ask, gap, keep, yes], in: .leading)
        confirmRow.edgeInsets = NSEdgeInsets(top: 0, left: 14, bottom: 0, right: 8)
        confirmRow.isHidden = true

        for stack in [main, confirmRow] {
            stack.translatesAutoresizingMaskIntoConstraints = false
            addSubview(stack)
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: leadingAnchor),
                stack.trailingAnchor.constraint(equalTo: trailingAnchor),
                stack.topAnchor.constraint(equalTo: topAnchor),
                stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
        }
        levelTrack.backgroundColor = NSColor.white.withAlphaComponent(0.15).cgColor
        levelFill.backgroundColor = NSColor.systemGreen.cgColor
        levelFill.anchorPoint = .zero
        layer?.addSublayer(levelTrack)
        layer?.addSublayer(levelFill)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    private func t(_ key: StringKey) -> String { Strings.text(key, lang) }

    private func symbol(_ name: String) -> NSImage? {
        NSImage(systemSymbolName: name, accessibilityDescription: nil)
    }

    private func style(_ b: NSButton, _ id: String, _ action: Selector) {
        b.isBordered = false
        b.bezelStyle = .regularSquare
        b.imagePosition = .imageOnly
        b.contentTintColor = .white
        b.target = self
        b.action = action
        b.setAccessibilityIdentifier(id)
        b.widthAnchor.constraint(equalToConstant: 28).isActive = true
        b.heightAnchor.constraint(equalToConstant: 28).isActive = true
    }

    private func label(_ b: NSButton, _ text: String) {
        b.toolTip = text
        b.setAccessibilityLabel(text)
    }

    func paint(_ v: RecView, shortcuts: (toggle: String, stop: String)?) {
        view = v
        let stateKey: StringKey
        switch v.phase {
        case .countdown: stateKey = .recStarting
        case .recording: stateKey = .recRecording
        case .paused: stateKey = .recPaused
        case .finishing: stateKey = .recFinishing
        }
        stateLabel.stringValue = t(stateKey)
        let hint = { (key: StringKey, combo: String?) -> String in
            combo.map { Strings.text(.recShortcutHint, self.lang, ["action": self.t(key), "key": $0]) } ?? self.t(key)
        }
        mic.image = symbol(v.mic == .on ? "mic.fill" : "mic.slash.fill")
        mic.isEnabled = v.mic != .none && v.phase != .finishing
        label(mic, t(v.mic == .none ? .recNoMic : v.mic == .muted ? .recUnmute : .recMute))
        camera.isHidden = !v.camera
        camera.image = symbol(v.bubbleVisible ? "video.fill" : "video.slash.fill")
        label(camera, t(v.bubbleVisible ? .recHideCamera : .recShowCamera))
        let paused = v.phase == .paused
        pause.image = symbol(paused ? "play.fill" : "pause.fill")
        label(pause, hint(paused ? .recResume : .recPause, shortcuts?.toggle))
        for b in [pause, restart, discard, finish] { b.isEnabled = v.live }
        label(restart, t(.recRestart))
        label(discard, t(.recDiscard))
        finish.toolTip = hint(.recFinishHint, shortcuts?.stop)
        finish.setAccessibilityLabel(t(.recFinish))
        if !v.live { confirm(nil) }
        // The dot pulses while recording (unless Reduce Motion is on) and stays still otherwise.
        dot.removeAllAnimations()
        dot.opacity = v.phase == .recording ? 1 : 0.5
        if v.phase == .recording, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.35
            pulse.duration = 0.9
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            dot.add(pulse, forKey: "pulse")
        }
        layoutLevel()
    }

    /// Asks before discarding or restarting, in the bar itself.
    func confirm(_ what: RecBar.Action?) {
        asking = what
        main.isHidden = what != nil
        confirmRow.isHidden = what == nil
        guard let what else { return }
        ask.stringValue = t(what == .discard ? .recDiscardConfirm : .recRestartConfirm)
        yes.title = t(what == .discard ? .recDiscard : .recRestart)
    }

    override func layout() {
        super.layout()
        dot.frame = NSRect(x: 12, y: bounds.midY - 5, width: 10, height: 10)
        layoutLevel()
    }

    /// A thin level line under the microphone button.
    private func layoutLevel() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let on = !main.isHidden && view?.mic == .on
        let f = mic.convert(mic.bounds, to: self)
        let track = NSRect(x: f.minX + 4, y: f.minY - 1, width: max(0, f.width - 8), height: 2)
        levelTrack.frame = track
        levelFill.frame = NSRect(x: track.minX, y: track.minY, width: track.width * level, height: track.height)
        levelTrack.isHidden = !on
        levelFill.isHidden = !on
        CATransaction.commit()
    }

    @objc private func tapMic() {
        guard let view else { return }
        onAction(view.mic == .muted ? .unmute : .mute)
    }

    @objc private func tapCamera() {
        guard let view else { return }
        onAction(view.bubbleVisible ? .cameraHide : .cameraShow)
    }

    @objc private func tapPause() {
        guard let view else { return }
        onAction(view.phase == .paused ? .resume : .pause)
    }

    @objc private func tapRestart() { confirm(.restart) }
    @objc private func tapDiscard() { confirm(.discard) }
    @objc private func tapFinish() { onAction(.stop) }
    @objc private func tapKeep() { confirm(nil) }

    @objc private func tapYes() {
        if let asking { onAction(asking) }
        confirm(nil)
    }

    // A click on the bar (not a button) opens the recording; a drag moves the bar.
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
        if dragged {
            onDragEnd()
        } else if downAt != nil {
            onAction(.open)
        }
    }
}
