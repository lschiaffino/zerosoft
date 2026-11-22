import Foundation
import Testing
@testable import ZerosoftCore

// Block 6 of docs/desktop-swift.md: the WAV encoder, the hold/toggle state machine, the
// clipboard restore rules and the retry policy (ports of audio.rs, dictation.rs, clipboard.rs and
// retry.rs, with their tests).

// MARK: WAV

@Test func wavHeader() {
    let w = [UInt8](WAV.bytes([0, 1, -1], rate: 16_000))
    #expect(Array(w[0 ..< 4]) == Array("RIFF".utf8))
    #expect(Array(w[8 ..< 16]) == Array("WAVEfmt ".utf8))
    func u32(_ at: Int) -> UInt32 { w[at ..< at + 4].reversed().reduce(0) { $0 << 8 | UInt32($1) } }
    func i16(_ at: Int) -> Int16 { Int16(bitPattern: UInt16(w[at]) | UInt16(w[at + 1]) << 8) }
    #expect(u32(4) == 36 + 6)
    #expect(u32(24) == 16_000)
    #expect(u32(28) == 32_000)
    #expect(u32(40) == 6)
    #expect(i16(46) == 32767 && i16(48) == -32767)
    #expect(w.count == 44 + 6)
    // Out of range and NaN are clamped, never a crash.
    let odd = [UInt8](WAV.bytes([2, -3, .nan], rate: 16_000))
    #expect(Int16(bitPattern: UInt16(odd[44]) | UInt16(odd[45]) << 8) == 32767)
    #expect(Int16(bitPattern: UInt16(odd[48]) | UInt16(odd[49]) << 8) == 0)
}

@Test func resample48kTo16k() {
    let s = (0 ..< 48_000).map { Float($0) / 48_000 }
    let r = WAV.resample(s, from: 48_000, to: 16_000)
    #expect(r.count == 16_000)
    #expect(abs(r[8_000] - 0.5) < 0.001)
    #expect(WAV.resample(Array(s[0 ..< 10]), from: 16_000, to: 16_000).count == 10)
    #expect(WAV.resample([], from: 44_100, to: 16_000).isEmpty)
    #expect(WAV.resample([1, 2], from: 0, to: 16_000) == [1, 2])
}

@Test func silenceIsDetected() {
    #expect(!WAV.encode(RecordedAudio(samples: Array(repeating: 0, count: 4_800), rate: 48_000)).heard)
    let (wav, heard) = WAV.encode(RecordedAudio(samples: Array(repeating: 0.2, count: 4_800), rate: 48_000))
    #expect(heard)
    #expect(wav.count == 44 + 1_600 * 2)
    #expect(RecordedAudio(samples: Array(repeating: 0, count: 48_000), rate: 48_000).durationMs == 1000)
    #expect(RecordedAudio(samples: [0], rate: 0).durationMs == 0)
}

// MARK: Shortcut and state machine

@Test func shortcutChoicesAndLabels() {
    #expect(DictationShortcut.choices.map(\.name) == [
        "Alt+Space", "Control+Alt+Space", "Control+Shift+Space", "Alt+Shift+Space", "CommandOrControl+Shift+D", "F5",
    ])
    #expect(DictationShortcut.standard.label == "⌥ Space")
    #expect(DictationShortcut.named("Control+Alt+Space")?.label == "⌃⌥ Space")
    #expect(DictationShortcut.named("CommandOrControl+Shift+D")?.label == "⇧⌘D")
    #expect(DictationShortcut.named("F5")?.label == "F5")
    #expect(DictationShortcut.pasteLast.label == "⌃⌘V")
    #expect(DictationShortcut.escape.modifiers == 0)
    #expect(DictationShortcut.named("Command+Q") == nil && DictationShortcut.named(nil) == nil)
    // Every choice has a modifier, except the function key.
    for c in DictationShortcut.choices where c.name != "F5" { #expect(c.modifiers != 0, "\(c.name)") }
}

