import Foundation

// Windows and tabs as data (docs/desktop-swift.md block 4, docs/desktop-tabs.md). Port of
// desktop/src-tauri/src/session.rs: which windows exist, the tabs of each, the one in front, the
// closed ones for Cmd+Shift+T and the preferences. The app (TabsController) connects it to the
// real windows and web views. Saved as session.json in the app's container.
//
// What goes to disk: window labels, sizes and positions, tab ids and paths, the tab in front of
// each window, and the preferences. Never a title, a URL with a host, a token or page contents.
// Every path is checked again with `allowedPath` when the file is read, because the file is
// outside the app's control between two launches.

/// Where a window sits on screen, in points, top-left origin (as the Tauri app stores it).
public struct TabBounds: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    /// session.rs keeps bounds only in these ranges; anything else is dropped (default size).
    public var plausible: Bool {
        [x, y, w, h].allSatisfy(\.isFinite) && w >= 300 && h >= 300 && w < 20_000 && h < 20_000
            && abs(x) < 50_000 && abs(y) < 50_000
    }
}

public struct SessionTab: Equatable, Sendable {
    public let id: Int
    public var path: String
    /// What the page reported (`document.title`, or its h1). Shown in the strip, never saved.
    public var title: String = ""
    /// Has a web view (suspended tabs and restored tabs that were not looked at do not).
    public var loaded = false
    /// Milliseconds of the last time it left the front (or was looked at).
    public var lastActive: Double = 0
    public var recording = false
    public var unread = false

    public init(id: Int, path: String) {
        self.id = id
        self.path = path
    }
}

public struct SessionWindow: Equatable, Sendable {
    public let label: String
    public var tabs: [SessionTab]
    /// Id of the tab in front.
    public var active: Int
    public var bounds: TabBounds?
}

/// What Cmd-click on a link opens: a tab behind the current one, or a new window.
public enum LinkTarget: String, Sendable {
    case tab
    case window
}

public struct TabPrefs: Equatable, Sendable {
    /// Suspend tabs nobody looked at for a while (frees memory; they reload when clicked).
    public var suspend = true
    public var suspendMinutes = 30
    /// At launch, the windows and tabs of the last time.
    public var restore = true
    public var links: LinkTarget = .tab

    public static let suspendChoices = [5, 15, 30, 60, 240]

    public init() {}

    /// Overrides only the valid values of `raw` (session.rs `parse_prefs`).
    public static func parse(_ raw: Any?, base: TabPrefs = TabPrefs()) -> TabPrefs {
        var p = base
        guard let raw = raw as? [String: Any] else { return p }
        if let b = raw["suspend"] as? NSNumber, isBool(b) { p.suspend = b.boolValue }
        if let m = raw["suspendMinutes"] as? NSNumber, !isBool(m), suspendChoices.contains(where: { Double($0) == m.doubleValue }) {
            p.suspendMinutes = m.intValue
        }
        if let b = raw["restore"] as? NSNumber, isBool(b) { p.restore = b.boolValue }
        if let l = (raw["links"] as? String).flatMap(LinkTarget.init(rawValue:)) { p.links = l }
        return p
    }

    var json: [String: Any] {
        ["suspend": suspend, "suspendMinutes": suspendMinutes, "restore": restore, "links": links.rawValue]
    }
}

public struct ClosedTab: Equatable, Sendable {
    public var path: String
    public var title: String
    public var window: String
    public var index: Int
}

/// Where something new opens.
public enum TabPlace: Sendable {
    /// At the end, in front (Cmd+T).
    case end
    /// Next to the current one, in front (Cmd+Shift-click, target=_blank).
    case next
    /// Next to the current one, behind (Cmd-click, middle click).
    case background
}

/// What the strip shows for a tab without a title of its own.
public struct Product: Equatable, Sendable {
    public let name: String
    /// sRGB hex, as lib/products.ts.
    public let color: UInt32
}

