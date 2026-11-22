import Foundation

// Meetings (block 7 of docs/desktop-swift.md): the computer's audio for meeting notes behind the
// bridge's `systemAudioStart/Read/Stop` contract (system_audio.rs and commands.rs of the Tauri
// app), the `recording` flag the page sends while a meeting records, and the rules of the
// floating recording indicator (indicator.rs). Pure logic: the capture itself (Core Audio taps,
// ScreenCaptureKit) lives in the app target.
//
// Nothing here keeps audio longer than the page takes to read it: at most `PCMQueue.maxSamples`
// (60 s) wait in memory between two reads, and nothing is ever written to disk.

/// What `systemAudioStart` answers (the strings of `SysAudio::code` in system_audio.rs, which
/// components/voice/audio.ts reads).
public enum SystemAudioResult: String, Sendable {
    case ok
    /// macOS has not allowed the capture (Screen Recording on macOS 13 to 14.1).
    case denied
    /// Not available here: the switch in Settings › Meetings is off, or the web views run with
    /// Lockdown restrictions (no Web Audio for the page to play the samples into).
    case unsupported
    /// The capture did not start, or the request did not come from the tab in use.
    case failed
}

/// Why a capture ended (system_audio.rs `Why`, plus the tab and the settings switch).
public enum SystemAudioStopReason: String, Sendable {
    /// The page stopped it (or restarted it).
    case page
    /// The page stopped reading for `SystemAudioRules.idleStopMs`.
    case idle
    /// The person, from the menu bar item or the indicator.
    case user
    /// The tab that started it closed, was suspended, or loaded another page.
    case tab
    /// "Let meetings capture the computer's audio" was switched off.
    case settings
}

/// Which macOS API captures the computer's audio (section 2.2, decision 7.6): Core Audio process
/// taps from macOS 14.2, which ask only for "system audio recording"; ScreenCaptureKit's audio
/// on 13 to 14.1, which needs Screen Recording.
public enum SystemAudioBackend: String, Sendable {
    case processTap
    case screenCapture
    case none

    public static func pick(major: Int, minor: Int, patch: Int = 0) -> SystemAudioBackend {
        if (major, minor) >= (14, 2) { return .processTap }
        if major >= 13 { return .screenCapture }
        return .none
    }

    /// The permission behind the capture can be checked before starting (Screen Recording has
    /// `CGPreflightScreenCaptureAccess`; audio taps have no public check, and a tap macOS did
    /// not allow delivers silence).
    public var canPreflight: Bool { self == .screenCapture }
}

public enum SystemAudioRules {
    /// A capture whose page stops reading ends by itself (system_audio.rs `IDLE_STOP_MS`): a
    /// closed, reloaded or frozen page never leaves the computer's audio captured.
    public static let idleStopMs: Double = 30_000

    /// commands.rs `system_audio_start_allowed`: a capture starts only from the tab the person
    /// is using (in front of its window, that window key, the app in front). A capture that
    /// runs is restarted only by the tab that started it.
    public static func startAllowed(tabInUse: Bool, alreadyRunning: Bool, isOwner: Bool) -> Bool {
        alreadyRunning ? isOwner : tabInUse
    }

    /// The page has not read for longer than `idleStopMs`.
    public static func idle(nowMs: Double, lastReadMs: Double) -> Bool {
        nowMs - lastReadMs > idleStopMs
    }

    /// Whether this build offers the capture to the page at all: the person's switch, and no
    /// forced Lockdown restrictions (WebKit removes Web Audio then, so the page could not play
    /// the samples; measured in block 2).
    public static func available(allowed: Bool, lockdown: Bool, backend: SystemAudioBackend) -> Bool {
        allowed && !lockdown && backend != .none
    }
}

// MARK: Samples

/// Float samples of the capture to what the page reads: mono, 16 kHz, signed 16-bit (system_audio.rs
/// asked ScreenCaptureKit for that format directly; Core Audio taps give the output device's
/// rate and channels, so the app converts). Downsampling averages each output period (a box
/// filter, enough for speech); upsampling interpolates linearly. It keeps its position between
/// chunks, so the result does not depend on how the audio thread splits the stream.
public struct PCMResampler: Sendable {
    public static let targetRate = 16_000.0