@Test func holdToTalk() {
    var m = DictationMachine()
    #expect(m.shortcut(pressed: true, at: 0, mode: .both) == .start(handsFree: false))
    #expect(m.phase == .recording && m.keyDown)
    // Repeats while held are not presses.
    #expect(m.shortcut(pressed: true, at: 0.5, mode: .both) == .none)
    #expect(m.shortcut(pressed: false, at: 1.2, mode: .both) == .stop)
    #expect(m.phase == .working && !m.keyDown)
    // Pressing again while the text is on its way does nothing.
    #expect(m.shortcut(pressed: true, at: 1.5, mode: .both) == .none)
    #expect(m.shortcut(pressed: false, at: 1.6, mode: .both) == .none)
    m.finished(generation: m.generation)
    #expect(m.phase == .idle)
}

@Test func quickTapIsHandsFreeInBothMode() {
    var m = DictationMachine()
    #expect(m.shortcut(pressed: true, at: 0, mode: .both) == .start(handsFree: false))
    #expect(m.shortcut(pressed: false, at: 0.1, mode: .both) == .becameHandsFree)
    #expect(m.handsFree && m.phase == .recording)
    // The next tap finishes.
    #expect(m.shortcut(pressed: true, at: 3, mode: .both) == .stop)
    #expect(m.shortcut(pressed: false, at: 3.05, mode: .both) == .none)
    #expect(m.phase == .working)
}

@Test func quickTapCancelsInHoldMode() {
    var m = DictationMachine()
    let first = m.generation
    #expect(m.shortcut(pressed: true, at: 0, mode: .hold) == .start(handsFree: false))
    #expect(m.shortcut(pressed: false, at: 0.1, mode: .hold) == .cancel)
    #expect(m.phase == .idle && m.generation == first + 2)
}

@Test func toggleMode() {
    var m = DictationMachine()
    #expect(m.shortcut(pressed: true, at: 0, mode: .toggle) == .start(handsFree: true))
    #expect(m.shortcut(pressed: false, at: 2, mode: .toggle) == .none)
    #expect(m.shortcut(pressed: true, at: 4, mode: .toggle) == .stop)
}

@Test func escapeMenuAndTimeout() {
    var m = DictationMachine()
    #expect(m.escape() == .none)
    #expect(m.toggle() == .start(handsFree: true))
    let g = m.generation
    #expect(m.escape() == .cancel)
    #expect(m.phase == .idle)
    // The timer of the cancelled dictation does nothing to the next one.
    #expect(m.toggle() == .start(handsFree: true))
    #expect(m.timeout(generation: g) == .none)
    #expect(m.timeout(generation: m.generation) == .stop)
    #expect(m.toggle() == .none)
    // A late finish of an older dictation leaves the current one alone.
    m.finished(generation: g)
    #expect(m.phase == .working)
    m.finished(generation: m.generation)
    #expect(m.phase == .idle)
}

@Test func lostReleaseDoesNotBlockTheShortcut() {
    var m = DictationMachine()
    #expect(m.shortcut(pressed: true, at: 0, mode: .toggle) == .start(handsFree: true))
    // No release arrived; a press much later still counts.
    #expect(m.shortcut(pressed: true, at: 10, mode: .toggle) == .stop)
}

@Test func contextFromTheAppName() {
    #expect(DictationContext.of(app: "Microsoft Outlook") == "email")
    #expect(DictationContext.of(app: "Slack") == "chat")
    #expect(DictationContext.of(app: "Notion") == "note")
    #expect(DictationContext.of(app: "Figma") == "other")
    #expect(DictationContext.of(app: "") == "other")
    #expect(DictationContext.of(app: "Mailchimp Desktop") == "other")
}

// MARK: Request and answer