public struct TabSession: Equatable, Sendable {
    /// Caps: a broken or huge session never stalls the launch.
    public static let maxWindows = 12
    public static let maxTabs = 40
    public static let maxClosed = 25
    public static let maxTitle = 200
    /// The first window. Closing it when it is the only one hides it.
    public static let main = "main"
    public static let home = "/app"
    public static let fileVersion = 1

    public private(set) var windows: [SessionWindow] = []
    public private(set) var closed: [ClosedTab] = []
    public var prefs: TabPrefs
    /// The server origin every path is checked against.
    public let server: String
    private var nextID = 1
    private var nextWin = 1

    public init(prefs: TabPrefs = TabPrefs(), server: String) {
        self.prefs = prefs
        self.server = server
    }

    // MARK: Paths

    /// A path that may live in a tab: `Bridge.validPath` (absolute, no `//`, no backslash, spaces
    /// or control characters, at most 1000 bytes), no `..` or encoded dot or backslash in the
    /// path part, not an API route (restoring one would replay a request such as a sign-in or an
    /// OAuth start at launch), and the server plus the path is still the server origin and passes
    /// the navigation policy. Used for every path that comes from the page or from disk.
    public static func allowedPath(_ path: String, server: String) -> Bool {
        guard Bridge.validPath(path) else { return false }
        let pathPart = path.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? ""
        let lower = pathPart.lowercased()
        guard !pathPart.isEmpty, !pathPart.contains(".."), !lower.contains("%2e"), !lower.contains("%5c"),
              lower != "/api", !lower.hasPrefix("/api/") else { return false }
        return url(for: path, server: server) != nil
    }

    /// The URL of a tab path: nil unless it stays on the server origin and the navigation policy
    /// loads it inside.
    public static func url(for path: String, server: String) -> URL? {
        guard Bridge.validPath(path), let url = URL(string: server + path),
              Server.origin(of: url) == server,
              NavigationPolicy.classify(url, server: server) == .allow else { return nil }
        return url
    }

    public func url(of id: Int) -> URL? {
        get(id).flatMap { Self.url(for: $0.path, server: server) }
    }

    /// The product segment of a path (`/app/track/...` is "track"; also after a locale).
    public static func product(of path: String) -> String {
        let clean = path.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? ""
        var parts = clean.split(separator: "/").map(String.init)[...]
        guard var first = parts.popFirst() else { return "" }
        if ["en", "es", "pt"].contains(first) {
            guard let next = parts.popFirst() else { return "" }
            first = next
        }
        guard first == "app" else { return "" }
        return parts.first ?? ""
    }

    /// Names and colors of `desktop/ui/tabs.ts` (lib/products.ts).
    public static let products: [String: Product] = [
        "track": Product(name: "Track", color: 0xF2611D), "crm": Product(name: "CRM", color: 0x7B4DFF),
        "chat": Product(name: "Chat", color: 0xE23D7F), "groups": Product(name: "Groups", color: 0x65A30D),
        "lines": Product(name: "Lines", color: 0x65A30D), "agents": Product(name: "Agents", color: 0xFF3B30),
        "flow": Product(name: "Flow", color: 0x0284C7), "robots": Product(name: "Robots", color: 0x6B7280),
        "links": Product(name: "Link", color: 0x2F6BFF), "docs": Product(name: "Docs", color: 0xC2700A),
        "notes": Product(name: "Notes", color: 0xE6B400), "calendar": Product(name: "Cal", color: 0x0E9F6E),
        "board": Product(name: "Board", color: 0x00B8A9), "voice": Product(name: "Voice", color: 0xC026D3),
        "inbox": Product(name: "Inbox", color: 0x3D5A80), "rec": Product(name: "Rec", color: 0xE11D48),
        "talk": Product(name: "Talk", color: 0x8E3A80), "design": Product(name: "Design", color: 0x00A5C8),
        "shop": Product(name: "Shop", color: 0x15803D), "analytics": Product(name: "Analytics", color: 0x4F46E5),
        "pulse": Product(name: "Pulse", color: 0x4F46E5), "social": Product(name: "Social", color: 0x7E22CE),
        "hiring": Product(name: "Hiring", color: 0x0F766E), "people": Product(name: "People", color: 0x8B5E34),
        "books": Product(name: "Books", color: 0x1E3A8A), "sign": Product(name: "Sign", color: 0x7F1D1D),
        "forms": Product(name: "Forms", color: 0x6E730D), "send": Product(name: "Send", color: 0x0B7285),
        "calls": Product(name: "Calls", color: 0xA61E4D), "fleet": Product(name: "Fleet", color: 0x2F9E44),
    ]