    public let sourceRate: Double
    private let ratio: Double
    private var pending: [Float] = []
    /// Position of the next output sample in `pending`, in source samples.
    private var offset: Double = 0

    public init(sourceRate: Double) {
        let rate = sourceRate.isFinite && sourceRate >= 1000 && sourceRate <= 384_000 ? sourceRate : Self.targetRate
        self.sourceRate = rate
        ratio = rate / Self.targetRate
    }

    /// Converts the next chunk of mono samples. Samples that do not fill an output period yet
    /// wait for the next chunk.
    public mutating func push(_ mono: [Float]) -> [Int16] {
        guard !mono.isEmpty else { return [] }
        pending.append(contentsOf: mono)
        var out: [Int16] = []
        out.reserveCapacity(Int(Double(pending.count) / ratio) + 1)
        let count = Double(pending.count)
        if ratio >= 1 {
            while offset + ratio <= count {
                let start = Int(offset)
                let end = max(start + 1, min(pending.count, Int(offset + ratio)))
                var sum: Float = 0
                for i in start ..< end { sum += pending[i] }
                out.append(Self.int16(sum / Float(end - start)))
                offset += ratio
            }
        } else {
            while offset + 1 < count {
                let i = Int(offset)
                let f = Float(offset - Double(i))
                out.append(Self.int16(pending[i] * (1 - f) + pending[i + 1] * f))
                offset += ratio
            }
        }
        let drop = min(Int(offset), pending.count)
        if drop > 0 {
            pending.removeFirst(drop)
            offset -= Double(drop)
        }
        return out
    }

    /// Float in [-1, 1] to 16-bit (system_audio.rs `to_i16`); anything outside is clamped, NaN is 0.
    public static func int16(_ x: Float) -> Int16 {
        guard x.isFinite else { return 0 }
        return Int16((min(max(x, -1), 1) * 32767).rounded())
    }

    /// Averages channels kept apart (one array per channel) into mono (system_audio.rs `mix_mono`).
    public static func mixMono(channels: [[Float]]) -> [Float] {
        guard let n = channels.map(\.count).min(), n > 0 else { return [] }
        if channels.count == 1 { return channels[0] }
        let scale = 1 / Float(channels.count)
        return (0 ..< n).map { i in channels.reduce(0) { $0 + $1[i] } * scale }
    }

    /// Averages interleaved frames (L R L R ...) into mono.
    public static func mixMono(interleaved: [Float], channels: Int) -> [Float] {
        guard channels > 0 else { return [] }
        if channels == 1 { return interleaved }
        let frames = interleaved.count / channels
        let scale = 1 / Float(channels)
        return (0 ..< frames).map { f in
            var sum: Float = 0
            for c in 0 ..< channels { sum += interleaved[f * channels + c] }
            return sum * scale
        }
    }
}

/// The samples waiting for the page's next read, at most 60 seconds (system_audio.rs
/// `MAX_SAMPLES`): a page that stops reading never makes the app hold more.
public struct PCMQueue: Sendable {
    public static let maxSamples = 16_000 * 60

    public private(set) var samples: [Int16] = []

    public init() {}

    public var count: Int { samples.count }

    public mutating func append(_ more: [Int16]) {
        samples.append(contentsOf: more)
        let over = samples.count - Self.maxSamples
        if over > 0 { samples.removeFirst(over) }
    }

    /// Everything since the last read as 16-bit little-endian bytes, and empties the queue.
    public mutating func take() -> Data {
        defer { samples.removeAll(keepingCapacity: true) }
        var data = Data(capacity: samples.count * 2)
        for s in samples {
            let v = UInt16(bitPattern: s.littleEndian)
            data.append(UInt8(v & 0xFF))
            data.append(UInt8(v >> 8))
        }
        return data
    }

    public mutating func clear() {
        samples.removeAll()
    }
}

// MARK: The page's recording flag

