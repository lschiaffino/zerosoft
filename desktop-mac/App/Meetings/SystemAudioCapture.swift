import AppKit
import AudioToolbox
import CoreAudio
import CoreMedia
import os
import ScreenCaptureKit

/// Where the audio threads put the computer's audio until the page reads it: mono 16 kHz
/// 16-bit samples (PCMResampler) in a queue capped at 60 seconds (PCMQueue). Memory only; the
/// queue is emptied by every read and on stop. Nothing here logs or keeps a sample.
final class SystemAudioSink: @unchecked Sendable {
    private let lock = NSLock()
    private var queue = PCMQueue()
    private var resampler = PCMResampler(sourceRate: PCMResampler.targetRate)
    private var open = false

    /// Starts taking samples (after a `close`, everything pushed is dropped).
    func reopen() {
        lock.lock()
        queue.clear()
        resampler = PCMResampler(sourceRate: PCMResampler.targetRate)
        open = true
        lock.unlock()
    }

    /// Drops what is waiting and refuses what the audio thread still pushes.
    func close() {
        lock.lock()
        open = false
        queue.clear()
        lock.unlock()
    }

    /// From an audio thread: mono float samples at `rate`.
    func push(mono: [Float], rate: Double) {
        guard !mono.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        guard open else { return }
        if resampler.sourceRate != rate { resampler = PCMResampler(sourceRate: rate) }
        queue.append(resampler.push(mono))
    }

    /// The tap's current format (it changes when the output device or its rate changes).
    private var tapFormat = AudioStreamBasicDescription()

    func setFormat(_ format: AudioStreamBasicDescription) {
        lock.lock()
        tapFormat = format
        lock.unlock()
    }

    /// From the tap's audio thread: the buffers in the tap's current format.
    func pushTap(_ list: UnsafePointer<AudioBufferList>) {
        lock.lock()
        let format = tapFormat
        lock.unlock()
        push(list, format: format)
    }

    /// From an audio thread: an AudioBufferList of 32-bit floats, interleaved or one buffer per
    /// channel.
    func push(_ list: UnsafePointer<AudioBufferList>, format: AudioStreamBasicDescription) {
        guard format.mFormatID == kAudioFormatLinearPCM,
              format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32 else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
        let nonInterleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
        var channels: [[Float]] = []
        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let floats = Array(UnsafeBufferPointer(start: data.assumingMemoryBound(to: Float.self), count: Int(buffer.mDataByteSize) / 4))
            if nonInterleaved || buffer.mNumberChannels <= 1 {
                channels.append(floats)
            } else {
                channels.append(PCMResampler.mixMono(interleaved: floats, channels: Int(buffer.mNumberChannels)))
            }
        }
        push(mono: PCMResampler.mixMono(channels: channels), rate: format.mSampleRate)
    }

    /// Everything since the last read, as 16-bit little-endian bytes. The samples are swapped
    /// out under the lock and encoded outside it, so the audio thread never waits for that.
    func take() -> Data {
        lock.lock()
        let samples = queue.takeSamples()
        lock.unlock()
        return PCMQueue.bytes(samples)
    }
}

/// One capture of the computer's audio. `start` returns once it runs (or why not); `stop` ends it
/// and releases everything it created.
@MainActor
protocol SystemAudioSource: AnyObject {
    func start(into sink: SystemAudioSink) async -> SystemAudioResult
    func stop()
}

/// The permissions behind the capture, for the start and for Settings › Permissions. macOS has no
/// public check for the "system audio recording" permission of audio taps: it asks the first time
/// a tap records, and a tap it refused records silence (the page warns about silence).
@MainActor
protocol CapturePermissions: AnyObject {
    var backend: SystemAudioBackend { get }
    /// Screen Recording (CGPreflightScreenCaptureAccess), which ScreenCaptureKit's audio needs.
    func screenAllowed() -> Bool
    /// The "Allow screen recording" button: macOS's prompt the first time, System Settings after.
    func requestScreen()
    /// The first capture without the permission: macOS's prompt (it shows once per app); never
    /// opens System Settings, so a page cannot bring it up.
    func promptScreenOnce()
    func openScreenSettings()
    func openAudioSettings()
}

@MainActor
final class SystemCapturePermissions: CapturePermissions {
    let backend: SystemAudioBackend
    private var askedScreen = false

    init() {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        backend = SystemAudioBackend.pick(major: v.majorVersion, minor: v.minorVersion, patch: v.patchVersion)
    }

    func screenAllowed() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    func requestScreen() {
        if askedScreen {
            openScreenSettings()
            return
        }
        askedScreen = true
        // Shows the prompt the first time; returns false right away while it is up.
        _ = CGRequestScreenCaptureAccess()
    }

