import AppKit
import os

/// Dictation in any app (block 6 of docs/desktop-swift.md; dictation.rs in the Tauri app):
/// the global shortcut (or the menu bar item) opens the microphone, the HUD shows it is open,
/// the audio goes to POST /api/voice/dictate with the web views' session, and the clean text is
/// pasted into the app in front, or copied when pasting is not allowed.
///
/// - The microphone permission is asked for only when the person starts a dictation (or presses
///   "Turn on the microphone"), never at launch. That first start only asks; the next one records.
/// - Audio and text stay in memory. The audio reaches the disk only as a saved dictation
///   (PendingStore, when sending failed and the switch is on); the text never does. The last
///   text is kept in memory for "Paste last dictation". Nothing here logs a transcript, an app
///   name or a request body: the log gets outcome tags and timings.
/// - The page in a tab cannot start a dictation: the bridge has no command for it.
@MainActor
final class DictationController {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "dictation")

    private let server: String
    private let lang: Lang
    private let http: NativeHTTP
    private let store: PendingStore
    private let hotKeys = HotKeys()
    private let hud = DictationHUD()
    let mic: MicrophonePermission
    let paste: PastePermission
    private let makeSource: () -> AudioSource
    private let board = SystemPasteboard()

    private(set) var machine = DictationMachine()
    private(set) var settings: AppSettings
    private var source: AudioSource?
    private var sourceApp = ""
    private var levelTimer: Timer?
    /// The last dictated text, in memory only (paste last).
    private var lastText = ""
    /// The dictation shortcut could not be registered (another app holds it).
    private(set) var shortcutTaken = false
    /// The shortcut in use: the chosen one, or a fallback when the default could not be
    /// registered (macOS 15 refuses some Option-only shortcuts, section 2.2).
    private(set) var shortcut = DictationShortcut.standard
    /// A retry of the saved dictations is running (one at a time).
    private var retrying = false
    /// The microphone prompt is on screen.
    private var askingMic = false

    /// The phase, the pending count or the shortcut changed: the menu bar item and Settings.
    var onChange: () -> Void = {}
    /// UI tests: "<what happened>" for each dictation, paste or retry.
    var onOutcome: ((String) -> Void)?

    init(server: String, lang: Lang, http: NativeHTTP, store: PendingStore, settings: AppSettings,
         mic: MicrophonePermission, paste: PastePermission, makeSource: @escaping () -> AudioSource) {
        self.server = server
        self.lang = lang
        self.http = http
        self.store = store
        self.settings = settings
        self.mic = mic
        self.paste = paste
        self.makeSource = makeSource
        hotKeys.onKey = { [weak self] key, pressed in self?.key(key, pressed) }
        hud.mayChange = { [weak self] in self?.machine.phase != .recording }
    }

    private func t(_ key: StringKey, _ vars: [String: String] = [:]) -> String {
        Strings.text(key, lang, vars)
    }

    private var now: Double { ProcessInfo.processInfo.systemUptime }

    // MARK: Shortcuts and settings

    /// Registers the dictation shortcut and "paste last". Called at launch: no permission is
    /// involved, and nothing is asked.
    func start() {
        registerShortcut()
        hotKeys.register(.pasteLast, .pasteLast)
    }

    func apply(_ new: AppSettings) {
        let shortcutChanged = new.shortcut != settings.shortcut
        settings = new
        if shortcutChanged {
            registerShortcut()
            onChange()
        }
    }

    private func registerShortcut() {
        shortcut = settings.shortcut
        var ok = hotKeys.register(.dictation, shortcut)
        var note = "hotkey \(shortcut.name) \(ok ? "ok" : "taken")"
        // The default refused: fall back to one without Option, kept in memory only (the
        // person's setting stays, and Settings shows the one in use).
        if !ok, shortcut == .standard, let fallback = DictationShortcut.named("CommandOrControl+Shift+D"),
           hotKeys.register(.dictation, fallback) {
            shortcut = fallback
            ok = true
            note += " fallback \(fallback.name)"
        }
        shortcutTaken = !ok
        onOutcome?(note)
        if !ok { Self.log.notice("dictation shortcut taken") }
    }

    var menuState: DictationMenuState {
        DictationMenuState(phase: machine.phase, mode: settings.mode, pending: retrying ? 0 : pendingCount)
    }

    var isRetrying: Bool { retrying }

    var pendingCount: Int {
        store.list(now: Self.epochMs).filter { $0.sameServer(server) }.count
    }

    private static var epochMs: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func key(_ key: HotKeys.Key, _ pressed: Bool) {
        switch key {
        case .dictation:
            run(machine.shortcut(pressed: pressed, at: now, mode: settings.mode))
        case .escape:
            if pressed { run(machine.escape()) }
        case .pasteLast:
            if pressed { pasteLast() }
        case .recToggle, .recStop:
            // Rec's own instance (RecController) registers these.
            break
        }
    }

    /// The menu bar item's Start / Stop.
    func toggleFromMenu() {
        run(machine.toggle())
    }

    private func run(_ action: DictationMachine.Action) {
        switch action {
        case let .start(handsFree): begin(handsFree: handsFree)
        case .stop: finish()
        case .cancel: cancel()
        case .becameHandsFree:
            hud.show(.recording, t(.hudHandsFree), hint: t(.hudHandsFreeHint, ["key": shortcut.label]), startedAt: recordingSince)
        case .none: break
        }
    }

    private var recordingSince: Date?

    // MARK: Recording

    private func begin(handsFree: Bool) {
        let generation = machine.generation
        switch mic.current() {
        case .notDetermined:
            // The first dictation asks for the microphone and records nothing: the person
            // answers the prompt, then dictates.
            machine.finished(generation: generation)
            onChange()
            guard !askingMic else { return }
            askingMic = true
            Task {
                let answer = await mic.request()
                askingMic = false
                if answer == .allowed {
                    hud.flash(.done, t(.hudMicReady, ["key": shortcut.label]))
                    report("mic-allowed")
                } else {
                    hud.flash(.error, t(.hudMicOff))
                    report("mic-off")
                }
                onChange()
            }
            return
        case .denied:
            machine.finished(generation: generation)
            hud.flash(.error, t(.hudMicOff))
            report("mic-off")
            onChange()
            return
        case .allowed:
            break
        }
        let capture = makeSource()
        do {
            try capture.start()
        } catch {
            machine.finished(generation: generation)
            hud.flash(.error, t((error as? MicError) == .denied ? .hudMicOff : .hudMicBusy))
            report("mic-busy")
            onChange()
            return
        }
        source = capture
        hotKeys.register(.escape, .escape)
        // The app's name is read only when the person lets it be sent.
        sourceApp = settings.sendAppName ? (NSWorkspace.shared.frontmostApplication?.localizedName ?? "") : ""
        recordingSince = Date()
        if handsFree {
            hud.show(.recording, t(.hudHandsFree), hint: t(.hudHandsFreeHint, ["key": shortcut.label]), startedAt: recordingSince)
        } else {
            hud.show(.recording, t(.hudListening), hint: t(.hudEscHint), startedAt: recordingSince)
        }
        warm()
        levelTimer?.invalidate()
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let source = self.source else { return }
                self.hud.level(source.level)
            }
        }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(DictationMachine.maxSeconds * 1_000_000_000))
            guard let self else { return }
            self.run(self.machine.timeout(generation: generation))
        }
        report("recording")
        onChange()
    }

    private func closeMic() -> AudioSource? {
        levelTimer?.invalidate()
        levelTimer = nil
        hotKeys.unregister(.escape)
        let s = source
        source = nil
        return s
    }

    private func cancel() {
        closeMic()?.cancel()
        hud.hide()
        report("cancelled")
        onChange()
    }

    /// Opens the connection and wakes the server function while the person speaks.
    private func warm() {
        guard let request = DictationEndpoint.warm.request(server: server) else { return }
        Task { _ = await http.send(request, withSession: false) }
    }

    private func finish() {
        let releasedAt = now
        let generation = machine.generation
        let recorded = closeMic()?.finish()
        onChange()
        guard let recorded, recorded.durationMs >= DictationMachine.minMs else {
            machine.finished(generation: generation)
            hud.hide()
            report("short")
            onChange()
            return
        }
        hud.show(.working, t(.hudWorking))
        let app = sourceApp
        Task {
            let (wav, heard) = await Task.detached(priority: .userInitiated) { WAV.encode(recorded) }.value
            if !heard, mic.current() != .allowed {
                done(generation, .error, t(.hudMicOff), "mic-off")
                return
            }
            let audioAt = now
            let context = DictationContext.of(app: app)
            let answer = await send(wav: wav, durationMs: recorded.durationMs, app: app, context: context)
            let serverAt = now
            switch DictationOutcome.classify(status: answer?.status, body: answer?.body) {
            case let .text(text):
                await waitForKeysUp()
                let (how, restored) = await insert(text)
                let timing = DictationTiming(
                    totalMs: ms(now - releasedAt), audioMs: ms(audioAt - releasedAt),
                    requestMs: ms(serverAt - audioAt), insertMs: ms(now - serverAt), server: answer?.body
                )
                Self.log.info("dictation \(how.rawValue, privacy: .public) \(timing.summary, privacy: .public)")
                done(generation, how == .failed ? .error : .done, label(how), "\(how.rawValue)\(detail(text, restored))")
            case let .failed(failure):
                let saved = settings.keepFailedDictations && failure.keepForRetry
                    && save(wav: wav, durationMs: recorded.durationMs, app: app, context: context, failure: failure)
                Self.log.notice("dictation failed \(failure.rawValue, privacy: .public) saved=\(saved, privacy: .public)")
                done(generation, .error, failureLabel(failure, saved: saved), "failed:\(failure.rawValue)\(saved ? " saved" : "")")
            }
        }
    }

    private func ms(_ seconds: Double) -> Int { Int((seconds * 1000).rounded()) }

    private func done(_ generation: Int, _ phase: DictationHUD.Phase, _ label: String, _ outcome: String) {
        machine.finished(generation: generation)
        hud.flash(phase, label)
        report(outcome)
        onChange()
    }

    private func send(wav: Data, durationMs: Int, app: String, context: String) async -> (status: Int, body: Data)? {
        let boundary = DictationUpload.boundary(UInt64.random(in: 0 ... UInt64.max))
        let body = DictationUpload(wav: wav, durationMs: durationMs, sourceApp: app, context: context).body(boundary: boundary)
        guard let request = DictationEndpoint.dictate.request(server: server, body: body, boundary: boundary) else { return nil }
        return await http.send(request, withSession: true)
    }

    private func save(wav: Data, durationMs: Int, app: String, context: String, failure: DictationFailure) -> Bool {
        let now = Self.epochMs
        let meta = PendingMeta(
            id: PendingStore.newID(now: now, random: UInt32.random(in: 0 ... UInt32.max)), createdAt: now,
            durationMs: durationMs, sourceApp: app, context: context, failure: failure, server: server
        )
        let ok = store.save(meta, audio: wav)
        _ = store.list(now: now) // prune
        return ok
    }

    // MARK: Inserting text

    /// Waits (up to 1.5 s) until the shortcut and every modifier are up: a held Option would turn
    /// Command+V into Command+Option+V.
    private func waitForKeysUp() async {
        for _ in 0 ..< 100 {
            let mods = NSEvent.modifierFlags.intersection([.command, .option, .control, .shift])
            if !machine.keyDown, mods.isEmpty { return }
            try? await Task.sleep(nanoseconds: 15_000_000)
        }
    }

    /// Pastes `text` into the app in front when allowed, otherwise copies it.
    private func insert(_ text: String) async -> (PasteResult, Bool) {
        lastText = text
        let paste = self.paste
        let mayPaste = PasteAccess.mayPaste(buildAllows: paste.buildAllows, switchOn: settings.autoPaste, approved: paste.approved())
        let tap: (() -> Bool)? = mayPaste ? { paste.postPaste() } : nil
        return await PasteFlow.run(board, text: text, tap: tap, restore: settings.restoreClipboard) { ms in
            try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
        }
    }

    private func label(_ how: PasteResult) -> String {
        switch how {
        case .pasted: return t(.hudPasted)
        case .copied: return t(.hudCopied, ["key": "⌘V"])
        case .failed: return t(.errFailed)
        }
    }

    private func failureLabel(_ f: DictationFailure, saved: Bool) -> String {
        let key: StringKey
        switch f {
        case .offline: key = .errOffline
        case .signedOut: key = .errSignedOut
        case .rateLimited: key = .errRateLimited
        case .server: key = .errServer
        case .tooLarge: key = .errTooLarge
        case .empty: key = .errEmpty
        case .rejected: key = .errFailed
        case .otherServer: key = .errOtherServer
        }
        return saved ? "\(t(key)). \(t(.savedToRetry))" : t(key)
    }

    /// UI tests: whether the clipboard held the text when the (fake) keystroke went out, and
    /// whether the old clipboard came back. Empty in a normal build.
    private func detail(_ text: String, _ restored: Bool) -> String {
        #if DEBUG
        if let fake = paste as? FakePastePermission, fake.keys > 0 {
            return " clip=\(fake.clipboardAtKey == text ? "match" : "other") restored=\(restored)"
        }
        #endif
        return ""
    }

    private func report(_ outcome: String) {
        onOutcome?("dictation \(outcome)")
    }

    // MARK: Paste last, history, saved dictations

    /// Pastes the last dictation again: this session's, or the newest of the history.
    func pasteLast() {
        guard machine.phase == .idle else { return }
        Task {
            var text = lastText
            if text.isEmpty, let request = SettingsEndpoint.history.request(server: server),
               let answer = await http.send(request, withSession: true), answer.status == 200 {
                text = HistoryItem.parseList(answer.body)?.first?.text ?? ""
            }
            guard !text.isEmpty else {
                hud.flash(.error, t(.noRecent))
                onOutcome?("paste-last none")
                return
            }
            await waitForKeysUp()
            let (how, restored) = await insert(text)
            hud.flash(how == .failed ? .error : .done, label(how))
            onOutcome?("paste-last \(how.rawValue)\(detail(text, restored))")
        }
    }

    /// Settings › History's Paste: zerosoft hides so the focus goes back to the app the person
    /// was using, then the text is pasted there. Without paste access it is only copied (and
    /// zerosoft stays in front).
    func pasteFromHistory(_ text: String) async -> PasteResult {
        let text = String(text.prefix(DictationOutcome.maxText))
        let mayPaste = PasteAccess.mayPaste(buildAllows: paste.buildAllows, switchOn: settings.autoPaste, approved: paste.approved())
        if mayPaste {
            NSApp.hide(nil)
            try? await Task.sleep(nanoseconds: 350_000_000)
        }
        let (how, restored) = await insert(text)
        if !mayPaste { hud.flash(how == .failed ? .error : .done, label(how)) }
        onOutcome?("history \(how.rawValue)\(detail(text, restored))")
        return how
    }

    /// Sends the saved dictations of this server again. The text is copied, never pasted: the
    /// person may be somewhere else by now.
    func retryPending() {
        guard machine.phase == .idle, !retrying else { return }
        retrying = true
        onChange()
        Task {
            defer {
                retrying = false
                onChange()
            }
            for meta in store.list(now: Self.epochMs) where meta.sameServer(server) {
                guard machine.phase == .idle else { return }
                let now = Self.epochMs
                guard let audio = store.read(meta.id, now: now)?.1 else { continue }
                hud.show(.working, t(.hudSending))
                // With "send the app's name" off now, the saved one is not sent.
                let app = settings.sendAppName ? meta.sourceApp : ""
                let answer = await send(wav: audio, durationMs: meta.durationMs, app: app, context: settings.sendAppName ? meta.context : "other")
                switch DictationOutcome.classify(status: answer?.status, body: answer?.body) {
                case let .text(text):
                    store.remove(meta.id)
                    lastText = text
                    let copied = board.write(text) != nil
                    hud.flash(copied ? .done : .error, label(copied ? .copied : .failed))
                    onOutcome?("retry \(copied ? "copied" : "failed")")
                case let .failed(failure):
                    if failure.keepForRetry {
                        store.markAttempt(meta.id, failure: failure, now: now)
                    } else {
                        store.remove(meta.id)
                    }
                    hud.flash(.error, failureLabel(failure, saved: failure.keepForRetry))
                    onOutcome?("retry failed:\(failure.rawValue)")
                    onChange()
                    // The rest would fail the same way.
                    if [.offline, .signedOut, .rateLimited].contains(failure) { return }
                }
                onChange()
            }
        }
    }

    #if DEBUG
    var hudSummary: String { hud.summary }
    #endif
}
