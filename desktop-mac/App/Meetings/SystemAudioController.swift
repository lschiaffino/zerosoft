import Foundation
import os

/// The computer's audio for meeting notes behind the bridge's `systemAudioStart/Read/Stop`
/// (system_audio.rs and commands.rs of the Tauri app; block 7 of docs/desktop-swift.md).
///
/// - A capture starts only from the tab the person is using, and only while Settings › Meetings
///   allows it and the web views are not under forced Lockdown restrictions. Only that tab reads
///   it, stops it or restarts it.
/// - The samples wait in memory (SystemAudioSink, at most 60 s) until the page reads them; a
///   page that stops reading for 30 s ends the capture, and so does closing, suspending or
///   reloading its tab.
/// - While it runs, the menu bar item and the floating indicator say so (`onChange`); the menu
///   bar item can stop it whatever the page does.
@MainActor
final class SystemAudioController {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "meetings")

    private let makeSource: () -> SystemAudioSource?
    /// One sink per capture: late buffers of a stopped capture never reach the next one.
    private var sink = SystemAudioSink()
    /// Bumped by every stop, every start and every document change of the starting tab: a start
    /// that waited for macOS while one of those happened does not begin.
    private var generation = 0
    private var pendingTab: Int?
    private var source: SystemAudioSource?
    private var idleTimer: Timer?
    private var starting = false
    /// Settings › Meetings and the Lockdown setting (SystemAudioRules.available).
    var available: () -> Bool = { false }
    /// The tab still exists (checked again after a start that waited for macOS).
    var tabExists: (Int) -> Bool = { _ in true }
    /// The owner tab reported a meeting that still records: its page may be throttled behind
    /// other tabs, so a pause in its reads does not end the capture (the meeting's marks stay on
    /// and the queue keeps at most 60 s).
    var ownerRecording: (Int) -> Bool = { _ in false }

    private(set) var running = false
    private(set) var owner: Int?
    /// Milliseconds since 1970.
    private(set) var startedAt: Double = 0
    private var lastRead: Double = 0

    /// Started or stopped: the menu bar item and the indicator.
    var onChange: () -> Void = {}
    /// UI tests: each start's answer and each stop's reason.
    var onOutcome: ((String) -> Void)?
    private(set) var starts = 0
    private(set) var lastResult = "none"
    private(set) var lastStop = "none"
    private(set) var readBytes = 0

    init(makeSource: @escaping () -> SystemAudioSource?) {
        self.makeSource = makeSource
    }

    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    /// `systemAudioStart` from a tab (`inUse`: in front of the key window, app in front).
    func start(from tab: Int, inUse: Bool) async -> SystemAudioResult {
        let result = await begin(tab, inUse: inUse)
        lastResult = result.rawValue
        Self.log.info("system audio start \(result.rawValue, privacy: .public)")
        onOutcome?("start \(result.rawValue)")
        return result
    }

    private func begin(_ tab: Int, inUse: Bool) async -> SystemAudioResult {
        guard available() else { return .unsupported }
        guard !starting,
              SystemAudioRules.startAllowed(tabInUse: inUse, alreadyRunning: running, isOwner: owner == tab) else { return .failed }
        // A restart by its own tab: never two captures.
        if running { stop(.page) }
        guard let source = makeSource() else { return .unsupported }
        starting = true
        pendingTab = tab
        generation += 1
        let mine = generation
        defer {
            starting = false
            pendingTab = nil
        }
        let sink = SystemAudioSink()
        sink.reopen()
        let result = await source.start(into: sink)
        // macOS may have kept the start waiting (a prompt): the tab, its page or the switch may
        // be gone, or the page may have stopped meanwhile.
        guard result == .ok, available(), tabExists(tab), generation == mine else {
            source.stop()
            sink.close()
            return result == .ok ? .failed : result
        }
        self.sink = sink
        self.source = source
        owner = tab
        running = true
        starts += 1
        startedAt = now
        lastRead = startedAt
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkIdle() }
        }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        idleTimer = timer
        onChange()
        return .ok
    }

    /// `systemAudioRead`: what was captured since the last read, base64, for the tab that started
    /// it only (another tab gets nothing).
    func read(from tab: Int) -> String {
        guard running, owner == tab else { return "" }
        lastRead = now
        let data = sink.take()
        readBytes += data.count
        return data.base64EncodedString()
    }

    /// `systemAudioStop`: only the tab that started it.
    func stop(from tab: Int) {
        if pendingTab == tab { generation += 1 }
        guard running, owner == tab else { return }
        stop(.page)
    }

    /// The tab closed, was suspended or loaded another document.
    func tabGone(_ tab: Int) {
        if pendingTab == tab { generation += 1 }
        guard owner == tab else { return }
        stop(.tab)
    }

    func stop(_ why: SystemAudioStopReason) {
        generation += 1
        guard running else { return }
        source?.stop()
        source = nil
        sink.close()
        idleTimer?.invalidate()
        idleTimer = nil
        running = false
        owner = nil
        startedAt = 0
        lastStop = why.rawValue
        Self.log.info("system audio stop \(why.rawValue, privacy: .public)")
        onOutcome?("stop \(why.rawValue)")
        onChange()
    }

    private func checkIdle() {
        guard running, SystemAudioRules.idle(nowMs: now, lastReadMs: lastRead) else { return }
        if let owner, ownerRecording(owner), tabExists(owner) { return }
        stop(.idle)
    }

    /// "sysaudio on starts=1 last=ok stop=none audio=true", for the UI tests.
    var summary: String {
        "sysaudio \(running ? "on" : "off") starts=\(starts) last=\(lastResult) stop=\(lastStop) audio=\(readBytes > 0)"
    }
}
