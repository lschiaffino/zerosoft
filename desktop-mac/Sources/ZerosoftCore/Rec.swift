import Foundation

// Rec (block 8 of docs/desktop-swift.md): while the page records with Rec
// (components/rec/Recorder.tsx), the app shows a floating control bar and, for a full-screen
// recording with the camera, the round camera bubble. Port of rec_overlay.rs. Pure logic: the
// panels, the camera and the shortcuts live in the app target.
//
// - The page tells its state through the bridge (`recOverlay`, `recLevel`). What the person does
//   on the bar, the bubble or the global shortcuts goes back to that page as the
//   `zerosoft:rec-control` event with a control from a fixed list (lib/rec-controls.ts).
// - Nothing here records: the page records (getDisplayMedia, MediaRecorder) and uploads. The
//   bubble only previews the camera, which the screen recording then shows.

/// What the app can ask the recording page (`REC_CONTROLS` in lib/rec-controls.ts; a unit test
/// compares the two lists).
public enum RecControl: String, CaseIterable, Sendable {
    case pause
    case resume
    case toggle
    case stop
    case restart
    case discard
    case mute
    case unmute
    /// The bubble could not open the camera: the page draws the face in the video again.
    case bubbleFailed = "bubble-failed"

    /// The script that dispatches it in the page. Only these fixed values ever reach the page.
    public var script: String {
        "window.dispatchEvent(new CustomEvent('zerosoft:rec-control',{detail:'\(rawValue)'}))"
    }
}

/// The page's microphone as it reports it (`'on' | 'muted' | 'none'`; anything else is none).
public enum RecMic: String, Sendable {
    case on
    case muted
    case none

    public static func parse(_ s: String?) -> RecMic {
        s.flatMap(RecMic.init(rawValue:)) ?? .none
    }
}

/// What the bar and the bubble show for one recording (rec_overlay.rs `RecView`).
public struct RecView: Equatable, Sendable {
    public var phase: RecPhase
    /// Recorded time (without pauses) when the state arrived.
    public var elapsedMs: Double
    /// When it arrived (ms since 1970): while recording, the bar keeps counting from here.
    public var at: Double
    public var mic: RecMic
    /// The page asked for the camera bubble (a full-screen recording with the camera).
    public var camera: Bool
    /// The camera the page used, by name ("" = the default one).
    public var cameraLabel: String
    /// The person can hide the bubble during a recording; it stays hidden for that recording.
    public var bubbleVisible: Bool
    /// The bubble could not open the camera in this recording: the page draws the face itself,
    /// and later states that still name the camera do not bring the bubble back.
    public var cameraFailed = false

    public init(phase: RecPhase, elapsedMs: Double, at: Double, mic: RecMic, camera: Bool, cameraLabel: String = "", bubbleVisible: Bool = true) {
        self.phase = phase
        self.elapsedMs = elapsedMs
        self.at = at
        self.mic = mic
        self.camera = camera
        self.cameraLabel = cameraLabel
        self.bubbleVisible = bubbleVisible
    }

    /// The recorded time now.
    public func elapsed(nowMs: Double) -> Double {
        elapsedMs + (phase == .recording ? max(0, nowMs - at) : 0)
    }

    /// Pause, finish, restart and discard make sense (lib/rec-controls.ts `controlAllowed`).
    public var live: Bool { phase == .recording || phase == .paused }

    /// The global shortcuts are registered (rec_overlay.rs `shortcuts`).
    public var shortcuts: Bool { phase == .countdown || phase == .recording || phase == .paused }

    /// The camera is open: the bubble shows it.
    public var cameraOpen: Bool { camera && bubbleVisible }
}

/// The recordings the pages reported, by tab, and which one the bar is about (the last one that
/// started): rec_overlay.rs `SESSION`, which kept only one, reduced to a value type so it can be
/// unit tested. Two tabs recording at once is rare; both keep their tab's red dot.
public struct RecSessions: Equatable, Sendable {
    public private(set) var views: [Int: RecView] = [:]
    /// Tabs in the order their recording started.
    public private(set) var order: [Int] = []
    /// The bubble's size for this run of the app (rec_overlay.rs `PLACES.large`).
    public private(set) var bubbleLarge = false
    /// Tabs whose recording was refused (not the tab in use when it started): no bar, bubble or
    /// shortcuts for them, but their tab and the menu bar item still mark the recording
    /// (guideline 2.5.14). A later state from that tab while it is in use starts it for real.
    public private(set) var refused: Set<Int> = []