    /// The strip's text for a tab: the page title without the " · zerosoft" suffix; without one,
    /// the product name, or `fallback` ("New tab"). Same rule as `tabTitle` in tabs.ts.
    public static func displayTitle(_ tab: SessionTab, fallback: String) -> String {
        var clean = tab.title
        if let range = clean.range(of: #"\s*[·|–-]\s*zerosoft\s*$"#, options: [.regularExpression, .caseInsensitive]) {
            clean.removeSubrange(range)
        }
        clean = clean.trimmingCharacters(in: .whitespaces)
        if !clean.isEmpty, clean.lowercased() != "zerosoft" { return clean }
        return products[product(of: tab.path)]?.name ?? fallback
    }

    // MARK: Lookups

    public func window(_ label: String) -> SessionWindow? {
        windows.first { $0.label == label }
    }

    /// (window index, tab index).
    public func find(_ id: Int) -> (Int, Int)? {
        for (wi, w) in windows.enumerated() {
            if let ti = w.tabs.firstIndex(where: { $0.id == id }) { return (wi, ti) }
        }
        return nil
    }

    public func get(_ id: Int) -> SessionTab? {
        find(id).map { windows[$0.0].tabs[$0.1] }
    }

    public func windowOf(_ id: Int) -> String? {
        find(id).map { windows[$0.0].label }
    }

    public func activeOf(_ label: String) -> Int? {
        window(label)?.active
    }

    public var allTabs: [SessionTab] {
        windows.flatMap(\.tabs)
    }

    private mutating func id() -> Int {
        let id = max(nextID, 1)
        nextID = id + 1
        return id
    }

    private mutating func tab(_ path: String) -> SessionTab {
        SessionTab(id: id(), path: Self.allowedPath(path, server: server) ? path : Self.home)
    }

    private func windowIndex(_ label: String) -> Int? {
        windows.firstIndex { $0.label == label }
    }

    public mutating func update(_ id: Int, _ change: (inout SessionTab) -> Void) {
        guard let (wi, ti) = find(id) else { return }
        change(&windows[wi].tabs[ti])
    }

    // MARK: Opening

    /// A new window with one tab. The first is "main"; the others "w1", "w2"...
    @discardableResult
    public mutating func newWindow(_ path: String, bounds: TabBounds? = nil) -> (label: String, tab: Int)? {
        guard windows.count < Self.maxWindows else { return nil }
        let label: String
        if window(Self.main) == nil {
            label = Self.main
        } else {
            var candidate: String
            repeat {
                candidate = "w\(max(nextWin, 1))"
                nextWin = max(nextWin, 1) + 1
            } while window(candidate) != nil
            label = candidate
        }
        let t = tab(path)
        windows.append(SessionWindow(label: label, tabs: [t], active: t.id, bounds: bounds?.plausible == true ? bounds : nil))
        return (label, t.id)
    }

