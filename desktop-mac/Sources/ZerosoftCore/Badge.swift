import Foundation

/// A new item from the badge poll, reduced to what a native notification may show: the title
/// the server wrote for it and the app page it links to. The item's body (which can hold the
/// text of a message) is never read, so a notification from the poll never shows contents.
public struct BadgeNotification: Equatable, Sendable {
    public let id: String
    public let title: String
    /// A safe app path (`DeepLink.safeAppPath`), or nil.
    public let path: String?

    public init(id: String, title: String, path: String?) {
        self.id = id
        self.title = title
        self.path = path
    }
}

public struct BadgeUpdate: Equatable, Sendable {
    public let total: Int
    public let notifications: [BadgeNotification]
    /// The server time of this answer: `since` of the next poll.
    public let now: String?
}

/// The Dock badge poll (docs/desktop-swift.md, section 4.7; port of badge.rs):
/// GET /api/desktop/badge every 30 s with the session, `?since=` the previous answer's `now`.
public enum Badge {
    public static let pollSeconds: TimeInterval = 30
    /// At most this many notifications per poll (badge.rs).
    public static let maxNotifications = 5
    public static let maxTotal = 1_000_000

    public static func requestURL(server: String, since: String?) -> URL? {
        guard var parts = URLComponents(string: server + "/api/desktop/badge") else { return nil }
        if let since, validTime(since) { parts.queryItems = [URLQueryItem(name: "since", value: since)] }
        return parts.url
    }

    /// Reads the JSON of /api/desktop/badge. nil when it is not the expected shape.
    public static func parse(_ data: Data) -> BadgeUpdate? {
        guard data.count <= 256 * 1024,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let raw = (json["total"] as? NSNumber)?.doubleValue ?? 0
        let total = raw.isFinite ? Int(min(max(raw, 0), Double(maxTotal))) : 0
        let list = (json["notifications"] as? [Any]) ?? []
        var items: [BadgeNotification] = []
        for case let item as [String: Any] in list {
            guard let id = item["id"] as? String, !id.isEmpty, id.utf8.count <= 100 else { continue }
            let title = Bridge.clip((item["title"] as? String) ?? "", Bridge.maxTitle)
            let path = (item["href"] as? String).flatMap(DeepLink.safeAppPath)
            items.append(BadgeNotification(id: id, title: title.isEmpty ? "zerosoft" : title, path: path))
            if items.count == maxNotifications { break }
        }
        let now = (json["now"] as? String).flatMap { validTime($0) ? $0 : nil }
        return BadgeUpdate(total: total, notifications: items, now: now)
    }

    /// The Dock badge text: empty for 0, "99+" above 99.
    public static func label(_ total: Int) -> String {
        total <= 0 ? "" : total > 99 ? "99+" : String(total)
    }

    /// The notifications to show for an answer: none on the first poll of a session (no
    /// `since`, so old items are not repeated), none while the app is in front (the page shows
    /// them), and each id only once.
    public static func toShow(_ update: BadgeUpdate, since: String?, appActive: Bool, seen: Set<String>) -> [BadgeNotification] {
        guard since != nil, !appActive else { return [] }
        return update.notifications.filter { !seen.contains($0.id) }
    }

    /// An ISO 8601 time as the server writes it (`new Date().toISOString()`).
    static func validTime(_ s: String) -> Bool {
        s.utf8.count <= 40 && s.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$"#, options: .regularExpression) != nil
    }
}

/// A notification the page asked for (the `window.Notification` shim, bridge `notify`). The page
/// chose its title and body, as in a browser. It shows only while the app is not in front.
public enum PageNotification {
    public static func shouldShow(appActive: Bool) -> Bool { !appActive }
}
