import XCTest

/// Block 7 of docs/desktop-swift.md: meetings. The fixture page does what the web app's recorder
/// does with the bridge (the recording flag, the computer's audio read every 250 ms, Stop from the
/// app). CI cannot grant Screen Recording or system audio recording, so the capture and its
/// permission are fakes (`-ZSSystemAudio ask|allowed|denied`, `zs-test-capperm`); the start rules,
/// the conversion, the indicator, the menu bar item and Settings are the real ones. Under forced
/// Lockdown restrictions the page has no Web Audio, so the app offers no computer audio
/// (`unsupported`) while the recording flag and its marks work the same.
final class MeetingsUITests: XCTestCase {
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

    /// "capture meeting=… sysaudio=… indicator=… item=…"
    private func waitCapture(_ app: XCUIApplication, meeting: Bool, sysaudio: Bool, indicator: Bool, item: Bool = true,
                             file: StaticString = #filePath, line: UInt = #line) {
        let want = "capture meeting=\(meeting) sysaudio=\(sysaudio) indicator=\(indicator ? "shown" : "hidden") item=\(item ? "shown" : "hidden")"
        waitLabel(app, "zs-test-capture", want, file: file, line: line)
    }

    /// The fixture page's meeting line ("meeting rec=… start=… audio=… stops=… sys=… ind=… end").
    private func waitMeeting(_ app: XCUIApplication, _ parts: [String], file: StaticString = #filePath, line: UInt = #line) {
        let match = app.staticTexts.matching(NSPredicate { obj, _ in
            guard let el = obj as? XCUIElementAttributes else { return false }
            return [el.label, (el.value as? String) ?? ""].contains { t in
                t.hasPrefix("meeting rec=") && t.hasSuffix(" end") && parts.allSatisfy { t.contains($0) }
            }
        }).firstMatch
        let lineNow = app.staticTexts.matching(NSPredicate { obj, _ in
            guard let el = obj as? XCUIElementAttributes else { return false }
            return el.label.hasPrefix("meeting ") || ((el.value as? String) ?? "").hasPrefix("meeting ")
        }).firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 20), "meeting line is '\(lineNow.label) \((lineNow.value as? String) ?? "")', want \(parts)",
                      file: file, line: line)
    }

    private func ready(_ app: XCUIApplication) {
        XCTAssertTrue(text(app, "zs-fixture-ok").waitForExistence(timeout: 20), "the server page did not show")
        waitMeeting(app, ["rec=false", "start=none"])
    }

    private func pageButton(_ app: XCUIApplication, _ title: String) {
        let button = app.buttons.matching(showing(title)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 10), "no '\(title)' button")
        button.click()
    }

    /// A click at the element's center.
    private func press(_ el: XCUIElement) {
        el.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    }

    private func waitHittable(_ el: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: el)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: timeout), .completed, "\(el) is not hittable", file: file, line: line)
    }

    /// Opens the menu bar item's menu and picks an entry. The menu can be slow to open on a busy
    /// runner: wait until the item can be clicked, and click once more if the menu did not open.
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
        press(row)
    }

    private func closeSettings(_ app: XCUIApplication) {
        let close = settingsWindow(app).buttons[XCUIIdentifierCloseWindow]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.click()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: settingsWindow(app))
        wait(for: [gone], timeout: 10)
    }

    private func checkbox(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let box = app.checkBoxes.matching(identifier: id).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 10), "no switch \(id)")
        return box
    }

    /// Scrolls Settings until `el` can be clicked (block 6's helper), then clicks it.
    private func reveal(_ app: XCUIApplication, _ el: XCUIElement, click: Bool = true, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(el.waitForExistence(timeout: 15), "missing \(el)", file: file, line: line)
        let scroll = settingsWindow(app).scrollViews.firstMatch
        for delta in [-120.0, -120, -120, -120, 120, 120, 120, 120, 120, 120, 120, 120] where !el.isHittable {
            scroll.scroll(byDeltaX: 0, deltaY: CGFloat(delta))
        }
        XCTAssertTrue(el.isHittable, "\(el) is not visible", file: file, line: line)
        if click { el.click() }
    }

    // MARK: Tests

    /// Nothing asks at launch. The first capture asks macOS (here a fake that is answered no)
    /// and the page gets `denied`; with Lockdown restrictions the app offers no computer audio
    /// and asks nothing. The page's recording flag is marked either way.
    func testSystemAudioWithoutPermissionAnswersDenied() throws {
        let app = launch(["-ZSSystemAudio", "ask"])
        ready(app)
        waitMeeting(app, ["sys=\(!lockdown)", "ind=true"])
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=ask screen-asked=0")
        waitCapture(app, meeting: false, sysaudio: false, indicator: false)

        pageButton(app, "Start meeting")
        let answer = lockdown ? "unsupported" : "denied"
        waitMeeting(app, ["rec=true", "start=\(answer)"])
        waitLabel(app, "zs-test-capperm", lockdown ? "capperm asked=0 audio=ask screen-asked=0" : "capperm asked=1 audio=denied screen-asked=0")
        waitLabel(app, "zs-test-sysaudio", "sysaudio off starts=0 last=\(answer) stop=none audio=false")
        // The tab is in front: the menu bar item marks the meeting, the floating indicator waits.
        waitCapture(app, meeting: true, sysaudio: false, indicator: false)

        pageButton(app, "Stop meeting")
        waitCapture(app, meeting: false, sysaudio: false, indicator: false)
        // A second start does not ask again.
        pageButton(app, "Start meeting")
        waitCapture(app, meeting: true, sysaudio: false, indicator: false)
        waitLabel(app, "zs-test-capperm", lockdown ? "capperm asked=0 audio=ask screen-asked=0" : "capperm asked=1 audio=denied screen-asked=0")
        pageButton(app, "Stop meeting")
        waitCapture(app, meeting: false, sysaudio: false, indicator: false)
    }

    /// A meeting with the computer's audio: the page reads 16 kHz PCM; with the tab behind, the
    /// floating indicator shows and its click brings the tab back; Hide keeps it away while the
    /// menu bar item keeps its dot; Stop in the menu bar item ends both the page's recording and
    /// the capture.
    func testRecordingIsMarkedAndStopsFromTheMenuBar() throws {
        let app = launch(["-ZSSystemAudio", "allowed"])
        ready(app)
        pageButton(app, "Start meeting")
        let audio = !lockdown
        if audio {
            waitMeeting(app, ["rec=true", "start=ok", "audio=true"])
            waitLabel(app, "zs-test-sysaudio", { $0.hasPrefix("sysaudio on starts=1 last=ok stop=none") }, "a running capture")
        } else {
            waitMeeting(app, ["rec=true", "start=unsupported"])
        }
        waitCapture(app, meeting: true, sysaudio: audio, indicator: false)

        // Another tab in front: the indicator shows.
        app.typeKey("t", modifierFlags: .command)
        waitCapture(app, meeting: true, sysaudio: audio, indicator: true)
        let indicator = element(app, "zs-indicator")
        XCTAssertTrue(indicator.waitForExistence(timeout: 10), "no indicator")
        indicator.click()
        // Its click brings the recording tab back to the front.
        waitCapture(app, meeting: true, sysaudio: audio, indicator: false)
        waitMeeting(app, ["rec=true"])

        app.typeKey("t", modifierFlags: .command)
        waitCapture(app, meeting: true, sysaudio: audio, indicator: true)
        XCTAssertTrue(indicator.waitForExistence(timeout: 10))
        indicator.rightClick()
        let hide = app.menuItems.matching(identifier: "zs-indicator-hide").firstMatch
        XCTAssertTrue(hide.waitForExistence(timeout: 10), "no indicator menu")
        hide.click()
        // Hidden until the next recording; the menu bar item still marks it.
        waitCapture(app, meeting: true, sysaudio: audio, indicator: false)

        statusMenu(app, "zs-status-stop-recording")
        // The page (in a tab behind) heard zerosoft:stop-recording and cleared its flag.
        waitCapture(app, meeting: false, sysaudio: false, indicator: false)
        if audio {
            waitLabel(app, "zs-test-sysaudio", "sysaudio off starts=1 last=ok stop=user audio=true")
        }
    }

    /// Settings › General hides the menu bar item, but a recording brings it back until it ends
    /// (guideline 2.5.14).
    func testMenuBarItemShowsWhileRecordingEvenWhenHidden() throws {
        let app = launch(["-ZSSystemAudio", "allowed"])
        ready(app)
        let item = app.statusItems.matching(identifier: "zs-status-item").firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10))
        openSettings(app, "general")
        checkbox(app, "zs-set-menubar").click()
        let hidden = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: item)
        wait(for: [hidden], timeout: 10)
        closeSettings(app)

        pageButton(app, "Start meeting")
        waitCapture(app, meeting: true, sysaudio: !lockdown, indicator: false, item: true)
        XCTAssertTrue(item.waitForExistence(timeout: 10), "the menu bar item did not come back while recording")
        pageButton(app, "Stop meeting")
        waitCapture(app, meeting: false, sysaudio: false, indicator: false, item: false)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: item)
        wait(for: [gone], timeout: 10)
    }

    /// A tab behind cannot start capturing the computer's audio (only the tab in use can).
    func testOnlyTheTabInUseStartsTheCapture() throws {
        let app = launch(["-ZSSystemAudio", "allowed"])
        ready(app)
        // The page starts 4 s later, by then from a tab behind.
        pageButton(app, "Start meeting soon")
        app.typeKey("t", modifierFlags: .command)
        waitLabel(app, "zs-test-sysaudio", "sysaudio off starts=0 last=\(lockdown ? "unsupported" : "failed") stop=none audio=false", timeout: 20)
        // Its recording flag is still marked, with the indicator since the tab is behind.
        waitCapture(app, meeting: true, sysaudio: false, indicator: true)
        XCTAssertEqual(value(app, "zs-test-capperm"), "capperm asked=0 audio=allowed screen-asked=0")
        // Closing the front tab brings the recording tab back.
        app.typeKey("w", modifierFlags: .command)
        waitCapture(app, meeting: true, sysaudio: false, indicator: false)
        pageButton(app, "Stop meeting")
        waitCapture(app, meeting: false, sysaudio: false, indicator: false)
    }

    /// On macOS 13 to 14.1 (ScreenCaptureKit) Permissions shows Screen Recording and asks for it
    /// only from its button.
    func testScreenRecordingRowOnOlderMacOS() throws {
        let app = launch(["-ZSSystemAudio", "allowed", "-ZSSystemAudioBackend", "screen"])
        ready(app)
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=allowed screen-asked=0")
        openSettings(app, "permissions")
        reveal(app, element(app, "zs-set-screen-state"), click: false)
        XCTAssertTrue(text(app, "Screen recording is off.").exists, "Screen Recording state missing")
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=allowed screen-asked=0")
        reveal(app, app.buttons.matching(identifier: "zs-set-screen").firstMatch)
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=allowed screen-asked=1")
    }

    /// Settings › Meetings: the switches persist; the indicator switch hides it for a meeting but
    /// never for the computer's audio; switching the computer's audio off stops a capture. Settings
    /// › Permissions explains the computer's audio.
    func testMeetingsSettingsAndPermissions() throws {
        var app = launch(["-ZSSystemAudio", "allowed"])
        ready(app)
        waitLabel(app, "zs-test-meetset", "indicator=true sysaudio=true")
        openSettings(app, "meetings")
        XCTAssertTrue(text(app, "Nothing is recording now.").waitForExistence(timeout: 10))
        checkbox(app, "zs-set-indicator").click()
        waitLabel(app, "zs-test-meetset", "indicator=false sysaudio=true")
        let sysaudio = checkbox(app, "zs-set-sysaudio")
        // Not offered under Lockdown restrictions.
        XCTAssertEqual(sysaudio.isEnabled, !lockdown)
        closeSettings(app)

        pageButton(app, "Start meeting")
        waitCapture(app, meeting: true, sysaudio: !lockdown, indicator: false)
        app.typeKey("t", modifierFlags: .command)
        // The computer's audio is marked even with the indicator switched off.
        waitCapture(app, meeting: true, sysaudio: !lockdown, indicator: !lockdown)

        openSettings(app, "meetings")
        XCTAssertTrue(text(app, "A meeting is recording.").waitForExistence(timeout: 10))
        if !lockdown {
            checkbox(app, "zs-set-sysaudio").click()
            waitLabel(app, "zs-test-meetset", "indicator=false sysaudio=false")
            waitCapture(app, meeting: true, sysaudio: false, indicator: false)
            waitLabel(app, "zs-test-sysaudio", "sysaudio off starts=1 last=ok stop=settings audio=true")
        }
        // Stop from Settings reaches the page in the tab behind.
        let stop = app.buttons.matching(identifier: "zs-set-meeting-stop").firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        press(stop)
        waitCapture(app, meeting: false, sysaudio: false, indicator: false)

        press(app.buttons.matching(identifier: "zs-settings-permissions").firstMatch)
        reveal(app, element(app, "zs-set-audio-state"), click: false)
        // macOS 14.2 and later (audio taps) never need Screen Recording: no row asks for it.
        XCTAssertFalse(element(app, "zs-set-screen-state").exists, "Screen Recording offered without a use")
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=allowed screen-asked=0")

        app.terminate()
        app = launch(["-ZSSystemAudio", "allowed", "-ZSKeepSettings", "YES"])
        ready(app)
        waitLabel(app, "zs-test-meetset", lockdown ? "indicator=false sysaudio=true" : "indicator=false sysaudio=false")
        // Switched off: the page gets `unsupported` and records the microphone only.
        pageButton(app, "Start meeting")
        waitMeeting(app, ["rec=true", "start=unsupported"])
        waitLabel(app, "zs-test-capperm", "capperm asked=0 audio=allowed screen-asked=0")
    }
}
