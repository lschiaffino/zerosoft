import Foundation
import Testing
@testable import ZerosoftCore

// Block 8: Rec's floating bar and camera bubble (rec_overlay.rs).

// MARK: Controls

/// The `REC_CONTROLS` list of lib/rec-controls.ts, read from the repository.
private func webControls() throws -> [String] {
    let file = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("lib/rec-controls.ts")
    let source = try String(contentsOf: file, encoding: .utf8)
    let line = try #require(source.split(separator: "\n").first { $0.contains("export const REC_CONTROLS") })
    let inside = try #require(line.split(separator: "[").dropFirst().first?.split(separator: "]").first)
    return inside.split(separator: ",").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) }
}

@Test func controlListMatchesTheWebApp() throws {
    #expect(RecControl.allCases.map(\.rawValue) == (try webControls()))
}

@Test func controlScriptsCarryOnlyTheFixedValue() {
    for c in RecControl.allCases {
        #expect(c.script == "window.dispatchEvent(new CustomEvent('zerosoft:rec-control',{detail:'\(c.rawValue)'}))")
    }
    #expect(RecControl(rawValue: "stop'}));alert(1);//") == nil)
    #expect(RecControl(rawValue: "Pause") == nil)
    #expect(RecControl(rawValue: "open") == nil)
}

@Test func micAndPhaseInput() {
    #expect(RecMic.parse("muted") == .muted)
    #expect(RecMic.parse("loud") == RecMic.none)
    #expect(RecMic.parse(nil) == RecMic.none)
    #expect(RecSessions.cleanElapsed(1234.9) == 1234)
    for bad in [nil, -1, Double.nan, 1e12] as [Double?] {
        #expect(RecSessions.cleanElapsed(bad) == 0)
    }
    #expect(RecSessions.cleanLabel("FaceTime HD Camera") == "FaceTime HD Camera")
    #expect(RecSessions.cleanLabel("a\u{0}b") == "")
    #expect(RecSessions.cleanLabel(String(repeating: "x", count: 201)) == "")
}

// MARK: The overlay state reducer

@Test func aRecordingStartsOnlyFromTheTabAllowedAndEndsOnlyFromItsTab() {
    var s = RecSessions()
    #expect(s.page(tab: 1, active: true, phase: .countdown, elapsedMs: 0, mic: "on", camera: nil, nowMs: 1000, startAllowed: false) == .refused)
    #expect(s.isEmpty && s.current == nil)
    #expect(s.page(tab: 1, active: true, phase: .countdown, elapsedMs: 0, mic: "on", camera: nil, nowMs: 1000, startAllowed: true) == .started)
    #expect(s.owner == 1 && s.current?.phase == .countdown && s.current?.shortcuts == true)
    // Updates from its own tab need no front: the page is often behind while it records.
    #expect(s.page(tab: 1, active: true, phase: .recording, elapsedMs: 0, mic: "on", camera: nil, nowMs: 4000, startAllowed: false) == .updated)
    #expect(s.current?.elapsed(nowMs: 6500) == 2500)
    // Another tab cannot end it, or start one without being in use.
    #expect(s.page(tab: 2, active: false, phase: nil, elapsedMs: nil, mic: nil, camera: nil, nowMs: 5000, startAllowed: true) == .ignored)
    #expect(s.page(tab: 2, active: true, phase: .recording, elapsedMs: 0, mic: nil, camera: nil, nowMs: 5000, startAllowed: false) == .refused)
    #expect(s.tabs == [1])
    // Paused: the clock stops.
    #expect(s.page(tab: 1, active: true, phase: .paused, elapsedMs: 9000, mic: "muted", camera: nil, nowMs: 10_000, startAllowed: false) == .updated)
    #expect(s.current?.elapsed(nowMs: 60_000) == 9000 && s.current?.mic == .muted && s.current?.live == true)
    #expect(s.page(tab: 1, active: true, phase: .finishing, elapsedMs: 9000, mic: "on", camera: nil, nowMs: 11_000, startAllowed: false) == .updated)
    #expect(s.current?.live == false && s.current?.shortcuts == false)
    #expect(s.page(tab: 1, active: false, phase: nil, elapsedMs: nil, mic: nil, camera: nil, nowMs: 12_000, startAllowed: false) == .ended)
    #expect(s.isEmpty && s.summary == "rec=off")
    // An active state without a phase is refused.
    #expect(s.page(tab: 1, active: true, phase: nil, elapsedMs: nil, mic: nil, camera: nil, nowMs: 1, startAllowed: true) == .refused)
}