    public init() {}

    /// What a `recOverlay` message did.
    public enum Outcome: String, Sendable {
        /// A new recording: the bar shows.
        case started
        case updated
        case ended
        /// A start from a tab that is not the one in use, or without a phase.
        case refused
        /// `active: false` from a tab without a recording.
        case ignored
    }

    /// The tab the bar is about.
    public var owner: Int? { order.last }
    public var current: RecView? { owner.flatMap { views[$0] } }
    public var tabs: Set<Int> { Set(views.keys) }
    public var isEmpty: Bool { views.isEmpty }

    /// `recOverlay` from `tab`. `startAllowed`: the tab may start a recording now (it is the one
    /// in use, RecStartGate). Updates of a recording that runs come from its own tab only, so
    /// another tab cannot take the bar over or end it.
    public mutating func page(tab: Int, active: Bool, phase: RecPhase?, elapsedMs: Double?, mic: String?, camera: String?,
                              nowMs: Double, startAllowed: Bool) -> Outcome {
        guard active else {
            let wasRefused = refused.remove(tab) != nil
            guard views.removeValue(forKey: tab) != nil else { return wasRefused ? .ended : .ignored }
            order.removeAll { $0 == tab }
            return .ended
        }
        guard let phase else { return .refused }
        let old = views[tab]
        if old == nil, !startAllowed {
            refused.insert(tab)
            return .refused
        }
        refused.remove(tab)
        let label = camera.map(Self.cleanLabel)
        let failed = old?.cameraFailed ?? false
        // The bubble stays hidden if the person hid it in this recording.
        let visible = old?.bubbleVisible ?? true
        var view = RecView(
            phase: phase, elapsedMs: Self.cleanElapsed(elapsedMs), at: nowMs, mic: RecMic.parse(mic),
            camera: label != nil && !failed, cameraLabel: label ?? "", bubbleVisible: visible
        )
        view.cameraFailed = failed
        views[tab] = view
        if old == nil {
            order.append(tab)
            return .started
        }
        return .updated
    }

    /// The tab closed, was suspended or loaded another document: its recording is over.
    @discardableResult
    public mutating func end(tab: Int) -> Bool {
        let wasRefused = refused.remove(tab) != nil
        guard views.removeValue(forKey: tab) != nil else { return wasRefused }
        order.removeAll { $0 == tab }
        return true
    }

    public mutating func setBubbleVisible(_ on: Bool) {
        guard let owner, var v = views[owner], v.camera else { return }
        v.bubbleVisible = on
        views[owner] = v
    }

    public mutating func toggleBubbleSize() {
        bubbleLarge.toggle()
    }

    /// The bubble could not open the camera (or another recording took it): no bubble for the
    /// rest of that tab's recording.
    public mutating func cameraFailed(tab: Int? = nil) {
        guard let id = tab ?? owner, var v = views[id] else { return }
        v.camera = false
        v.cameraFailed = true
        views[id] = v
    }

    /// Every tab that records with Rec, the refused ones included: they all get the red dot.
    public var marked: Set<Int> { tabs.union(refused) }

    /// The level reaches the bar only from the recording tab.
    public func levelAccepted(from tab: Int) -> Bool { owner == tab }

    /// rec_overlay.rs `clean_elapsed`: under a day, else 0.
    static func cleanElapsed(_ v: Double?) -> Double {
        guard let v, v.isFinite, v >= 0, v < 86_400_000 else { return 0 }
        return v.rounded(.down)
    }

    /// rec_overlay.rs `clean_label`: a short camera name without control characters, else the
    /// default camera. (The bridge already dropped control characters and clipped it.)
    static func cleanLabel(_ l: String) -> String {
        l.count <= Bridge.maxDeviceLabel && !l.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) } ? l : ""
    }

    /// "rec=on phase=recording mic=on camera=true bubble=true large=false", for the UI tests.
    public var summary: String {
        guard let v = current else { return "rec=off" }
        return "rec=on phase=\(v.phase.rawValue) mic=\(v.mic.rawValue) camera=\(v.camera) bubble=\(v.cameraOpen) large=\(bubbleLarge) tabs=\(views.count)"
    }
}

