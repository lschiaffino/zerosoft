import Foundation

// What the Settings window asks the server (block 5 of docs/desktop-swift.md): the same routes
// as the Tauri app's settings commands (commands.rs), with the session cookie of the web views.
// Every answer is parsed into closed types with caps before the window shows it, and nothing
// from it is written to disk: dictionary entries and dictation history live in memory while the
// window shows them.

/// Every request the Settings window and the menu bar item can make. The privacy facts
/// (desktop/privacy-facts.json) list each of these paths; a test compares the two lists.
public enum SettingsEndpoint: Equatable, Sendable {
    /// GET: who is signed in (the same route as the Dock badge; 401 means signed out).
    case account
    case voiceSettings
    case saveVoiceSettings
    case dictionary
    case addDictionaryEntry
    case deleteDictionaryEntry(String)
    /// GET: the last 50 dictations.
    case history
    /// GET then POST: next-auth's sign-out, which also ends the session on the server.
    case csrf
    case signOut

    public static let historyLimit = 50

    public var method: String {
        switch self {
        case .account, .voiceSettings, .dictionary, .history, .csrf: return "GET"
        case .saveVoiceSettings: return "PATCH"
        case .addDictionaryEntry, .signOut: return "POST"
        case .deleteDictionaryEntry: return "DELETE"
        }
    }

    /// Path and query on the server. nil for an entry id that is not a plain id.
    public var path: String? {
        switch self {
        case .account: return "/api/desktop/badge"
        case .voiceSettings, .saveVoiceSettings: return "/api/voice/settings"
        case .dictionary, .addDictionaryEntry: return "/api/voice/dictionary"
        case let .deleteDictionaryEntry(id): return DictionaryEntry.validID(id) ? "/api/voice/dictionary/\(id)" : nil
        case .history: return "/api/voice/sessions?kind=dictation&limit=\(Self.historyLimit)"
        case .csrf: return "/api/auth/csrf"
        case .signOut: return "/api/auth/signout"
        }
    }

    /// Writes carry the server as Origin: the site's write routes ask for the same origin.
    public var isWrite: Bool { method != "GET" }

    /// Every kind of request, for the privacy facts test.
    public static let all: [SettingsEndpoint] = [
        .account, .voiceSettings, .saveVoiceSettings, .dictionary, .addDictionaryEntry,
        .deleteDictionaryEntry("id"), .history, .csrf, .signOut,
    ]

    /// "METHOD /path" as desktop/privacy-facts.json writes it (no query, `{id}` for the id).
    public var fact: String {
        let p: String
        switch self {
        case .deleteDictionaryEntry: p = "/api/voice/dictionary/{id}"
        default: p = (path ?? "").split(separator: "?").first.map(String.init) ?? ""
        }
        return "\(method) \(p)"
    }

