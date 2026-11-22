import XCTest

/// The window shows the server page or the native error view, never nothing. CI runs this suite
/// twice (docs/desktop-swift.md, section 3.5): with `ZS_LOCKDOWN=off` and `ZS_LOCKDOWN=on`
/// (`TEST_RUNNER_ZS_LOCKDOWN` in xcodebuild), and every launch without an explicit mode uses it.
final class MainWindowUITests: XCTestCase {
    /// The Lockdown mode of this run: on or off (off when unset, as on a developer's Mac).
    static let mode: String = {
        let raw = ProcessInfo.processInfo.environment["ZS_LOCKDOWN"]?.lowercased() ?? "off"
        return raw == "on" ? "on" : "off"
    }()

    private var server: FixtureServer!
    private var app: XCUIApplication?

    override func setUpWithError() throws {
        continueAfterFailure = false
        server = FixtureServer(port: try FixtureServer.freePort())
    }

    override func tearDownWithError() throws {
        app?.terminate()
        server.stop()
    }

    private func launch(lockdown: String? = nil, language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-server", server.origin,
            "-ZSUITest", "YES",
            "-AppleLanguages", "(\(language))",
            "-ApplePersistenceIgnoreState", "YES",
        ]
        app.launchArguments += ["-ZSLockdown", lockdown ?? Self.mode]
        app.launch()
        self.app = app
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Web content on macOS puts a text in the label, the title or the value depending on the
    /// role, so match any of them.
    private func showing(_ text: String) -> NSPredicate {
        NSPredicate(format: "label == %@ OR title == %@ OR value == %@", text, text, text)
    }

    private func text(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(showing(text)).firstMatch
    }

    private func link(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.links.matching(showing(text)).firstMatch
    }

    private func reason(_ app: XCUIApplication) -> String {
        let el = element(app, "zs-error-reason")
        return "\(el.label) \(el.value as? String ?? "")"
    }

