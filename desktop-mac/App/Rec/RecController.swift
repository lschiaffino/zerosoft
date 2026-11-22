import AppKit
import os

/// Rec (block 8 of docs/desktop-swift.md, port of rec_overlay.rs): while a page records with Rec
/// (components/rec/Recorder.tsx), the floating bar (RecBar) and, for a full-screen recording with
/// the camera, the camera bubble (RecBubble), plus the global shortcuts while it records. What the
/// person does there goes back to that page as `zerosoft:rec-control`.
///
/// - Nothing native records. The page records the screen (getDisplayMedia), the camera and the
///   microphone and uploads them; the bubble only previews the camera, and the page's screen
///   recording records it. No frame or sound is kept by the app.
/// - Only the tab in use starts a recording's bar (RecStartGate, the rule of the computer's audio
///   in block 7). After that only that tab updates or ends it; its level reaches the bar only from
///   it. A tab that closes, is suspended or loads another document ends its recording.
/// - The camera opens only for a recording the person started with the camera, and only while
///   the bubble shows. macOS asks for it on that first use if nothing asked before; a refusal or a
///   missing camera sends `bubble-failed` and the page draws the face in the video again.
@MainActor
final class RecController {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "rec")

    private let tabs: TabsController
    let bar: RecBar
    let bubble: RecBubble
    let camera: CameraPreview
    let cameraPermission: CameraPermission
    private let keys = HotKeys()
    private(set) var sessions = RecSessions()
    private var gate = RecStartGate()
    private var askingCamera = false
    private var observers: [NSObjectProtocol] = []
    /// The shortcuts in use while recording ("⌥⇧P" and "⌥⇧S", or the fallback), nil when off.
    private(set) var shortcutLabels: (toggle: String, stop: String)?

    /// Rec started, changed or ended: the tabs' dots, the indicator and the menu bar item.
    var onChange: () -> Void = {}
    /// UI tests: what each message and action did.
    var onOutcome: ((String) -> Void)?
    /// macOS answered the camera prompt of a first use (Settings shows the new state).
    var onCameraAsked: () -> Void = {}

    init(lang: Lang, tabs: TabsController, camera: CameraPreview, cameraPermission: CameraPermission) {
        self.tabs = tabs
        self.camera = camera
        self.cameraPermission = cameraPermission
        bar = RecBar(lang: lang)
        bubble = RecBubble(lang: lang)
        bar.onAction = { [weak self] action in self?.barAction(action) }
        bubble.onAction = { [weak self] action in self?.bubbleAction(action) }
        // A camera that stops while it shows (unplugged, taken by another app): the page draws
        // the face again.
        camera.onFailure = { [weak self] in
            guard let self, self.sessions.current?.cameraOpen == true else { return }
            self.cameraFailed("runtime")
        }
        keys.onKey = { [weak self] key, pressed in
            guard pressed, let self else { return }
            switch key {
            case .recToggle: self.send(.toggle, from: "shortcut")
            case .recStop: self.finish(from: "shortcut")
            default: break
            }
        }
        let center = NotificationCenter.default
        let names: [Notification.Name] = [
            NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
            NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
        ]
        for name in names {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.observeInUse() }
            })
        }
    }

    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    private func observeInUse() {
        gate.observe(inUse: tabs.tabInUseNow, nowMs: now)
    }

    /// The bridge commands of one tab's page.
    func wire(_ web: WebController, tab id: Int) {
        web.onRecOverlay = { [weak self] active, phase, elapsedMs, mic, camera in
            self?.page(id, active: active, phase: phase, elapsedMs: elapsedMs, mic: mic, camera: camera)
        }
        web.onRecLevel = { [weak self] level in
            guard let self, self.sessions.levelAccepted(from: id) else { return }
            self.bar.setLevel(level)
        }
    }

    /// The tab is in front of the person (another tab became the one in use).
    func frontChanged() {
        observeInUse()
    }

    /// The tab closed, was suspended or loaded another document.
    func tabGone(_ id: Int) {
        if sessions.end(tab: id) {
            outcome("tab-gone")
            render()
        }
    }

    /// A recording shows the bar.
    var active: Bool { !sessions.isEmpty }
    /// Some tab records with Rec, also one whose start was refused (it is marked, without a bar).
    var marking: Bool { !sessions.marked.isEmpty }
    func records(_ id: Int) -> Bool { sessions.marked.contains(id) }
    /// The tab has the bar (its recording was started from the tab in use).
    func hasBar(_ id: Int) -> Bool { sessions.tabs.contains(id) }

    private func page(_ id: Int, active: Bool, phase: RecPhase?, elapsedMs: Double?, mic: String?, camera: String?) {
        observeInUse()
        let allowed = gate.allows(tab: id, inUse: tabs.tabInUseNow, nowMs: now)
        let before = sessions.owner.flatMap { o in sessions.views[o].map { (o, $0) } }
        let result = sessions.page(tab: id, active: active, phase: phase, elapsedMs: elapsedMs, mic: mic, camera: camera,
                                   nowMs: now, startAllowed: allowed)
        Self.log.info("rec overlay \(result.rawValue, privacy: .public)")
        outcome("overlay \(result.rawValue)")
        // A second recording takes the bubble: the first page draws its face again.
        if result == .started, let (prev, view) = before, prev != id, view.cameraOpen {
            tabs.sendRecControl(.bubbleFailed, to: prev)
            sessions.cameraFailed(tab: prev)
            self.camera.stop()
        }
        switch result {
        case .started, .updated, .ended: render()
        // Refused: no bar, but the tab and the menu bar item mark the recording.
        case .refused: onChange()
        case .ignored: break
        }
    }

    // MARK: Showing

    /// The visible area of the screen of the recording tab's window.
    private func area() -> RecLayout.Area {
        let screen = sessions.owner.flatMap(tabs.screen(of:)) ?? NSScreen.main ?? NSScreen.screens.first
        let f = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        return (Double(f.minX), Double(f.minY), Double(f.width), Double(f.height))
    }

    private func render() {
        guard let view = sessions.current else {
            bar.hide()
            bubble.hide()
            camera.stop()
            setShortcuts(false)
            onChange()
            return
        }
        let a = area()
        let size = RecLayout.bubbleSize(large: sessions.bubbleLarge)
        if view.cameraOpen {
            openCamera(view, area: a, size: size)
        } else {
            bubble.hide()
            camera.stop()
        }
        bar.keepOnScreen(a)
        bar.show(view) { [weak self] in
            guard let self else { return .zero }
            let b = view.camera ? (self.bubble.moved.map { Double($0.x) } ?? RecLayout.defaultBubble(a, size: size).x,
                                   self.bubble.moved.map { Double($0.y) } ?? RecLayout.defaultBubble(a, size: size).y) : nil
            let p = RecLayout.defaultBar(a, bubble: b.map { (x: $0.0, y: $0.1, size: size) })
            return NSPoint(x: p.x, y: p.y)
        }
        setShortcuts(view.shortcuts)
        onChange()
    }

    private func openCamera(_ view: RecView, area a: RecLayout.Area, size: Double) {
        switch cameraPermission.current() {
        case .allowed:
            guard camera.isRunning || camera.start(label: view.cameraLabel) else {
                cameraFailed("no-camera")
                return
            }
            bubble.keepOnScreen(a, size: size)
            bubble.show(camera: camera.layer, size: size, large: sessions.bubbleLarge) {
                let p = RecLayout.defaultBubble(a, size: size)
                return NSPoint(x: p.x, y: p.y)
            }
        case .denied:
            cameraFailed("denied")
        case .notDetermined:
            // The first use: the person started a recording with the camera. macOS asks once.
            guard !askingCamera else { return }
            askingCamera = true
            Task { @MainActor in
                let answer = await self.cameraPermission.request()
                self.askingCamera = false
                self.onCameraAsked()
                guard self.sessions.current?.cameraOpen == true else { return }
                if answer == .allowed {
                    self.render()
                } else {
                    self.cameraFailed("denied")
                }
            }
        }
    }

    /// The bubble cannot show the camera: the page draws the face in the video again.
    private func cameraFailed(_ why: String) {
        guard let owner = sessions.owner else { return }
        Self.log.notice("rec camera \(why, privacy: .public)")
        outcome("camera \(why)")
        tabs.sendRecControl(.bubbleFailed, to: owner)
        sessions.cameraFailed()
        render()
    }

    private func setShortcuts(_ on: Bool) {
        guard on != (shortcutLabels != nil) else { return }
        if !on {
            keys.unregister(.recToggle)
            keys.unregister(.recStop)
            shortcutLabels = nil
            bar.setShortcuts(nil)
            outcome("keys off")
            return
        }
        var pair = (RecShortcuts.toggle, RecShortcuts.stop)
        var ok = keys.register(.recToggle, pair.0) && keys.register(.recStop, pair.1)
        if !ok {
            // macOS 15 refuses shortcuts with only Option and Shift (section 2.2).
            pair = (RecShortcuts.toggleFallback, RecShortcuts.stopFallback)
            ok = keys.register(.recToggle, pair.0) && keys.register(.recStop, pair.1)
        }
        if ok {
            shortcutLabels = (pair.0.label, pair.1.label)
        } else {
            keys.unregister(.recToggle)
            keys.unregister(.recStop)
            shortcutLabels = ("", "")
        }
        bar.setShortcuts(ok ? shortcutLabels : nil)
        outcome("keys \(ok ? pair.0.name : "none")")
    }

    // MARK: Actions

    private func barAction(_ action: RecBar.Action) {
        switch action {
        case .pause: send(.pause, from: "bar")
        case .resume: send(.resume, from: "bar")
        case .restart: send(.restart, from: "bar")
        case .discard: send(.discard, from: "bar")
        case .mute: send(.mute, from: "bar")
        case .unmute: send(.unmute, from: "bar")
        case .stop: finish(from: "bar")
        case .open: open()
        case .cameraShow, .cameraHide:
            sessions.setBubbleVisible(action == .cameraShow)
            outcome("bubble \(action == .cameraShow ? "show" : "hide")")
            render()
        }
    }

    private func bubbleAction(_ action: RecBubble.Action) {
        switch action {
        case .hide:
            sessions.setBubbleVisible(false)
            outcome("bubble hide")
            render()
        case .size:
            sessions.toggleBubbleSize()
            bubble.resize(to: RecLayout.bubbleSize(large: sessions.bubbleLarge), large: sessions.bubbleLarge, area: area())
            outcome("bubble large=\(sessions.bubbleLarge)")
            onChange()
        }
    }

    /// A control for the recording page. When its tab is gone, the bar closes.
    private func send(_ control: RecControl, from source: String) {
        guard let owner = sessions.owner else { return }
        guard tabs.hasWeb(owner) else {
            tabGone(owner)
            return
        }
        tabs.sendRecControl(control, to: owner)
        outcome("control \(control.rawValue) \(source)")
    }

    /// Finish (bar, shortcut, menu bar item): the page stops, uploads and shows the recording, so
    /// its tab comes to the front.
    func finish(from source: String = "menu") {
        guard sessions.current?.live == true else { return }
        send(.stop, from: source)
        open()
    }

    /// The recording tab in front (bar click, menu bar item).
    func open() {
        guard let owner = sessions.owner else { return }
        NSApp.activate(ignoringOtherApps: true)
        _ = tabs.focus(owner)
    }

    private func outcome(_ what: String) {
        onOutcome?(what)
    }

    /// "rec=on phase=recording ... bar=shown bubble=shown sharing=none keys=Alt+Shift+P", for the
    /// UI tests.
    var summary: String {
        "\(sessions.summary) marked=\(sessions.marked.count) bar=\(bar.isVisible ? "shown" : "hidden") bubble=\(bubble.isVisible ? "shown" : "hidden") sharing=\(bar.sharing) keys=\(shortcutLabels.map { $0.toggle.isEmpty ? "none" : "on" } ?? "off")"
    }
}