    /// A new tab in a window. nil when the window does not exist or is full.
    @discardableResult
    public mutating func addTab(_ label: String, path: String, place: TabPlace) -> Int? {
        guard let wi = windowIndex(label), windows[wi].tabs.count < Self.maxTabs else { return nil }
        let t = tab(path)
        let w = windows[wi]
        let current = w.tabs.firstIndex { $0.id == w.active } ?? max(w.tabs.count - 1, 0)
        let at: Int
        switch place {
        case .end: at = w.tabs.count
        case .next, .background: at = min(current + 1, w.tabs.count)
        }
        windows[wi].tabs.insert(t, at: at)
        if place != .background { windows[wi].active = t.id }
        return t.id
    }

    /// Brings a tab to the front of its window. Returns the one that was in front, if it changed.
    @discardableResult
    public mutating func activate(_ id: Int, now: Double) -> Int? {
        guard let (wi, ti) = find(id) else { return nil }
        let previous = windows[wi].active
        windows[wi].active = id
        windows[wi].tabs[ti].lastActive = now
        windows[wi].tabs[ti].unread = false
        guard previous != id else { return nil }
        if let pi = windows[wi].tabs.firstIndex(where: { $0.id == previous }) {
            windows[wi].tabs[pi].lastActive = now
        }
        return previous
    }

    /// Cmd+1...Cmd+8 the n-th, Cmd+9 the last.
    public func nth(_ label: String, _ n: Int) -> Int? {
        guard let w = window(label), n > 0, !w.tabs.isEmpty else { return nil }
        if n >= 9 { return w.tabs.last?.id }
        return n <= w.tabs.count ? w.tabs[n - 1].id : nil
    }

    /// Ctrl+Tab (+1) and Ctrl+Shift+Tab (-1), wrapping around.
    public func cycle(_ label: String, _ delta: Int) -> Int? {
        guard let w = window(label), w.tabs.count > 1 else { return nil }
        let n = w.tabs.count
        let current = w.tabs.firstIndex { $0.id == w.active } ?? 0
        return w.tabs[((current + delta) % n + n) % n].id
    }

    // MARK: Closing

    /// Closes a tab. Returns its window, the new tab in front if it changed, and whether the
    /// window is now empty.
    @discardableResult
    public mutating func closeTab(_ id: Int) -> (window: String, next: Int?, empty: Bool)? {
        guard let (wi, ti) = find(id) else { return nil }
        let tab = windows[wi].tabs.remove(at: ti)
        let label = windows[wi].label
        var next: Int?
        if windows[wi].active == id, !windows[wi].tabs.isEmpty {
            // As browsers do: the one on the right, or on the left when it was the last.
            let n = windows[wi].tabs[min(ti, windows[wi].tabs.count - 1)].id
            windows[wi].active = n
            next = n
        }
        let empty = windows[wi].tabs.isEmpty
        remember(tab, window: label, index: ti)
        return (label, next, empty)
    }

    private mutating func remember(_ tab: SessionTab, window: String, index: Int) {
        closed.append(ClosedTab(path: tab.path, title: tab.title, window: window, index: index))
        if closed.count > Self.maxClosed { closed.removeFirst(closed.count - Self.maxClosed) }
    }

    /// Removes a window closed with its button: its tabs stay for Cmd+Shift+T.
    @discardableResult
    public mutating func removeWindow(_ label: String) -> SessionWindow? {
        guard let i = windowIndex(label) else { return nil }
        let w = windows.remove(at: i)
        for (ti, t) in w.tabs.enumerated() { remember(t, window: label, index: ti) }
        return w
    }

    /// Cmd+Shift+T: the last closed tab goes back to its window and place (or to `fallback`
    /// when its window is gone).
    @discardableResult
    public mutating func reopen(fallback: String) -> (window: String, tab: Int)? {
        guard let c = closed.popLast() else { return nil }
        let label = window(c.window) != nil ? c.window : fallback
        guard let wi = windowIndex(label), windows[wi].tabs.count < Self.maxTabs else {
            closed.append(c)
            return nil
        }
        var t = tab(c.path)
        t.title = c.title
        windows[wi].tabs.insert(t, at: min(c.index, windows[wi].tabs.count))
        windows[wi].active = t.id
        return (label, t.id)
    }