    func promptScreenOnce() {
        guard !askedScreen else { return }
        askedScreen = true
        _ = CGRequestScreenCaptureAccess()
    }

    func openScreenSettings() {
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    }

    func openAudioSettings() {
        // System Settings has one pane for screen and system audio recording.
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    }

    private func open(_ link: String) {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }

    /// The capture for this macOS: an audio tap on 14.2 and later, ScreenCaptureKit before.
    func makeSource() -> SystemAudioSource? {
        switch backend {
        case .processTap:
            if #available(macOS 14.2, *) { return ProcessTapSource() }
            return nil
        case .screenCapture:
            return ScreenCaptureAudioSource(permissions: self)
        case .none:
            return nil
        }
    }
}

// MARK: Core Audio process tap (macOS 14.2+)

/// Every process's output except this app's own, through a private process tap in a private
/// aggregate device (https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps).
/// The tap does not mute anything. macOS asks for "system audio recording" the first time it
/// records (NSAudioCaptureUsageDescription).
@available(macOS 14.2, *)
@MainActor
final class ProcessTapSource: SystemAudioSource {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "meetings")
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var aggregate = AudioObjectID(kAudioObjectUnknown)
    private var proc: AudioDeviceIOProcID?
    private var listener: AudioObjectPropertyListenerBlock?
    private let queue = DispatchQueue(label: "ai.zerosoft.mac.system-audio", qos: .userInitiated)

    func start(into sink: SystemAudioSink) async -> SystemAudioResult {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: Self.ownProcess().map { [$0] } ?? [])
        description.uuid = UUID()
        description.name = "zerosoft meeting audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        var status = AudioHardwareCreateProcessTap(description, &tap)
        guard status == noErr, tap != kAudioObjectUnknown else { return fail("tap", status) }
        self.tap = tap

        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        status = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format)
        guard status == noErr else { return fail("format", status) }
        sink.setFormat(format)
        // The output device or its rate can change mid-call (a headset switching profile): the
        // sink follows the tap's format, so the conversion keeps the right rate.
        let listener = Self.formatListener(tap: tap, sink: sink)
        if AudioObjectAddPropertyListenerBlock(tap, &address, queue, listener) == noErr { self.listener = listener }

        let device: [String: Any] = [
            kAudioAggregateDeviceNameKey: "zerosoft meeting audio",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: description.uuid.uuidString,
                kAudioSubTapDriftCompensationKey: true,
            ]],
        ]
        // Taps only, no sub-device: a headset's microphone would otherwise join the input
        // buffers of the aggregate and be mixed into the computer's audio.
        var aggregate = AudioObjectID(kAudioObjectUnknown)
        status = AudioHardwareCreateAggregateDevice(device as CFDictionary, &aggregate)
        guard status == noErr, aggregate != kAudioObjectUnknown else { return fail("device", status) }
        self.aggregate = aggregate

        var proc: AudioDeviceIOProcID?
        status = AudioDeviceCreateIOProcIDWithBlock(&proc, aggregate, queue, Self.ioBlock(sink))
        guard status == noErr, let proc else { return fail("proc", status) }
        self.proc = proc
        status = AudioDeviceStart(aggregate, proc)
        guard status == noErr else { return fail("start", status) }
        return .ok
    }

    func stop() {
        if let listener, tap != kAudioObjectUnknown {
            var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            AudioObjectRemovePropertyListenerBlock(tap, &address, queue, listener)
        }
        listener = nil
        if let proc {
            AudioDeviceStop(aggregate, proc)
            AudioDeviceDestroyIOProcID(aggregate, proc)
        }
        proc = nil
        if aggregate != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregate) }
        aggregate = AudioObjectID(kAudioObjectUnknown)
        if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
        tap = AudioObjectID(kAudioObjectUnknown)
    }

    /// Releases what was created and says which step failed (a closed tag and an OSStatus only).
    private func fail(_ step: StaticString, _ status: OSStatus) -> SystemAudioResult {
        Self.log.notice("system audio tap failed at \(step, privacy: .public): \(status, privacy: .public)")
        stop()
        return .failed
    }

    /// The block the audio thread calls: built outside the main actor, so it never inherits its
    /// isolation.
    private nonisolated static func ioBlock(_ sink: SystemAudioSink) -> AudioDeviceIOBlock {
        { _, input, _, _, _ in sink.pushTap(input) }
    }

    /// Reads the tap's format again when it changes (on the capture queue).
    private nonisolated static func formatListener(tap: AudioObjectID, sink: SystemAudioSink) -> AudioObjectPropertyListenerBlock {
        { _, _ in
            var format = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            if AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format) == noErr { sink.setFormat(format) }
        }
    }

    /// This app's Core Audio process object, so the tap leaves out the app's own sound.
    private static func ownProcess() -> AudioObjectID? {
        var pid = getpid()
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }
}

