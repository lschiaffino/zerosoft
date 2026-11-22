import Foundation

// The dictation's requests (api.rs `dictate` and `warm`) and what their answers mean
// (retry.rs `classify`). Both paths are in desktop/privacy-facts.json (network `dictation`); a
// test compares the lists.

public enum DictationEndpoint: Equatable, Sendable {
    /// POST multipart: the audio and its fields; the answer has the clean text.
    case dictate
    /// GET without the session while recording: opens the connection and wakes the server
    /// function (204, reads nothing).
    case warm

    public static let all: [DictationEndpoint] = [.dictate, .warm]
    public static let path = "/api/voice/dictate"

    public var method: String { self == .dictate ? "POST" : "GET" }
    public var fact: String { "\(method) \(Self.path)" }

    /// The request, or nil when the URL would not be on the server origin.
    public func request(server: String, body: Data? = nil, boundary: String = "") -> URLRequest? {
        guard let url = URL(string: server + Self.path), Server.origin(of: url) == server else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if self == .dictate {
            // The server's write routes ask for the same origin.
            r.setValue(server, forHTTPHeaderField: "Origin")
            r.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            r.httpBody = body
            // A long dictation with AI cleanup can take the server most of its 60 seconds.
            r.timeoutInterval = 70
        } else {
            r.timeoutInterval = 5
        }
        return r
    }
}

/// The multipart body of POST /api/voice/dictate, with the same fields as the Tauri app.
public struct DictationUpload: Equatable, Sendable {
    public static let maxSourceApp = 100

    public var wav: Data
    public var durationMs: Int
    /// The name of the app in front, or "" when the switch is off (then "desktop" is sent).
    public var sourceApp: String
    /// email, chat, note or other (DictationContext).
    public var context: String

    public init(wav: Data, durationMs: Int, sourceApp: String, context: String) {
        self.wav = wav
        self.durationMs = durationMs
        self.sourceApp = sourceApp
        self.context = context
    }

    /// A boundary that cannot appear in the fields (letters and digits only).
    public static func boundary(_ random: UInt64) -> String {
        "zerosoft-" + String(random, radix: 36)
    }

    public func body(boundary: String) -> Data {
        var out = Data()
        func text(_ s: String) { out.append(contentsOf: Array(s.utf8)) }
        func field(_ name: String, _ value: String) {
            text("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        let app = Self.clean(sourceApp)
        field("context", ["email", "chat", "note", "other"].contains(context) ? context : "other")
        field("sourceApp", app.isEmpty ? "desktop" : app)
        field("durationMs", String(max(durationMs, 0)))
        field("capture", "desktop")
        // Quick answer: the server skips AI cleanup of short phrases, caps its time and saves
        // the history after answering (the app pastes the text as soon as it arrives).
        field("fast", "1")
        text("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"dictation.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
        out.append(wav)
        text("\r\n--\(boundary)--\r\n")
        return out
    }

    /// An app name as a form value: no line breaks or quotes, capped.
    public static func clean(_ name: String) -> String {
        let kept = name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && $0 != "\"" }
        return String(String(String.UnicodeScalarView(kept)).trimmingCharacters(in: .whitespaces).prefix(maxSourceApp))
    }
}

/// Why a dictation did not come back as text (retry.rs `Failure`).
public enum DictationFailure: String, CaseIterable, Sendable, Codable {
    case offline
    case signedOut = "signed_out"
    case rateLimited = "rate_limited"
    case server
    case tooLarge = "too_large"
    case empty
    case rejected
    /// Saved for another server: it stays here and is not sent to the current one.
    case otherServer = "other_server"

    /// The audio is kept to send again only when the audio was not the problem.
    public var keepForRetry: Bool {
        switch self {
        case .offline, .signedOut, .rateLimited, .server: return true
        case .tooLarge, .empty, .rejected, .otherServer: return false
        }
    }
}

public enum DictationOutcome: Equatable, Sendable {
    case text(String)
    case failed(DictationFailure)

    public static let maxText = 20_000

    /// An HTTP answer (nil status: no answer at all) as text or a failure.
    public static func classify(status: Int?, body: Data?) -> DictationOutcome {
        guard let status else { return .failed(.offline) }
        let json = body.flatMap { $0.count <= 2 * 1024 * 1024 ? (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] : nil }
        let error = json?["error"] as? String ?? ""
        switch status {
        case 401: return .failed(.signedOut)
        case 429: return .failed(.rateLimited)
        case 413: return .failed(.tooLarge)
        case _ where error == "audio_too_large": return .failed(.tooLarge)
        case _ where error == "empty_audio": return .failed(.empty)
        case 500 ... 599: return .failed(.server)
        case 200 ... 299:
            guard let json else { return .failed(.server) }
            let text = ((json["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? .failed(.empty) : .text(String(text.prefix(maxText)))
        default: return .failed(.rejected)
        }
    }
}

/// Where a dictation's time went (dictation.rs `Latency`): numbers only, kept in memory.
public struct DictationTiming: Equatable, Sendable {
    /// From the release of the shortcut to the text inserted.
    public var totalMs: Int
    /// Closing the microphone and building the WAV.
    public var audioMs: Int
    /// The whole request (upload, server, answer).
    public var requestMs: Int
    public var insertMs: Int
    /// What the server says it spent, when it says.
    public var transcribeMs: Int?
    public var cleanupMs: Int?
    public var serverMs: Int?

    public init(totalMs: Int, audioMs: Int, requestMs: Int, insertMs: Int, server body: Data?) {
        self.totalMs = totalMs
        self.audioMs = audioMs
        self.requestMs = requestMs
        self.insertMs = insertMs
        let timings = body.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }?["timings"] as? [String: Any]
        func ms(_ key: String) -> Int? {
            guard let n = timings?[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            let d = n.doubleValue
            return d.isFinite && d >= 0 && d < 3_600_000 ? Int(d) : nil
        }
        transcribeMs = ms("transcribeMs")
        cleanupMs = ms("cleanupMs")
        serverMs = ms("totalMs")
    }

    /// "total=1200 audio=40 request=1100 insert=60 transcribe=700 cleanup=300 server=1000".
    public var summary: String {
        var parts = ["total=\(totalMs)", "audio=\(audioMs)", "request=\(requestMs)", "insert=\(insertMs)"]
        if let transcribeMs { parts.append("transcribe=\(transcribeMs)") }
        if let cleanupMs { parts.append("cleanup=\(cleanupMs)") }
        if let serverMs { parts.append("server=\(serverMs)") }
        return parts.joined(separator: " ")
    }
}