    // MARK: Moving

    /// Moves a tab to another window (or to another place in the same one). Returns its old
    /// window, the new tab in front there if the one that left was in front, and whether it is
    /// now empty.
    @discardableResult
    public mutating func moveTab(_ id: Int, to: String, index: Int) -> (from: String, next: Int?, empty: Bool)? {
        guard let (wi, ti) = find(id) else { return nil }
        let from = windows[wi].label
        if from != to {
            guard let dest = window(to), dest.tabs.count < Self.maxTabs else { return nil }
        }
        let tab = windows[wi].tabs.remove(at: ti)
        var next: Int?
        if from != to, windows[wi].active == id, !windows[wi].tabs.isEmpty {
            let n = windows[wi].tabs[min(ti, windows[wi].tabs.count - 1)].id
            windows[wi].active = n
            next = n
        }
        let empty = windows[wi].tabs.isEmpty && from != to
        guard let di = windowIndex(to) else { return nil }
        windows[di].tabs.insert(tab, at: min(max(index, 0), windows[di].tabs.count))
        windows[di].active = id
        return (from, next, empty)
    }

    /// A new window for a tab that already exists (dragged out, "Move Tab to New Window").
    /// Returns its old window, the new window and the new tab in front of the old one.
    @discardableResult
    public mutating func detach(_ id: Int, bounds: TabBounds? = nil) -> (from: String, window: String, next: Int?)? {
        guard let (wi, _) = find(id), windows[wi].tabs.count >= 2, windows.count < Self.maxWindows else { return nil }
        let from = windows[wi].label
        guard let (label, placeholder) = newWindow(Self.home, bounds: bounds),
              let (_, next, _) = moveTab(id, to: label, index: 0) else { return nil }
        // The provisional tab of the new window goes (it does not count as closed).
        if let di = windowIndex(label) {
            windows[di].tabs.removeAll { $0.id == placeholder }
            windows[di].active = id
        }
        return (from, label, next)
    }

    // MARK: Page state

    /// Tabs to suspend: loaded, behind, not recording, still for at least `suspendMinutes`.
    public func discardable(now: Double) -> [Int] {
        guard prefs.suspend else { return [] }
        let limit = Double(max(prefs.suspendMinutes, 1)) * 60_000
        return windows.flatMap { w in w.tabs.filter { $0.id != w.active } }
            .filter { $0.loaded && !$0.recording && $0.lastActive > 0 && now - $0.lastActive >= limit }
            .map(\.id)
    }

    @discardableResult
    public mutating func setTitle(_ id: Int, _ title: String) -> Bool {
        let clean = Bridge.clip(title.trimmingCharacters(in: .whitespacesAndNewlines), Self.maxTitle)
        guard let t = get(id), t.title != clean else { return false }
        update(id) { $0.title = clean }
        return true
    }

    /// A path the page reported or a link asked for. Refused unless `allowedPath`.
    @discardableResult
    public mutating func setPath(_ id: Int, _ path: String) -> Bool {
        guard Self.allowedPath(path, server: server), let t = get(id), t.path != path else { return false }
        update(id) { $0.path = path }
        return true
    }

    public mutating func setBounds(_ label: String, _ bounds: TabBounds?) {
        guard let wi = windowIndex(label) else { return }
        windows[wi].bounds = bounds?.plausible == true ? bounds : nil
    }

    /// "Something new" dots per product (not on the tab in front of the focused window).
    /// Returns whether anything changed.
    @discardableResult
    public mutating func setUnread(_ products: Set<String>, focused: String?) -> Bool {
        var changed = false
        for wi in windows.indices {
            let w = windows[wi]
            for ti in w.tabs.indices {
                let p = Self.product(of: w.tabs[ti].path)
                let on = !p.isEmpty && products.contains(p) && !(focused == w.label && w.tabs[ti].id == w.active)
                if windows[wi].tabs[ti].unread != on {
                    windows[wi].tabs[ti].unread = on
                    changed = true
                }
            }
        }
        return changed
    }

