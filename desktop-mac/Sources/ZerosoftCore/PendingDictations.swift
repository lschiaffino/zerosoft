import Foundation

// Dictations that could not be sent (retry.rs): when the network, the server or the session
// failed and "Keep dictations that could not be sent" is on, the audio waits in
// <container>/Application Support/zerosoft/pending/ to be sent again from the menu bar item or
// Settings › History. At most 20, for at most a week (privacy facts `pendingMax`, `pendingDays`).
// No text is ever stored: what comes back from the server goes to the clipboard and the
// account's history, never to these files.

public struct PendingMeta: Codable, Equatable, Sendable {
    public var id: String
    /// Milliseconds since 1970.
    public var createdAt: Int64
    public var mime: String
    public var durationMs: Int
    public var sourceApp: String
    public var context: String
    public var failure: DictationFailure
    public var attempts: Int
    /// The server origin it was recorded for: it is only ever sent there.
    public var server: String

    public init(id: String, createdAt: Int64, durationMs: Int, sourceApp: String, context: String,
                failure: DictationFailure, server: String) {
        self.id = id
        self.createdAt = createdAt
        mime = "audio/wav"
        self.durationMs = durationMs
        self.sourceApp = DictationUpload.clean(sourceApp)
        self.context = context
        self.failure = failure
        attempts = 0
        self.server = server
    }

    /// Recorded for `server` (the Tauri app's files without a server count for any).
    public func sameServer(_ current: String) -> Bool {
        server.isEmpty || server == current
    }
}

public struct PendingStore: Sendable {
    public static let maxCount = 20
    public static let maxAgeMs: Int64 = 7 * 86_400_000
    /// A file larger than this is not a dictation of ours (two minutes are about 3.8 MB).
    static let maxAudioBytes = 8 * 1024 * 1024
    static let maxMetaBytes = 16 * 1024

    public let dir: URL

    public init(dir: URL) {
        self.dir = dir
    }

    /// 6 to 40 lowercase letters and digits: an id is a file name and nothing else.
    public static func validID(_ id: String) -> Bool {
        (6 ... 40).contains(id.utf8.count) && id.unicodeScalars.allSatisfy { ("a" ... "z").contains($0) || ("0" ... "9").contains($0) }
    }

    public static func newID(now: Int64, random: UInt32) -> String {
        let n = String(format: "%06d", Int(random % 1_000_000))
        return String(max(now, 0), radix: 36) + n
    }

    /// Newest first; out go those past the cap or older than a week.
    public static func prune(_ list: [PendingMeta], now: Int64) -> (keep: [PendingMeta], drop: [PendingMeta]) {
        var keep: [PendingMeta] = []
        var drop: [PendingMeta] = []
        for m in list.sorted(by: { $0.createdAt > $1.createdAt }) {
            if keep.count < maxCount, now - m.createdAt <= maxAgeMs {
                keep.append(m)
            } else {
                drop.append(m)
            }
        }
        return (keep, drop)
    }

    private func paths(_ id: String) -> (audio: URL, meta: URL) {
        (dir.appendingPathComponent("\(id).audio"), dir.appendingPathComponent("\(id).json"))
    }

    /// The saved dictations, newest first. Pruned ones and files that do not parse are deleted.
    public func list(now: Int64) -> [PendingMeta] {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return [] }
        var metas: [PendingMeta] = []
        for name in names where name.hasSuffix(".json") {
            let url = dir.appendingPathComponent(name)
            let size = (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int) ?? Int.max
            if size <= Self.maxMetaBytes, let data = try? Data(contentsOf: url),
               let m = try? JSONDecoder().decode(PendingMeta.self, from: data),
               Self.validID(m.id), name == "\(m.id).json", fm.fileExists(atPath: paths(m.id).audio.path) {
                metas.append(m)
            } else {
                try? fm.removeItem(at: url)
            }
        }
        let (keep, drop) = Self.prune(metas, now: now)
        for m in drop { remove(m.id) }
        // Audio left without its description.
        let kept = Set(keep.map(\.id))
        for name in names where name.hasSuffix(".audio") && !kept.contains(String(name.dropLast(6))) {
            try? fm.removeItem(at: dir.appendingPathComponent(name))
        }
        return keep
    }

    public func save(_ meta: PendingMeta, audio: Data) -> Bool {
        guard Self.validID(meta.id), audio.count <= Self.maxAudioBytes,
              let json = try? JSONEncoder().encode(meta) else { return false }
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let (a, j) = paths(meta.id)
            try Self.writePrivate(audio, to: a)
            try Self.writePrivate(json, to: j)
            return true
        } catch {
            remove(meta.id)
            return false
        }
    }

    public func read(_ id: String, now: Int64) -> (PendingMeta, Data)? {
        guard Self.validID(id), let meta = list(now: now).first(where: { $0.id == id }) else { return nil }
        let url = paths(id).audio
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? Int.max
        guard size <= Self.maxAudioBytes, let audio = try? Data(contentsOf: url) else { return nil }
        return (meta, audio)
    }

    public func markAttempt(_ id: String, failure: DictationFailure, now: Int64) {
        guard var m = list(now: now).first(where: { $0.id == id }) else { return }
        m.failure = failure
        m.attempts += 1
        guard let json = try? JSONEncoder().encode(m) else { return }
        try? Self.writePrivate(json, to: paths(id).meta)
    }

    @discardableResult
    public func remove(_ id: String) -> Bool {
        guard Self.validID(id) else { return false }
        let (a, j) = paths(id)
        try? FileManager.default.removeItem(at: a)
        try? FileManager.default.removeItem(at: j)
        return true
    }

    /// Readable only by the user, written whole.
    static func writePrivate(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
