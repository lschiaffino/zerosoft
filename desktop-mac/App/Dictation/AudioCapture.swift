import AVFoundation
import AppKit

/// Where a dictation's audio comes from: the microphone (`EngineCapture`) or, in UI tests, a
/// fixed tone (`FakeAudioSource`: CI has no microphone and cannot answer the permission prompt).
@MainActor
protocol AudioSource: AnyObject {
    /// Opens the microphone. The permission is checked (and asked for) before this is called.
    func start() throws
    /// The last peak, 0 to 1, for the HUD.
    var level: Float { get }
    /// Closes the microphone and hands over what was recorded.
    func finish() -> RecordedAudio?
    /// Closes the microphone and drops what was recorded.
    func cancel()
}

enum MicError: Error {
    case denied
    case noDevice
    case failed
}

/// Samples from the audio thread, mixed to mono; read on the main thread. Lives only in memory.
private final class SampleSink: @unchecked Sendable {
    private let lock = NSLock()
    private var samples: [Float] = []
    private var peak: Float = 0
    private var rate = 0
    /// A hard stop of ten minutes, as audio.rs (the dictation itself stops at two).
    private var cap = 0

    func reset(rate: Int) {
        lock.lock()
        defer { lock.unlock() }
        samples = []
        samples.reserveCapacity(rate * 30)
        peak = 0
        self.rate = rate
        cap = rate * 600
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0, let data = buffer.floatChannelData else { return }
        let interleaved = buffer.format.isInterleaved
        var top: Float = 0
        lock.lock()
        defer { lock.unlock() }
        guard samples.count < cap else { return }
        for i in 0 ..< frames {
            var sum: Float = 0
            for c in 0 ..< channels {
                sum += interleaved ? data[0][i * channels + c] : data[c][i]
            }
            let m = sum / Float(channels)
            top = max(top, abs(m))
            samples.append(m)
        }
        peak = top
    }

    var level: Float {
        lock.lock()
        defer { lock.unlock() }
        return min(peak, 1)
    }

    func take() -> RecordedAudio {
        lock.lock()
        defer { lock.unlock() }
        let out = RecordedAudio(samples: samples, rate: rate)
        samples = []
        peak = 0
        return out
    }
}

/// The microphone through `AVAudioEngine`'s input node, at the device's own rate and format; the
/// samples are mixed to mono here and resampled to 16 kHz when the dictation ends (WAV.encode).
@MainActor
final class EngineCapture: AudioSource {
    private var engine: AVAudioEngine?
    private let sink = SampleSink()

    func start() throws {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw MicError.noDevice }
        guard format.commonFormat == .pcmFormatFloat32 else { throw MicError.failed }
        sink.reset(rate: Int(format.sampleRate))
        input.installTap(onBus: 0, bufferSize: 2048, format: format, block: Self.tap(sink))
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw AVCaptureDevice.authorizationStatus(for: .audio) == .authorized ? MicError.failed : MicError.denied
        }
        self.engine = engine
    }

    /// Built outside the main actor: the block runs on the audio thread.
    nonisolated private static func tap(_ sink: SampleSink) -> AVAudioNodeTapBlock {
        { buffer, _ in sink.append(buffer) }
    }

    var level: Float { sink.level }

    func finish() -> RecordedAudio? {
        guard let engine else { return nil }
        stop(engine)
        return sink.take()
    }

    func cancel() {
        if let engine { stop(engine) }
        _ = sink.take()
    }

    private func stop(_ engine: AVAudioEngine) {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.engine = nil
    }
}

/// Microphone permission (AVCaptureDevice, the same TCC entry AVAudioEngine uses).
@MainActor
protocol MicrophonePermission: AnyObject {
    func current() -> MicrophoneAccess
    /// Shows the system prompt (only while it is not determined) and returns the answer.
    func request() async -> MicrophoneAccess
    func openSystemSettings()
}

@MainActor
final class SystemMicrophonePermission: MicrophonePermission {
    func current() -> MicrophoneAccess {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .allowed
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    func request() async -> MicrophoneAccess {
        if current() == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        return current()
    }

    func openSystemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
    }
}

#if DEBUG
/// UI tests only: one second of a quiet 440 Hz tone, whatever the time between start and finish.
@MainActor
final class FakeAudioSource: AudioSource {
    private var open = false

    func start() throws { open = true }

    var level: Float { open ? 0.2 : 0 }

    func finish() -> RecordedAudio? {
        guard open else { return nil }
        open = false
        let rate = 48_000
        let samples = (0 ..< rate).map { Float(sin(Double($0) * 2 * .pi * 440 / Double(rate)) * 0.2) }
        return RecordedAudio(samples: samples, rate: rate)
    }

    func cancel() { open = false }
}

/// UI tests only: the microphone permission without the system. `-ZSMicAllowed YES` starts it
/// allowed, `-ZSMicDenied YES` denied; otherwise it is not determined and the first request
/// allows it. It records how often the app asked.
@MainActor
final class FakeMicrophonePermission: MicrophonePermission {
    private var access: MicrophoneAccess
    private(set) var asked = 0
    var onChange: ((Int, MicrophoneAccess) -> Void)?

    init(_ access: MicrophoneAccess) {
        self.access = access
    }

    func current() -> MicrophoneAccess { access }

    func request() async -> MicrophoneAccess {
        asked += 1
        if access == .notDetermined { access = .allowed }
        onChange?(asked, access)
        return access
    }

    func openSystemSettings() {}
}
#endif