@Test func twoRecordingsTheBarFollowsTheLastAndTheLevelOnlyItsTab() {
    var s = RecSessions()
    _ = s.page(tab: 1, active: true, phase: .recording, elapsedMs: 0, mic: "on", camera: nil, nowMs: 0, startAllowed: true)
    _ = s.page(tab: 2, active: true, phase: .recording, elapsedMs: 0, mic: "on", camera: nil, nowMs: 0, startAllowed: true)
    #expect(s.owner == 2 && s.tabs == [1, 2])
    #expect(s.levelAccepted(from: 2) && !s.levelAccepted(from: 1))
    let ended = s.end(tab: 2)
    #expect(ended)
    #expect(s.owner == 1 && s.levelAccepted(from: 1))
    let again = s.end(tab: 2)
    #expect(!again)
}

@Test func theBubbleFollowsTheCameraAndThePerson() {
    var s = RecSessions()
    _ = s.page(tab: 1, active: true, phase: .countdown, elapsedMs: 0, mic: "on", camera: "FaceTime HD Camera", nowMs: 0, startAllowed: true)
    #expect(s.current?.camera == true && s.current?.cameraLabel == "FaceTime HD Camera" && s.current?.cameraOpen == true)
    s.setBubbleVisible(false)
    #expect(s.current?.cameraOpen == false)
    // It stays hidden for the rest of this recording.
    _ = s.page(tab: 1, active: true, phase: .recording, elapsedMs: 0, mic: "on", camera: "FaceTime HD Camera", nowMs: 1, startAllowed: false)
    #expect(s.current?.bubbleVisible == false)
    s.setBubbleVisible(true)
    #expect(s.current?.cameraOpen == true)
    s.toggleBubbleSize()
    #expect(s.bubbleLarge && s.summary.contains("large=true"))
    // The camera failed: no bubble, and showing it again does nothing.
    s.cameraFailed()
    #expect(s.current?.camera == false && s.current?.cameraOpen == false)
    s.setBubbleVisible(true)
    #expect(s.current?.cameraOpen == false)
    // A new recording starts with the bubble shown.
    _ = s.page(tab: 1, active: false, phase: nil, elapsedMs: nil, mic: nil, camera: nil, nowMs: 2, startAllowed: false)
    _ = s.page(tab: 1, active: true, phase: .countdown, elapsedMs: 0, mic: "none", camera: "", nowMs: 3, startAllowed: true)
    #expect(s.current?.cameraOpen == true && s.current?.cameraLabel == "" && s.current?.mic == RecMic.none)
    #expect(s.summary == "rec=on phase=countdown mic=none camera=true bubble=true large=true tabs=1")
}

// MARK: Which tab may start

@Test func onlyTheTabInUseStartsWithAGraceForTheScreenPicker() {
    var g = RecStartGate()
    #expect(!g.allows(tab: 1, inUse: nil, nowMs: 0))
    g.observe(inUse: 1, nowMs: 0)
    #expect(g.allows(tab: 1, inUse: 1, nowMs: 0))
    #expect(!g.allows(tab: 2, inUse: 1, nowMs: 0))
    // The picker took the app out of the front: the tab that was in use may still start.
    g.observe(inUse: nil, nowMs: 1000)
    #expect(g.allows(tab: 1, inUse: nil, nowMs: 1000 + RecStartGate.graceMs))
    #expect(!g.allows(tab: 1, inUse: nil, nowMs: 1001 + RecStartGate.graceMs))
    #expect(!g.allows(tab: 2, inUse: nil, nowMs: 2000))
    // Later observations while away do not move the time it was lost.
    g.observe(inUse: nil, nowMs: 50_000)
    #expect(g.lostAt == 1000)
    // Another tab came to the front since: the first one no longer starts.
    g.observe(inUse: 2, nowMs: 3000)
    g.observe(inUse: nil, nowMs: 4000)
    #expect(!g.allows(tab: 1, inUse: nil, nowMs: 4000))
    #expect(g.allows(tab: 2, inUse: nil, nowMs: 4000))
}

