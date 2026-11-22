import XCTest

/// Block 4 of docs/desktop-swift.md: tabs and windows. The shortcuts of docs/desktop-tabs.md,
/// links that open tabs and windows, and the session restored after a relaunch with only
/// allowed paths. The app writes its windows and tabs to a test label (`zs-test-tabs`,
/// `TabSession.summary`): `*` is the tab in front, `~` a tab without a web view yet.
final class TabsUITests: XCTestCase {
    private var server: FixtureServer!
    private var app: XCUIApplication?

    override func setUpWithError() throws {
        continueAfterFailure = false
        server = FixtureServer(port: try FixtureServer.freePort())
        try server.start()
    }

    override func tearDownWithError() throws {
        app?.terminate()
        server.stop()
    }

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-server", server.origin,
            "-ZSUITest", "YES",
            "-AppleLanguages", "(en)",
            "-ApplePersistenceIgnoreState", "YES",
            "-ZSStartPath", "/",
            "-ZSLockdown", MainWindowUITests.mode,
        ] + extra
        app.launch()
        self.app = app
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func showing(_ text: String) -> NSPredicate {
        NSPredicate(format: "label == %@ OR title == %@ OR value == %@", text, text, text)
    }

    private func text(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(showing(text)).firstMatch
    }

    private func link(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.links.matching(showing(text)).firstMatch
    }

    private func value(_ app: XCUIApplication, _ id: String) -> String {
        (element(app, id).value as? String) ?? ""
    }

    /// Waits until the app's windows and tabs are `want` ("main=*/,/app w1=*/app").
    private func waitTabs(_ app: XCUIApplication, _ want: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let label = element(app, "zs-test-tabs")
        let done = XCTNSPredicateExpectation(predicate: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String) == "tabs \(want) end"
        }, object: label)
        let result = XCTWaiter().wait(for: [done], timeout: timeout)
        XCTAssertEqual(result, .completed, "tabs are '\(value(app, "zs-test-tabs"))', want '\(want)'", file: file, line: line)
    }

    private func ready(_ app: XCUIApplication) {
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the server page did not show")
        waitTabs(app, "main=*/")
    }

    /// Cmd+T opens the home page at the end, Cmd+W closes the tab in front, Cmd+Shift+T brings
    /// it back in its place; the strip's + button and a click on a tab do the same as the keys;
    /// closing the last tab hides the window and Cmd+T shows it again.
    func testNewTabCloseTabAndReopen() throws {
        let app = launch()
        ready(app)
        // The strip shows the page's own title.
        let titled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "fixture"), object: element(app, "zs-tab-0"))
        XCTAssertEqual(XCTWaiter().wait(for: [titled], timeout: 10), .completed, element(app, "zs-tab-0").label)

        app.typeKey("t", modifierFlags: .command)
        waitTabs(app, "main=/,*/app")
        XCTAssertTrue(text(app, "zs-fixture-app").waitForExistence(timeout: 15), "the new tab did not load the home page")

        app.typeKey("w", modifierFlags: .command)
        waitTabs(app, "main=*/")
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 10), "the first tab is not in front")

        app.typeKey("t", modifierFlags: [.command, .shift])
        waitTabs(app, "main=/,*/app")

        // The strip: a click on the first tab, then its + button.
        element(app, "zs-tab-0").click()
        waitTabs(app, "main=*/,/app")
        element(app, "zs-new-tab").click()
        waitTabs(app, "main=/,/app,*/app")
        XCTAssertEqual("\(element(app, "zs-tab-2").value ?? "")", "1")
        XCTAssertEqual("\(element(app, "zs-tab-0").value ?? "")", "0")

        // Down to one tab, then the last Cmd+W hides the window and keeps its tab.
        app.typeKey("w", modifierFlags: .command)
        app.typeKey("w", modifierFlags: .command)
        waitTabs(app, "main=*/")
        app.typeKey("w", modifierFlags: .command)
        let strip = element(app, "zs-tab-strip")
        let hidden = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: strip)
        wait(for: [hidden], timeout: 10)
        waitTabs(app, "main=*/")
        // No window has the keyboard now: File > New Tab from the menu bar.
        app.menuBars.menuBarItems["File"].click()
        app.menuItems["New Tab"].click()
        XCTAssertTrue(strip.waitForExistence(timeout: 10), "New Tab did not show the window again")
        waitTabs(app, "main=/,*/app")
    }

    /// Cmd+1...Cmd+8 pick a tab, Cmd+9 the last; Ctrl+Tab and Ctrl+Shift+Tab wrap around, as do
    /// Cmd+Shift+] and Cmd+Shift+[.
    func testSelectByNumberAndCycle() throws {
        let app = launch()
        ready(app)
        app.typeKey("t", modifierFlags: .command)
        waitTabs(app, "main=/,*/app")
        app.typeKey("t", modifierFlags: .command)
        waitTabs(app, "main=/,/app,*/app")
        XCTAssertTrue(text(app, "zs-fixture-app").waitForExistence(timeout: 15))

        app.typeKey("1", modifierFlags: .command)
        waitTabs(app, "main=*/,/app,/app")
        app.typeKey("9", modifierFlags: .command)
        waitTabs(app, "main=/,/app,*/app")
        app.typeKey("2", modifierFlags: .command)
        waitTabs(app, "main=/,*/app,/app")
        // A number past the last tab does nothing.
        app.typeKey("5", modifierFlags: .command)
        app.typeKey(.tab, modifierFlags: .control)
        waitTabs(app, "main=/,/app,*/app")
        app.typeKey(.tab, modifierFlags: .control)
        waitTabs(app, "main=*/,/app,/app")
        app.typeKey(.tab, modifierFlags: [.control, .shift])
        waitTabs(app, "main=/,/app,*/app")
        app.typeKey("]", modifierFlags: [.command, .shift])
        waitTabs(app, "main=*/,/app,/app")
        app.typeKey("[", modifierFlags: [.command, .shift])
        waitTabs(app, "main=/,/app,*/app")
    }

    /// Cmd-click opens a tab behind, Cmd+Shift-click a tab in front, Cmd+Option-click a window;
    /// target=_blank of the server opens a tab next to the page, of another origin the browser.
    /// Cmd+N and Cmd+Shift+W open and close windows.
    func testLinksOpenTabsAndWindows() throws {
        let app = launch()
        ready(app)

        let two = link(app, "App two")
        XCUIElement.perform(withKeyModifiers: .command) { two.click() }
        waitTabs(app, "main=*/,/app/two")
        XCTAssertTrue(text(app, "zs-fixture-ok").exists, "Cmd-click changed the page in front")

        XCUIElement.perform(withKeyModifiers: [.command, .shift]) { two.click() }
        waitTabs(app, "main=/,*/app/two,/app/two")
        app.typeKey("1", modifierFlags: .command)
        waitTabs(app, "main=*/,/app/two,/app/two")

        link(app, "Blank same").click()
        waitTabs(app, "main=/,*/app/one,/app/two,/app/two")
        XCTAssertTrue(text(app, "zs-fixture-app").waitForExistence(timeout: 15))
        app.typeKey("1", modifierFlags: .command)
        waitTabs(app, "main=*/,/app/one,/app/two,/app/two")

        link(app, "Blank other").click()
        let external = element(app, "zs-test-external")
        let opened = expectation(for: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String)?.hasPrefix("\(self.server.otherOrigin)/blank-other") == true
        }, evaluatedWith: external)
        wait(for: [opened], timeout: 10)
        waitTabs(app, "main=*/,/app/one,/app/two,/app/two")

        XCUIElement.perform(withKeyModifiers: [.command, .option]) { two.click() }
        waitTabs(app, "main=*/,/app/one,/app/two,/app/two w1=*/app/two")

        app.typeKey("w", modifierFlags: [.command, .shift])
        waitTabs(app, "main=*/,/app/one,/app/two,/app/two")
        app.typeKey("n", modifierFlags: .command)
        waitTabs(app, "main=*/,/app/one,/app/two,/app/two w2=*/app")
        // Cmd+Shift+T brings back the tab of the closed window, in the window in front.
        app.typeKey("t", modifierFlags: [.command, .shift])
        waitTabs(app, "main=*/,/app/one,/app/two,/app/two w2=*/app/two,/app")

        // Nothing loaded another origin as a page of the app (the fixture's cross-origin iframe
        // is a frame inside the page, which the policy leaves to the page).
        XCTAssertFalse(server.requests.contains { $0.hasPrefix("localhost:") && !$0.contains("/frame?") }, server.requests.joined(separator: " "))
    }

    /// Quit and open again: the windows and tabs come back, only the tab in front of each window
    /// loads, the others load when picked.
    func testRestoreAfterRelaunch() throws {
        var app = launch()
        ready(app)
        XCUIElement.perform(withKeyModifiers: .command) { link(app, "App two").click() }
        waitTabs(app, "main=*/,/app/two")
        app.typeKey("t", modifierFlags: .command)
        waitTabs(app, "main=/,/app/two,*/app")
        app.typeKey("n", modifierFlags: .command)
        waitTabs(app, "main=/,/app/two,*/app w1=*/app")
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 15), "the app did not quit")

        // Only app pages are saved: the fixture's root page ("/") is not.
        app = launch(["-ZSKeepSession", "YES"])
        waitTabs(app, "main=/app/two~,*/app w1=*/app")
        XCTAssertTrue(text(app, "zs-fixture-app").waitForExistence(timeout: 20))
        // The first window has the keyboard; its first tab loads when picked.
        app.typeKey("1", modifierFlags: .command)
        waitTabs(app, "main=*/app/two,/app w1=*/app")
        let page = app.staticTexts.matching(NSPredicate(format: "value BEGINSWITH %@ OR label BEGINSWITH %@", "app path=/app/two ", "app path=/app/two ")).firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20), "the picked tab did not load its page")
    }

    /// A session file is outside the app's control between launches. Paths of another origin,
    /// schemes, API routes and dot segments are dropped before anything loads; a window left
    /// with no valid tab is dropped; nothing goes to the browser.
    func testRestoreKeepsOnlyAllowedPaths() throws {
        let other = "//localhost:\(server.port)"
        let session: [String: Any] = [
            "version": 1,
            "windows": [
                ["label": "main", "active": 4, "tabs": [
                    ["id": 1, "path": "\(other)/elsewhere"],
                    ["id": 2, "path": "/api/desktop/login?challenge=x&state=y&device=darwin"],
                    ["id": 3, "path": "/app/kept"],
                    ["id": 4, "path": "javascript:alert(1)"],
                    ["id": 5, "path": "http://localhost:\(server.port)/x"],
                    ["id": 6, "path": "/app/../api/integrations/demo/start"],
                    ["id": 8, "path": "/invite/tok_secret_value"],
                    ["id": 9, "path": "/app/kept?token=secret"],
                ]],
                ["label": "w1", "active": 7, "tabs": [["id": 7, "path": "\(other)/w1"]]],
            ],
            "prefs": ["restore": true],
        ]
        let data = try JSONSerialization.data(withJSONObject: session)
        let app = launch(["-ZSTestSession", data.base64EncodedString()])
        waitTabs(app, "main=*/app/kept")
        XCTAssertTrue(text(app, "zs-fixture-app").waitForExistence(timeout: 20))
        // Past the load watchdog: nothing else happened.
        XCTAssertFalse(element(app, "zs-error-view").waitForExistence(timeout: 3))
        XCTAssertEqual(value(app, "zs-test-external"), "none")
        let requests = server.requests
        XCTAssertFalse(requests.contains { $0.hasPrefix("localhost:") }, requests.joined(separator: " "))
        XCTAssertFalse(requests.contains { $0.contains("/api/desktop/login") || $0.contains("/api/integrations") || $0.contains("/invite/") || $0.contains("token=") }, requests.joined(separator: " "))
        XCTAssertEqual(server.tokenRequests, [])
    }
}
