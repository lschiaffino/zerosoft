import AppKit
import XCTest

/// Block 6 of docs/desktop-swift.md: dictation. CI has no microphone, cannot answer the
/// microphone prompt and must not post keystrokes, so the audio is a fake tone and the
/// microphone and Accessibility permissions are fakes (`zs-test-mic`, `zs-test-paste`); the
/// shortcut, the HUD flow, the request, the clipboard, the saved dictations and the Settings and
/// onboarding parts are the real ones. The fixture server plays /api/voice/dictate.
final class DictationUITests: XCTestCase {
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

    // MARK: Helpers

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

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

    private func waitLabel(_ app: XCUIApplication, _ id: String, _ check: @escaping (String) -> Bool, _ want: String,
                           timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let label = element(app, id)
        let done = XCTNSPredicateExpectation(predicate: NSPredicate { obj, _ in
            check(((obj as? XCUIElement)?.value as? String) ?? "")
        }, object: label)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: timeout), .completed,
                       "\(id) is '\(value(app, id))', want \(want); dictations \(server.dictations)", file: file, line: line)
    }

    private func waitLabel(_ app: XCUIApplication, _ id: String, _ want: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        waitLabel(app, id, { $0 == want }, "'\(want)'", timeout: timeout, file: file, line: line)
    }

    /// The last dictation event ("events <n> <what>") ends with `what`.
    private func waitEvent(_ app: XCUIApplication, _ what: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        waitLabel(app, "zs-test-dictation", { $0.hasPrefix("events ") && $0.hasSuffix(" " + what) }, "an event '\(what)'", timeout: timeout, file: file, line: line)
    }

    private func waitServer(_ what: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line, _ check: @escaping () -> Bool) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: timeout), .completed, "\(what): dictations \(server.dictations)", file: file, line: line)
    }

    private func pause(_ seconds: TimeInterval) {
        _ = XCTWaiter().wait(for: [XCTestExpectation(description: "pause")], timeout: seconds)
    }

    private func ready(_ app: XCUIApplication) {
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the server page did not show")
    }

    private func signIn(_ app: XCUIApplication) {
        app.buttons.matching(showing("Sign in with Google")).firstMatch.click()
        waitLabel(app, "zs-test-login", "login 1 ok")
    }

    private func button(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.buttons.matching(identifier: id).firstMatch
    }

    private func press(_ el: XCUIElement) {
        el.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    }

    /// Opens the menu bar item's menu and clicks one of its items.
    private func menu(_ app: XCUIApplication, _ id: String, file: StaticString = #filePath, line: UInt = #line) {
        let item = app.statusItems.matching(identifier: "zs-status-item").firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10), "no menu bar item", file: file, line: line)
        item.click()
        let entry = app.menuItems.matching(identifier: "zs-status-\(id)").firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "no menu item \(id)", file: file, line: line)
        entry.click()
    }

    private func openSettings(_ app: XCUIApplication) {
        app.typeKey(",", modifierFlags: .command)
        XCTAssertTrue(app.windows.matching(identifier: "zs-settings").firstMatch.waitForExistence(timeout: 10), "Cmd+, did not open Settings")
    }

    private func section(_ app: XCUIApplication, _ name: String) {
        let row = button(app, "zs-settings-\(name)")
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no \(name) section")
        press(row)
    }

    /// What the system clipboard holds, read the way a person would: pasted with Command+V into
    /// a text field of the app (Settings › Dictionary's phrase field, which needs a session).
    private func pastedText(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) -> String {
        openSettings(app)
        section(app, "dictionary")
        let field = app.textFields.matching(identifier: "zs-dict-phrase").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "no phrase field", file: file, line: line)
        press(field)
        field.typeKey("a", modifierFlags: .command)
        field.typeKey(.delete, modifierFlags: [])
        field.typeKey("v", modifierFlags: .command)
        pause(0.5)
        return (field.value as? String) ?? ""
    }

    // MARK: Tests

    /// The microphone is not asked for at launch. The first dictation from the menu bar item
    /// asks and records nothing; the next records, sends the audio with the session and the
    /// same origin, and, in a build that only copies (the flag off), copies the text without a
    /// keystroke.
    func testMenuDictationAsksForTheMicrophoneFirstThenCopies() throws {
        let app = launch(["-ZSCopyOnly", "YES"])
        ready(app)
        waitLabel(app, "zs-test-mic", "mic asked=0 notDetermined")
        waitLabel(app, "zs-test-paste", "paste asked=0 off keys=0")
        // The default Option+Space: macOS 15 is reported to refuse some Option-only shortcuts
        // (section 2.2). Recorded for the CI summary; the shortcut test below uses Command+Shift+D.
        waitLabel(app, "zs-test-hotkey", { $0.hasPrefix("hotkey Alt+Space ") }, "the default shortcut registered or refused")
        let hotkey = XCTAttachment(string: "default shortcut on \(ProcessInfo.processInfo.operatingSystemVersionString): \(value(app, "zs-test-hotkey"))")
        hotkey.lifetime = .keepAlways
        add(hotkey)
        signIn(app)
        pause(1)
        XCTAssertEqual(server.dictations, [], "something reached the dictation route before a dictation")
        waitLabel(app, "zs-test-mic", "mic asked=0 notDetermined")

        menu(app, "dictate")
        waitLabel(app, "zs-test-mic", "mic asked=1 allowed")
        waitEvent(app, "dictation mic-allowed")
        waitLabel(app, "zs-test-phase", "phase idle")
        XCTAssertEqual(server.dictations, [], "the asking dictation recorded something")

        menu(app, "dictate")
        waitEvent(app, "dictation recording")
        waitLabel(app, "zs-test-phase", "phase recording")
        waitLabel(app, "zs-test-hud", { $0.hasPrefix("recording ") }, "the HUD recording")
        pause(0.6)
        menu(app, "dictate")
        waitEvent(app, "dictation copied")
        waitLabel(app, "zs-test-phase", "phase idle")
        waitServer("the upload") { self.server.dictations.contains { $0.hasPrefix("ok ") } }
        let upload = server.dictations.first { $0.hasPrefix("ok ") } ?? ""
        XCTAssertTrue(upload.hasSuffix("capture=desktop fast=1 rate=16000 ms=1000"), upload)
        XCTAssertTrue(server.dictations.contains("warm session=no"), "\(server.dictations)")
        XCTAssertFalse(server.dictations.contains("bad-origin"))
        // No keystroke in a copy-only build; the mic was asked for once.
        waitLabel(app, "zs-test-paste", "paste asked=0 off keys=0")
        waitLabel(app, "zs-test-mic", "mic asked=1 allowed")
        XCTAssertEqual(pastedText(app), FixtureServer.dictatedText)
    }

    /// The global shortcut (tap to start, tap to finish) pastes with the keystroke when it is
    /// allowed, with the text on the clipboard at that moment, and puts the old clipboard back.
    /// Esc cancels without a request.
    func testShortcutPastesAndRestoresTheClipboard() throws {
        let app = launch(["-ZSMicAllowed", "YES", "-ZSPasteAllowed", "YES", "-ZSTestShortcut", "CommandOrControl+Shift+D"])
        ready(app)
        waitLabel(app, "zs-test-hotkey", "hotkey CommandOrControl+Shift+D ok")
        signIn(app)
        let board = NSPasteboard.general
        board.clearContents()
        board.setString("zs-before", forType: .string)

        app.typeKey("d", modifierFlags: [.command, .shift])
        waitLabel(app, "zs-test-phase", "phase recording")
        pause(0.6)
        app.typeKey("d", modifierFlags: [.command, .shift])
        waitEvent(app, "dictation pasted clip=match restored=true")
        waitLabel(app, "zs-test-paste", "paste asked=0 allowed keys=1")
        XCTAssertEqual(server.dictations.filter { $0.hasPrefix("ok ") }.count, 1, "\(server.dictations)")

        // Esc cancels: nothing is sent.
        app.typeKey("d", modifierFlags: [.command, .shift])
        waitLabel(app, "zs-test-phase", "phase recording")
        app.typeKey(.escape, modifierFlags: [])
        waitEvent(app, "dictation cancelled")
        waitLabel(app, "zs-test-phase", "phase idle")
        pause(1)
        XCTAssertEqual(server.dictations.filter { $0.hasPrefix("ok ") }.count, 1, "a cancelled dictation was sent")
        XCTAssertEqual(pastedText(app), "zs-before", "the clipboard did not come back")
    }

    /// Without a session the audio is kept (the switch is on by default); after signing in, the
    /// menu bar item sends it again and the text is copied.
    func testSignedOutDictationIsSavedAndSentAgain() throws {
        let app = launch(["-ZSMicAllowed", "YES", "-ZSPasteAllowed", "YES"])
        ready(app)
        waitLabel(app, "zs-test-pending", "pending 0")
        menu(app, "dictate")
        waitLabel(app, "zs-test-phase", "phase recording")
        pause(0.6)
        menu(app, "dictate")
        waitEvent(app, "dictation failed:signed_out saved")
        waitLabel(app, "zs-test-pending", "pending 1")
        XCTAssertTrue(server.dictations.contains("signed-out"), "\(server.dictations)")

        signIn(app)
        menu(app, "retry")
        waitEvent(app, "retry copied")
        waitLabel(app, "zs-test-pending", "pending 0")
        waitServer("the second upload") { self.server.dictations.contains { $0.hasPrefix("ok ") } }
        // A saved dictation is copied, never pasted.
        waitLabel(app, "zs-test-paste", "paste asked=0 allowed keys=0")
        XCTAssertEqual(pastedText(app), FixtureServer.dictatedText)
    }

    /// Settings › Permissions: the microphone and Accessibility are asked for only from their
    /// buttons. Settings › Dictation keeps its switches in settings.json.
    func testPermissionsAndDictationSettings() throws {
        let app = launch()
        ready(app)
        openSettings(app)
        section(app, "permissions")
        XCTAssertTrue(text(app, "Not asked yet. macOS asks the first time you dictate, or now with the button.").waitForExistence(timeout: 10))
        waitLabel(app, "zs-test-mic", "mic asked=0 notDetermined")
        press(button(app, "zs-set-mic"))
        waitLabel(app, "zs-test-mic", "mic asked=1 allowed")
        XCTAssertTrue(text(app, "The microphone is on.").waitForExistence(timeout: 10))

        waitLabel(app, "zs-test-paste", "paste asked=0 off keys=0")
        press(button(app, "zs-set-paste"))
        waitLabel(app, "zs-test-paste", "paste asked=1 allowed keys=0")
        XCTAssertTrue(text(app, "Pasting is on.").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "zs-set-notif").exists, "the notifications row is missing")

        section(app, "voice")
        waitLabel(app, "zs-test-dictset", "shortcut=Alt+Space mode=both paste=true restore=true app=true keep=true")
        let keep = app.checkBoxes.matching(identifier: "zs-dict-keep").firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 10))
        keep.click()
        waitLabel(app, "zs-test-dictset", "shortcut=Alt+Space mode=both paste=true restore=true app=true keep=false")
        let toggleOnly = app.radioButtons.matching(showing("Only tap to start and stop")).firstMatch
        XCTAssertTrue(toggleOnly.waitForExistence(timeout: 10))
        toggleOnly.click()
        waitLabel(app, "zs-test-dictset", "shortcut=Alt+Space mode=toggle paste=true restore=true app=true keep=false")
    }

    /// Settings › History's Paste: zerosoft steps aside and pastes into the app that was in front.
    func testHistoryPastesBack() throws {
        let app = launch(["-ZSPasteAllowed", "YES"])
        ready(app)
        signIn(app)
        openSettings(app)
        section(app, "history")
        let paste = button(app, "zs-history-paste-s1")
        XCTAssertTrue(paste.waitForExistence(timeout: 15), "history did not load")
        press(paste)
        // The app hid to give the focus back; bring it back to read the result.
        pause(2)
        app.activate()
        waitEvent(app, "history pasted clip=match restored=true")
        waitLabel(app, "zs-test-paste", "paste asked=0 allowed keys=1")
    }
}
