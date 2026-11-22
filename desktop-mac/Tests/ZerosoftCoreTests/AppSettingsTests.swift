import Foundation
import Testing
@testable import ZerosoftCore

// MARK: settings.json

@Test func settingsDefaultsAndRoundTrip() {
    let fresh = AppSettings.decode(nil)
    #expect(!fresh.onboarded && fresh.menuBarItem)
    var s = AppSettings()
    s.onboarded = true
    s.menuBarItem = false
    let back = AppSettings.decode(s.encoded())
    #expect(back == s)
    #expect(back.summary == "onboarded=true menubar=false")
}

@Test func settingsFileHoldsOnlyItsSwitches() throws {
    var s = AppSettings()
    s.onboarded = true
    s.indicatorPosition = IndicatorPosition(x: 10, y: 20)
    let raw = try #require(try JSONSerialization.jsonObject(with: s.encoded()) as? [String: Any])
    #expect(Set(raw.keys) == AppSettings.keys)
    // Switches, the version, two names from closed lists and one point only: nothing that could
    // be a token, an address or page text.
    #expect((raw["indicatorPosition"] as? [Double]) == [10, 20])
    // Without a position the key is not written.
    let plain = try #require(try JSONSerialization.jsonObject(with: AppSettings().encoded()) as? [String: Any])
    #expect(Set(plain.keys) == AppSettings.keys.subtracting(["indicatorPosition"]))
    for (key, value) in raw where !["version", "shortcut", "mode", "indicatorPosition"].contains(key) {
        let n = try #require(value as? NSNumber, "\(key)")
        #expect(CFGetTypeID(n) == CFBooleanGetTypeID(), "\(key)")
    }
    #expect(raw["version"] as? Int == AppSettings.fileVersion)
    #expect(DictationShortcut.choices.map(\.name).contains(try #require(raw["shortcut"] as? String)))
    #expect(DictationMode.allCases.map(\.rawValue).contains(try #require(raw["mode"] as? String)))
}

