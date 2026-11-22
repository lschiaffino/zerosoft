import XCTest

/// Block 5 of docs/desktop-swift.md: the Settings window, the menu bar item, the onboarding,
/// the notification prompt and the login item. The login item and the notification permission
/// are fakes in UI tests (`zs-test-loginitem`, `zs-test-notif`): CI cannot answer the system
/// prompt, and an ad hoc build must not add itself to the runner's login items.
final class SettingsUITests: XCTestCase {
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

    /// Label, title or a string value (a switch's value is a number, so no format predicate).
    private func showing(_ text: String) -> NSPredicate {
        NSPredicate { obj, _ in
            guard let el = obj as? XCUIElementAttributes else { return false }
            return el.label == text || el.title == text || (el.value as? String) == text
        }
    }

    private func text(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(showing(text)).firstMatch
    }

    private func value(_ app: XCUIApplication, _ id: String) -> String {
        (element(app, id).value as? String) ?? ""
    }

    private func waitLabel(_ app: XCUIApplication, _ id: String, _ want: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let label = element(app, id)
        let done = XCTNSPredicateExpectation(predicate: NSPredicate { obj, _ in
            ((obj as? XCUIElement)?.value as? String) == want
        }, object: label)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: timeout), .completed, "\(id) is '\(value(app, id))', want '\(want)'", file: file, line: line)
    }

    /// Waits for something the fixture server saw.
    private func waitServer(_ what: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line, _ check: @escaping () -> Bool) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: timeout), .completed, "\(what): writes \(server.writes)", file: file, line: line)
    }

    private func ready(_ app: XCUIApplication) {
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the server page did not show")
    }

    private func settingsWindow(_ app: XCUIApplication) -> XCUIElement {
        app.windows.matching(identifier: "zs-settings").firstMatch
    }

    private func openSettings(_ app: XCUIApplication) {
        app.typeKey(",", modifierFlags: .command)
        XCTAssertTrue(settingsWindow(app).waitForExistence(timeout: 10), "Cmd+, did not open Settings")
    }

    private func section(_ app: XCUIApplication, _ name: String) {
        let row = button(app, "zs-settings-\(name)")
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no \(name) section")
        press(row)
    }

    /// A click at the element's center.
    private func press(_ el: XCUIElement) {
        el.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    }

    /// Typed queries: a click resolves its query over the whole tree, and some SwiftUI controls
    /// expose values a generic identifier query cannot compare.
    private func button(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.buttons.matching(identifier: id).firstMatch
    }

    private func checkbox(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let box = app.checkBoxes.matching(identifier: id).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 10), "no switch \(id)")
        return box
    }

    private func isOn(_ box: XCUIElement) -> Bool {
        "\(box.value ?? "")" == "1"
    }

    /// Scrolls Settings until `el` can be clicked (the sections are scroll views taller than
    /// the window), then clicks it.
    private func reveal(_ app: XCUIApplication, _ el: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(el.waitForExistence(timeout: 15), "missing \(el)", file: file, line: line)
        let scroll = app.windows.matching(identifier: "zs-settings").firstMatch.scrollViews.firstMatch
        for delta in [-120.0, -120, -120, -120, 120, 120, 120, 120, 120, 120, 120, 120] where !el.isHittable {
            scroll.scroll(byDeltaX: 0, deltaY: CGFloat(delta))
        }
        XCTAssertTrue(el.isHittable, "\(el) is not visible", file: file, line: line)
        el.click()
    }

    /// Cmd+, opens Settings; the app's switches go to settings.json and the tab preferences to
    /// session.json, and both are there again after a relaunch.
    func testSettingsOpensAndSwitchesPersist() throws {
        var app = launch()
        ready(app)
        waitLabel(app, "zs-test-settings", "onboarded=false menubar=true")
        waitLabel(app, "zs-test-prefs", "suspend=true minutes=30 restore=true links=tab")
        let statusItem = app.statusItems.matching(identifier: "zs-status-item").firstMatch
        XCTAssertTrue(statusItem.waitForExistence(timeout: 10), "no menu bar item")
        // Nothing asks the server for Settings data before Settings opens.
        waitLabel(app, "zs-test-requests", "requests end")
        openSettings(app)

        let menubar = checkbox(app, "zs-set-menubar")
        XCTAssertTrue(isOn(menubar))
        menubar.click()
        waitLabel(app, "zs-test-settings", "onboarded=false menubar=false")
        let hidden = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: statusItem)
        wait(for: [hidden], timeout: 10)
        let login = checkbox(app, "zs-set-loginitem")
        XCTAssertFalse(isOn(login), "open at login must start off")
        login.click()
        waitLabel(app, "zs-test-loginitem", "login-item enabled")

        section(app, "tabs")
        checkbox(app, "zs-set-suspend").click()
        waitLabel(app, "zs-test-prefs", "suspend=false minutes=30 restore=true links=tab")
        let window = app.radioButtons.matching(showing("A new window")).firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        window.click()
        waitLabel(app, "zs-test-prefs", "suspend=false minutes=30 restore=true links=window")

        app.terminate()
        app = launch(["-ZSKeepSession", "YES", "-ZSKeepSettings", "YES"])
        ready(app)
        waitLabel(app, "zs-test-settings", "onboarded=false menubar=false")
        waitLabel(app, "zs-test-prefs", "suspend=false minutes=30 restore=true links=window")
        XCTAssertFalse(app.statusItems.matching(identifier: "zs-status-item").firstMatch.exists, "the hidden menu bar item came back")
        openSettings(app)
        XCTAssertFalse(isOn(checkbox(app, "zs-set-menubar")))
        section(app, "tabs")
        XCTAssertFalse(isOn(checkbox(app, "zs-set-suspend")))
        XCTAssertTrue(isOn(checkbox(app, "zs-set-restore")))
    }

    /// The menu bar item's menu opens a window and Settings.
    func testMenuBarItem() throws {
        let app = launch()
        ready(app)
        let item = app.statusItems.matching(identifier: "zs-status-item").firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10), "no menu bar item")
        item.click()
        let newWindow = app.menuItems.matching(identifier: "zs-status-new-window").firstMatch
        XCTAssertTrue(newWindow.waitForExistence(timeout: 10))
        newWindow.click()
        waitLabel(app, "zs-test-tabs", "tabs main=*/ w1=*/app end")
        item.click()
        let settings = app.menuItems.matching(identifier: "zs-status-settings").firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.click()
        XCTAssertTrue(settingsWindow(app).waitForExistence(timeout: 10), "the menu bar item did not open Settings")
    }

    /// The page's `openSettings()` (the web app's "Desktop app settings" buttons) opens the
    /// native window.
    func testPageOpensSettings() throws {
        let app = launch()
        ready(app)
        app.buttons.matching(showing("Desktop settings")).firstMatch.click()
        XCTAssertTrue(settingsWindow(app).waitForExistence(timeout: 10), "openSettings() did not open Settings")
    }

    /// The onboarding asks for notifications only when its button is pressed, never at launch;
    /// open at login stays off until it is switched on; finishing marks it as seen.
    func testOnboardingAsksForNotificationsOnlyFromItsButton() throws {
        let app = launch(["-ZSOnboarding", "YES"])
        let onboarding = app.windows.matching(identifier: "zs-onboarding").firstMatch
        XCTAssertTrue(onboarding.waitForExistence(timeout: 20), "no onboarding window")
        waitLabel(app, "zs-test-notif", "notif asked=0")
        button(app, "zs-ob-next").click()
        // Block 6: the dictation step shows the shortcut and explains the microphone before
        // anything asks for it.
        XCTAssertTrue(button(app, "zs-ob-mic").waitForExistence(timeout: 10), "no dictation step")
        XCTAssertTrue(element(app, "zs-ob-dict-body").exists)
        waitLabel(app, "zs-test-mic", "mic asked=0 notDetermined")
        button(app, "zs-ob-next").click()
        XCTAssertTrue(button(app, "zs-ob-notif").waitForExistence(timeout: 10))
        // Still not asked: the step explains first.
        waitLabel(app, "zs-test-notif", "notif asked=0")
        button(app, "zs-ob-notif").click()
        waitLabel(app, "zs-test-notif", "notif asked=1 allowed")

        let login = checkbox(app, "zs-ob-loginitem")
        XCTAssertFalse(isOn(login))
        login.click()
        waitLabel(app, "zs-test-loginitem", "login-item enabled")
        button(app, "zs-ob-next").click()
        let done = button(app, "zs-ob-done")
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        done.click()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: onboarding)
        wait(for: [gone], timeout: 10)
        waitLabel(app, "zs-test-settings", "onboarded=true menubar=true")
        // Settings shows the same answer, without a second prompt.
        openSettings(app)
        section(app, "permissions")
        XCTAssertTrue(text(app, "Notifications are on.").waitForExistence(timeout: 10))
        // Nothing in the onboarding asked for the microphone.
        waitLabel(app, "zs-test-mic", "mic asked=0 notDetermined")
        waitLabel(app, "zs-test-notif", "notif asked=1 allowed")
    }

    /// Without a session the server sections say so; after sign-in they show the server's data
    /// and write to it with the server as Origin; sign-out ends the session on the server too.
    func testServerSectionsUseTheSession() throws {
        let app = launch()
        ready(app)
        openSettings(app)
        section(app, "dictionary")
        XCTAssertTrue(text(app, "Sign in to see this.").waitForExistence(timeout: 15), "signed out state missing")

        // Sign in from Settings itself: the open section loads with the new session.
        press(button(app, "zs-remote-signin"))
        waitLabel(app, "zs-test-login", "login 1 ok")
        // The sign-in shows its page in the tab window; Cmd+, brings Settings back as it was.
        openSettings(app)
        XCTAssertTrue(element(app, "zs-dict-entry-e1").waitForExistence(timeout: 15), "the open section did not reload after sign-in")

        section(app, "account")
        XCTAssertTrue(text(app, "Signed in as fixture@example.com").waitForExistence(timeout: 15), "account missing")

        section(app, "dictionary")
        XCTAssertTrue(element(app, "zs-dict-entry-e1").waitForExistence(timeout: 15), "the dictionary did not load")
        let phrase = app.textFields.matching(identifier: "zs-dict-phrase").firstMatch
        press(phrase)
        phrase.typeText("zs-new-word")
        press(button(app, "zs-dict-add"))
        waitServer("add") { self.server.writes.contains(#"POST /api/voice/dictionary {"kind":"word","phrase":"zs-new-word"}"#) }
        XCTAssertTrue(element(app, "zs-dict-entry-e2").waitForExistence(timeout: 15), "the new entry is not listed")
        press(button(app, "zs-dict-delete-e1"))
        waitServer("delete") { self.server.dictionaryIDs == ["e2"] }
        let removed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element(app, "zs-dict-entry-e1"))
        wait(for: [removed], timeout: 10)

        section(app, "voice")
        // Block 6 put the dictation controls of this Mac above the account's settings.
        let cleanup = app.popUpButtons.matching(identifier: "zs-voice-cleanup").firstMatch
        XCTAssertTrue(cleanup.waitForExistence(timeout: 15), "voice settings did not load")
        reveal(app, cleanup)
        cleanup.menuItems["Formal"].click()
        waitServer("patch") { self.server.writes.contains(#"PATCH /api/voice/settings {"cleanupMode":"formal"}"#) }
        XCTAssertTrue(element(app, "zs-voice-saved").waitForExistence(timeout: 10))

        section(app, "history")
        XCTAssertTrue(text(app, "zs-history-text").waitForExistence(timeout: 15), "history did not load")

        section(app, "account")
        let signOut = button(app, "zs-account-signout")
        XCTAssertTrue(signOut.waitForExistence(timeout: 10))
        press(signOut)
        waitServer("sign-out") { self.server.writes.contains("signout ok") }
        XCTAssertTrue(text(app, "Not signed in.").waitForExistence(timeout: 10))
        openSettings(app)
        section(app, "dictionary")
        XCTAssertTrue(text(app, "Sign in to see this.").waitForExistence(timeout: 15), "the dictionary still shows after sign-out")
        waitLabel(app, "zs-test-badge", "badge 0")
        XCTAssertFalse(server.writes.contains { $0.hasPrefix("bad-origin") || $0 == "signout bad" }, "\(server.writes)")
    }
}