    /// The request, or nil when the URL would not be on the server origin. `body` is JSON for
    /// PATCH and POST to the voice routes, a form for the sign-out.
    public func request(server: String, body: Data? = nil, form: Bool = false) -> URLRequest? {
        guard let path, let url = URL(string: server + path), Server.origin(of: url) == server else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if isWrite { r.setValue(server, forHTTPHeaderField: "Origin") }
        if let body {
            r.httpBody = body
            r.setValue(form ? "application/x-www-form-urlencoded" : "application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }
}

/// How a request ended, for the window: the data, or why there is none.
public enum Remote<T: Equatable & Sendable>: Equatable, Sendable {
    case ok(T)
    /// 401: nobody is signed in on this server.
    case signedOut
    /// No answer (offline, server down, timeout).
    case offline
    /// An answer that is not the expected one.
    case failed

    /// Maps an HTTP result through a parser (commands.rs `remote`).
    public static func from(status: Int?, body: Data?, _ parse: (Data) -> T?) -> Remote<T> {
        guard let status else { return .offline }
        if status == 401 { return .signedOut }
        guard (200 ... 299).contains(status), let body, let value = parse(body) else { return .failed }
        return .ok(value)
    }
}

/// The signed-in account, from the badge answer's `user` (name and email only).
public struct AccountInfo: Equatable, Sendable {
    public var email: String
    public var name: String

    public static func parse(_ data: Data) -> AccountInfo? {
        guard let json = SettingsJSON.object(data), let user = json["user"] as? [String: Any],
              let email = user["email"] as? String, !email.isEmpty else { return nil }
        return AccountInfo(
            email: Bridge.clip(email, 320),
            name: Bridge.clip((user["name"] as? String) ?? "", 200)
        )
    }
}

public enum CleanupMode: String, CaseIterable, Sendable {
    case raw
    case clean
    case formal
    case perApp = "per_app"
}

public enum CleanupDepth: String, CaseIterable, Sendable {
    case light
    case standard
    case thorough
}

/// The dictation settings Settings › Voice edits (lib/voice-types.ts, /api/voice/settings).
public struct VoiceSettings: Equatable, Sendable {
    public var language: String
    public var cleanupMode: CleanupMode
    public var cleanupDepth: CleanupDepth
    public var aiCleanup: Bool

    /// The picker's languages; the server takes any two-letter code, so a code it already has
    /// that is not in the list is shown too.
    public static let languages = ["auto", "en", "es", "pt", "fr", "de", "it"]

    public init(language: String = "auto", cleanupMode: CleanupMode = .perApp, cleanupDepth: CleanupDepth = .standard, aiCleanup: Bool = true) {
        self.language = language
        self.cleanupMode = cleanupMode
        self.cleanupDepth = cleanupDepth
        self.aiCleanup = aiCleanup
    }

    /// "auto" or two lowercase letters (the server's own check).
    public static func validLanguage(_ s: String) -> Bool {
        s == "auto" || (s.utf8.count == 2 && s.unicodeScalars.allSatisfy { ("a" ... "z").contains($0) })
    }

    /// `{settings: {...}}` of GET and PATCH. Values the app does not know keep the default.
    public static func parse(_ data: Data) -> VoiceSettings? {
        guard let json = SettingsJSON.object(data), let s = json["settings"] as? [String: Any] else { return nil }
        var v = VoiceSettings()
        if let l = s["language"] as? String, validLanguage(l) { v.language = l }
        if let m = (s["cleanupMode"] as? String).flatMap(CleanupMode.init(rawValue:)) { v.cleanupMode = m }
        if let d = (s["cleanupDepth"] as? String).flatMap(CleanupDepth.init(rawValue:)) { v.cleanupDepth = d }
        if let n = s["aiCleanup"] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { v.aiCleanup = n.boolValue }
        return v
    }

    /// The PATCH body with only the fields that changed from `old`. nil when nothing changed or
    /// the language is not valid.
    public func patch(from old: VoiceSettings) -> Data? {
        guard Self.validLanguage(language) else { return nil }
        var body: [String: Any] = [:]
        if language != old.language { body["language"] = language }
        if cleanupMode != old.cleanupMode { body["cleanupMode"] = cleanupMode.rawValue }
        if cleanupDepth != old.cleanupDepth { body["cleanupDepth"] = cleanupDepth.rawValue }
        if aiCleanup != old.aiCleanup { body["aiCleanup"] = aiCleanup }
        guard !body.isEmpty else { return nil }
        return try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

public enum DictionaryKind: String, CaseIterable, Sendable {
    /// How a word is written.
    case word
    /// What is heard, then what is written.
    case replace
    /// A phrase that inserts a saved text.
    case snippet
}

/// The dictionary as the window shows it: the entries and whether the person may delete the
/// team's (only workspace admins can; the server answers 404 otherwise).
public struct DictionaryList: Equatable, Sendable {
    public var entries: [DictionaryEntry]
    public var canEditTeam: Bool

    public static func parse(_ data: Data) -> DictionaryList? {
        guard let entries = DictionaryEntry.parseList(data) else { return nil }
        let flag = SettingsJSON.object(data)?["canEditTeam"] as? NSNumber
        let team = flag.map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
        return DictionaryList(entries: entries, canEditTeam: team)
    }

    /// Delete is offered for the person's own entries, and for the team's only to admins.
    public func canDelete(_ entry: DictionaryEntry) -> Bool {
        !entry.shared || canEditTeam
    }
}

public struct DictionaryEntry: Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: DictionaryKind
    public let phrase: String
    public let replacement: String
    /// The team's (only admins change those).
    public let shared: Bool

    public static let maxEntries = 500
    public static let maxPhrase = 100
    public static let maxReplacement = 2000

    /// An id as the server makes them: 1 to 64 of letters, digits, - and _ (commands.rs).
    public static func validID(_ id: String) -> Bool {
        (1 ... 64).contains(id.utf8.count)
            && id.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
    }

    /// `{entries: [...]}` of GET /api/voice/dictionary. Entries that do not parse are skipped.
    public static func parseList(_ data: Data) -> [DictionaryEntry]? {
        guard let json = SettingsJSON.object(data), let list = json["entries"] as? [Any] else { return nil }
        var out: [DictionaryEntry] = []
        for case let e as [String: Any] in list {
            guard let id = e["id"] as? String, validID(id),
                  let kind = (e["kind"] as? String).flatMap(DictionaryKind.init(rawValue:)),
                  let phrase = e["phrase"] as? String, !phrase.isEmpty else { continue }
            let shared = (e["shared"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
            out.append(DictionaryEntry(
                id: id, kind: kind, phrase: Bridge.clip(phrase, maxPhrase),
                replacement: Bridge.clip((e["replacement"] as? String) ?? "", maxReplacement), shared: shared
            ))
            if out.count == maxEntries { break }
        }
        return out
    }

    /// The POST body for a new entry (commands.rs `dictionary_add`): the phrase trimmed and
    /// capped, a replacement only for replace and snippet, where it is required. nil if invalid.
    public static func addBody(kind: DictionaryKind, phrase: String, replacement: String) -> Data? {
        let p = String(phrase.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxPhrase))
        guard !p.isEmpty else { return nil }
        var body: [String: Any] = ["kind": kind.rawValue, "phrase": p]
        if kind != .word {
            let r = String(replacement.prefix(maxReplacement))
            guard !r.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            body["replacement"] = r
        }
        return try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    /// The id the server gave a new entry (`{id: ...}`).
    public static func parseAdded(_ data: Data) -> String? {
        guard let id = SettingsJSON.object(data)?["id"] as? String, validID(id) else { return nil }
        return id
    }
}

/// One dictation of the history: what was dictated, when and how long.
public struct HistoryItem: Equatable, Sendable, Identifiable {
    public let id: String
    public let text: String
    public let startedAt: Date?
    public let durationMs: Int

    public static let maxText = 20_000

    /// `{sessions: [...]}` of GET /api/voice/sessions. Items without text are skipped.
    public static func parseList(_ data: Data) -> [HistoryItem]? {
        guard let json = SettingsJSON.object(data), let list = json["sessions"] as? [Any] else { return nil }
        var out: [HistoryItem] = []
        for case let s as [String: Any] in list {
            guard let id = s["id"] as? String, DictionaryEntry.validID(id),
                  let text = s["text"] as? String, !text.isEmpty else { continue }
            let ms = (s["durationMs"] as? NSNumber)?.doubleValue ?? 0
            out.append(HistoryItem(
                id: id,
                text: String(text.prefix(maxText)),
                startedAt: (s["startedAt"] as? String).flatMap(SettingsJSON.date),
                durationMs: ms.isFinite ? Int(min(max(ms, 0), 86_400_000)) : 0
            ))
            if out.count == SettingsEndpoint.historyLimit { break }
        }
        return out
    }
}

/// next-auth's sign-out from the app (auth.rs `server_sign_out`): the CSRF token from
/// GET /api/auth/csrf, then a form POST to /api/auth/signout with it.
public enum SignOut {
    public static func csrfToken(_ data: Data) -> String? {
        guard let t = SettingsJSON.object(data)?["csrfToken"] as? String, !t.isEmpty, t.utf8.count <= 200,
              t.unicodeScalars.allSatisfy({ $0.isASCII && !CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return t
    }

    public static func form(token: String) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let value = token.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        return Data("csrfToken=\(value)&json=true".utf8)
    }
}

enum SettingsJSON {
    static func object(_ data: Data) -> [String: Any]? {
        guard data.count <= 2 * 1024 * 1024 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func date(_ s: String) -> Date? {
        guard s.utf8.count <= 40 else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}
