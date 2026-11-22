import CoreFoundation
import Foundation

// The native side of the JS bridge (docs/desktop-swift.md, section 4.3): every message the page
// posts to the `zerosoft` handler goes through `Bridge.validate` before the app acts on it.
// 1. Origin: only the main frame of the configured server origin (scheme, host, port).
// 2. Allowlist: `cmd` must be a `BridgeCommand`.
// 3. Typed arguments: each command parses its own keys and types and rejects anything else.
// The app adds the context checks of the commands that need them (the tab in front, the tab that
// owns a recording) when those commands get their native side.

/// Where a message came from: `WKScriptMessage.frameInfo` reduced to what the origin check reads.
/// `port` is `securityOrigin.port`: 0 means the scheme's default port.
public struct BridgeFrame: Equatable, Sendable {
    public var isMainFrame: Bool
    public var scheme: String
    public var host: String
    public var port: Int

    public init(isMainFrame: Bool, scheme: String, host: String, port: Int) {
        self.isMainFrame = isMainFrame
        self.scheme = scheme
        self.host = host
        self.port = port
    }
}

/// Every command the page may send: the bridge surface of section 1 (`lib/desktop-bridge.ts`,
/// `bridge_script` in lib.rs) plus `ready`, which the bridge script posts itself. Anything else
/// is rejected before its arguments are read.
public enum BridgeCommand: String, CaseIterable, Sendable {
    case info
    case ready
    case startLogin
    case openSettings
    case notify
    case recording
    case systemAudioStart
    case systemAudioRead
    case systemAudioStop
    case recOverlay
    case recLevel
    case tabs

    /// Commands with a native side in this build. The others are valid messages that answer
    /// `unavailable` until their block lands (`recOverlay` and `recLevel`: block 8).
    public static let implemented: Set<BridgeCommand> = [
        .info, .ready, .startLogin, .openSettings, .notify, .tabs,
        .recording, .systemAudioStart, .systemAudioRead, .systemAudioStop,
    ]
}

/// Why a message was refused. The raw value is the error the page's promise rejects with and the
/// closed tag that gets logged (never the message content).
public enum BridgeRejection: String, Error, Equatable, Sendable {
    /// Not the main frame of the server origin.
    case origin
    /// The body is not `{cmd, args}` with plain JSON values.
    case malformed
    /// The body is larger or deeper than any command needs.
    case tooLarge
    /// `cmd` is not a `BridgeCommand`.
    case unknownCommand
    /// The arguments do not match the command's schema.
    case badArgs
    /// A valid command this build does not implement yet.
    case unavailable
}

/// What the bridge script measured when the DOM was ready. Under forced Lockdown restrictions
/// WebKit removes most of these: the UI tests read them to prove the switch reached WebKit.
public struct ReadyReport: Equatable, Sendable {
    public static let featureKeys = ["wasm", "idb", "sw", "media", "rtc", "audio", "notification"]

    /// Visible children of `<body>` at DOMContentLoaded (same rule as the paint check).
    public var content: Int
    /// `featureKeys` present in the page.
    public var features: [String: Bool]

    public init(content: Int, features: [String: Bool]) {
        self.content = content
        self.features = features
    }

    /// "content=3 wasm=true idb=false ...": closed keys and values only, for logs and tests.
    public var summary: String {
        (["content=\(content)"] + Self.featureKeys.map { "\($0)=\(features[$0].map(String.init) ?? "?")" })
            .joined(separator: " ")
    }
}

/// The phases of `RecOverlayState` (`RecPhase` without `setup`, lib/rec-controls.ts).
public enum RecPhase: String, Sendable {
    case countdown
    case recording
    case paused
    case finishing
}

/// The `desktop_tabs` actions of tabs.rs.
public enum TabsAction: String, Sendable {
    case state
    case open
    case openTab = "open-tab"
    case openWindow = "open-window"
    case menu
    case select
    case next
    case prev
}

/// A message that passed every check, with its arguments typed.
public enum BridgeRequest: Equatable, Sendable {
    case info
    case ready(ReadyReport)
    case startLogin
    case openSettings
    case notify(title: String, body: String?)
    case recording(active: Bool, startedAt: Double?, path: String?)
    case systemAudioStart
    case systemAudioRead
    case systemAudioStop
    case recOverlay(active: Bool, phase: RecPhase?, elapsedMs: Double?, mic: String?, camera: String?)
    case recLevel(Double)
    case tabs(action: TabsAction, path: String?, title: String?, n: Int?)

