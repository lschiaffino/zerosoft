import Foundation
import Testing
@testable import ZerosoftCore

// Block 7: the computer's audio for meetings, the page's recording flag and the indicator.

// MARK: Samples

private func sine(_ n: Int, rate: Double, hz: Double = 440, amp: Float = 0.5) -> [Float] {
    (0 ..< n).map { Float(sin(Double($0) * 2 * .pi * hz / rate)) * amp }
}

@Test func resamplerPassesSixteenKilohertzThrough() {
    var r = PCMResampler(sourceRate: 16_000)
    let input: [Float] = [0, 0.5, -0.5, 1, -1, 0.25]
    #expect(r.push(input) == input.map(PCMResampler.int16))
    #expect(r.push([]) == [])
}

@Test func resamplerAveragesWhenDownsampling() {
    var r = PCMResampler(sourceRate: 48_000)
    // Three source samples per output sample.
    let out = r.push([0.3, 0.3, 0.3, -0.6, 0, 0, 1, 1])
    #expect(out == [PCMResampler.int16(0.3), PCMResampler.int16(-0.2)])
    // The two leftover samples wait for the next chunk.
    #expect(r.push([1]) == [PCMResampler.int16(1)])
}

@Test func resamplerDoesNotDependOnChunks() {
    let input = sine(48_000, rate: 48_000)
    var whole = PCMResampler(sourceRate: 48_000)
    let one = whole.push(input)
    var split = PCMResampler(sourceRate: 48_000)
    var parts: [Int16] = []
    var i = 0
    for size in [1, 7, 480, 1023, 5, 4096] + Array(repeating: 1024, count: 60) where i < input.count {
        let end = min(input.count, i + size)
        parts += split.push(Array(input[i ..< end]))
        i = end
    }
    parts += split.push(Array(input[i...]))
    #expect(one.count == 16_000)
    #expect(parts == one)
}

@Test func resamplerKeepsLengthAndLevelAtOddRates() {
    for rate in [44_100.0, 22_050, 8_000, 96_000] {
        let input = sine(Int(rate), rate: rate, hz: 300)
        var r = PCMResampler(sourceRate: rate)
        var out: [Int16] = []
        stride(from: 0, to: input.count, by: 512).forEach { out += r.push(Array(input[$0 ..< min(input.count, $0 + 512)])) }
        // One second in, one second out (give or take the sample waiting for the next chunk).
        #expect(abs(out.count - 16_000) <= 2, "\(rate): \(out.count)")
        // A 300 Hz tone keeps its level (well under every rate's Nyquist).
        let peak = out.map { abs(Int($0)) }.max() ?? 0
        #expect(peak > 15_000 && peak <= 16_400, "\(rate): \(peak)")
    }
}

@Test func resamplerRejectsNonsenseRates() {
    #expect(PCMResampler(sourceRate: 0).sourceRate == 16_000)
    #expect(PCMResampler(sourceRate: .nan).sourceRate == 16_000)
    #expect(PCMResampler(sourceRate: 10_000_000).sourceRate == 16_000)
}

@Test func int16Clamps() {
    #expect(PCMResampler.int16(0) == 0)
    #expect(PCMResampler.int16(1) == 32767)
    #expect(PCMResampler.int16(-2) == -32767)
    #expect(PCMResampler.int16(.nan) == 0)
    #expect(PCMResampler.int16(.infinity) == 0)
}

@Test func mixMonoAveragesChannels() {
    #expect(PCMResampler.mixMono(channels: [[1, 0], [0, 1]]) == [0.5, 0.5])
    #expect(PCMResampler.mixMono(channels: [[1, 0, 1], [0, 1]]) == [0.5, 0.5])
    #expect(PCMResampler.mixMono(channels: []).isEmpty)
    #expect(PCMResampler.mixMono(channels: [[0.25]]) == [0.25])
    #expect(PCMResampler.mixMono(interleaved: [1, 0, 0, 1, 0.5, 0.5], channels: 2) == [0.5, 0.5, 0.5])
    #expect(PCMResampler.mixMono(interleaved: [1, 0, 0], channels: 2) == [0.5])
    #expect(PCMResampler.mixMono(interleaved: [1], channels: 0).isEmpty)
}

@Test func queueGivesLittleEndianBytesOnce() {
    var q = PCMQueue()
    q.append([1, -2, 0x1234])
    let data = q.take()
    #expect(Array(data) == [0x01, 0x00, 0xFE, 0xFF, 0x34, 0x12])
    #expect(q.count == 0 && q.take().isEmpty)
    // What the page decodes (pcm16Base64ToFloat in components/voice/audio.ts).
    q.append([0, 32767])
    #expect(q.take().base64EncodedString() == "AAD/fw==")
}

