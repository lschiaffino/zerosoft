import Foundation
import Testing
@testable import ZerosoftCore

private let server = "https://zerosoft.ai"
private let main = BridgeFrame(isMainFrame: true, scheme: "https", host: "zerosoft.ai", port: 0)

private func check(_ body: Any, frame: BridgeFrame = main, server s: String = server) -> Result<BridgeRequest, BridgeRejection> {
    Bridge.validate(body: body, frame: frame, server: s)
}

private func rejection(_ body: Any, frame: BridgeFrame = main, server s: String = server) -> BridgeRejection? {
    if case let .failure(r) = check(body, frame: frame, server: s) { return r }
    return nil
}

private func accepted(_ body: Any) -> BridgeRequest? {
    if case let .success(r) = check(body) { return r }
    return nil
}

private func frame(_ scheme: String, _ host: String, _ port: Int = 0, main: Bool = true) -> BridgeFrame {
    BridgeFrame(isMainFrame: main, scheme: scheme, host: host, port: port)
}

// MARK: Origin

@Test func originOfTheServerMainFrameIsAllowed() {
    #expect(Bridge.originAllowed(main, server: server))
    #expect(Bridge.originAllowed(frame("https", "ZeroSoft.AI"), server: server))
    #expect(Bridge.originAllowed(frame("HTTPS", "zerosoft.ai", 443), server: server))
    #expect(Bridge.originAllowed(frame("http", "127.0.0.1", 3000), server: "http://127.0.0.1:3000"))
    #expect(Bridge.originAllowed(frame("http", "localhost", 0), server: "http://localhost"))
}

@Test func otherOriginsAreRejected() {
    // Scheme, host and port must all match.
    #expect(!Bridge.originAllowed(frame("http", "zerosoft.ai"), server: server))
    #expect(!Bridge.originAllowed(frame("https", "zerosoft.ai", 8443), server: server))
    #expect(!Bridge.originAllowed(frame("https", "evil.zerosoft.ai"), server: server))
    #expect(!Bridge.originAllowed(frame("https", "zerosoft.ai.evil.com"), server: server))
    #expect(!Bridge.originAllowed(frame("https", "evil.com"), server: server))
    #expect(!Bridge.originAllowed(frame("https", "zerosoftai"), server: server))
    // localhost and 127.0.0.1 are different origins.
    #expect(!Bridge.originAllowed(frame("http", "localhost", 3000), server: "http://127.0.0.1:3000"))
    #expect(!Bridge.originAllowed(frame("http", "127.0.0.1", 3001), server: "http://127.0.0.1:3000"))
    // Opaque origins (sandboxed iframe, data:, about:blank) and other schemes.
    #expect(!Bridge.originAllowed(frame("", ""), server: server))
    #expect(!Bridge.originAllowed(frame("https", ""), server: server))
    #expect(!Bridge.originAllowed(frame("file", ""), server: server))
    #expect(!Bridge.originAllowed(frame("zerosoft", "zerosoft.ai"), server: server))
    #expect(!Bridge.originAllowed(frame("https", "zerosoft.ai", -1), server: server))
    #expect(!Bridge.originAllowed(frame("https", "zerosoft.ai", 70000), server: server))
}

@Test func iframesAreRejectedEvenOnTheServerOrigin() {
    #expect(!Bridge.originAllowed(frame("https", "zerosoft.ai", main: false), server: server))
    #expect(!Bridge.originAllowed(frame("https", "evil.com", main: false), server: server))
    #expect(rejection(["cmd": "info"], frame: frame("https", "zerosoft.ai", main: false)) == .origin)
}

@Test func originIsCheckedBeforeTheBody() {
    // A wrong origin never reaches the parser: not even a valid command passes.
    #expect(rejection(["cmd": "info", "args": [:]], frame: frame("https", "evil.com")) == .origin)
    #expect(rejection("garbage", frame: frame("https", "evil.com")) == .origin)
}

// MARK: Envelope

