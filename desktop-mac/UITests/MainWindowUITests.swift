import XCTest

/// Block 1: the window shows the server page or the native error view, never nothing.
final class MainWindowUITests: XCTestCase {
    private var server: FixtureServer!
    private var app: XCUIApplication?

    override func setUpWithError() throws {
        continueAfterFailure = false
        server = FixtureServer(port: FixtureServer.freePort())
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
        if let lockdown { app.launchArguments += ["-ZSLockdown", lockdown] }
        app.launch()
        self.app = app
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.staticTexts[label].firstMatch
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
        app.links["Other origin"].firstMatch.click()
        waitForExternal(app, hasPrefix: "\(server.otherOrigin)/elsewhere")
        XCTAssertTrue(text(app, "zs-fixture-ok").exists)

        // The server's own origin loads inside.
        app.links["Same origin"].firstMatch.click()
        XCTAssertTrue(text(app, "zs-fixture-second").waitForExistence(timeout: 15))
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

    /// Lockdown restrictions forced on (WKWebpagePreferences.isLockdownModeEnabled): the page
    /// still loads. Block 2 extends this to both modes and asserts the restrictions are active.
    func testPageLoadsWithLockdownOn() throws {
        try server.start()
        let app = launch(lockdown: "on")
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the page did not show with Lockdown on")
        let features = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'features'")).firstMatch
        if features.waitForExistence(timeout: 5) {
            let note = XCTAttachment(string: features.label)
            note.name = "web features with Lockdown on"
            note.lifetime = .keepAlways
            add(note)
            print("lockdown-on \(features.label)")
        }
    }
}
