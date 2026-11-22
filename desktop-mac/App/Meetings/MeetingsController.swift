import AppKit
import os

/// Meetings (block 7 of docs/desktop-swift.md): the page's `recording` flag, the computer's audio
/// (SystemAudioController) and what marks them: the tab's red dot, the menu bar item's dot and
/// the floating indicator (RecordingIndicator). Port of indicator.rs and the recording commands
/// of commands.rs.
///
/// - The flag belongs to the tab that sent it. Only that tab clears it, so another tab that opens
///   Voice (and says "not recording" when it mounts) does not hide a recording elsewhere. A tab
///   that closes, is suspended or loads another document loses its flag and its capture.
/// - The indicator shows while the recording tab is not in front (another tab, another window,
///   another app): for a meeting unless Settings › Meetings turned it off, and always for the
///   computer's audio. Hide keeps it away until the next recording; the tab and the menu bar
///   item keep their dot (guideline 2.5.14).
@MainActor
final class MeetingsController {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "meetings")

    private let server: String
    private let tabs: TabsController
    let systemAudio: SystemAudioController
    let indicator: RecordingIndicator
    private(set) var recording: MeetingRecording?
    private(set) var recordingTab: Int?
    private var dismissed = false
    private var indicatorEnabled = true
    private var observers: [NSObjectProtocol] = []

    /// What is capturing changed: the menu bar item.
    var onCapture: () -> Void = {}
    /// The person dragged the indicator somewhere else.
    var onMoved: (IndicatorPosition) -> Void = { _ in }

    init(server: String, lang: Lang, tabs: TabsController, systemAudio: SystemAudioController) {
        self.server = server
        self.tabs = tabs
        self.systemAudio = systemAudio
        indicator = RecordingIndicator(lang: lang)
        var wasRunning = false
        systemAudio.onChange = { [weak self] in
            guard let self else { return }
            // A new capture brings a hidden indicator back.
            if systemAudio.running, !wasRunning { self.dismissed = false }
            wasRunning = systemAudio.running
            self.update()
        }
        systemAudio.tabExists = { [weak tabs] id in tabs?.hasWeb(id) ?? false }
        indicator.onOpen = { [weak self] in self?.open() }
        indicator.onStop = { [weak self] in self?.stop() }
        indicator.onHide = { [weak self] in self?.hideIndicator() }
        indicator.onMoved = { [weak self] p in self?.onMoved(p) }
        tabs.keepAlive = { [weak self] id in self?.recordingTab == id || self?.systemAudio.owner == id }
        tabs.onTabGone = { [weak self] id in self?.tabGone(id) }
        tabs.onFrontChange = { [weak self] in self?.update() }
        let center = NotificationCenter.default
        let names: [Notification.Name] = [
            NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
            NSApplication.didHideNotification, NSApplication.didUnhideNotification,
            NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
            NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification,
        ]
        for name in names {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.update() }
            })
        }
    }

    /// Settings › Meetings: the indicator switch, and the computer's audio switch (off stops a
    /// capture that runs).
    func apply(_ settings: AppSettings) {
        indicatorEnabled = settings.recordingIndicator
        if !settings.allowSystemAudio { systemAudio.stop(.settings) }
        update()
    }

    /// The bridge commands of one tab's page.
    func wire(_ web: WebController, tab id: Int) {
        web.onRecording = { [weak self] active, startedAt, path in
            self?.pageRecording(id, active: active, startedAt: startedAt, path: path)
        }
        web.onSystemAudioStart = { [weak self] reply in
            guard let self else {
                reply(SystemAudioResult.failed.rawValue)
                return
            }
            let inUse = self.tabs.tabInUse(id)
            Task { @MainActor in
                let result = await self.systemAudio.start(from: id, inUse: inUse)
                reply(result.rawValue)
            }
        }
        web.onSystemAudioRead = { [weak self] in self?.systemAudio.read(from: id) ?? "" }
        web.onSystemAudioStop = { [weak self] in self?.systemAudio.stop(from: id) }
        web.onDocumentGone = { [weak self] in self?.tabGone(id) }
    }

    var capture: (meeting: Bool, systemAudio: Bool) {
        (recording != nil, systemAudio.running)
    }

    private func pageRecording(_ id: Int, active: Bool, startedAt: Double?, path: String?) {
        let now = Date().timeIntervalSince1970 * 1000
        if let rec = MeetingRecording.from(active: active, startedAt: startedAt, path: path, nowMs: now) {
            if recording == nil || recordingTab != id { dismissed = false }
            recording = rec
            recordingTab = id
            tabs.setRecording(id)
        } else {
            guard recordingTab == id else { return }
            recording = nil
            recordingTab = nil
            tabs.setRecording(nil)
        }
        Self.log.info("meeting recording \(active ? "on" : "off", privacy: .public)")
        update()
    }

    private func tabGone(_ id: Int) {
        systemAudio.tabGone(id)
        guard recordingTab == id else { return }
        recording = nil
        recordingTab = nil
        tabs.setRecording(nil)
        update()
    }

    /// The tab that the marks are about: the meeting's, or the one capturing the computer's audio.
    private var markedTab: Int? { recordingTab ?? systemAudio.owner }

    var indicatorShown: Bool { indicator.isVisible }

    func update() {
        let inFront = markedTab.map(tabs.isInFront) ?? false
        let show = RecordingIndicatorRules.shouldShow(
            meeting: recording != nil, systemAudio: systemAudio.running, recBar: false,
            enabled: indicatorEnabled, dismissed: dismissed, inFront: inFront
        )
        if show {
            indicator.show(startedAt: recording?.startedAt ?? systemAudio.startedAt)
        } else {
            indicator.hide()
        }
        onCapture()
    }

    /// Open (indicator, menu bar item): the recording tab in front; when there is none, the
    /// meeting's page in the tab in front.
    func open() {
        NSApp.activate(ignoringOtherApps: true)
        if let id = markedTab, tabs.focus(id) { return }
        if let path = recording?.path, MeetingRecording.validPath(path), let url = URL(string: server + path) {
            tabs.navigateActive(url)
        } else {
            tabs.showLast()
        }
    }

    /// Stop (indicator, menu bar item): the recording page gets `zerosoft:stop-recording` and
    /// stops as with its own button; the computer's audio stops here right away, whatever the
    /// page does.
    func stop() {
        if let id = recordingTab { tabs.stopRecording(in: id) }
        systemAudio.stop(.user)
    }

    /// "Hide until the next recording".
    func hideIndicator() {
        dismissed = true
        update()
    }
}