    private func waitForExternal(_ app: XCUIApplication, hasPrefix prefix: String) {
        let label = element(app, "zs-test-external")
        let done = expectation(for: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String)?.hasPrefix(prefix) == true
        }, evaluatedWith: label)
        wait(for: [done], timeout: 10)
    }

    func testServerPageLoadsAndOnlyItsOriginStaysInside() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the server page did not show")
        XCTAssertFalse(element(app, "zs-error-view").exists)

        // Another origin goes to the browser and the page stays.
        link(app, "Other origin").click()
        waitForExternal(app, hasPrefix: "\(server.otherOrigin)/elsewhere")
        XCTAssertTrue(text(app, "zs-fixture-ok").exists)

        // The server's own origin loads inside.
        link(app, "Same origin").click()
        XCTAssertTrue(text(app, "zs-fixture-second").waitForExistence(timeout: 15))
    }

    /// A navigation the policy cancels over a drawn page never ends in a false timeout: a start
    /// route redirecting to another origin (OAuth), a download, window.open() without a URL.
    func testCancelledNavigationsKeepThePage() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))

        link(app, "Connect demo").click()
        waitForExternal(app, hasPrefix: "\(server.otherOrigin)/provider/authorize")

        link(app, "Download report").click()
        waitForExternal(app, hasPrefix: "\(server.origin)/files/report.csv")

        app.buttons.matching(showing("Open blank")).firstMatch.click()

        // Past the 10 s load timeout: still the page, no error view.
        XCTAssertFalse(element(app, "zs-error-view").waitForExistence(timeout: 12), reason(app))
        XCTAssertTrue(text(app, "zs-fixture-ok").exists)
    }

    func testUnreachableServerShowsNativeErrorAndRetryRecovers() throws {
        let app = launch()
        XCTAssertTrue(element(app, "zs-error-view").waitForExistence(timeout: 20), "no native error view")
        XCTAssertTrue(app.buttons["zs-retry"].exists)
        XCTAssertTrue(app.buttons["zs-open-browser"].exists)
        XCTAssertTrue(reason(app).contains("unreachable"), reason(app))

        app.buttons["zs-open-browser"].click()
        waitForExternal(app, hasPrefix: server.origin)

        try server.start()
        app.buttons["zs-retry"].click()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "Retry did not load the page")
        XCTAssertFalse(element(app, "zs-error-view").exists)
    }

    func testPageThatDrawsNothingShowsNativeError() throws {
        server.mode = .blank
        try server.start()
        let app = launch(language: "es")
        XCTAssertTrue(element(app, "zs-error-view").waitForExistence(timeout: 25))
        XCTAssertTrue(reason(app).contains("blank"), reason(app))
        // Localized: the Spanish label of Retry.
        XCTAssertEqual(app.buttons["zs-retry"].title.isEmpty ? app.buttons["zs-retry"].label : app.buttons["zs-retry"].title, "Reintentar")
    }

    func testPageThatNeverFinishesShowsNativeError() throws {
        server.mode = .hang
        try server.start()
        let app = launch()
        XCTAssertTrue(element(app, "zs-error-view").waitForExistence(timeout: 30))
        XCTAssertTrue(reason(app).contains("timeout"), reason(app))
    }

    /// The run's Lockdown mode reached WebKit: with `on` the restrictions are active (the page's
    /// own probe and the bridge `ready` report agree), with `off` they are not. Without this the
    /// `on` run could pass with a no-op switch.
    func testRestrictionsMatchTheLockdownMode() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the page did not show (Lockdown \(Self.mode))")
        XCTAssertFalse(element(app, "zs-error-view").exists)
        let line = featureLine(app)
        let ready = readyLine(app)
        if Self.mode == "on" {
            // Section 3.1. Measured on macos-15: WebAssembly, IndexedDB, WebRTC, Web Audio and
            // Notification go; service workers stay with the per-web-view switch. getUserMedia is
            // absent in both modes here (no camera entitlement yet), so it proves nothing.
            XCTAssertTrue(line.contains("wasm=undefined"), "Lockdown restrictions not active: \(line)")
            for gone in ["wasm", "idb", "rtc", "audio", "notification"] {
                XCTAssertTrue(ready.contains("\(gone)=false"), "\(gone) still on with Lockdown: \(ready)")
            }
        } else {
            XCTAssertTrue(line.contains("wasm=object"), line)
            for on in ["wasm", "idb", "rtc", "audio", "notification"] {
                XCTAssertTrue(ready.contains("\(on)=true"), "\(on) off without Lockdown: \(ready)")
            }
        }
        XCTAssertFalse(ready.contains("content=0 "), "the page reported no content: \(ready)")
    }

    /// `-ZSLockdown system` leaves WebKit's default. On a runner without system Lockdown Mode
    /// that is no restrictions. Section 3.2 expects the same with system Lockdown Mode on, which
    /// CI cannot turn on (it needs a restart and a person).
    func testSystemModeKeepsTheWebKitDefault() throws {
        try XCTSkipIf(Self.mode == "on", "runs once, in the off run")
        try server.start()
        let app = launch(lockdown: "system")
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        let ready = readyLine(app)
        XCTAssertTrue(ready.contains("wasm=true"), ready)
        let bridge = bridgeLine(app)
        XCTAssertTrue(bridge.contains(":lockdown=false:system "), bridge)
    }

    /// What the offline code of the web app does (open IndexedDB, register a service worker) and
    /// a web font: in both modes the page still draws, and with Lockdown on the storage APIs are
    /// absent, never an error that blanks the page.
    func testOfflineFeaturesAndWebFontsDegradeWithoutBlanking() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        XCTAssertTrue(text(app, "zs-font-text").exists, "text in a web font did not show")
        let attempts = line(app, prefix: "attempts idb=")
        let fonts = line(app, prefix: "fonts status=")
        if Self.mode == "on" {
            // IndexedDB is gone (not a thrown error); the service worker still registers
            // (measured on macos-15). On macos-15 the web font is refused ("fonts status=error",
            // attached) and the text falls back to a system font, as section 3.3 expects.
            XCTAssertTrue(attempts.contains("idb=absent"), attempts)
            XCTAssertFalse(attempts.contains("=threw"), attempts)
            XCTAssertFalse(fonts.isEmpty)
        } else {
            XCTAssertTrue(attempts.contains("idb=opened"), attempts)
            XCTAssertTrue(fonts.contains("status=loaded"), "the fixture font did not load: \(fonts)")
        }
        // Past the paint deadline: still the page.
        XCTAssertFalse(element(app, "zs-error-view").waitForExistence(timeout: 6), reason(app))
    }

    /// The bridge answers the server's main frame and refuses everything else: an unknown
    /// command, an oversize or mistyped message, a command without a native side yet, and any
    /// frame (another origin, the same origin, a sandboxed one).
    func testBridgeAnswersOnlyTheServerMainFrame() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        let lockdown = Self.mode == "on" ? "true" : "false"

        let bridge = bridgeLine(app)
        XCTAssertTrue(bridge.contains("info=ok:darwin:store=false:lockdown=\(lockdown):\(Self.mode) "), bridge)
        XCTAssertTrue(bridge.contains("unknown=denied:unknownCommand "), bridge)
        XCTAssertTrue(bridge.contains("oversize=denied:tooLarge "), bridge)
        XCTAssertTrue(bridge.contains("badargs=denied:badArgs "), bridge)
        XCTAssertTrue(bridge.contains("unimplemented=denied:unavailable "), bridge)
        XCTAssertTrue(bridge.contains("malformed=denied:malformed "), bridge)
        XCTAssertTrue(bridge.contains("frozen=true "), bridge)
        XCTAssertTrue(bridge.contains("fields=darwin,false,\(lockdown) "), bridge)

        // Frames: refused by the native origin check, or not even given the handler. Never
        // answered, and the bridge object is never defined in them.
        var refused = 0
        for who in ["other", "same", "sandboxed"] {
            let frame = line(app, prefix: "frame-\(who)=")
            XCTAssertFalse(frame.contains("=allowed"), frame)
            XCTAssertTrue(frame.contains("bridge=false"), frame)
            if frame.contains("=denied:origin") {
                refused += 1
            } else {
                XCTAssertTrue(frame.contains("=nohandler"), frame)
            }
        }

        // The native side counted each refusal under its reason.
        let native = element(app, "zs-test-bridge")
        let origin = refused == 0 ? "" : "origin=\(refused) "
        let want = "rejected \(origin)malformed=1 tooLarge=1 unknownCommand=1 badArgs=1 unavailable=1 end"
        let done = expectation(for: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String) == want
        }, evaluatedWith: native)
        wait(for: [done], timeout: 10)
        attach("bridge native", (native.value as? String) ?? "")
    }

    // MARK: Block 3: sign-in, deep links, notifications, badge

    /// A native test label's value once it matches.
    private func waitForLabel(_ app: XCUIApplication, _ id: String, equals want: String, timeout: TimeInterval = 15) {
        let label = element(app, id)
        let done = expectation(for: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String) == want
        }, evaluatedWith: label)
        wait(for: [done], timeout: timeout)
        attach(id, (label.value as? String) ?? "")
    }

    private func openLink(_ app: XCUIApplication, _ raw: String) throws {
        guard #available(macOS 13.3, *) else { throw XCTSkip("XCUIApplication.open needs macOS 13.3") }
        app.open(URL(string: raw)!)
    }

    /// The page finds the app the way the web app does (`desktopBridge()` checks `startLogin`),
    /// and the Notification shim is there in both Lockdown modes.
    func testWebAppDetectsTheAppAndItsCapabilities() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        let detect = line(app, prefix: "detect ")
        XCTAssertTrue(detect.contains("startLogin=function notification=function permission=granted settingsWindow=false end"), detect)
    }

    /// Google sign-in end to end against the fixture's copy of the server flow: PKCE challenge
    /// and state out, the callback checked, code and verifier exchanged, the session cookie in
    /// the web view (sent to the server, not readable by the page), then the app page and the
    /// badge poll with that session.
    func testGoogleSignInWithPKCE() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        app.buttons.matching(showing("Sign in with Google")).firstMatch.click()
        waitForLabel(app, "zs-test-login", equals: "login 1 ok")
        XCTAssertEqual(server.tokenRequests, ["ok"], "the verifier did not match the challenge")
        let page = line(app, prefix: "app path=")
        XCTAssertTrue(page.contains("app path=/app session=yes jscookie=no end"), page)
        waitForLabel(app, "zs-test-badge", equals: "badge 3")
    }

    /// A callback whose state is not the one the app sent is refused before any token request.
    func testSignInWithAnotherStateIsRefused() throws {
        server.loginState = .wrong
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        app.buttons.matching(showing("Sign in with Google")).firstMatch.click()
        waitForLabel(app, "zs-test-login", equals: "login 1 state")
        XCTAssertEqual(server.tokenRequests, [])
        XCTAssertTrue(text(app, "zs-fixture-ok").exists)
    }

    /// `zerosoft://open` shows an app page of the configured server and nothing else: a path
    /// that would leave the server is refused, and a sign-in callback that the app did not ask
    /// for through its sign-in window is ignored (no token request).
    func testDeepLinksOpenOnlyAppPagesOfTheServer() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))

        try openLink(app, "zerosoft://open?path=//localhost:\(server.port)/app")
        waitForLabel(app, "zs-test-deeplink", equals: "link 1 refused")
        try openLink(app, "zerosoft://open?path=/blog")
        waitForLabel(app, "zs-test-deeplink", equals: "link 2 refused")
        try openLink(app, "zerosoft://auth/callback?code=\(String(repeating: "c", count: 43))&state=\(String(repeating: "S", count: 32))")
        waitForLabel(app, "zs-test-deeplink", equals: "link 3 ignored auth")
        XCTAssertEqual(server.tokenRequests, [])
        XCTAssertTrue(text(app, "zs-fixture-ok").exists, "a refused link changed the page")

        try openLink(app, "zerosoft://open?path=/app/deep")
        waitForLabel(app, "zs-test-deeplink", equals: "link 4 open /app/deep")
        let page = line(app, prefix: "app path=")
        XCTAssertTrue(page.contains("app path=/app/deep "), page)
    }

    /// `new Notification(...)` in the page reaches the native side through the shim, with the
    /// page's own title and body; with the app in front it is not shown.
    func testNotificationShimCallsNative() throws {
        try server.start()
        let app = launch()
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20))
        app.buttons.matching(showing("Notify")).firstMatch.click()
        waitForLabel(app, "zs-test-notify", equals: "notify zs-note|zs-body|app-active")
    }

    /// The page's feature line ("features wasm=... idb=... end"), attached to the result.
    private func featureLine(_ app: XCUIApplication) -> String {
        line(app, prefix: "features ")
    }

    /// The page's bridge line, once every call has answered.
    private func bridgeLine(_ app: XCUIApplication) -> String {
        line(app, prefix: "bridge info=")
    }

    /// What the bridge `ready` message reported (the native test label).
    private func readyLine(_ app: XCUIApplication) -> String {
        let label = element(app, "zs-test-ready")
        let done = expectation(for: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String)?.hasPrefix("ready ") == true
        }, evaluatedWith: label)
        wait(for: [done], timeout: 15)
        let value = (label.value as? String) ?? ""
        attach("bridge ready", value)
        return value
    }

    /// A text of the page that starts with `prefix` and ends in " end" (the page writes it when
    /// its async checks are done), attached to the result.
    private func line(_ app: XCUIApplication, prefix: String) -> String {
        let match = app.staticTexts
            .matching(NSPredicate { obj, _ in
                // value can be a number for some elements: compare strings only.
                guard let el = obj as? XCUIElementAttributes else { return false }
                let texts = [el.label, (el.value as? String) ?? ""]
                return texts.contains { $0.hasPrefix(prefix) && $0.hasSuffix(" end") }
            }).firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 15), "no '\(prefix)' line in the page")
        let text = "\(match.label) \((match.value as? String) ?? "")"
        attach(prefix.trimmingCharacters(in: .whitespaces), text)
        return text
    }

    private func attach(_ name: String, _ text: String) {
        let note = XCTAttachment(string: "lockdown=\(Self.mode) \(text)")
        note.name = name
        note.lifetime = .keepAlways
        add(note)
    }
}
