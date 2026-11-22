import Foundation

/// What the microphone recorded: mono samples at the device's rate (audio.rs `Recorded`).
public struct RecordedAudio: Equatable, Sendable {
    public var samples: [Float]
    public var rate: Int

    public init(samples: [Float], rate: Int) {
        self.samples = samples
        self.rate = rate
    }

    public var durationMs: Int {
        rate <= 0 ? 0 : samples.count * 1000 / rate
    }
}

/// The audio sent to the server: 16 kHz, mono, 16-bit PCM WAV, 32 KB a second, about 3.8 MB for
/// the two-minute cap (audio.rs). It lives in memory until the request ends; it reaches the disk
/// only as a saved dictation, when sending failed and "Keep dictations that could not be sent" is
/// on (PendingStore).
public enum WAV {
    public static let rate = 16_000
    /// Below this peak the recording is silence (macOS hands an app without the microphone
    /// permission pure silence).
    public static let silence: Float = 0.0005

    /// Linear resampling, enough for speech going to a transcription model.
    public static func resample(_ samples: [Float], from: Int, to: Int) -> [Float] {
        guard from != to, from > 0, to > 0, !samples.isEmpty else { return samples }
        let ratio = Double(from) / Double(to)
        let n = Int((Double(samples.count) / ratio).rounded(.down))
        var out = [Float]()
        out.reserveCapacity(n)
        for i in 0 ..< n {
            let pos = Double(i) * ratio
            let j = Int(pos)
            let frac = Float(pos - Double(j))
            let a = samples[j]
            let b = j + 1 < samples.count ? samples[j + 1] : a
            out.append(a + (b - a) * frac)
        }
        return out
    }

    /// A 44-byte RIFF header and 16-bit little-endian samples.
    public static func bytes(_ samples: [Float], rate: Int) -> Data {
        let dataLength = UInt32(samples.count * 2)
        var out = Data(capacity: 44 + Int(dataLength))
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
        out.append(contentsOf: Array("RIFF".utf8))
        u32(36 + dataLength)
        out.append(contentsOf: Array("WAVEfmt ".utf8))
        u32(16)
        u16(1) // PCM
        u16(1) // mono
        u32(UInt32(rate))
        u32(UInt32(rate * 2))
        u16(2)
        u16(16)
        out.append(contentsOf: Array("data".utf8))
        u32(dataLength)
        for s in samples {
            let v = s.isFinite ? Int16((min(max(s, -1), 1) * 32767).rounded()) : 0
            u16(UInt16(bitPattern: v))
        }
        return out
    }

    /// The recording as the server takes it, and whether anything was heard.
    public static func encode(_ audio: RecordedAudio) -> (wav: Data, heard: Bool) {
        let mono = resample(audio.samples, from: audio.rate, to: rate)
        let heard = mono.contains { abs($0) > silence }
        return (bytes(mono, rate: rate), heard)
    }
}