@Test func settingsIgnoreWrongTypesAndJunk() {
    let wrong = Data(#"{"onboarded":"yes","menuBarItem":0,"token":"x"}"#.utf8)
    #expect(AppSettings.decode(wrong) == AppSettings())
    #expect(AppSettings.decode(Data("not json".utf8)) == AppSettings())
    #expect(AppSettings.decode(Data("[true]".utf8)) == AppSettings())
    let partial = AppSettings.decode(Data(#"{"menuBarItem":false}"#.utf8))
    #expect(!partial.menuBarItem && !partial.onboarded)
    // A huge file is not read.
    let big = Data(("{\"onboarded\":true,\"pad\":\"" + String(repeating: "a", count: 70_000) + "\"}").utf8)
    #expect(AppSettings.decode(big) == AppSettings())
    // Unknown keys are not written back.
    let again = AppSettings.decode(Data(#"{"onboarded":true,"email":"a@b.c"}"#.utf8)).encoded()
    #expect(!String(decoding: again, as: UTF8.self).contains("email"))
}

@Test func tabPrefsSummaryAndSessionRoundTrip() {
    var p = TabPrefs()
    #expect(p.summary == "suspend=true minutes=30 restore=true links=tab")
    p.suspend = false
    p.suspendMinutes = 240
    p.links = .window
    var session = TabSession(prefs: p, server: "https://zerosoft.ai")
    _ = session.newWindow("/app")
    let back = TabSession.decode(session.encoded(), server: "https://zerosoft.ai")
    #expect(back.prefs == p)
    #expect(back.prefs.summary == "suspend=false minutes=240 restore=true links=window")
}

// MARK: Login item, notifications, onboarding, menu

@Test func loginItemStates() {
    #expect(LoginItemState.enabled.isOn && LoginItemState.needsApproval.isOn)
    #expect(!LoginItemState.disabled.isOn && !LoginItemState.unavailable.isOn)
}

@Test func notificationPromptOnlyFromTheButton() {
    #expect(NotificationAccess.notDetermined.buttonAction == .ask)
    #expect(NotificationAccess.denied.buttonAction == .openSystemSettings)
    #expect(NotificationAccess.allowed.buttonAction == .none)
    // Nothing is delivered (and so nothing triggers a prompt) until the person allowed it.
    #expect(NotificationAccess.allowed.mayDeliver)
    #expect(!NotificationAccess.notDetermined.mayDeliver && !NotificationAccess.denied.mayDeliver)
}

@Test func onboardingShowsOnceAndNotInTests() {
    var s = AppSettings()
    #expect(OnboardingStep.shouldShow(s, testing: false, forced: false))
    #expect(!OnboardingStep.shouldShow(s, testing: true, forced: false))
    #expect(OnboardingStep.shouldShow(s, testing: true, forced: true))
    s.onboarded = true
    #expect(!OnboardingStep.shouldShow(s, testing: false, forced: false))
    #expect(OnboardingStep.shouldShow(s, testing: false, forced: true))
    #expect(OnboardingStep.welcome.next == .dictation && OnboardingStep.dictation.next == .notifications)
    #expect(OnboardingStep.done.next == nil)
    #expect(OnboardingStep.welcome.previous == nil && OnboardingStep.done.previous == .startup)
}

@Test func statusMenuItems() {
    #expect(StatusMenuItem.items(signedIn: nil, unread: 0) == [.open, .newTab, .newWindow, .separator, .settings, .separator, .quit])
    #expect(StatusMenuItem.items(signedIn: true, unread: 3) == [
        .open, .newTab, .newWindow, .separator, .unread(3), .separator, .settings, .signOut, .separator, .quit,
    ])
    #expect(StatusMenuItem.items(signedIn: false, unread: 0).contains(.signIn))
    #expect(!StatusMenuItem.items(signedIn: false, unread: 0).contains(.signOut))
    // Dictation (block 6): start or stop, the hint while idle, paste last, the saved ones, history.
    let idle = DictationMenuState(phase: .idle, mode: .both, pending: 0)
    #expect(StatusMenuItem.items(signedIn: true, unread: 0, dictation: idle) == [
        .open, .newTab, .newWindow, .separator, .dictate(recording: false), .dictateHint, .pasteLast, .history,
        .separator, .settings, .signOut, .separator, .quit,
    ])
    let recording = DictationMenuState(phase: .recording, mode: .both, pending: 2)
    let list = StatusMenuItem.items(signedIn: nil, unread: 0, dictation: recording)
    #expect(list.contains(.dictate(recording: true)) && !list.contains(.dictateHint) && list.contains(.retry(2)))
    #expect(!StatusMenuItem.items(signedIn: nil, unread: 0, dictation: DictationMenuState(phase: .idle, mode: .toggle, pending: 0)).contains(.dictateHint))
}

@Test func dictationSettingsRoundTripAndDefaults() {
    let fresh = AppSettings()
    // The Tauri app's defaults (config.rs) and the privacy facts' controls.
    #expect(fresh.shortcut.name == "Alt+Space" && fresh.mode == .both)
    #expect(fresh.autoPaste && fresh.restoreClipboard && fresh.sendAppName && fresh.keepFailedDictations)
    var s = fresh
    s.shortcut = DictationShortcut.named("F5")!
    s.mode = .toggle
    s.autoPaste = false
    s.keepFailedDictations = false
    let back = AppSettings.decode(s.encoded())
    #expect(back == s)
    #expect(back.dictationSummary == "shortcut=F5 mode=toggle paste=false restore=true app=true keep=false")
    // Names outside the closed lists keep the defaults.
    let junk = AppSettings.decode(Data(#"{"shortcut":"Command+Q","mode":"always","autoPaste":"no"}"#.utf8))
    #expect(junk.shortcut == .standard && junk.mode == .both && junk.autoPaste)
}

@Test func microphonePromptOnlyFromTheButtonOrADictation() {
    #expect(MicrophoneAccess.notDetermined.buttonAction == .ask)
    #expect(MicrophoneAccess.denied.buttonAction == .openSystemSettings)
    #expect(MicrophoneAccess.allowed.buttonAction == .none)
}

@Test func settingsSectionsOrder() {
    #expect(SettingsSection.allCases.map(\.rawValue) == ["general", "tabs", "meetings", "permissions", "voice", "dictionary", "history", "account"])
}