    public var command: BridgeCommand {
        switch self {
        case .info: return .info
        case .ready: return .ready
        case .startLogin: return .startLogin
        case .openSettings: return .openSettings
        case .notify: return .notify
        case .recording: return .recording
        case .systemAudioStart: return .systemAudioStart
        case .systemAudioRead: return .systemAudioRead
        case .systemAudioStop: return .systemAudioStop
        case .recOverlay: return .recOverlay
        case .recLevel: return .recLevel
        case .tabs: return .tabs
        }
    }
}

/// What `info()` answers and what the bridge object carries as fields.
public struct BridgeInfo: Equatable, Sendable {
    public var version: String
    /// Store build (`STORE` compilation condition): the page hides purchase links (decision 7.2).
    public var store: Bool
    /// The web views run with Lockdown Mode restrictions forced on (`-ZSLockdown on`). False
    /// for `off` and for `system`, which on macOS leaves third-party web views unrestricted
    /// (section 3.2).
    public var lockdown: Bool
    /// The `-ZSLockdown` setting itself: on, off or system.
    public var lockdownSetting: String
    /// The app can capture the computer's audio for meetings (block 7): a backend exists on
    /// this macOS and the web views are not under forced Lockdown restrictions (the page needs
    /// Web Audio to play the samples). Settings › Meetings can still turn the capture off;
    /// `systemAudioStart` then answers `unsupported` and the page records the microphone only.
    public var systemAudio: Bool

    public init(version: String, store: Bool, lockdown: LockdownSetting, systemAudio: Bool = false) {
        self.version = version
        self.store = store
        self.lockdown = lockdown == .on
        lockdownSetting = lockdown.rawValue
        self.systemAudio = systemAudio && lockdown != .on
    }

    /// Capability fields of `lib/desktop-bridge.ts` that the Tauri app leaves out (meaning yes):
    /// this build does not update from the Tauri feed `/api/desktop/update/latest.json` (the
    /// Store or Sparkle update it, block 10). It has its own tabs and windows since block 4, so
    /// the web app opens links in them the way it does in the Tauri app (`openInNewWindow` in
    /// components/ui/ContextMenu.tsx), and its native Settings window since block 5, which the
    /// web app's "Desktop app settings" buttons open with `openSettings()`. The web app reads
    /// these instead of asking which app it is in.
    public static let settingsWindow = true
    public static let updateFeed = false
    public static let tabs = true

    /// The reply to `info`: plain JSON types only (what WKScriptMessageHandlerWithReply sends back).
    /// Features without a native side in this build report false. `dictation` is true since
    /// block 6 (dictation in any app from the shortcut; the page cannot start one), and
    /// `recordingIndicator` since block 7 (the page's `recording()` drives the floating
    /// indicator, the tab's dot and the menu bar item's dot).
    public static let recordingIndicator = true

    public var reply: [String: Any] {
        [
            "version": version,
            "platform": "darwin",
            "systemAudio": systemAudio,
            "dictation": true,
            "recordingIndicator": Self.recordingIndicator,
            "settingsWindow": Self.settingsWindow,
            "updateFeed": Self.updateFeed,
            "tabs": Self.tabs,
            "store": store,
            "lockdown": lockdown,
            "lockdownSetting": lockdownSetting,
        ]
    }
}

public enum Bridge {
    /// The `WKScriptMessageHandlerWithReply` name: `window.webkit.messageHandlers.zerosoft`.
    public static let handlerName = "zerosoft"

    /// Limits on a message before any command reads it. The largest real message is a tab state
    /// (path up to 1000 characters plus a title).
    public static let maxStringBytes = 4096
    public static let maxTotalBytes = 16 * 1024
    public static let maxNodes = 64
    public static let maxDepth = 3

    /// Caps of the Rust commands (commands.rs, session.rs).
    public static let maxTitle = 200
    public static let maxBody = 500
    public static let maxPath = 1000
    public static let maxDeviceLabel = 200

    /// Rule 1: only the main frame of the exact server origin. Opaque origins (sandboxed iframes,
    /// data: URLs) have an empty scheme or host and never match.
    public static func originAllowed(_ frame: BridgeFrame, server: String) -> Bool {
        guard frame.isMainFrame else { return false }
        let scheme = frame.scheme.lowercased()
        let host = frame.host.lowercased()
        guard !scheme.isEmpty, !host.isEmpty, frame.port >= 0, frame.port <= 65535 else { return false }
        return Server.origin(scheme: scheme, host: host, port: frame.port == 0 ? nil : frame.port) == server
    }