@Test func malformedBodiesAreRejected() {
    #expect(rejection("info") == .malformed)
    #expect(rejection(42) == .malformed)
    #expect(rejection(NSNull()) == .malformed)
    #expect(rejection(["info"]) == .malformed)
    #expect(rejection([String: Any]()) == .malformed)
    #expect(rejection(["cmd": 1]) == .malformed)
    #expect(rejection(["cmd": "info", "extra": true]) == .malformed)
    #expect(rejection(["cmd": "info", "args": Date()]) == .malformed)
    #expect(rejection(["cmd": "info", "args": ["x": Data([1])]]) == .malformed)
    #expect(rejection(["cmd": "recLevel", "args": ["level": Double.nan]]) == .malformed)
}

@Test func unknownCommandsAreRejected() {
    #expect(rejection(["cmd": "eval"]) == .unknownCommand)
    #expect(rejection(["cmd": "Info"]) == .unknownCommand)
    #expect(rejection(["cmd": "desktop_info"]) == .unknownCommand)
    #expect(rejection(["cmd": "openURL", "args": ["url": "file:///etc/passwd"]]) == .unknownCommand)
    #expect(rejection(["cmd": "shell", "args": ["cmd": "rm -rf /"]]) == .unknownCommand)
    #expect(rejection(["cmd": ""]) == .unknownCommand)
}

@Test func oversizeMessagesAreRejected() {
    let long = String(repeating: "x", count: Bridge.maxStringBytes + 1)
    #expect(rejection(["cmd": "notify", "args": ["title": long]]) == .tooLarge)
    #expect(rejection(["cmd": long]) == .tooLarge)
    // Many strings under the per-string cap still hit the total.
    var many: [String: Any] = [:]
    for i in 0 ..< 10 { many["k\(i)"] = String(repeating: "y", count: 4000) }
    #expect(rejection(["cmd": "notify", "args": many]) == .tooLarge)
    // Too many values, or too deep.
    #expect(rejection(["cmd": "info", "args": ["list": Array(repeating: 1, count: 100)]]) == .tooLarge)
    #expect(rejection(["cmd": "info", "args": ["a": ["b": ["c": ["d": 1]]]]]) == .tooLarge)
    #expect(rejection(["cmd": "info", "args": [String(repeating: "k", count: 65): 1]]) == .tooLarge)
}

// MARK: Typed arguments

@Test func infoAndArgumentlessCommands() {
    #expect(accepted(["cmd": "info"]) == .info)
    #expect(accepted(["cmd": "info", "args": [:]]) == .info)
    #expect(accepted(["cmd": "info", "args": NSNull()]) == .info)
    #expect(rejection(["cmd": "info", "args": ["x": 1]]) == .badArgs)
    #expect(rejection(["cmd": "info", "args": "x"]) == .badArgs)
    #expect(rejection(["cmd": "info", "args": [1]]) == .badArgs)
    #expect(accepted(["cmd": "startLogin"]) == .startLogin)
    #expect(accepted(["cmd": "systemAudioRead", "args": [:]]) == .systemAudioRead)
    #expect(rejection(["cmd": "openSettings", "args": ["section": "x"]]) == .badArgs)
}

@Test func readyReport() {
    let body: [String: Any] = ["cmd": "ready", "args": ["content": 3, "features": ["wasm": false, "idb": true]]]
    #expect(accepted(body) == .ready(ReadyReport(content: 3, features: ["wasm": false, "idb": true])))
    #expect(accepted(["cmd": "ready"]) == .ready(ReadyReport(content: 0, features: [:])))
    // Features are booleans from the closed list.
    #expect(rejection(["cmd": "ready", "args": ["features": ["wasm": 1]]]) == .badArgs)
    #expect(rejection(["cmd": "ready", "args": ["features": ["cookie": true]]]) == .badArgs)
    #expect(rejection(["cmd": "ready", "args": ["content": -1]]) == .badArgs)
    #expect(rejection(["cmd": "ready", "args": ["content": 1.5]]) == .badArgs)
    #expect(rejection(["cmd": "ready", "args": ["content": true]]) == .badArgs)
    #expect(ReadyReport(content: 2, features: ["wasm": true]).summary == "content=2 wasm=true idb=? sw=? media=? rtc=? audio=? notification=?")
}

