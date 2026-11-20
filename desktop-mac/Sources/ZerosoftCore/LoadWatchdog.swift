import Foundation

/// Why the page is not showing. `code` is the short reason shown under the message and kept for
/// diagnostics ("the window is white" reports come with something to act on).
public enum LoadFailure: Equatable, Sendable {
    case offline
    case unreachable
    case timeout
    case secureConnection
    case server(status: Int)
    case blank
    case crashed
    case other(domain: String, code: Int)

    public var code: String {
        switch self {
        case .offline: return "offline"
        case .unreachable: return "unreachable"
        case .timeout: return "timeout"
        case .secureConnection: return "tls"
        case let .server(status): return "http-\(status)"
        case .blank: return "blank"
        case .crashed: return "crashed"
        case let .other(domain, code): return "\(domain)/\(code)"
        }
    }

    /// A failed navigation (`didFail` / `didFailProvisionalNavigation`) as a reason, or nil when
    /// it is not a failure the person should see: a navigation replaced by another (cancelled),
    /// or one the app cancelled itself (an external link, a server error it already reported).
    /// The app sends `.cancelled` to the watchdog for those.
    public static func from(domain: String, code: Int) -> LoadFailure? {
        switch domain {
        case "NSURLErrorDomain":
            switch code {
            case -999: return nil // NSURLErrorCancelled
            case -1009, -1005, -1020, -1018: return .offline
            case -1003, -1004, -1006: return .unreachable
            case -1001: return .timeout
            case -1206 ... -1200: return .secureConnection
            default: return .other(domain: "nsurl", code: code)
            }
        case "WebKitErrorDomain":
            // 102: frame load interrupted by policy change; 204: plug-in handled the load.
            if code == 102 || code == 204 { return nil }
            return .other(domain: "webkit", code: code)
        default:
            return .other(domain: domain, code: code)
        }
    }

    /// A main-frame HTTP status that should show the native error view instead of the page.
    public static func from(httpStatus: Int) -> LoadFailure? {
        httpStatus >= 500 && httpStatus <= 599 ? .server(status: httpStatus) : nil
    }
}

/// What covers the web view: nothing (the page is there), a native loading view (nothing has
/// drawn yet), or the native error view. Never a white web view on its own.
public enum Overlay: Equatable, Sendable {
    case none
    case loading
    case error(LoadFailure)
}

public enum WatchdogTimer: Equatable, Sendable {
    case load
    case paint
}

/// Work the app does for the watchdog. Timers and paint checks carry the generation they were
/// made for; results for an older navigation are ignored.
public enum WatchdogEffect: Equatable, Sendable {
    case schedule(WatchdogTimer, after: TimeInterval, generation: Int)
    case checkPaint(after: TimeInterval, generation: Int)
    /// Load the last requested URL (or the server). Always comes with a load timer, so a load
    /// that never even starts still ends in the error view.
    case reload
}

/// Load and paint watchdog for one web view (docs/desktop-swift.md, section 4.6). Pure state
/// machine: the app feeds it WKNavigationDelegate events and performs the effects it returns.
public struct LoadWatchdog: Sendable {
    /// From the start of a navigation to `didFinish`.
    public static let loadTimeout: TimeInterval = 10
    /// From `didFinish` to a body with content.
    public static let paintTimeout: TimeInterval = 5
    public static let paintPoll: TimeInterval = 0.5
    /// A second WebContent crash within this window leaves the error view up.
    public static let crashWindow: TimeInterval = 60

    /// Paint check run after `didFinish`: how many children of `<body>` take up space on screen
    /// (scripts, styles and zero-sized elements do not count). 0 means the page drew nothing.
    public static let paintCheckScript = """
    (function(){var b=document.body;if(!b)return 0;var n=0;for(var i=0;i<b.children.length;i++){\
    var e=b.children[i];if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META)$/.test(e.tagName))continue;\
    var r=e.getBoundingClientRect();if(r.width>0&&r.height>0)n++;}return n;})()
    """

    public enum Phase: Equatable, Sendable {
        case idle
        case loading
        case checkingPaint
        case shown
        case failed
    }