    /// Runs every check on a message body (`WKScriptMessage.body`) from `frame`.
    public static func validate(body: Any, frame: BridgeFrame, server: String) -> Result<BridgeRequest, BridgeRejection> {
        guard originAllowed(frame, server: server) else { return .failure(.origin) }
        do {
            return .success(try parse(body))
        } catch let rejection as BridgeRejection {
            return .failure(rejection)
        } catch {
            return .failure(.malformed)
        }
    }

    static func parse(_ body: Any) throws -> BridgeRequest {
        var budget = Budget()
        let value = try JSONValue(any: body, budget: &budget, depth: 0)
        guard case let .object(envelope) = value else { throw BridgeRejection.malformed }
        guard Set(envelope.keys).isSubset(of: ["cmd", "args"]),
              case let .string(name)? = envelope["cmd"] else { throw BridgeRejection.malformed }
        guard let command = BridgeCommand(rawValue: name) else { throw BridgeRejection.unknownCommand }
        let args: [String: JSONValue]
        switch envelope["args"] {
        case nil, .null?: args = [:]
        case let .object(object)?: args = object
        default: throw BridgeRejection.badArgs
        }
        return try request(command, Args(args))
    }

    private static func request(_ command: BridgeCommand, _ a: Args) throws -> BridgeRequest {
        switch command {
        case .info:
            try a.only([])
            return .info
        case .ready:
            try a.only(["content", "features"])
            let content = try a.int("content", in: 0 ... 100_000) ?? 0
            var features: [String: Bool] = [:]
            if let raw = try a.object("features") {
                guard Set(raw.keys).isSubset(of: Set(ReadyReport.featureKeys)) else { throw BridgeRejection.badArgs }
                for (key, value) in raw {
                    guard case let .bool(present) = value else { throw BridgeRejection.badArgs }
                    features[key] = present
                }
            }
            return .ready(ReadyReport(content: content, features: features))
        case .startLogin:
            try a.only([])
            return .startLogin
        case .openSettings:
            try a.only([])
            return .openSettings
        case .notify:
            try a.only(["title", "body"])
            guard let title = try a.string("title") else { throw BridgeRejection.badArgs }
            return .notify(title: clip(title, maxTitle), body: try a.string("body").map { clip($0, maxBody) })
        case .recording:
            try a.only(["active", "startedAt", "path"])
            guard let active = try a.bool("active") else { throw BridgeRejection.badArgs }
            let path = try a.string("path")
            if let path, !validPath(path) { throw BridgeRejection.badArgs }
            return .recording(active: active, startedAt: try a.number("startedAt", in: 0 ... 1e15), path: path)
        case .systemAudioStart:
            try a.only([])
            return .systemAudioStart
        case .systemAudioRead:
            try a.only([])
            return .systemAudioRead
        case .systemAudioStop:
            try a.only([])
            return .systemAudioStop
        case .recOverlay:
            try a.only(["active", "phase", "elapsedMs", "mic", "camera"])
            guard let active = try a.bool("active") else { throw BridgeRejection.badArgs }
            let phase = try a.string("phase").map { raw -> RecPhase in
                guard let phase = RecPhase(rawValue: raw) else { throw BridgeRejection.badArgs }
                return phase
            }
            return .recOverlay(
                active: active,
                phase: phase,
                elapsedMs: try a.number("elapsedMs", in: 0 ... 1e10),
                mic: try a.string("mic").map { clip($0, maxDeviceLabel) },
                camera: try a.string("camera").map { clip($0, maxDeviceLabel) }
            )
        case .recLevel:
            try a.only(["level"])
            guard let level = try a.number("level", in: -1e6 ... 1e6) else { throw BridgeRejection.badArgs }
            return .recLevel(min(max(level, 0), 1))
        case .tabs:
            try a.only(["action", "path", "title", "n"])
            guard let raw = try a.string("action"), let action = TabsAction(rawValue: raw) else { throw BridgeRejection.badArgs }
            let path = try a.string("path")
            if let path, !validPath(path) { throw BridgeRejection.badArgs }
            return .tabs(action: action, path: path, title: try a.string("title").map { clip($0, maxTitle) }, n: try a.int("n", in: 0 ... 99))
        }
    }

