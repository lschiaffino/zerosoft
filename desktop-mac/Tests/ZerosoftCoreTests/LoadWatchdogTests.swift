import Foundation
import Testing
@testable import ZerosoftCore

@Test func loadsAndPaints() {
    var w = LoadWatchdog()
    #expect(w.overlay == .loading)
    #expect(w.handle(.started) == [.schedule(.load, after: 10, generation: 1)])
    #expect(w.handle(.finished) == [.checkPaint(after: 0, generation: 1), .schedule(.paint, after: 5, generation: 1)])
    #expect(w.overlay == .loading)
    // Empty body: poll again until the paint deadline.
    #expect(w.handle(.paint(hasContent: false, generation: 1)) == [.checkPaint(after: 0.5, generation: 1)])
    #expect(w.handle(.paint(hasContent: true, generation: 1)) == [])
    #expect(w.phase == .shown && w.overlay == .none && w.painted)
    // Stale timers of that navigation do nothing.
    _ = w.handle(.timer(.load, generation: 1))
    _ = w.handle(.timer(.paint, generation: 1))
    #expect(w.overlay == .none)
}

@Test func timeoutShowsErrorAndSlowPageStillReplacesIt() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.timer(.load, generation: 1))
    #expect(w.overlay == .error(.timeout))
    // The page was only slow.
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 1))
    #expect(w.overlay == .none)
}

@Test func failedNavigationShowsError() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.failed(.unreachable))
    #expect(w.phase == .failed && w.overlay == .error(.unreachable))
    // A later, more precise reason replaces the first.
    _ = w.handle(.failed(.offline))
    #expect(w.overlay == .error(.offline))
}

@Test func blankPageShowsError() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: false, generation: 1))
    _ = w.handle(.timer(.paint, generation: 1))
    #expect(w.overlay == .error(.blank))
    // A late paint result of that check does not hide the error.
    _ = w.handle(.paint(hasContent: true, generation: 1))
    #expect(w.overlay == .error(.blank))
}

@Test func retryReloadsAndRecovers() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.failed(.unreachable))
    #expect(w.handle(.retry) == [.reload])
    #expect(w.overlay == .loading)
    #expect(w.handle(.started) == [.schedule(.load, after: 10, generation: 2)])
    _ = w.handle(.timer(.load, generation: 1)) // the first navigation's timer
    #expect(w.overlay == .loading)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 2))
    #expect(w.overlay == .none)
}

@Test func laterNavigationKeepsThePageVisible() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 1))
    _ = w.handle(.started)
    #expect(w.overlay == .none)
    _ = w.handle(.failed(.offline))
    #expect(w.overlay == .error(.offline))
    #expect(!w.painted)
}

@Test func crashReloadsOnceThenStays() {
    var w = LoadWatchdog()
    let t0 = Date(timeIntervalSince1970: 1_000)
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 1))
    #expect(w.handle(.terminated(at: t0)) == [.reload])
    #expect(w.overlay == .loading && !w.painted)
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 2))
    #expect(w.handle(.terminated(at: t0.addingTimeInterval(30))) == [])
    #expect(w.overlay == .error(.crashed))
    // Retry still works after the second crash.
    #expect(w.handle(.retry) == [.reload])
}

@Test func crashesFarApartReloadEachTime() {
    var w = LoadWatchdog()
    let t0 = Date(timeIntervalSince1970: 1_000)
    #expect(w.handle(.terminated(at: t0)) == [.reload])
    #expect(w.handle(.terminated(at: t0.addingTimeInterval(61))) == [.reload])
}

@Test func backOnlineRetriesOnlyOffline() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.failed(.offline))
    #expect(w.handle(.networkAvailable) == [.reload])
    var v = LoadWatchdog()
    _ = v.handle(.started)
    _ = v.handle(.failed(.blank))
    #expect(v.handle(.networkAvailable) == [])
    var shown = LoadWatchdog()
    #expect(shown.handle(.networkAvailable) == [])
}

@Test func failureClassification() {
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -999) == nil)
    #expect(LoadFailure.from(domain: "WebKitErrorDomain", code: 102) == nil)
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -1009) == .offline)
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -1004) == .unreachable)
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -1003) == .unreachable)
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -1001) == .timeout)
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -1202) == .secureConnection)
    #expect(LoadFailure.from(domain: "NSURLErrorDomain", code: -1011)?.code == "nsurl/-1011")
    #expect(LoadFailure.from(httpStatus: 502) == .server(status: 502))
    #expect(LoadFailure.from(httpStatus: 502)?.code == "http-502")
    #expect(LoadFailure.from(httpStatus: 404) == nil)
    #expect(LoadFailure.from(httpStatus: 200) == nil)
}

@Test func lockdownSetting() {
    #expect(LockdownSetting(raw: "on").webpagePreference == true)
    #expect(LockdownSetting(raw: "OFF").webpagePreference == false)
    #expect(LockdownSetting(raw: "system").webpagePreference == nil)
    #expect(LockdownSetting(raw: nil) == .system)
    #expect(LockdownSetting(raw: "maybe") == .system)
}