@Test func queueKeepsAtMostSixtySeconds() {
    var q = PCMQueue()
    q.append([Int16](repeating: 1, count: PCMQueue.maxSamples))
    q.append([2, 3])
    #expect(q.count == PCMQueue.maxSamples)
    #expect(q.samples.last == 3 && q.samples.first == 1)
    q.clear()
    #expect(q.count == 0)
}

// MARK: Start rules

@Test func startsOnlyFromTheTabInUse() {
    // commands.rs system_audio_starts_only_from_the_tab_in_use
    #expect(SystemAudioRules.startAllowed(tabInUse: true, alreadyRunning: false, isOwner: false))
    #expect(!SystemAudioRules.startAllowed(tabInUse: false, alreadyRunning: false, isOwner: false))
    #expect(SystemAudioRules.startAllowed(tabInUse: false, alreadyRunning: true, isOwner: true))
    #expect(!SystemAudioRules.startAllowed(tabInUse: true, alreadyRunning: true, isOwner: false))
    #expect(!SystemAudioRules.startAllowed(tabInUse: false, alreadyRunning: true, isOwner: false))
}

@Test func stopsAfterThirtySecondsWithoutReads() {
    #expect(!SystemAudioRules.idle(nowMs: 40_000, lastReadMs: 20_000))
    #expect(SystemAudioRules.idle(nowMs: 51_000, lastReadMs: 20_000))
    #expect(!SystemAudioRules.idle(nowMs: 10, lastReadMs: 20_000))
}

@Test func availability() {
    #expect(SystemAudioRules.available(allowed: true, lockdown: false, backend: .processTap))
    #expect(!SystemAudioRules.available(allowed: false, lockdown: false, backend: .processTap))
    #expect(!SystemAudioRules.available(allowed: true, lockdown: true, backend: .screenCapture))
    #expect(!SystemAudioRules.available(allowed: true, lockdown: false, backend: .none))
    #expect(BridgeInfo(version: "1", store: false, lockdown: .off, systemAudio: true).reply["systemAudio"] as? Bool == true)
    #expect(BridgeInfo(version: "1", store: false, lockdown: .on, systemAudio: true).reply["systemAudio"] as? Bool == false)
    #expect(BridgeInfo(version: "1", store: false, lockdown: .off).reply["systemAudio"] as? Bool == false)
}

@Test func backendByMacOSVersion() {
    #expect(SystemAudioBackend.pick(major: 13, minor: 0) == .screenCapture)
    #expect(SystemAudioBackend.pick(major: 14, minor: 1, patch: 9) == .screenCapture)
    #expect(SystemAudioBackend.pick(major: 14, minor: 2) == .processTap)
    #expect(SystemAudioBackend.pick(major: 15, minor: 0) == .processTap)
    #expect(SystemAudioBackend.pick(major: 26, minor: 1) == .processTap)
    #expect(SystemAudioBackend.pick(major: 12, minor: 7) == .none)
    #expect(SystemAudioBackend.screenCapture.canPreflight && !SystemAudioBackend.processTap.canPreflight)
}

@Test func resultCodesMatchThePage() {
    // components/voice/audio.ts reads exactly these.
    #expect(["ok", "denied", "unsupported", "failed"] == [SystemAudioResult.ok, .denied, .unsupported, .failed].map(\.rawValue))
}

// MARK: Recording flag

@Test func recordingFromThePage() {
    let now = 1_800_000_000_000.0
    #expect(MeetingRecording.from(active: false, startedAt: now, path: "/app/voice/meetings/m1", nowMs: now) == nil)
    #expect(MeetingRecording.from(active: true, startedAt: now - 5000, path: "/app/voice/meetings/m1", nowMs: now)
        == MeetingRecording(startedAt: now - 5000, path: "/app/voice/meetings/m1"))
    // A start in the future or more than a day ago becomes now.
    #expect(MeetingRecording.from(active: true, startedAt: now + 10, path: nil, nowMs: now)?.startedAt == now)
    #expect(MeetingRecording.from(active: true, startedAt: now - 90_000_000, path: nil, nowMs: now)?.startedAt == now)
    #expect(MeetingRecording.from(active: true, startedAt: nil, path: "/elsewhere", nowMs: now) == MeetingRecording(startedAt: now, path: ""))
}

@Test func indicatorPaths() {
    // indicator.rs `paths`
    #expect(MeetingRecording.validPath("/app/voice/meetings/abc_123-x"))
    for bad in ["/voice", "/app//x", "/app/../admin", "https://evil.com/app/x", "/app/x?y=1", "/app/x#h", "", "/app/ñ",
                "/app/" + String(repeating: "a", count: 200)] {
        #expect(!MeetingRecording.validPath(bad), "\(bad)")
    }
}

// MARK: Indicator