    /// `session::valid_path` of the Tauri app: an absolute path on the server, no scheme-relative
    /// `//`, no backslash, no spaces or control characters, at most 1000 bytes.
    public static func validPath(_ path: String) -> Bool {
        path.hasPrefix("/") && !path.hasPrefix("//") && path.utf8.count <= maxPath && !path.contains("\\")
            && !path.unicodeScalars.contains { $0 == " " || CharacterSet.controlCharacters.contains($0) }
    }

    /// The first `max` characters without control characters, like `clip` in session.rs.
    static func clip(_ s: String, _ max: Int) -> String {
        String(String.UnicodeScalarView(s.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }).prefix(max))
    }
}

// MARK: Plain JSON values

/// Size limits shared by one message.
struct Budget {
    var nodes = 0
    var bytes = 0

    mutating func spend(nodes n: Int = 1, bytes b: Int = 0) throws {
        nodes += n
        bytes += b
        if nodes > Bridge.maxNodes || bytes > Bridge.maxTotalBytes { throw BridgeRejection.tooLarge }
    }
}

/// A message body as plain JSON. WebKit turns JS values into NSDictionary, NSArray, NSString,
/// NSNumber (booleans are CFBoolean), NSNull and NSDate; anything outside JSON is rejected.
indirect enum JSONValue: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(any: Any, budget: inout Budget, depth: Int) throws {
        guard depth <= Bridge.maxDepth else { throw BridgeRejection.tooLarge }
        switch any {
        case is NSNull:
            try budget.spend()
            self = .null
        case let s as String:
            let bytes = s.utf8.count
            guard bytes <= Bridge.maxStringBytes else { throw BridgeRejection.tooLarge }
            try budget.spend(bytes: bytes)
            self = .string(s)
        case let n as NSNumber:
            try budget.spend(bytes: 8)
            if CFGetTypeID(n) == CFBooleanGetTypeID() {
                self = .bool(n.boolValue)
            } else {
                let d = n.doubleValue
                guard d.isFinite else { throw BridgeRejection.malformed }
                self = .number(d)
            }
        case let list as [Any]:
            try budget.spend()
            self = .array(try list.map { try JSONValue(any: $0, budget: &budget, depth: depth + 1) })
        case let dict as [String: Any]:
            try budget.spend()
            var out: [String: JSONValue] = [:]
            for (key, value) in dict {
                guard key.utf8.count <= 64 else { throw BridgeRejection.tooLarge }
                try budget.spend(nodes: 0, bytes: key.utf8.count)
                out[key] = try JSONValue(any: value, budget: &budget, depth: depth + 1)
            }
            self = .object(out)
        default:
            // NSDate, NSData and anything else WebKit may hand over.
            throw BridgeRejection.malformed
        }
    }
}

/// Typed reads of a command's arguments. A missing key or `null` is nil; a wrong type rejects.
struct Args {
    let values: [String: JSONValue]

    init(_ values: [String: JSONValue]) {
        self.values = values
    }

    /// Unknown keys reject: a command reads exactly its schema.
    func only(_ keys: Set<String>) throws {
        guard Set(values.keys).isSubset(of: keys) else { throw BridgeRejection.badArgs }
    }

    private func value(_ key: String) -> JSONValue? {
        switch values[key] {
        case nil, .null?: return nil
        case let v?: return v
        }
    }

    func string(_ key: String) throws -> String? {
        guard let v = value(key) else { return nil }
        guard case let .string(s) = v else { throw BridgeRejection.badArgs }
        return s
    }

    func bool(_ key: String) throws -> Bool? {
        guard let v = value(key) else { return nil }
        guard case let .bool(b) = v else { throw BridgeRejection.badArgs }
        return b
    }

    func number(_ key: String, in range: ClosedRange<Double>) throws -> Double? {
        guard let v = value(key) else { return nil }
        guard case let .number(d) = v, range.contains(d) else { throw BridgeRejection.badArgs }
        return d
    }

    func int(_ key: String, in range: ClosedRange<Int>) throws -> Int? {
        guard let d = try number(key, in: Double(range.lowerBound) ... Double(range.upperBound)) else { return nil }
        guard d == d.rounded() else { throw BridgeRejection.badArgs }
        return Int(d)
    }

    func object(_ key: String) throws -> [String: JSONValue]? {
        guard let v = value(key) else { return nil }
        guard case let .object(o) = v else { throw BridgeRejection.badArgs }
        return o
    }
}
