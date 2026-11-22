import Foundation

// Dictation in any app (block 6 of docs/desktop-swift.md): the shortcut, how it is held or
// tapped, and what each press does. Port of dictation.rs and config.rs in the Tauri app. The app
// target wires these to Carbon's RegisterEventHotKey, AVAudioEngine and the HUD; everything that
// decides lives here, without AppKit, so it is unit tested.

/// How the shortcut dictates (config.rs MODES).
public enum DictationMode: String, CaseIterable, Sendable {
    /// Holding longer than `DictationMachine.hold` is push to talk; a quick tap keeps listening
    /// until the next tap (hands-free).
    case both
    /// Only push to talk: a quick tap cancels.
    case hold
    /// Only tap to start and tap again to finish.
    case toggle
}

/// A global shortcut: a key and its modifiers, in Carbon's terms (RegisterEventHotKey). Only the
/// choices of `DictationShortcut.choices` exist, the same list as the Tauri app (config.rs
/// SHORTCUTS), stored by their Tauri name ("Alt+Space") so settings read the same in both apps.
public struct DictationShortcut: Equatable, Hashable, Sendable {
    /// Carbon modifier masks (Events.h): cmdKey, shiftKey, optionKey, controlKey.
    public static let command: UInt32 = 0x0100
    public static let shift: UInt32 = 0x0200
    public static let option: UInt32 = 0x0800
    public static let control: UInt32 = 0x1000

    /// The stored name, as config.rs writes it.
    public let name: String
    /// Virtual key code (kVK_*).
    public let keyCode: UInt32
    public let modifiers: UInt32

    /// kVK_Space, kVK_ANSI_D, kVK_F5, kVK_Escape, kVK_ANSI_V.
    static let space: UInt32 = 49
    static let keyD: UInt32 = 2
    static let keyF5: UInt32 = 96
    static let keyEscape: UInt32 = 53
    static let keyV: UInt32 = 9

    public static let choices: [DictationShortcut] = [
        DictationShortcut(name: "Alt+Space", keyCode: space, modifiers: option),
        DictationShortcut(name: "Control+Alt+Space", keyCode: space, modifiers: control | option),
        DictationShortcut(name: "Control+Shift+Space", keyCode: space, modifiers: control | shift),
        DictationShortcut(name: "Alt+Shift+Space", keyCode: space, modifiers: option | shift),
        DictationShortcut(name: "CommandOrControl+Shift+D", keyCode: keyD, modifiers: command | shift),
        DictationShortcut(name: "F5", keyCode: keyF5, modifiers: 0),
    ]

    /// Option+Space, the Tauri app's default on the Mac (config.rs default_shortcut).
    public static let standard = choices[0]

    /// Esc, registered only while a dictation records (it cancels).
    public static let escape = DictationShortcut(name: "Escape", keyCode: keyEscape, modifiers: 0)

    /// Control+Command+V: paste the last dictation again (config.rs paste_last_shortcut).
    public static let pasteLast = DictationShortcut(name: "Control+Super+V", keyCode: keyV, modifiers: control | command)

    /// One of the choices by its stored name; nil for anything else.
    public static func named(_ name: String?) -> DictationShortcut? {
        guard let name else { return nil }
        return choices.first { $0.name == name }
    }

    /// "⌃⌥Space", the way macOS menus write shortcuts.
    public var label: String {
        var s = ""
        if modifiers & Self.control != 0 { s += "⌃" }
        if modifiers & Self.option != 0 { s += "⌥" }
        if modifiers & Self.shift != 0 { s += "⇧" }
        if modifiers & Self.command != 0 { s += "⌘" }
        switch keyCode {
        case Self.space: return s + (s.isEmpty ? "Space" : " Space")
        case Self.keyD: return s + "D"
        case Self.keyF5: return s + "F5"
        case Self.keyEscape: return s + "Esc"
        case Self.keyV: return s + "V"
        case RecShortcuts.keyP: return s + "P"
        case RecShortcuts.keyS: return s + "S"
        default: return s + "?"
        }
    }
}

public enum DictationPhase: String, Sendable {
    case idle
    /// The microphone is open (or opening).
    case recording
    /// The audio is on its way to the server or the text is being inserted.
    case working
}