@Test func notifyClipsLikeTheRustCommand() {
    let title = String(repeating: "t", count: 300)
    let body = String(repeating: "b", count: 900)
    #expect(accepted(["cmd": "notify", "args": ["title": title, "body": body]])
        == .notify(title: String(repeating: "t", count: 200), body: String(repeating: "b", count: 500)))
    #expect(accepted(["cmd": "notify", "args": ["title": "a\u{0}b\nc", "body": NSNull()]]) == .notify(title: "abc", body: nil))
    #expect(rejection(["cmd": "notify", "args": [:]]) == .badArgs)
    #expect(rejection(["cmd": "notify", "args": ["title": 5]]) == .badArgs)
}

@Test func booleansAndNumbersAreNotConfused() {
    // A JS boolean arrives as CFBoolean, a number as another NSNumber: neither passes for the other.
    #expect(rejection(["cmd": "recording", "args": ["active": NSNumber(value: 1)]]) == .badArgs)
    #expect(accepted(["cmd": "recording", "args": ["active": NSNumber(value: true)]]) == .recording(active: true, startedAt: nil, path: nil))
    #expect(rejection(["cmd": "recLevel", "args": ["level": true]]) == .badArgs)
}

@Test func pathsAreValidatedLikeSessionRs() {
    #expect(Bridge.validPath("/app/talk?x=1#y"))
    #expect(!Bridge.validPath("app"))
    #expect(!Bridge.validPath("//evil.com/x"))
    #expect(!Bridge.validPath("/a\\b"))
    #expect(!Bridge.validPath("/a b"))
    #expect(!Bridge.validPath("/a\u{7}"))
    #expect(!Bridge.validPath("https://evil.com/"))
    #expect(!Bridge.validPath("/" + String(repeating: "a", count: Bridge.maxPath)))
    #expect(Bridge.validPath("/" + String(repeating: "a", count: Bridge.maxPath - 1)))

    #expect(accepted(["cmd": "recording", "args": ["active": true, "startedAt": 1_700_000_000_000.0, "path": "/app/voice/m1"]])
        == .recording(active: true, startedAt: 1_700_000_000_000, path: "/app/voice/m1"))
    #expect(rejection(["cmd": "recording", "args": ["active": true, "path": "//evil.com"]]) == .badArgs)
    #expect(rejection(["cmd": "tabs", "args": ["action": "open", "path": "javascript:alert(1)"]]) == .badArgs)
}

@Test func tabsActionsAreAClosedList() {
    #expect(accepted(["cmd": "tabs", "args": ["action": "open-tab", "path": "/app/docs"]])
        == .tabs(action: .openTab, path: "/app/docs", title: nil, n: nil))
    #expect(accepted(["cmd": "tabs", "args": ["action": "select", "n": 3]]) == .tabs(action: .select, path: nil, title: nil, n: 3))
    #expect(rejection(["cmd": "tabs", "args": ["action": "close-all"]]) == .badArgs)
    #expect(rejection(["cmd": "tabs", "args": [:]]) == .badArgs)
    #expect(rejection(["cmd": "tabs", "args": ["action": "select", "n": 1000]]) == .badArgs)
    #expect(rejection(["cmd": "tabs", "args": ["action": "state", "url": "/x"]]) == .badArgs)
}

@Test func recOverlayAndLevel() {
    #expect(accepted(["cmd": "recOverlay", "args": ["active": true, "phase": "paused", "elapsedMs": 1200, "mic": "on", "camera": NSNull()]])
        == .recOverlay(active: true, phase: .paused, elapsedMs: 1200, mic: "on", camera: nil))
    #expect(rejection(["cmd": "recOverlay", "args": ["active": true, "phase": "setup"]]) == .badArgs)
    #expect(rejection(["cmd": "recOverlay", "args": ["active": true, "elapsedMs": -5]]) == .badArgs)
    #expect(accepted(["cmd": "recLevel", "args": ["level": 2]]) == .recLevel(1))
    #expect(accepted(["cmd": "recLevel", "args": ["level": -0.5]]) == .recLevel(0))
    #expect(rejection(["cmd": "recLevel", "args": [:]]) == .badArgs)
    #expect(rejection(["cmd": "recLevel", "args": ["level": "loud"]]) == .badArgs)
}