// MARK: Places

@Test func barAndBubblePlaces() {
    let a: RecLayout.Area = (0, 0, 1440, 875)
    // Bottom left with a margin; the bar to its right, aligned at the bottom.
    let b = RecLayout.defaultBubble(a, size: RecLayout.small)
    #expect(b.x == 24 && b.y == 24)
    let bar = RecLayout.defaultBar(a, bubble: (x: b.x, y: b.y, size: RecLayout.small))
    #expect(bar.x == 24 + 168 + 12 && bar.y == 24)
    let alone = RecLayout.defaultBar(a, bubble: nil)
    #expect(alone.x == 24 && alone.y == 24)
    // Off the screen: back inside.
    let fitted = RecLayout.fit(2000, -50, width: 168, height: 168, in: a)
    #expect(fitted.x == 1440 - 168 && fitted.y == 0)
    // Growing at the bottom left grows up and right; at the top right, down and left.
    let low = RecLayout.resizeKeepingCorner(24, 24, old: RecLayout.small, new: RecLayout.large, in: a)
    #expect(low.x == 24 && low.y == 24)
    let high = RecLayout.resizeKeepingCorner(1248, 683, old: RecLayout.small, new: RecLayout.large, in: a)
    #expect(high.x == 1248 + 168 - 280 && high.y == 683 + 168 - 280)
    // A second screen with its own origin.
    let left: RecLayout.Area = (-1920, 100, 1920, 1080)
    let lb = RecLayout.defaultBubble(left, size: RecLayout.large)
    #expect(lb.x == -1896 && lb.y == 124)
}

// MARK: Shortcuts

@Test func recShortcuts() {
    #expect(RecShortcuts.toggle.label == "⌥⇧P" && RecShortcuts.stop.label == "⌥⇧S")
    #expect(RecShortcuts.toggleFallback.label == "⌃⌥P" && RecShortcuts.stopFallback.label == "⌃⌥S")
    // None of them is a dictation shortcut.
    for s in [RecShortcuts.toggle, RecShortcuts.stop, RecShortcuts.toggleFallback, RecShortcuts.stopFallback] {
        #expect(!DictationShortcut.choices.contains(s) && s != DictationShortcut.pasteLast && s != DictationShortcut.escape)
    }
}

// MARK: Marks

@Test func recMarksTheMenuBarAndKeepsTheIndicatorForMeetings() {
    #expect(CaptureState(rec: true).forcesMenuBarItem)
    #expect(CaptureState(rec: true).statusKey == .statusRec)
    #expect(CaptureState(meeting: true, rec: true).statusKey == .statusMeeting)
    #expect(CaptureState(systemAudio: true, rec: true).statusKey == .statusRec)
    let rec = CaptureState(systemAudio: true, rec: true)
    #expect(StatusMenuItem.items(signedIn: nil, unread: 0, capture: rec) == [
        .open, .newTab, .newWindow, .separator, .capturing(rec), .openRec, .stopRec, .stopSystemAudio,
        .separator, .settings, .separator, .quit,
    ])
    // Rec's bar marks the computer's audio of its recording; a meeting still gets the indicator.
    #expect(!RecordingIndicatorRules.shouldShow(meeting: false, systemAudio: true, recBar: true, enabled: true, dismissed: false, inFront: false))
    #expect(RecordingIndicatorRules.shouldShow(meeting: true, systemAudio: true, recBar: true, enabled: true, dismissed: false, inFront: false))
    #expect(RecordingIndicatorRules.shouldShow(meeting: false, systemAudio: true, recBar: false, enabled: true, dismissed: false, inFront: false))
}