/// Which tab may start a Rec recording: the one in use, as for the computer's audio (block 7).
/// Rec reports its first state after the screen picker closes, and macOS's picker can take the
/// app out of the front meanwhile. So the tab that was in use when the app lost the front may
/// still start within `graceMs`, as long as no other tab of the app came to the front since.
public struct RecStartGate: Equatable, Sendable {
    public static let graceMs: Double = 120_000

    public private(set) var lastInUse: Int?
    public private(set) var lostAt: Double?

    public init() {}

    /// The tab in use now (nil while the app is not in front or no tab window is key).
    public mutating func observe(inUse: Int?, nowMs: Double) {
        if let inUse {
            lastInUse = inUse
            lostAt = nil
        } else if lostAt == nil, lastInUse != nil {
            lostAt = nowMs
        }
    }

    public func allows(tab: Int, inUse: Int?, nowMs: Double) -> Bool {
        if inUse == tab { return true }
        guard inUse == nil, lastInUse == tab, let lostAt else { return false }
        return nowMs - lostAt <= Self.graceMs
    }
}

/// Where the bar and the bubble go, in AppKit screen coordinates (origin at the bottom left):
/// the bubble at the bottom left of the screen, like Loom; the bar to its right, aligned at the
/// bottom; without the bubble, the bar at the bottom left. Port of rec_overlay.rs (which works
/// with the origin at the top left).
public enum RecLayout {
    public typealias Area = (x: Double, y: Double, width: Double, height: Double)

    public static let barWidth = 392.0
    public static let barHeight = 44.0
    public static let small = 168.0
    public static let large = 280.0
    public static let margin = 24.0
    public static let gap = 12.0

    public static func bubbleSize(large: Bool) -> Double { large ? Self.large : small }

    /// The whole window inside the area.
    public static func fit(_ x: Double, _ y: Double, width: Double, height: Double, in a: Area) -> (x: Double, y: Double) {
        (max(a.x, min(x, a.x + a.width - width)), max(a.y, min(y, a.y + a.height - height)))
    }

    public static func defaultBubble(_ a: Area, size: Double) -> (x: Double, y: Double) {
        (a.x + margin, a.y + margin)
    }

    public static func defaultBar(_ a: Area, bubble: (x: Double, y: Double, size: Double)?) -> (x: Double, y: Double) {
        let p = bubble.map { (x: $0.x + $0.size + gap, y: $0.y) } ?? (x: a.x + margin, y: a.y + margin)
        return fit(p.x, p.y, width: barWidth, height: barHeight, in: a)
    }

    /// A new bubble size that keeps the corner nearest to it: bottom left grows up and right, top
    /// right grows down and left.
    public static func resizeKeepingCorner(_ x: Double, _ y: Double, old: Double, new: Double, in a: Area) -> (x: Double, y: Double) {
        let cx = x + old / 2, cy = y + old / 2
        let nx = cx > a.x + a.width / 2 ? x + old - new : x
        let ny = cy > a.y + a.height / 2 ? y + old - new : y
        return fit(nx, ny, width: new, height: new, in: a)
    }
}

/// The global shortcuts while Rec records (rec_overlay.rs `SHORTCUTS`): Option+Shift+P pauses or
/// resumes, Option+Shift+S finishes. macOS 15 refuses global shortcuts whose only modifiers are
/// Option and Shift (section 2.2), so when those are refused the app uses Control+Option+P / S.
public enum RecShortcuts {
    static let keyP: UInt32 = 35
    static let keyS: UInt32 = 1

    public static let toggle = DictationShortcut(name: "Alt+Shift+P", keyCode: keyP, modifiers: DictationShortcut.option | DictationShortcut.shift)
    public static let stop = DictationShortcut(name: "Alt+Shift+S", keyCode: keyS, modifiers: DictationShortcut.option | DictationShortcut.shift)
    public static let toggleFallback = DictationShortcut(name: "Control+Alt+P", keyCode: keyP, modifiers: DictationShortcut.control | DictationShortcut.option)
    public static let stopFallback = DictationShortcut(name: "Control+Alt+S", keyCode: keyS, modifiers: DictationShortcut.control | DictationShortcut.option)
}
