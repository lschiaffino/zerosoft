import Foundation
import Testing
@testable import ZerosoftCore

private let code = String(repeating: "a", count: 43)
private let state = String(repeating: "S", count: 32)
private let server = "https://zerosoft.ai"

// The table of deeplink.rs, plus the cases the Swift parser adds.

@Test func authCallback() {
    #expect(DeepLink.parse("zerosoft://auth/callback?code=\(code)&state=\(state)") == .auth(code: code, state: state))
    #expect(DeepLink.parse("ZEROSOFT://AUTH/callback?code=\(code)&state=\(state)") == .auth(code: code, state: state))
    #expect(DeepLink.parse("zerosoft://auth/callback/?code=\(code)&state=\(state)") == .auth(code: code, state: state))
    let bad = [
        "zerosoft://auth/callback?code=short&state=\(state)",
        "zerosoft://auth/callback?code=\(code)&state=short",
        "zerosoft://auth/other?code=\(code)&state=\(state)",
        "zerosoft://user:pw@auth/callback?code=\(code)&state=\(state)",
        "zerosoft://auth:99/callback?code=\(code)&state=\(state)",
        "https://auth/callback?code=\(code)&state=\(state)",
        "zerosoft://auth/callback?code=\(code)%3Cscript%3E&state=\(state)",
        "zerosoft://auth/callback?code=\(code)",
        "zerosoft://auth/callback?code=\(code)&state=\(state)&state=\(state)x",
        "zerosoft://auth/callback?code=\(code)&state=\(state)&next=/app",
        "zerosoft://auth/callback?code=\(code)&state=\(state) ",
        "zerosoft://auth/callback?code=\(String(repeating: "a", count: 201))&state=\(state)",
    ]
    for raw in bad { #expect(DeepLink.parse(raw) == nil, "\(raw)") }
}

@Test func openOnlyAppPages() {
    #expect(DeepLink.parse("zerosoft://open?path=/app/talk") == .open(path: "/app/talk"))
    #expect(DeepLink.parse("zerosoft://open/app/voice?new=1") == .open(path: "/app/voice?new=1"))
    #expect(DeepLink.parse("zerosoft://open?path=/es/app/crm") == .open(path: "/es/app/crm"))
    #expect(DeepLink.parse("zerosoft://open?path=%2Fapp%2Fdocs") == .open(path: "/app/docs"))
    #expect(DeepLink.parse("zerosoft://open?path=/app") == .open(path: "/app"))
    let bad = [
        "zerosoft://open?path=//evil.com/app",
        "zerosoft://open?path=%2F%2Fevil.com%2Fapp",
        "zerosoft://open?path=https://evil.com/app",
        "zerosoft://open?path=/blog",
        "zerosoft://open?path=/apple",
        "zerosoft://open?path=/fr/app",
        "zerosoft://open?path=/app/../x",
        "zerosoft://open?path=/app/%2e%2e/blog",
        "zerosoft://open?path=/app/%252e%252e/blog",
        "zerosoft://open?path=/app\\..\\x",
        "zerosoft://open?path=/app/x%0Ay",
        "zerosoft://open?path=/app&path=//evil.com",
        "zerosoft://open?path=/app&next=//evil.com",
        "zerosoft://open?url=https://evil.com",
        "zerosoft://open",
        "zerosoft://open//evil.com/app",
        "zerosoft://evil.com/app",
        "zerosoft:open?path=/app",
        "zerosoft://nope",
        "javascript://open?path=/app",
        "zerosoft://open?path=/app/" + String(repeating: "x", count: 600),
    ]
    for raw in bad { #expect(DeepLink.parse(raw) == nil, "\(raw)") }
}

@Test func targetStaysOnTheServer() {
    #expect(DeepLink.target(for: "/app/talk", server: server)?.absoluteString == "https://zerosoft.ai/app/talk")
    #expect(DeepLink.target(for: "/es/app/crm?x=1#y", server: server)?.absoluteString == "https://zerosoft.ai/es/app/crm?x=1#y")
    #expect(DeepLink.target(for: "/app/x", server: "http://127.0.0.1:3000")?.absoluteString == "http://127.0.0.1:3000/app/x")
    // An @ in the path is still a path of the server.
    #expect(DeepLink.target(for: "/app/x@evil.com", server: server).map { Server.origin(of: $0) } == server)
    #expect(DeepLink.target(for: "/app@evil.com", server: server) == nil)
    for bad in ["//evil.com/app", "/blog", "app/x", "/app/../../x", "https://evil.com/app"] {
        #expect(DeepLink.target(for: bad, server: server) == nil, "\(bad)")
    }
}

// MARK: Badge

@Test func badgeParsing() throws {
    let json = """
    {"total": 7, "talk": 2, "bell": 5, "now": "2026-11-22T10:00:00.123Z",
     "notifications": [
       {"id": "a", "title": "Ana · #general", "body": "the message text", "href": "/app/talk/c/1"},
       {"id": "b", "title": "", "body": null, "href": "https://evil.com/app"},
       {"id": "", "title": "no id"},
       {"id": "c", "title": "Line\\nbreak", "href": "/es/app/crm/r/2"},
       {"id": "d", "title": "x"}, {"id": "e", "title": "x"}, {"id": "f", "title": "x"}, {"id": "g", "title": "x"}
     ]}
    """
    let update = try #require(Badge.parse(Data(json.utf8)))
    #expect(update.total == 7)
    #expect(update.now == "2026-11-22T10:00:00.123Z")
    #expect(update.notifications.count == Badge.maxNotifications)
    #expect(update.notifications[0] == BadgeNotification(id: "a", title: "Ana · #general", path: "/app/talk/c/1"))
    // No title: the app name. A foreign href: no path.
    #expect(update.notifications[1] == BadgeNotification(id: "b", title: "zerosoft", path: nil))
    #expect(update.notifications[2] == BadgeNotification(id: "c", title: "Linebreak", path: "/es/app/crm/r/2"))

    #expect(Badge.parse(Data("[]".utf8)) == nil)
    #expect(Badge.parse(Data("not json".utf8)) == nil)
    let odd = try #require(Badge.parse(Data(#"{"total": -4, "now": "yesterday", "notifications": "x"}"#.utf8)))
    #expect(odd.total == 0 && odd.now == nil && odd.notifications.isEmpty)
}

@Test func badgeNeverCarriesTheBody() {
    // BadgeNotification has no field for it: the poll cannot show message contents.
    let labels = Mirror(reflecting: BadgeNotification(id: "a", title: "t", path: nil)).children.compactMap(\.label)
    #expect(labels == ["id", "title", "path"])
}

@Test func badgeLabelAndURL() {
    #expect(Badge.label(0) == "" && Badge.label(-1) == "")
    #expect(Badge.label(5) == "5" && Badge.label(99) == "99" && Badge.label(100) == "99+")
    #expect(Badge.requestURL(server: server, since: nil)?.absoluteString == "https://zerosoft.ai/api/desktop/badge")
    #expect(Badge.requestURL(server: server, since: "2026-11-22T10:00:00.123Z")?.absoluteString
        == "https://zerosoft.ai/api/desktop/badge?since=2026-11-22T10:00:00.123Z")
    // A `since` that is not a time is not sent.
    #expect(Badge.requestURL(server: server, since: "x&y=1")?.absoluteString == "https://zerosoft.ai/api/desktop/badge")
}

@Test func badgeNotificationsToShow() {
    let items = [BadgeNotification(id: "a", title: "A", path: nil), BadgeNotification(id: "b", title: "B", path: nil)]
    let update = BadgeUpdate(total: 2, notifications: items, now: nil)
    // First poll of a session: nothing old is repeated.
    #expect(Badge.toShow(update, since: nil, appActive: false, seen: []).isEmpty)
    // In front: the page shows them.
    #expect(Badge.toShow(update, since: "t", appActive: true, seen: []).isEmpty)
    #expect(Badge.toShow(update, since: "t", appActive: false, seen: ["a"]).map(\.id) == ["b"])
    #expect(PageNotification.shouldShow(appActive: false) && !PageNotification.shouldShow(appActive: true))
}