    public enum Event: Equatable, Sendable {
        /// The app asks for the first load (`start()`).
        case loadRequested
        /// `didStartProvisionalNavigation` of the main frame.
        case started
        /// `didFinish`.
        case finished
        /// A failure that `LoadFailure.from` did not ignore.
        case failed(LoadFailure)
        /// The current navigation was cancelled without a failure to show: replaced, turned into
        /// a browser open by the policy (a redirect to another origin, a download), or a
        /// WebKit-internal stop. The page that was drawn is still there.
        case cancelled
        /// Result of a paint check.
        case paint(hasContent: Bool, generation: Int)
        case timer(WatchdogTimer, generation: Int)
        /// `webViewWebContentProcessDidTerminate`.
        case terminated(at: Date)
        /// The person pressed Retry.
        case retry
        /// The network path became satisfied (NWPathMonitor).
        case networkAvailable
    }

    public private(set) var phase: Phase = .idle
    public private(set) var overlay: Overlay = .loading
    public private(set) var generation = 0
    /// Whether the web view currently holds a page that drew. A failure or a crash clears it:
    /// what is under the overlay is then unknown, so the next load shows the loading view.
    public private(set) var painted = false
    private var lastCrash: Date?

    public init() {}

    public mutating func handle(_ event: Event) -> [WatchdogEffect] {
        switch event {
        case .loadRequested:
            return requestLoad()

        case .started:
            generation += 1
            phase = .loading
            if !painted { overlay = .loading }
            return [.schedule(.load, after: Self.loadTimeout, generation: generation)]

        case .finished:
            // A load that was only slow still replaces the timeout error when it arrives.
            guard phase == .loading || phase == .failed else { return [] }
            phase = .checkingPaint
            return [
                .checkPaint(after: 0, generation: generation),
                .schedule(.paint, after: Self.paintTimeout, generation: generation),
            ]

        case let .failed(reason):
            guard phase != .shown && phase != .idle else { return [] }
            fail(reason)
            return []

        case .cancelled:
            // Back to the page that is drawn. With nothing drawn, the load timer still runs and
            // ends in the error view.
            guard phase == .loading, painted else { return [] }
            phase = .shown
            overlay = .none
            return []

        case let .paint(hasContent, gen):
            guard gen == generation, phase == .checkingPaint else { return [] }
            if hasContent {
                phase = .shown
                painted = true
                overlay = .none
                return []
            }
            return [.checkPaint(after: Self.paintPoll, generation: gen)]

        case let .timer(kind, gen):
            guard gen == generation else { return [] }
            if kind == .load && phase == .loading { fail(.timeout) }
            if kind == .paint && phase == .checkingPaint { fail(.blank) }
            return []

        case let .terminated(at):
            painted = false
            if let last = lastCrash, at.timeIntervalSince(last) < Self.crashWindow {
                fail(.crashed)
                return []
            }
            lastCrash = at
            return requestLoad()

        case .retry:
            return requestLoad()

        case .networkAvailable:
            guard phase == .failed, overlay == .error(.offline) else { return [] }
            return requestLoad()
        }
    }

    /// A load the app starts itself: loading view, a new generation and its timer.
    private mutating func requestLoad() -> [WatchdogEffect] {
        generation += 1
        phase = .loading
        painted = false
        overlay = .loading
        return [.reload, .schedule(.load, after: Self.loadTimeout, generation: generation)]
    }

    private mutating func fail(_ reason: LoadFailure) {
        phase = .failed
        painted = false
        overlay = .error(reason)
    }
}

/// `-ZSLockdown on|off|system` (docs/desktop-swift.md, section 3.5): `on` forces WebKit's Lockdown
/// Mode restrictions on every navigation, `off` turns them off, `system` keeps WebKit's default.
public enum LockdownSetting: String, Sendable {
    case on
    case off
    case system

    public static let defaultsKey = "ZSLockdown"

    public init(raw: String?) {
        self = raw.flatMap { LockdownSetting(rawValue: $0.lowercased()) } ?? .system
    }

    /// The value for `WKWebpagePreferences.isLockdownModeEnabled`, nil to leave the default.
    public var webpagePreference: Bool? {
        switch self {
        case .on: return true
        case .off: return false
        case .system: return nil
        }
    }
}