@Test func everyCommandHasASchema() {
    // Each allowlisted command parses its minimal valid arguments: the switch covers them all.
    let minimal: [BridgeCommand: [String: Any]] = [
        .notify: ["title": "t"], .recording: ["active": false], .recOverlay: ["active": false],
        .recLevel: ["level": 0.5], .tabs: ["action": "next"],
    ]
    for command in BridgeCommand.allCases {
        let body: [String: Any] = ["cmd": command.rawValue, "args": minimal[command] ?? [:]]
        #expect(accepted(body)?.command == command, "\(command)")
    }
    #expect(BridgeCommand.implemented == [
        .info, .ready, .startLogin, .openSettings, .notify, .tabs, .recording, .systemAudioStart, .systemAudioRead, .systemAudioStop,
    ])
    #expect(Set(BridgeCommand.allCases).subtracting(BridgeCommand.implemented) == [.recOverlay, .recLevel])
}

// MARK: info and the script

@Test func infoReply() {
    let info = BridgeInfo(version: "0.2.0", store: false, lockdown: .on)
    #expect(info.lockdown)
    #expect(info.reply["lockdown"] as? Bool == true)
    #expect(info.reply["lockdownSetting"] as? String == "on")
    #expect(info.reply["store"] as? Bool == false)
    #expect(info.reply["platform"] as? String == "darwin")
    // What this build does not have, so the web app hides it (lib/desktop-bridge.ts), and the
    // tabs (block 4) and the Settings window (block 5) it has.
    #expect(info.reply["updateFeed"] as? Bool == false)
    #expect(info.reply["tabs"] as? Bool == true)
    #expect(info.reply["settingsWindow"] as? Bool == true)
    #expect(info.reply["recordingIndicator"] as? Bool == true)
    #expect(info.reply["dictation"] as? Bool == true)
    #expect(JSONSerialization.isValidJSONObject(info.reply))
    #expect(!BridgeInfo(version: "1", store: true, lockdown: .system).lockdown)
    #expect(BridgeInfo(version: "1", store: true, lockdown: .off).reply["store"] as? Bool == true)
}

@Test func scriptChecksTheOriginAndEscapesValues() {
    let script = BridgeScript.source(server: "http://127.0.0.1:3000", info: BridgeInfo(version: "1\"; alert(1); \"", store: false, lockdown: .on))
    #expect(script.contains("if (location.origin !== \"http:\\/\\/127.0.0.1:3000\") return;"))
    #expect(script.contains("version: \"1\\\"; alert(1); \\\"\""))
    #expect(script.contains("lockdown: true"))
    #expect(script.contains("store: false"))
    #expect(script.contains("messageHandlers.zerosoft"))
    // startLogin is how desktopBridge() finds the app; the shim replaces window.Notification
    // after the features are measured.
    #expect(script.contains("startLogin: function () { call('startLogin')"))
    #expect(script.contains("settingsWindow: true") && script.contains("updateFeed: false") && script.contains("tabs: true"))
    #expect(script.contains("openSettings: function () { call('openSettings')"))
    let measured = script.range(of: "notification: typeof Notification")
    let shim = script.range(of: "Object.defineProperty(window, 'Notification'")
    #expect(measured != nil && shim != nil && measured!.lowerBound < shim!.lowerBound)
    #expect(BridgeScript.js("a\u{2028}b") == "\"a\\u2028b\"")
    // Tabs: the page reports its path and title, and only same-origin links become tab actions.
    #expect(script.contains("tabs({ action: 'state', path: p, title: t })"))
    #expect(script.contains("u.origin === location.origin && p.length <= \(Bridge.maxPath)"))
    #expect(script.contains("u.pathname.indexOf('/api/') === 0) return null"))
    #expect(script.contains("action: e.altKey ? 'open-window' : e.shiftKey ? 'open-tab' : 'open'"))
    // The JS regex keeps its backslashes (\s, not s).
    #expect(script.contains("/^zerosoft(\\s*[·|]|$)/i"))
    // Meetings (block 7): forced Lockdown has no Web Audio, so no computer audio is offered.
    #expect(script.contains("systemAudio: false") && script.contains("recordingIndicator: true"))
    #expect(script.contains("systemAudioStart: function () { return call('systemAudioStart'); }"))
    #expect(script.contains("recording: function (s) {"))
    let open = BridgeScript.source(server: "http://127.0.0.1:3000", info: BridgeInfo(version: "1", store: false, lockdown: .off, systemAudio: true))
    #expect(open.contains("systemAudio: true"))
}