@Test func indicatorVisibility() {
    // indicator.rs `visibility`
    let show = RecordingIndicatorRules.shouldShow
    #expect(show(true, false, false, true, false, false))
    #expect(!show(true, false, false, true, false, true))
    #expect(!show(true, false, false, false, false, false))
    #expect(!show(false, false, false, true, false, false))
    // The computer's audio is marked even with the indicator off in Settings and without a
    // flag from the page.
    #expect(show(false, true, false, false, false, false))
    #expect(show(true, true, false, false, false, false))
    #expect(!show(true, true, false, true, true, false))
    // Rec's floating bar already marks its capture.
    #expect(!show(false, true, true, false, false, false))
    #expect(show(true, true, true, true, false, false))
}

@Test func indicatorClock() {
    #expect(RecordingIndicatorRules.elapsed(ms: 0) == "0:00")
    #expect(RecordingIndicatorRules.elapsed(ms: 7_900) == "0:07")
    #expect(RecordingIndicatorRules.elapsed(ms: 754_000) == "12:34")
    #expect(RecordingIndicatorRules.elapsed(ms: 3_723_000) == "1:02:03")
    #expect(RecordingIndicatorRules.elapsed(ms: -5) == "0:00")
}

@Test func savedIndicatorPositionMustBeOnAScreen() {
    let screens = [(x: 0.0, y: 0.0, width: 1440.0, height: 900.0)]
    #expect(RecordingIndicatorRules.onScreen(x: 1384, y: 860, screens: screens))
    #expect(!RecordingIndicatorRules.onScreen(x: 3000, y: 12, screens: screens))
    #expect(!RecordingIndicatorRules.onScreen(x: 100, y: 2000, screens: screens))
    #expect(RecordingIndicatorRules.onScreen(x: -30, y: 100, screens: screens))
    #expect(!RecordingIndicatorRules.onScreen(x: 100, y: 100, screens: []))
    // A second screen on the left.
    #expect(RecordingIndicatorRules.onScreen(x: -1000, y: 300, screens: screens + [(x: -1920, y: 0, width: 1920, height: 1080)]))
}

// MARK: Menu bar item

@Test func captureStateOfTheMenuBarItem() {
    #expect(!CaptureState(dictation: true).forcesMenuBarItem)
    #expect(CaptureState(meeting: true).forcesMenuBarItem && CaptureState(systemAudio: true).forcesMenuBarItem)
    #expect(CaptureState().statusKey == nil)
    #expect(CaptureState(dictation: true).statusKey == .statusRecording)
    #expect(CaptureState(dictation: true, meeting: true).statusKey == .statusMeeting)
    #expect(CaptureState(systemAudio: true).statusKey == .statusSystemAudio)
    #expect(CaptureState(meeting: true, systemAudio: false).summary == "meeting=true sysaudio=false")
}

@Test func menuWhileAMeetingRecords() {
    let both = CaptureState(meeting: true, systemAudio: true)
    #expect(StatusMenuItem.items(signedIn: nil, unread: 0, capture: both) == [
        .open, .newTab, .newWindow, .separator, .capturing(both), .openRecording, .stopRecording, .stopSystemAudio,
        .separator, .settings, .separator, .quit,
    ])
    let audio = CaptureState(systemAudio: true)
    #expect(StatusMenuItem.items(signedIn: nil, unread: 0, capture: audio) == [
        .open, .newTab, .newWindow, .separator, .capturing(audio), .stopSystemAudio, .separator, .settings, .separator, .quit,
    ])
    // A dictation alone keeps the block 6 menu.
    #expect(StatusMenuItem.items(signedIn: nil, unread: 0, capture: CaptureState(dictation: true))
        == StatusMenuItem.items(signedIn: nil, unread: 0))
}

// MARK: Settings

@Test func meetingSettingsDefaultsAndRoundTrip() {
    let fresh = AppSettings.decode(nil)
    #expect(fresh.recordingIndicator && fresh.allowSystemAudio && fresh.indicatorPosition == nil)
    #expect(fresh.meetingsSummary == "indicator=true sysaudio=true")
    var s = AppSettings()
    s.recordingIndicator = false
    s.allowSystemAudio = false
    s.indicatorPosition = IndicatorPosition(x: 1200.4, y: -33.6)
    let back = AppSettings.decode(s.encoded())
    #expect(back == s)
    #expect(back.indicatorPosition == IndicatorPosition(x: 1200, y: -34))
    #expect(back.meetingsSummary == "indicator=false sysaudio=false")
    // Junk positions are dropped, the rest of the file still reads.
    for junk in [#"[1]"#, #"[true, 2]"#, #"["1", 2]"#, #"[1e9, 2]"#, #"{"x":1,"y":2}"#] {
        let read = AppSettings.decode(Data(#"{"allowSystemAudio":false,"indicatorPosition":\#(junk)}"#.utf8))
        #expect(read.indicatorPosition == nil && !read.allowSystemAudio, "\(junk)")
    }
}

@Test func meetingsSectionComesBeforePermissions() {
    let order = SettingsSection.allCases
    #expect(order.firstIndex(of: .meetings)! < order.firstIndex(of: .permissions)!)
}
