import Foundation
import Testing
@testable import ZerosoftCore

// Port of the tests in desktop/src-tauri/src/session.rs, plus the checks a restored session.json
// goes through (block 4 of docs/desktop-swift.md).

private let server = "https://zerosoft.ai"
private let main = TabSession.main

private func one() -> (TabSession, Int) {
    var s = TabSession(server: server)
    let (label, id) = s.newWindow("/app/track")!
    #expect(label == main)
    return (s, id)
}

private func paths(_ s: TabSession, _ label: String) -> [String] {
    s.window(label)?.tabs.map(\.path) ?? []
}

private func json(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

@Test func pathsAndProducts() {
    #expect(TabSession.allowedPath("/app/track/issue/ZS-1?view=x#c", server: server))
    #expect(TabSession.allowedPath("/", server: server))
    for bad in ["", "app", "//evil.com/app", "/app\\x", "/app/\n", "/app/a b", "https://evil.com/app"] {
        #expect(!TabSession.allowedPath(bad, server: server), "\(bad)")
    }
    #expect(TabSession.product(of: "/app/track/issue/1") == "track")
    #expect(TabSession.product(of: "/es/app/crm?x=1") == "crm")
    #expect(TabSession.product(of: "/app") == "")
    #expect(TabSession.product(of: "/pricing") == "")
    #expect(TabSession.product(of: "/es") == "")
}

@Test func openAndPlace() {
    var (s, a) = one()
    let b = s.addTab(main, path: "/app/crm", place: .end)!
    #expect(s.activeOf(main) == b)
    s.activate(a, now: 1)
    // Cmd-click: next to the current one, behind.
    let c = s.addTab(main, path: "/app/docs", place: .background)!
    #expect(s.window(main)!.tabs.map(\.id) == [a, c, b])
    #expect(s.activeOf(main) == a)
    let d = s.addTab(main, path: "/app/talk", place: .next)!
    #expect(s.window(main)!.tabs[1].id == d)
    #expect(s.activeOf(main) == d)
    // A path that is not allowed becomes the home page.
    let e = s.addTab(main, path: "https://evil.com", place: .end)!
    #expect(s.get(e)!.path == TabSession.home)
    do { let r = s.addTab("nope", path: "/app", place: .end); #expect(r == nil) }
}

@Test func selectAndCycle() {
    var (s, a) = one()
    let b = s.addTab(main, path: "/app/crm", place: .end)!
    let c = s.addTab(main, path: "/app/docs", place: .end)!
    #expect(s.nth(main, 1) == a)
    #expect(s.nth(main, 2) == b)
    #expect(s.nth(main, 9) == c)
    #expect(s.nth(main, 5) == nil)
    #expect(s.nth(main, 0) == nil)
    #expect(s.cycle(main, 1) == a) // c to a, wrapping
    #expect(s.cycle(main, -1) == b)
    var single = TabSession(server: server)
    single.newWindow("/app")
    #expect(single.cycle(main, 1) == nil)
}

@Test func closeAndReopen() {
    var (s, a) = one()
    let b = s.addTab(main, path: "/app/crm", place: .end)!
    let c = s.addTab(main, path: "/app/docs", place: .end)!
    s.activate(b, now: 1)
    let first = s.closeTab(b)!
    #expect(first.window == main && first.next == c && !first.empty)
    // The one on the right; when it was the last, the one on the left.
    do { let r = s.closeTab(c); #expect(r!.next == a) }
    let (_, id) = s.reopen(fallback: main)!
    #expect(s.get(id)!.path == "/app/docs")
    let (_, id2) = s.reopen(fallback: main)!
    #expect(paths(s, main) == ["/app/track", "/app/crm", "/app/docs"])
    #expect(s.activeOf(main) == id2)
    do { let r = s.reopen(fallback: main); #expect(r == nil) }
    let last = s.closeTab(a)!
    #expect(!last.empty)
}

@Test func windowsMoveAndDetach() {
    var (s, a) = one()
    let b = s.addTab(main, path: "/app/crm", place: .end)!
    // A window's only tab is not detached (it already is its window).
    let (l2, x) = s.newWindow("/app/talk")!
    #expect(l2 == "w1")
    do { let r = s.detach(x); #expect(r == nil) }
    let (from, l3, next) = s.detach(b)!
    #expect(from == main && next == a)
    #expect(s.window(l3)!.tabs.count == 1)
    #expect(s.windowOf(b) == l3)
    // Moving it back leaves its window empty.
    let back = s.moveTab(b, to: main, index: 0)!
    #expect(back.from == l3 && back.empty)
    #expect(s.window(main)!.tabs[0].id == b)
    // Reordering in the same window.
    s.moveTab(b, to: main, index: 5)
    #expect(s.window(main)!.tabs.last!.id == b)
    do { let r = s.moveTab(b, to: "nope", index: 0); #expect(r == nil) }
    // A closed window leaves its tabs for Cmd+Shift+T, in another window when its own is gone.
    s.removeWindow(l2)
    let (label, _) = s.reopen(fallback: main)!
    #expect(label == main)
}

@Test func caps() {
    var (s, _) = one()
    for _ in 1 ..< TabSession.maxTabs { #expect(s.addTab(main, path: "/app", place: .end) != nil) }
    do { let r = s.addTab(main, path: "/app", place: .end); #expect(r == nil) }
    for _ in 1 ..< TabSession.maxWindows { #expect(s.newWindow("/app") != nil) }
    do { let r = s.newWindow("/app"); #expect(r == nil) }
    for i in 0 ..< 40 {
        s.closeTab(s.window(main)!.tabs[0].id)
        #expect(s.closed.count <= TabSession.maxClosed, "\(i)")
    }
}

@Test func suspendCandidates() {
    var (s, a) = one()
    let b = s.addTab(main, path: "/app/crm", place: .end)!
    let c = s.addTab(main, path: "/app/talk", place: .end)!
    for id in [a, b, c] { s.update(id) { $0.loaded = true } }
    s.activate(a, now: 1000)
    s.activate(c, now: 2000)
    s.update(c) { $0.lastActive = 2000 }
    s.update(b) { $0.lastActive = 1000 }
    let min = 60_000.0 * 30
    // Never the one in front, never the one recording.
    #expect(s.discardable(now: 1500 + min) == [b])
    #expect(s.discardable(now: 2000 + min) == [a, b])
    s.update(a) { $0.recording = true }
    #expect(s.discardable(now: 2000 + min) == [b])
    s.prefs.suspend = false
    s.update(a) { $0.recording = false }
    #expect(s.discardable(now: 10 * min).isEmpty)
}

@Test func unreadDots() {
    var (s, a) = one()
    let b = s.addTab(main, path: "/app/talk/c/1", place: .end)!
    s.activate(a, now: 1)
    do { let r = s.setUnread(["talk"], focused: main); #expect(r) }
    #expect(s.get(b)!.unread && !s.get(a)!.unread)
    // In front of the focused window: no dot.
    s.activate(b, now: 2)
    s.setUnread(["talk"], focused: main)
    #expect(!s.get(b)!.unread)
    do { let r = s.setUnread(["talk"], focused: main); #expect(!r) }
}

@Test func titlesAndPathsFromThePage() {
    var (s, a) = one()
    do { let r = s.setTitle(a, "  Deals · CRM · zerosoft\n"); #expect(r) }
    #expect(s.get(a)!.title == "Deals · CRM · zerosoft")
    do { let r = s.setTitle(a, "Deals · CRM · zerosoft"); #expect(!r) }
    #expect(TabSession.displayTitle(s.get(a)!, fallback: "New tab") == "Deals · CRM")
    s.setTitle(a, String(repeating: "x", count: 500))
    #expect(s.get(a)!.title.count == TabSession.maxTitle)
    s.setTitle(a, "zerosoft")
    #expect(TabSession.displayTitle(s.get(a)!, fallback: "New tab") == "Track")
    s.setTitle(a, "")
    s.setPath(a, "/app")
    #expect(TabSession.displayTitle(s.get(a)!, fallback: "New tab") == "New tab")
    // The page cannot point a tab at another origin, an API route or a dot segment.
    for bad in ["//evil.com/x", "/api/desktop/login?x=1", "/app/../api/auth/signout", "/app/%2E%2E/blog", "/a b"] {
        do { let r = s.setPath(a, bad); #expect(!r, "\(bad)") }
    }
    #expect(s.get(a)!.path == "/app")
    do { let r = s.setPath(a, "/app/crm/deals?view=2#top"); #expect(r) }
}

// MARK: session.json

@Test func persistRoundTripKeepsPathsOnly() throws {
    var (s, _) = one()
    let b = s.addTab(main, path: "/app/crm/deals", place: .end)!
    s.setTitle(b, "Deals · CRM · zerosoft")
    let (l2, _) = s.newWindow("/app/talk", bounds: TabBounds(x: 10, y: 20, w: 900, h: 700))!
    s.addTab(l2, path: "/app/docs", place: .background)
    let data = s.encoded()
    let text = String(decoding: data, as: UTF8.self)
    // No titles, no hosts: the file holds paths, ids, labels, bounds and preferences.
    #expect(!text.contains("Deals ·"))
    #expect(!text.contains("zerosoft.ai"))
    #expect(!text.contains("title"))

    let back = TabSession.decode(data, server: server)
    #expect(back.windows.count == 2)
    #expect(paths(back, main) == ["/app/track", "/app/crm/deals"])
    let active = try #require(back.activeOf(main))
    #expect(back.get(active)?.path == "/app/crm/deals")
    #expect(back.get(active)?.title == "")
    #expect(back.window(l2)?.bounds?.w == 900)
    #expect(paths(back, l2) == ["/app/talk", "/app/docs"])
    #expect(back.get(back.activeOf(l2)!)?.path == "/app/talk")
    // Nothing is loaded by itself: the app loads the tab in front when it builds the window.
    #expect(back.allTabs.allSatisfy { !$0.loaded })
}

@Test func readsTheTauriSessionFile() {
    // What session.rs writes (titles included): the Swift app reads the paths and drops titles.
    let tauri: [String: Any] = [
        "version": 1,
        "windows": [
            ["label": "main", "active": 7, "bounds": NSNull(), "tabs": [
                ["id": 3, "path": "/app/crm", "title": "CRM · zerosoft"],
                ["id": 7, "path": "/es/app/track/issue/ZS-9", "title": "ZS-9"],
            ]],
        ],
        "prefs": ["suspend": true, "suspendMinutes": 60, "restore": true, "links": "window"],
    ]
    let s = TabSession.decode(json(tauri), server: server)
    #expect(s.summary == "main=/app/crm~,*/es/app/track/issue/ZS-9~")
    #expect(s.allTabs.allSatisfy { $0.title.isEmpty })
    #expect(s.prefs.suspendMinutes == 60 && s.prefs.links == .window)
}

/// A session file is outside the app's control between two launches: nothing in it may make a
/// tab load another origin, a scheme, an API route or a path the policy would not load.
@Test func restoreRefusesWhatTheAllowlistRefuses() {
    let raw: [String: Any] = ["windows": [
        ["label": "x", "active": 9, "tabs": [["id": 9, "path": "//evil.com"]]],
        ["label": "y", "active": 2, "bounds": ["x": 0, "y": 0, "w": 5, "h": 5], "tabs": [
            ["id": 1, "path": "/app/crm"],
            ["id": 2, "path": "javascript:alert(1)"],
            ["id": 3, "path": "https://evil.com/app"],
            ["id": 4, "path": "/\\evil.com"],
            ["id": 5, "path": "/api/desktop/login?challenge=x"],
            ["id": 6, "path": "/API/integrations/google/start"],
            ["id": 7, "path": "/app/../api/auth/signout"],
            ["id": 8, "path": "/app/%2e%2e/%2e%2e/api/x"],
            ["id": 10, "path": "/app/a b"],
            ["id": 11, "path": "/app/\u{0}x"],
            ["id": 12, "path": "/" + String(repeating: "a", count: 1001)],
            ["id": 13, "path": 42],
            ["id": 14],
            "nope",
        ]],
        "nope",
        ["label": "z", "tabs": "nope"],
    ], "prefs": ["suspendMinutes": 7, "links": "popup", "suspend": false, "restore": true]]
    let s = TabSession.decode(json(raw), server: server)
    // One window survives (the first one had no valid tab), renamed main, with one tab.
    #expect(s.windows.count == 1)
    #expect(s.windows[0].label == main)
    #expect(paths(s, main) == ["/app/crm"])
    // The tab in front was refused: the first kept tab is in front.
    #expect(s.get(s.activeOf(main)!)?.path == "/app/crm")
    // Implausible bounds are dropped (default size).
    #expect(s.windows[0].bounds == nil)
    var prefs = TabPrefs()
    prefs.suspend = false
    #expect(s.prefs == prefs)
    // Every kept tab resolves to the server origin.
    #expect(s.allTabs.allSatisfy { s.url(of: $0.id).map(Server.origin(of:)) == server })
}

@Test func restoreChecksAgainstTheConfiguredServer() {
    // The same file read by an app pointed at another server keeps the paths, on that server.
    var s = TabSession(server: server)
    s.newWindow("/app/crm")
    let local = TabSession.decode(s.encoded(), server: "http://localhost:3000")
    #expect(local.url(of: local.activeOf(main)!)?.absoluteString == "http://localhost:3000/app/crm")
}

@Test func restoreCapsAndGarbage() {
    let tabs = (0 ..< 100).map { ["id": $0, "path": "/app/t\($0)"] as [String: Any] }
    let wins = (0 ..< 30).map { ["label": "w\($0)", "active": 99, "tabs": tabs] as [String: Any] }
    let s = TabSession.decode(json(["windows": wins]), server: server)
    #expect(s.windows.count == TabSession.maxWindows)
    #expect(s.windows.allSatisfy { $0.tabs.count == TabSession.maxTabs })
    // Labels are made again: main, w1, w2...
    #expect(s.windows.map(\.label).prefix(3) == ["main", "w1", "w2"])
    // Ids are new and unique.
    #expect(Set(s.allTabs.map(\.id)).count == s.allTabs.count)

    for data in [nil, Data(), Data("not json".utf8), json([1, 2]), json(["windows": "x"]),
                 Data(repeating: 0x20, count: 1_000_001)] as [Data?] {
        let empty = TabSession.decode(data, server: server)
        #expect(empty.windows.isEmpty)
        #expect(empty.prefs == TabPrefs())
    }
    #expect(TabPrefs.parse(["suspendMinutes": true, "suspend": 1, "restore": "no"]) == TabPrefs())
}

@Test func withoutRestoreOnlyPreferences() {
    var (s, _) = one()
    s.setTitle(s.activeOf(main)!, "Deals")
    let saved = s.encoded()
    let off = TabSession.decode(json(["windows": (try! JSONSerialization.jsonObject(with: saved) as! [String: Any])["windows"]!,
                                      "prefs": ["restore": false]]), server: server)
    #expect(off.windows.isEmpty && !off.prefs.restore)
    // Without restore nothing about what was open is written either.
    s.prefs.restore = false
    let text = String(decoding: s.encoded(), as: UTF8.self)
    #expect(!text.contains("/app/track"))
    let root = try! JSONSerialization.jsonObject(with: s.encoded()) as! [String: Any]
    #expect((root["windows"] as? [Any])?.isEmpty == true)
    #expect((root["prefs"] as? [String: Any])?["restore"] as? Bool == false)
}