/// What a press, a release, the menu or Esc does (dictation.rs `on_main_shortcut`, `start`,
/// `stop`, `cancel`), as a value: the app runs the returned action. Times are seconds on a
/// monotonic clock, passed in so the tests control them.
public struct DictationMachine: Equatable, Sendable {
    /// Held at least this long: push to talk. Shorter: a tap.
    public static let hold: Double = 0.3
    /// A dictation stops by itself after two minutes (privacy facts `dictationMaxSeconds`).
    public static let maxSeconds: Double = 120
    /// Shorter recordings are dropped without a request.
    public static let minMs = 300

    public enum Action: Equatable, Sendable {
        /// Open the microphone; `handsFree` keeps listening until the next tap.
        case start(handsFree: Bool)
        /// Close the microphone and send what was recorded.
        case stop
        /// Close the microphone and drop what was recorded.
        case cancel
        /// A quick tap in `both` mode: keep listening, the HUD says how to finish.
        case becameHandsFree
        case none
    }

    public private(set) var phase: DictationPhase = .idle
    public private(set) var handsFree = false
    /// Bumped by every start and cancel: late work of an older dictation sees a different number
    /// and does nothing.
    public private(set) var generation = 0
    private var pressedAt: Double?
    private var lastPress: Double?

    public init() {}

    /// The shortcut is down right now (the paste waits for it to be released: a held Option
    /// would turn Command+V into Command+Option+V).
    public var keyDown: Bool { pressedAt != nil }

    public mutating func shortcut(pressed: Bool, at time: Double, mode: DictationMode) -> Action {
        let previous = pressedAt
        if pressed {
            // A key that repeats while held is not a second press. A press long after the last
            // one is real even without a release in between (a release that never arrived).
            if let last = lastPress, previous != nil, time - last < 1 {
                lastPress = time
                return .none
            }
            pressedAt = time
            lastPress = time
            switch phase {
            case .idle: return begin(handsFree: mode == .toggle)
            case .recording where handsFree:
                phase = .working
                return .stop
            default: return .none
            }
        }
        pressedAt = nil
        lastPress = nil
        guard phase == .recording, !handsFree else { return .none }
        let held = previous.map { time - $0 } ?? Self.hold
        if held >= Self.hold {
            phase = .working
            return .stop
        }
        if mode == .both {
            handsFree = true
            return .becameHandsFree
        }
        return cancelled()
    }

    /// The menu bar item: starts a hands-free dictation, or stops the one that records.
    public mutating func toggle() -> Action {
        switch phase {
        case .idle: return begin(handsFree: true)
        case .recording:
            phase = .working
            return .stop
        case .working: return .none
        }
    }

    /// Esc while recording.
    public mutating func escape() -> Action {
        phase == .recording ? cancelled() : .none
    }

    /// The two-minute cap of the dictation `generation`.
    public mutating func timeout(generation g: Int) -> Action {
        guard g == generation, phase == .recording else { return .none }
        phase = .working
        return .stop
    }

    /// The microphone could not open, or the dictation `generation` finished: back to idle.
    public mutating func finished(generation g: Int) {
        guard g == generation, phase != .idle else { return }
        phase = .idle
        handsFree = false
    }

    private mutating func begin(handsFree: Bool) -> Action {
        phase = .recording
        self.handsFree = handsFree
        generation += 1
        return .start(handsFree: handsFree)
    }

    private mutating func cancelled() -> Action {
        phase = .idle
        handsFree = false
        generation += 1
        return .cancel
    }
}

/// The category the server uses to pick the tone, from the name of the app in front
/// (platform.rs `context_for_app`). An empty name is "other".
public enum DictationContext {
    public static func of(app name: String) -> String {
        let words = Set(name.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
        let has = { (list: [String]) in list.contains { words.contains($0) } }
        if words.isEmpty { return "other" }
        if has(["mail", "outlook", "gmail", "spark", "superhuman", "thunderbird", "airmail", "hey"]) { return "email" }
        if has(["slack", "discord", "teams", "whatsapp", "telegram", "messages", "signal", "messenger", "zoom", "wechat", "line"]) { return "chat" }
        if has(["notes", "notion", "obsidian", "bear", "word", "pages", "docs", "evernote", "craft", "logseq", "textedit", "notepad"]) { return "note" }
        return "other"
    }
}