    // MARK: session.json

    /// The file contents. Without "restore at launch" nothing about what was open is written,
    /// only the preferences. Titles are never written (they are page contents).
    public func encoded() -> Data {
        let wins: [[String: Any]] = prefs.restore ? windows.map { w in
            var o: [String: Any] = [
                "label": w.label,
                "active": w.active,
                "tabs": w.tabs.map { ["id": $0.id, "path": $0.path] as [String: Any] },
            ]
            if let b = w.bounds { o["bounds"] = ["x": b.x, "y": b.y, "w": b.w, "h": b.h] }
            return o
        } : []
        let root: [String: Any] = ["version": Self.fileVersion, "windows": wins, "prefs": prefs.json]
        return (try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
    }

    /// A session from session.json (or anything else): every path is checked with `allowedPath`
    /// against `server`, tabs that fail are dropped, empty windows are dropped, and at most
    /// `maxWindows` windows of `maxTabs` tabs are kept. Window labels are made again (the first
    /// is "main"), ids are new, nothing is loaded. Titles in the file (the Tauri app writes them)
    /// are ignored. Without `restore`, only the preferences.
    public static func decode(_ data: Data?, server: String) -> TabSession {
        let raw = data.flatMap { $0.count <= 1_000_000 ? try? JSONSerialization.jsonObject(with: $0) : nil } as? [String: Any]
        let prefs = TabPrefs.parse(raw?["prefs"])
        var s = TabSession(prefs: prefs, server: server)
        guard prefs.restore, let wins = raw?["windows"] as? [Any] else { return s }
        for case let w as [String: Any] in wins.prefix(maxWindows * 2) {
            guard s.windows.count < maxWindows, let tabs = w["tabs"] as? [Any] else { continue }
            let activeID = (w["active"] as? NSNumber).map(\.doubleValue)
            let kept: [(path: String, active: Bool)] = tabs.compactMap { item in
                guard let t = item as? [String: Any], let path = t["path"] as? String,
                      allowedPath(path, server: server) else { return nil }
                let id = (t["id"] as? NSNumber).map(\.doubleValue)
                return (path, id != nil && id == activeID)
            }.prefix(maxTabs).map { $0 }
            guard let first = kept.first else { continue }
            guard let (label, firstID) = s.newWindow(first.path, bounds: bounds(w["bounds"])) else { break }
            var active = firstID
            for t in kept.dropFirst() {
                if let id = s.addTab(label, path: t.path, place: .end), t.active { active = id }
            }
            if let wi = s.windowIndex(label) { s.windows[wi].active = active }
        }
        return s
    }

    private static func bounds(_ raw: Any?) -> TabBounds? {
        guard let b = raw as? [String: Any],
              let x = (b["x"] as? NSNumber)?.doubleValue, let y = (b["y"] as? NSNumber)?.doubleValue,
              let w = (b["w"] as? NSNumber)?.doubleValue, let h = (b["h"] as? NSNumber)?.doubleValue else { return nil }
        let bounds = TabBounds(x: x, y: y, w: w, h: h)
        return bounds.plausible ? bounds : nil
    }

    /// "main=*/app,/app/crm~ w1=*/app/docs": every window with its tabs, `*` the one in front,
    /// `~` not loaded. Paths only, for logs and UI tests.
    public var summary: String {
        windows.map { w in
            w.label + "=" + w.tabs.map { t in (t.id == w.active ? "*" : "") + t.path + (t.loaded ? "" : "~") }.joined(separator: ",")
        }.joined(separator: " ")
    }
}

private func isBool(_ n: NSNumber) -> Bool {
    CFGetTypeID(n) == CFBooleanGetTypeID()
}
