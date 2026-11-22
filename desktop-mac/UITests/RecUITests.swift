import XCTest

/// Block 8 of docs/desktop-swift.md: Rec. The fixture page does what components/rec/Recorder.tsx
/// does with the bridge (the overlay state, the level, the controls that come back). CI has no
/// camera and cannot answer the camera prompt, so the camera and its permission are fakes
/// (`-ZSCamera ask|allowed|denied`, `-ZSCameraMissing YES`, `zs-test-camperm`); the bar, the
/// bubble panel, the start rule, the shortcuts, the menu bar item and Settings are the real ones.
/// Rec's messages are plain bridge messages, so both Lockdown modes behave the same.
final class RecUITests: XCTestCase {
    private var server: FixtureServer!
    private var app: XCUIApplication?
    private var lockdown: Bool { MainWindowUITests.mode == "on" }

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
                       "\(id) is '\(value(app, id))', want \(want)", file: file, line: line)
    }

    private func waitLabel(_ app: XCUIApplication, _ id: String, _ want: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        waitLabel(app, id, { $0 == want }, "'\(want)'", timeout: timeout, file: file, line: line)
    }

    /// `zs-test-rec` contains every part.
    private func waitRec(_ app: XCUIApplication, _ parts: [String], timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        waitLabel(app, "zs-test-rec", { v in parts.allSatisfy { v.contains($0) } }, "\(parts)", timeout: timeout, file: file, line: line)
    }

    /// The fixture page's Rec line ("rec phase=… mic=… cam=… controls=… sys=… api=… end").
    private func waitPage(_ app: XCUIApplication, _ parts: [String], file: StaticString = #filePath, line: UInt = #line) {
        let match = app.staticTexts.matching(NSPredicate { obj, _ in
            guard let el = obj as? XCUIElementAttributes else { return false }
            return [el.label, (el.value as? String) ?? ""].contains { t in
                t.hasPrefix("rec phase=") && t.hasSuffix(" end") && parts.allSatisfy { t.contains($0) }
            }
        }).firstMatch
        let lineNow = app.staticTexts.matching(NSPredicate { obj, _ in
            guard let el = obj as? XCUIElementAttributes else { return false }
            return el.label.hasPrefix("rec phase=") || ((el.value as? String) ?? "").hasPrefix("rec phase=")
        }).firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 20), "rec line is '\(lineNow.label) \((lineNow.value as? String) ?? "")', want \(parts)",
                      file: file, line: line)
    }

    private func ready(_ app: XCUIApplication) {
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the server page did not show")
        // The web app shows its desktop Rec controls when recOverlay exists.
        waitPage(app, ["phase=setup", "api=function"])
    }

    private func pageButton(_ app: XCUIApplication, _ title: String) {
        let button = app.buttons.matching(showing(title)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 10), "no '\(title)' button")
        button.click()
    }

    private func waitHittable(_ el: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: el)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: timeout), .completed, "\(el) is not hittable", file: file, line: line)
    }

    /// A button of the bar or the bubble, once it can be clicked.
    private func tap(_ app: XCUIApplication, _ id: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = element(app, id)
        waitHittable(button, file: file, line: line)
        button.click()
    }

    /// Opens the menu bar item's menu and picks an entry (block 7's hardened helper).
    private func statusMenu(_ app: XCUIApplication, _ id: String, file: StaticString = #filePath, line: UInt = #line) {
        let item = app.statusItems.matching(identifier: "zs-status-item").firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10), "no menu bar item", file: file, line: line)
        waitHittable(item, file: file, line: line)
        let entry = app.menuItems.matching(identifier: id).firstMatch
        item.click()
        if !entry.waitForExistence(timeout: 5) {
            app.typeKey(.escape, modifierFlags: [])
            item.click()
        }
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "no menu entry \(id)", file: file, line: line)
        entry.click()
    }

    private func settingsWindow(_ app: XCUIApplication) -> XCUIElement {
        app.windows.matching(identifier: "zs-settings").firstMatch
    }

    private func openSettings(_ app: XCUIApplication, _ section: String) {
        app.typeKey(",", modifierFlags: .command)
        XCTAssertTrue(settingsWindow(app).waitForExistence(timeout: 10), "Cmd+, did not open Settings")
        let row = app.buttons.matching(identifier: "zs-settings-\(section)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no \(section) section")
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    }

    /// Scrolls Settings until `el` can be clicked (block 6's helper), then clicks it.
    private func reveal(_ app: XCUIApplication, _ el: XCUIElement, click: Bool = true, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(el.waitForExistence(timeout: 15), "missing \(el)", file: file, line: line)
        let scroll = settingsWindow(app).scrollViews.firstMatch
        // Negative deltas scroll down. Small steps all the way down, then back up, so a row
        // never jumps past the visible part (Permissions grew a camera row in block 8).
        for delta in Array(repeating: -60.0, count: 24) + Array(repeating: 60.0, count: 24) where !el.isHittable {
            scroll.scroll(byDeltaX: 0, deltaY: CGFloat(delta))
        }
        XCTAssertTrue(el.isHittable, "\(el) is not visible", file: file, line: line)
        if click { el.click() }
    }

    private func attach(_ name: String, _ text: String) {
        let note = XCTAttachment(string: "lockdown=\(MainWindowUITests.mode) \(text)")
        note.name = name
        note.lifetime = .keepAlways
        add(note)
    }

    // MARK: Tests

    /// The page's `recOverlay` shows and hides the bar, which is left out of screen captures; its
    /// buttons reach the page as `zerosoft:rec-control`; discard asks first; Finish ends it.
    /// Nothing asks for the camera without one.
    func testBarFollowsThePageAndSendsItsControls() throws {
        let app = launch(["-ZSCamera", "ask"])
        ready(app)
        waitRec(app, ["rec=off", "bar=hidden", "bubble=hidden", "sharing=none", "camera off opens=0"])
        waitLabel(app, "zs-test-camperm", "camperm asked=0 camera=notDetermined")
        // What this WebKit offers Rec (section 6, block 8: getDisplayMedia checked on macos-15).
        attach("web features", value(app, "zs-test-ready"))

        pageButton(app, "Start rec")
        waitRec(app, ["rec=on phase=countdown", "bar=shown", "bubble=hidden", "sharing=none"])
        waitRec(app, ["rec=on phase=recording mic=on camera=false", "bar=shown"])
        XCTAssertTrue(element(app, "zs-recbar-finish").waitForExistence(timeout: 10), "no bar")
        XCTAssertFalse(element(app, "zs-recbar-camera").exists, "camera button without a camera")

        tap(app, "zs-recbar-pause")
        waitPage(app, ["phase=paused", "controls=pause"])
        waitRec(app, ["phase=paused"])
        tap(app, "zs-recbar-pause")
        waitPage(app, ["phase=recording", "controls=pause,resume"])
        tap(app, "zs-recbar-mic")
        waitPage(app, ["mic=muted", "controls=pause,resume,mute"])
        waitRec(app, ["mic=muted"])

        // Discard asks in the bar; Keep recording sends nothing.
        tap(app, "zs-recbar-discard")
        XCTAssertTrue(text(app, "Discard this recording?").waitForExistence(timeout: 10), "no confirmation")
        tap(app, "zs-recbar-keep")
        tap(app, "zs-recbar-finish")
        waitPage(app, ["phase=setup", "controls=pause,resume,mute,stop"])
        waitRec(app, ["rec=off", "bar=hidden", "bubble=hidden"])
        waitLabel(app, "zs-test-camperm", "camperm asked=0 camera=notDetermined")
    }

    /// A full-screen recording with the camera: the bubble asks for the camera on this first use
    /// only, shows it, hides it (releasing the camera) and brings it back from the bar, and grows
    /// from its hover button. Finishing releases the camera.
    func testCameraBubbleAsksOnFirstUseAndFollowsTheBar() throws {
        let app = launch(["-ZSCamera", "ask"])
        ready(app)
        waitLabel(app, "zs-test-camperm", "camperm asked=0 camera=notDetermined")
        pageButton(app, "Start rec with camera")
        waitLabel(app, "zs-test-camperm", "camperm asked=1 camera=allowed")
        waitRec(app, ["camera=true bubble=true", "bar=shown bubble=shown", "camera on opens=1"])
        XCTAssertTrue(element(app, "zs-recbubble").waitForExistence(timeout: 10), "no bubble")

        tap(app, "zs-recbar-camera")
        waitRec(app, ["camera=true bubble=false", "bubble=hidden", "camera off opens=1"])
        tap(app, "zs-recbar-camera")
        waitRec(app, ["camera=true bubble=true", "bubble=shown", "camera on opens=2"])

        let bubble = element(app, "zs-recbubble")
        XCTAssertTrue(bubble.waitForExistence(timeout: 10))
        bubble.hover()
        tap(app, "zs-recbubble-size")
        waitRec(app, ["large=true", "bubble=shown"])
        bubble.hover()
        tap(app, "zs-recbubble-hide")
        waitRec(app, ["camera=true bubble=false", "bubble=hidden", "camera off"])

        tap(app, "zs-recbar-finish")
        waitRec(app, ["rec=off", "bar=hidden", "bubble=hidden", "camera off opens=2"])
        // Asked once, on that first use.
        waitLabel(app, "zs-test-camperm", "camperm asked=1 camera=allowed")
    }

    /// The camera refused (or missing): no prompt, no bubble, and the page hears `bubble-failed`
    /// and draws the face in the video again.
    func testRefusedCameraFallsBackToThePage() throws {
        let app = launch(["-ZSCamera", "denied"])
        ready(app)
        pageButton(app, "Start rec with camera")
        waitPage(app, ["cam=none", "controls=bubble-failed"])
        waitRec(app, ["rec=on", "camera=false", "bar=shown", "bubble=hidden", "camera off opens=0"])
        waitLabel(app, "zs-test-camperm", "camperm asked=0 camera=denied")
        tap(app, "zs-recbar-finish")
        waitRec(app, ["rec=off", "bar=hidden"])
    }

    func testMissingCameraFallsBackToThePage() throws {
        let app = launch(["-ZSCamera", "allowed", "-ZSCameraMissing", "YES"])
        ready(app)
        pageButton(app, "Start rec with camera")
        waitPage(app, ["cam=none", "controls=bubble-failed"])
        waitRec(app, ["rec=on", "camera=false", "bubble=hidden"])
        tap(app, "zs-recbar-finish")
        waitRec(app, ["rec=off", "bar=hidden"])
    }

    /// A tab behind cannot start Rec's bar (only the tab in use can), but its recording is still
    /// marked: the tab and the menu bar item (guideline 2.5.14).
    func testOnlyTheTabInUseStartsTheBar() throws {
        let app = launch()
        ready(app)
        // The page starts 4 s later, by then from a tab behind.
        pageButton(app, "Start rec soon")
        app.typeKey("t", modifierFlags: .command)
        waitLabel(app, "zs-test-recevents", { $0.hasSuffix("overlay refused") }, "a refused start", timeout: 20)
        waitRec(app, ["rec=off", "marked=1", "bar=hidden"])
        waitLabel(app, "zs-test-capture", { $0.hasSuffix("item=shown") }, "the menu bar item")
        // Back in front, a start from the tab in use gets the bar.
        app.typeKey("w", modifierFlags: .command)
        pageButton(app, "Start rec")
        waitRec(app, ["rec=on phase=recording", "marked=1", "bar=shown"])
        tap(app, "zs-recbar-finish")
        waitRec(app, ["rec=off", "marked=0", "bar=hidden"])
    }

    /// While recording, the global shortcuts pause or resume and finish (Option+Shift, or
    /// Control+Option where macOS refuses Option+Shift); they go away when it ends.
    func testShortcutsWhileRecording() throws {
        let app = launch()
        ready(app)
        waitLabel(app, "zs-test-reckeys", "keys off")
        pageButton(app, "Start rec")
        waitLabel(app, "zs-test-reckeys", { $0 != "keys off" }, "registered shortcuts")
        let keys = value(app, "zs-test-reckeys")
        attach("rec shortcuts", keys)
        waitRec(app, ["phase=recording"])
        let mods: XCUIElement.KeyModifierFlags
        switch keys {
        case "keys Alt+Shift+P": mods = [.option, .shift]
        case "keys Control+Alt+P": mods = [.control, .option]
        default:
            throw XCTSkip("macOS refused both shortcut pairs on this runner: \(keys)")
        }
        app.typeKey("p", modifierFlags: mods)
        waitPage(app, ["phase=paused", "controls=toggle"])
        app.typeKey("p", modifierFlags: mods)
        waitPage(app, ["phase=recording", "controls=toggle,toggle"])
        app.typeKey("s", modifierFlags: mods)
        waitPage(app, ["phase=setup", "controls=toggle,toggle,stop"])
        waitLabel(app, "zs-test-reckeys", "keys off")
    }

    /// Rec is marked while its tab is behind: the bar (not the meeting indicator, also for the
    /// computer's audio it captures) and the menu bar item, whose Finish ends the recording and
    /// stops the computer's audio right away.
    func testRecIsMarkedAndFinishesFromTheMenuBar() throws {
        let app = launch(["-ZSSystemAudio", "allowed"])
        ready(app)
        pageButton(app, "Start rec with audio")
        waitPage(app, ["sys=\(lockdown ? "unsupported" : "ok")"])
        waitRec(app, ["rec=on phase=recording", "bar=shown"])
        app.typeKey("t", modifierFlags: .command)
        // The bar marks it; the floating indicator stays away.
        waitLabel(app, "zs-test-capture", "capture meeting=false sysaudio=\(!lockdown) indicator=hidden item=shown")
        waitRec(app, ["rec=on", "bar=shown"])

        statusMenu(app, "zs-status-stop-rec")
        waitRec(app, ["rec=off", "bar=hidden"])
        waitLabel(app, "zs-test-capture", "capture meeting=false sysaudio=false indicator=hidden item=shown")
        if !lockdown {
            waitLabel(app, "zs-test-sysaudio", { $0.hasPrefix("sysaudio off starts=1 last=ok stop=user") }, "stopped by the person")
        }
        // Finish brought the recording tab to the front.
        waitPage(app, ["phase=setup", "controls=stop"])
    }

    /// Settings › Permissions has the camera and Screen Recording, and asks only from the button.
    func testPermissionsShowCameraAndScreenRecording() throws {
        let app = launch(["-ZSCamera", "ask", "-ZSSystemAudio", "allowed"])
        ready(app)
        openSettings(app, "permissions")
        reveal(app, element(app, "zs-set-camera-state"), click: false)
        XCTAssertTrue(text(app, "Not asked yet. macOS asks the first time a page or Rec uses it, or now with the button.").exists)
        waitLabel(app, "zs-test-camperm", "camperm asked=0 camera=notDetermined")
        reveal(app, element(app, "zs-set-screen-state"), click: false)
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=allowed screen-asked=0")
        reveal(app, app.buttons.matching(identifier: "zs-set-camera").firstMatch)
        waitLabel(app, "zs-test-camperm", "camperm asked=1 camera=allowed")
        XCTAssertTrue(text(app, "The camera is on.").waitForExistence(timeout: 10))
    }
}