/// What the page said with `recording({active, startedAt, path})` (commands.rs
/// `desktop_recording`): when the meeting started and the meeting page the indicator opens.
public struct MeetingRecording: Equatable, Sendable {
    /// Milliseconds since 1970.
    public var startedAt: Double
    /// An app page (`MeetingRecording.validPath`), or empty when the page sent none or a bad one.
    public var path: String

    public init(startedAt: Double, path: String) {
        self.startedAt = startedAt
        self.path = path
    }

    /// nil when the page says it stopped. A start in the future or more than a day ago becomes
    /// now; a path that is not a plain app page is dropped (the indicator then opens the tab).
    public static func from(active: Bool, startedAt: Double?, path: String?, nowMs: Double) -> MeetingRecording? {
        guard active else { return nil }
        let start = startedAt.flatMap { $0 <= nowMs && nowMs - $0 < 86_400_000 ? $0 : nil } ?? nowMs
        let page = path.flatMap { validPath($0) ? $0 : nil } ?? ""
        return MeetingRecording(startedAt: start, path: page)
    }

    /// indicator.rs `valid_path`: `/app/...` with letters, digits, `/`, `-` and `_` only, no
    /// `//` or `..`, at most 200 characters.
    public static func validPath(_ p: String) -> Bool {
        p.hasPrefix("/app/") && p.utf8.count <= 200 && !p.contains("//") && !p.contains("..")
            && p.unicodeScalars.allSatisfy { ($0.isASCII && CharacterSet.alphanumerics.contains($0)) || "/-_".unicodeScalars.contains($0) }
    }
}

// MARK: The floating indicator

public enum RecordingIndicatorRules {
    /// Closed size (the dot) and the size with the time, in points.
    public static let width = 44.0
    public static let openWidth = 96.0
    public static let height = 28.0
    public static let margin = 12.0

    /// indicator.rs `should_show`: while the recording tab is not in front, for a meeting the
    /// page reported (unless switched off in Settings › Meetings) and always for the computer's
    /// audio, which the app captures itself and must mark whatever the page says (guideline
    /// 2.5.14). Rec's own floating bar (block 8) already marks a Rec capture. The person can hide
    /// it until the next recording; the menu bar item and the tab keep their dot.
    public static func shouldShow(meeting: Bool, systemAudio: Bool, recBar: Bool, enabled: Bool, dismissed: Bool, inFront: Bool) -> Bool {
        !dismissed && !inFront && ((meeting && enabled) || (systemAudio && !recBar))
    }

    /// "0:07", "12:34", "1:02:03".
    public static func elapsed(ms: Double) -> String {
        let total = max(0, Int(ms / 1000))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// indicator.rs `on_screen`: a saved position (bottom-left origin of the closed indicator,
    /// AppKit coordinates) is used only while part of it is on one of the screens.
    public static func onScreen(x: Double, y: Double, screens: [(x: Double, y: Double, width: Double, height: Double)]) -> Bool {
        screens.contains { s in
            x + width > s.x + 8 && x < s.x + s.width - 8 && y + height > s.y + 4 && y < s.y + s.height - height / 2
        }
    }
}

/// What is capturing now, for the menu bar item (its icon, tooltip and first items).
public struct CaptureState: Equatable, Sendable {
    /// The microphone is open for a dictation (block 6).
    public var dictation: Bool
    /// The page reported a meeting recording.
    public var meeting: Bool
    /// The app captures the computer's audio.
    public var systemAudio: Bool

    public init(dictation: Bool = false, meeting: Bool = false, systemAudio: Bool = false) {
        self.dictation = dictation
        self.meeting = meeting
        self.systemAudio = systemAudio
    }

    /// A meeting or the computer's audio: the menu bar item shows even when Settings › General
    /// hides it, so the recording is always marked (guideline 2.5.14).
    public var forcesMenuBarItem: Bool { meeting || systemAudio }

    /// The tooltip of the menu bar item.
    public var statusKey: StringKey? {
        if meeting { return .statusMeeting }
        if systemAudio { return .statusSystemAudio }
        if dictation { return .statusRecording }
        return nil
    }

    /// "meeting=true sysaudio=false", for the UI tests.
    public var summary: String { "meeting=\(meeting) sysaudio=\(systemAudio)" }
}