@Test func dictationEndpointsAreInThePrivacyFacts() throws {
    #expect(DictationEndpoint.all.map(\.fact) == ["POST /api/voice/dictate", "GET /api/voice/dictate"])
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let facts = try Data(contentsOf: root.appendingPathComponent("desktop/privacy-facts.json"))
    let json = try #require(try JSONSerialization.jsonObject(with: facts) as? [String: Any])
    let network = try #require(json["network"] as? [[String: Any]])
    let listed = Set(network.flatMap { ($0["endpoints"] as? [String]) ?? [] })
    for e in DictationEndpoint.all { #expect(listed.contains(e.fact), "\(e.fact)") }
    // The limits the code uses are the ones the privacy page states.
    let limits = try #require(json["limits"] as? [String: Int])
    #expect(limits["pendingMax"] == PendingStore.maxCount)
    #expect(Int64(limits["pendingDays"] ?? 0) * 86_400_000 == PendingStore.maxAgeMs)
    #expect(limits["dictationMaxSeconds"] == Int(DictationMachine.maxSeconds))
    #expect(limits["clipboardRestoreMs"] == PasteFlow.settleMs)
}

@Test func dictationRequestStaysOnTheServer() throws {
    let server = "https://zerosoft.ai"
    let post = try #require(DictationEndpoint.dictate.request(server: server, body: Data("x".utf8), boundary: "b"))
    #expect(post.url?.absoluteString == "https://zerosoft.ai/api/voice/dictate")
    #expect(post.httpMethod == "POST")
    #expect(post.value(forHTTPHeaderField: "Origin") == server)
    #expect(post.value(forHTTPHeaderField: "Content-Type") == "multipart/form-data; boundary=b")
    let warm = try #require(DictationEndpoint.warm.request(server: server))
    #expect(warm.httpMethod == "GET" && warm.httpBody == nil && warm.value(forHTTPHeaderField: "Origin") == nil)
    #expect(DictationEndpoint.dictate.request(server: "http://127.0.0.1:4100")?.url?.port == 4100)
}

@Test func multipartBody() {
    let wav = WAV.bytes([0.1, -0.1], rate: 16_000)
    let upload = DictationUpload(wav: wav, durationMs: 1200, sourceApp: "Mail\r\n\"x", context: "email")
    let boundary = DictationUpload.boundary(123_456)
    #expect(boundary.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" })
    let body = upload.body(boundary: boundary)
    let text = String(decoding: body, as: UTF8.self)
    #expect(text.contains("name=\"context\"\r\n\r\nemail\r\n"))
    // Line breaks and quotes never reach a form value.
    #expect(text.contains("name=\"sourceApp\"\r\n\r\nMailx\r\n"))
    #expect(text.contains("name=\"durationMs\"\r\n\r\n1200\r\n"))
    #expect(text.contains("name=\"capture\"\r\n\r\ndesktop\r\n"))
    #expect(text.contains("name=\"fast\"\r\n\r\n1\r\n"))
    #expect(text.contains("filename=\"dictation.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFF"))
    #expect(text.hasSuffix("\r\n--\(boundary)--\r\n"))
    #expect(body.range(of: wav) != nil)
    // Without an app name: "desktop" and the category "other".
    let bare = String(decoding: DictationUpload(wav: wav, durationMs: 1, sourceApp: "", context: "bogus").body(boundary: "b"), as: UTF8.self)
    #expect(bare.contains("name=\"sourceApp\"\r\n\r\ndesktop\r\n") && bare.contains("name=\"context\"\r\n\r\nother\r\n"))
    #expect(DictationUpload.clean(String(repeating: "a", count: 300)).count == DictationUpload.maxSourceApp)
}

@Test func classifiesServerAnswers() {
    func d(_ s: String) -> Data { Data(s.utf8) }
    #expect(DictationOutcome.classify(status: 201, body: d(#"{"text":"  hola  "}"#)) == .text("hola"))
    #expect(DictationOutcome.classify(status: nil, body: nil) == .failed(.offline))
    #expect(DictationOutcome.classify(status: 401, body: nil) == .failed(.signedOut))
    #expect(DictationOutcome.classify(status: 429, body: nil) == .failed(.rateLimited))
    #expect(DictationOutcome.classify(status: 413, body: nil) == .failed(.tooLarge))
    #expect(DictationOutcome.classify(status: 400, body: d(#"{"error":"empty_audio"}"#)) == .failed(.empty))
    #expect(DictationOutcome.classify(status: 400, body: d(#"{"error":"audio_too_large"}"#)) == .failed(.tooLarge))
    #expect(DictationOutcome.classify(status: 502, body: d(#"{"error":"transcribe_failed"}"#)) == .failed(.server))
    #expect(DictationOutcome.classify(status: 201, body: d(#"{"text":""}"#)) == .failed(.empty))
    #expect(DictationOutcome.classify(status: 200, body: nil) == .failed(.server))
    #expect(DictationOutcome.classify(status: 200, body: d("not json")) == .failed(.server))
    #expect(DictationOutcome.classify(status: 400, body: d(#"{"error":"audio_type"}"#)) == .failed(.rejected))
    let long = String(repeating: "a", count: 30_000)
    #expect(DictationOutcome.classify(status: 201, body: d(#"{"text":"\#(long)"}"#)) == .text(String(long.prefix(DictationOutcome.maxText))))
}

@Test func keepsAudioOnlyWhenTheAudioWasFine() {
    let kept = DictationFailure.allCases.filter(\.keepForRetry)
    #expect(kept == [.offline, .signedOut, .rateLimited, .server])
}

@Test func timingsFromTheServer() {
    let t = DictationTiming(totalMs: 900, audioMs: 20, requestMs: 800, insertMs: 80,
                            server: Data(#"{"text":"x","timings":{"transcribeMs":500,"cleanupMs":true,"totalMs":-1}}"#.utf8))
    #expect(t.transcribeMs == 500 && t.cleanupMs == nil && t.serverMs == nil)
    #expect(t.summary == "total=900 audio=20 request=800 insert=80 transcribe=500")
}

// MARK: Pending dictations

private func meta(_ id: String, _ createdAt: Int64, server: String = "") -> PendingMeta {
    PendingMeta(id: id, createdAt: createdAt, durationMs: 1000, sourceApp: "", context: "other", failure: .offline, server: server)
}

@Test func pendingIDs() {
    let id = PendingStore.newID(now: 1_700_000_000_000, random: 42)
    #expect(PendingStore.validID(id), "\(id)")
    #expect(!PendingStore.validID("../etc/passwd") && !PendingStore.validID("AB") && !PendingStore.validID("abc"))
    #expect(!PendingStore.validID("abcdefG") && !PendingStore.validID(String(repeating: "a", count: 41)))
}

@Test func pruneKeepsTheNewestWithinAWeek() {
    let now = 10 * PendingStore.maxAgeMs
    var list = (0 ..< PendingStore.maxCount + 3).map { meta(String(format: "id%06d", $0), now - Int64($0) * 1000) }
    list.append(meta("old000", now - PendingStore.maxAgeMs - 1))
    let (keep, drop) = PendingStore.prune(list.shuffled(), now: now)
    #expect(keep.count == PendingStore.maxCount)
    #expect(keep.first?.id == "id000000")
    #expect(drop.count == 4 && drop.contains { $0.id == "old000" })
}

@Test func pendingStoreRoundTrip() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("zs-pending-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = PendingStore(dir: dir)
    let now: Int64 = 1_700_000_000_000
    #expect(store.list(now: now).isEmpty)
    let m = meta(PendingStore.newID(now: now, random: 7), now, server: "https://zerosoft.ai")
    #expect(store.save(m, audio: Data("RIFFdata".utf8)))
    #expect(store.list(now: now) == [m])
    #expect(store.read(m.id, now: now)?.1 == Data("RIFFdata".utf8))
    // Only the user can read the files.
    let attrs = try FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent("\(m.id).audio").path)
    #expect((attrs[.posixPermissions] as? Int) == 0o600)
    store.markAttempt(m.id, failure: .server, now: now)
    #expect(store.list(now: now).first?.attempts == 1 && store.list(now: now).first?.failure == .server)
    // Only to the server it was recorded for.
    #expect(m.sameServer("https://zerosoft.ai") && !m.sameServer("https://intra.example.com"))
    #expect(meta("abcdef", now).sameServer("https://intra.example.com"))
    #expect(store.remove(m.id))
    #expect(store.list(now: now).isEmpty)
    #expect(!store.remove("../x"))
    #expect(store.read("../x", now: now) == nil)
}

@Test func pendingStoreDropsJunkAndExpired() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("zs-pending-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = PendingStore(dir: dir)
    let now: Int64 = 1_700_000_000_000
    let old = meta("aaaaaa1", now - PendingStore.maxAgeMs - 1)
    #expect(store.save(old, audio: Data("RIFF".utf8)))
    try Data("not json".utf8).write(to: dir.appendingPathComponent("bbbbbb2.json"))
    try Data("RIFF".utf8).write(to: dir.appendingPathComponent("cccccc3.audio"))
    // A description whose file name is not its id.
    let renamed = try JSONEncoder().encode(meta("dddddd4", now))
    try renamed.write(to: dir.appendingPathComponent("eeeeee5.json"))
    #expect(store.list(now: now).isEmpty)
    let left = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    #expect(left.isEmpty, "\(left)")
}

// MARK: Clipboard

/// A clipboard of strings; the snapshot is the list of "formats" that were on it.
@MainActor
private final class FakeBoard: ClipboardPort {
    var items: [String]
    var count = 0
    var restored = 0
    var cleared = 0
    var failWrite = false
    /// Something the person copies while the paste waits.
    var copiedMeanwhile: String?
    var seenAtTap: String?

    init(_ items: [String]) { self.items = items }

    func snapshot() -> [String]? { items }
    func isEmpty(_ s: [String]) -> Bool { s.isEmpty }
    func write(_ text: String) -> Int? {
        if failWrite { return nil }
        items = [text]
        count += 1
        return count
    }
    func changeCount() -> Int {
        if let c = copiedMeanwhile {
            items = [c]
            count += 1
            copiedMeanwhile = nil
        }
        return count
    }
    func restore(_ s: [String]) -> Bool {
        items = s
        count += 1
        restored += 1
        return true
    }
    func clear() {
        items = []
        count += 1
        cleared += 1
    }
}

@MainActor
private func paste(_ board: FakeBoard, restore: Bool, canTap: Bool, tapWorks: Bool = true) async -> (PasteResult, Bool) {
    let tap: (() -> Bool)? = canTap ? {
        board.seenAtTap = board.items.first
        return tapWorks
    } : nil
    return await PasteFlow.run(board, text: "dictado", tap: tap, restore: restore, wait: { _ in })
}

@MainActor
@Test func pastesAndRestores() async {
    let board = FakeBoard(["viejo", "<b>html</b>"])
    let (how, restored) = await paste(board, restore: true, canTap: true)
    #expect(how == .pasted && restored)
    // The key is posted with the dictation already on the clipboard.
    #expect(board.seenAtTap == "dictado")
    #expect(board.items == ["viejo", "<b>html</b>"])
}

@MainActor
@Test func doesNotClobberANewCopy() async {
    let board = FakeBoard(["viejo"])
    board.copiedMeanwhile = "copiado por la persona"
    let (_, restored) = await paste(board, restore: true, canTap: true)
    #expect(!restored)
    #expect(board.items == ["copiado por la persona"] && board.restored == 0)
}

@MainActor
@Test func emptyBeforeStaysEmpty() async {
    let board = FakeBoard([])
    let (_, restored) = await paste(board, restore: true, canTap: true)
    #expect(restored && board.cleared == 1 && board.items.isEmpty)
}

@MainActor
@Test func noRestoreLeavesTheDictation() async {
    let board = FakeBoard(["viejo"])
    #expect(await paste(board, restore: false, canTap: true).0 == .pasted)
    #expect(board.items == ["dictado"])
}

@MainActor
@Test func withoutThePasteKeyItOnlyCopies() async {
    let board = FakeBoard(["viejo"])
    let (how, restored) = await paste(board, restore: true, canTap: false)
    #expect(how == .copied && !restored)
    #expect(board.items == ["dictado"])
    // A key that could not be posted leaves the text copied.
    let other = FakeBoard(["viejo"])
    #expect(await paste(other, restore: true, canTap: true, tapWorks: false).0 == .copied)
    #expect(other.items == ["dictado"])
    let broken = FakeBoard(["viejo"])
    broken.failWrite = true
    #expect(await paste(broken, restore: true, canTap: true).0 == .failed)
    #expect(broken.items == ["viejo"])
}

@Test func pasteAccess() {
    #expect(PasteAccess.of(buildAllows: false, approved: true) == .unavailable)
    #expect(PasteAccess.of(buildAllows: true, approved: false) == .notAllowed)
    #expect(PasteAccess.of(buildAllows: true, approved: true) == .allowed)
    #expect(PasteAccess.mayPaste(buildAllows: true, switchOn: true, approved: true))
    #expect(!PasteAccess.mayPaste(buildAllows: false, switchOn: true, approved: true))
    #expect(!PasteAccess.mayPaste(buildAllows: true, switchOn: false, approved: true))
    #expect(!PasteAccess.mayPaste(buildAllows: true, switchOn: true, approved: false))
}