// MARK: ScreenCaptureKit audio (macOS 13 to 14.1)

/// The audio of an `SCStream` of the main display, with this app's own audio left out
/// (system_audio.rs). The stream asks for the smallest video ScreenCaptureKit allows and the app
/// takes no video output, so no screen image reaches it. Needs Screen Recording: without it,
/// the first capture shows macOS's prompt and answers `denied`.
@MainActor
final class ScreenCaptureAudioSource: NSObject, SystemAudioSource {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "meetings")
    private let permissions: CapturePermissions
    private var stream: SCStream?
    private var output: AudioOutput?
    private let queue = DispatchQueue(label: "ai.zerosoft.mac.system-audio", qos: .userInitiated)

    init(permissions: CapturePermissions) {
        self.permissions = permissions
    }

    func start(into sink: SystemAudioSink) async -> SystemAudioResult {
        guard permissions.screenAllowed() else {
            // First use: macOS's prompt (once per app). The page says the permission is missing.
            permissions.promptScreenOnce()
            return .denied
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { return .failed }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 16_000
            config.channelCount = 1
            let stream = SCStream(filter: filter, configuration: config, delegate: nil)
            let output = AudioOutput(sink: sink)
            try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: queue)
            try await stream.startCapture()
            self.stream = stream
            self.output = output
            return .ok
        } catch {
            let code = (error as NSError).code
            Self.log.notice("system audio stream failed: \(code, privacy: .public)")
            stop()
            return .failed
        }
    }

    func stop() {
        if let stream {
            Task { try? await stream.stopCapture() }
        }
        stream = nil
        output = nil
    }

    private final class AudioOutput: NSObject, SCStreamOutput, @unchecked Sendable {
        let sink: SystemAudioSink

        init(sink: SystemAudioSink) {
            self.sink = sink
        }

        func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
            guard type == .audio, buffer.isValid,
                  let description = CMSampleBufferGetFormatDescription(buffer),
                  let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee else { return }
            var size = 0
            CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(buffer, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0,
                                                                    blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
            guard size > 0 else { return }
            let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
            defer { raw.deallocate() }
            let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
            var block: CMBlockBuffer?
            let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
                buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: size,
                blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
                flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block
            )
            guard status == noErr else { return }
            sink.push(UnsafePointer(list), format: asbd)
            _ = block
        }
    }
}

#if DEBUG
/// UI tests only: the computer's audio without the system. `-ZSSystemAudio allowed` captures a
/// quiet tone, `denied` refuses, anything else (`ask`, the default) is not decided: the first
/// capture "asks" and the answer is no, as when the person denies the prompt. It records how
/// often the app asked.
@MainActor
final class FakeCapturePermissions: CapturePermissions {
    enum Access: String {
        case ask
        case allowed
        case denied
    }

    let backend: SystemAudioBackend
    private(set) var audio: Access
    private(set) var screen: Bool
    private(set) var asked = 0
    private(set) var askedScreen = 0
    var onChange: (() -> Void)?

    init(audio: Access, backend: SystemAudioBackend) {
        self.audio = audio
        self.backend = backend
        screen = false
    }

    func screenAllowed() -> Bool { screen }

    func requestScreen() {
        askedScreen += 1
        onChange?()
    }

    func promptScreenOnce() {}

    func openScreenSettings() {}
    func openAudioSettings() {}

    /// The fake capture's start: the "prompt" of a first use, and the answer.
    func startResult() -> SystemAudioResult {
        switch audio {
        case .allowed: return .ok
        case .denied: return .denied
        case .ask:
            asked += 1
            audio = .denied
            onChange?()
            return .denied
        }
    }

    var summary: String { "asked=\(asked) audio=\(audio.rawValue) screen-asked=\(askedScreen)" }
}

/// UI tests only: a quiet 440 Hz stereo tone at 48 kHz, 0.25 s every 0.25 s, through the same
/// sink and conversion as the real captures.
@MainActor
final class FakeSystemAudioSource: SystemAudioSource {
    private let permissions: FakeCapturePermissions
    private var timer: Timer?
    private var phase = 0.0

    init(permissions: FakeCapturePermissions) {
        self.permissions = permissions
    }

    func start(into sink: SystemAudioSink) async -> SystemAudioResult {
        let result = permissions.startResult()
        guard result == .ok else { return result }
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick(sink) }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        return .ok
    }

    private func tick(_ sink: SystemAudioSink) {
        let rate = 48_000.0
        var left: [Float] = []
        for _ in 0 ..< 12_000 {
            left.append(Float(sin(phase)) * 0.2)
            phase += 2 * .pi * 440 / rate
        }
        sink.push(mono: PCMResampler.mixMono(channels: [left, left]), rate: rate)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }
}
#endif
