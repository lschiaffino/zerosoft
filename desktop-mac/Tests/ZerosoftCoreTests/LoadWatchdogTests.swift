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
    #expect(w.handle(.retry) == [.reload, .schedule(.load, after: 10, generation: 2)])
    #expect(w.overlay == .loading)
    #expect(w.handle(.started) == [.schedule(.load, after: 10, generation: 3)])
    _ = w.handle(.timer(.load, generation: 1)) // the first navigation's timer
    _ = w.handle(.timer(.load, generation: 2)) // the retry's timer
    #expect(w.overlay == .loading)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 3))
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
    #expect(w.handle(.terminated(at: t0)) == [.reload, .schedule(.load, after: 10, generation: 2)])
    #expect(w.overlay == .loading && !w.painted)
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 3))
    #expect(w.handle(.terminated(at: t0.addingTimeInterval(30))) == [])
    #expect(w.overlay == .error(.crashed))
    // Retry still works after the second crash.
    #expect(w.handle(.retry).first == .reload)
}

@Test func crashesFarApartReloadEachTime() {
    var w = LoadWatchdog()
    let t0 = Date(timeIntervalSince1970: 1_000)
    #expect(w.handle(.terminated(at: t0)).first == .reload)
    #expect(w.handle(.terminated(at: t0.addingTimeInterval(61))).first == .reload)
}

@Test func backOnlineRetriesOnlyOffline() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.failed(.offline))
    #expect(w.handle(.networkAvailable) == [.reload, .schedule(.load, after: 10, generation: 2)])
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

/// Every load the app starts itself has a timer: if `didStartProvisionalNavigation` never comes,
/// the spinner still turns into the error view.
@Test func loadsWithoutAStartStillTimeOut() {
    var w = LoadWatchdog()
    #expect(w.handle(.loadRequested) == [.reload, .schedule(.load, after: 10, generation: 1)])
    _ = w.handle(.timer(.load, generation: 1))
    #expect(w.overlay == .error(.timeout))
    let effects = w.handle(.retry)
    #expect(effects == [.reload, .schedule(.load, after: 10, generation: 2)])
    #expect(w.overlay == .loading)
    _ = w.handle(.timer(.load, generation: 2))
    #expect(w.overlay == .error(.timeout))
    // Same after a crash reload and after the network comes back.
    var c = LoadWatchdog()
    let crash = c.handle(.terminated(at: Date(timeIntervalSince1970: 0)))
    guard case let .schedule(.load, _, gen)? = crash.last else { Issue.record("no timer after crash"); return }
    _ = c.handle(.timer(.load, generation: gen))
    #expect(c.overlay == .error(.timeout))
}

/// A navigation cancelled over a drawn page (a redirect to another origin opened in the browser,
/// a download, -999, WebKit 102/204) goes back to the page instead of a timeout error.
@Test func cancelledNavigationKeepsTheDrawnPage() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 1))
    _ = w.handle(.started)
    _ = w.handle(.cancelled)
    #expect(w.phase == .shown && w.overlay == .none)
    _ = w.handle(.timer(.load, generation: 2))
    #expect(w.overlay == .none)
}

@Test func cancelledFirstLoadStillEndsInTheErrorView() {
    var w = LoadWatchdog()
    _ = w.handle(.loadRequested)
    _ = w.handle(.started)
    _ = w.handle(.cancelled)
    #expect(w.overlay == .loading)
    _ = w.handle(.timer(.load, generation: 2))
    #expect(w.overlay == .error(.timeout))
}

@Test func cancelAfterAServerErrorKeepsTheError() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.finished)
    _ = w.handle(.paint(hasContent: true, generation: 1))
    _ = w.handle(.started)
    _ = w.handle(.failed(.server(status: 502)))
    _ = w.handle(.cancelled) // the WebKit 102 that follows our cancel
    #expect(w.overlay == .error(.server(status: 502)))
}

@Test func bridgeReadyIsTheSecondPaintSignal() {
    // ready with content before didFinish: the page shows as soon as it finishes.
    var w = LoadWatchdog()
    _ = w.handle(.started)
    #expect(w.handle(.ready(hasContent: true)) == [])
    #expect(w.overlay == .loading)
    #expect(w.handle(.finished) == [])
    #expect(w.phase == .shown && w.overlay == .none && w.painted)

    // ready after didFinish while the paint check polls.
    var v = LoadWatchdog()
    _ = v.handle(.started)
    _ = v.handle(.finished)
    _ = v.handle(.ready(hasContent: true))
    #expect(v.overlay == .none)
}

@Test func bridgeReadyWithoutContentDoesNotHideABlankPage() {
    var w = LoadWatchdog()
    _ = w.handle(.started)
    _ = w.handle(.ready(hasContent: false))
    #expect(w.handle(.finished).count == 2)
    _ = w.handle(.ready(hasContent: false))
    _ = w.handle(.timer(.paint, generation: 1))
    #expect(w.overlay == .error(.blank))
    // A ready seen for one navigation does not carry over to the next.
    var v = LoadWatchdog()
    _ = v.handle(.started)
    _ = v.handle(.ready(hasContent: true))
    _ = v.handle(.started)
    #expect(v.handle(.finished).count == 2)
    #expect(v.phase == .checkingPaint)
    // Nor does it lift an error view.
    var e = LoadWatchdog()
    _ = e.handle(.started)
    _ = e.handle(.failed(.unreachable))
    _ = e.handle(.ready(hasContent: true))
    #expect(e.overlay == .error(.unreachable))
}
