import Foundation

/// `zerosoft://` links, validated field by field. Port of desktop/src-tauri/src/deeplink.rs:
/// - `zerosoft://auth/callback?code&state`: the end of the browser sign-in. The app completes a
///   sign-in only from the ASWebAuthenticationSession that started it (LoginFlow), never from a
///   link opened by something else, so `application(_:open:)` ignores this case.
/// - `zerosoft://open?path=/app/...` (or `zerosoft://open/app/...`): opens a page of the app.
///
/// A link never carries a URL: only a path that must be an app page of the configured server,
/// and `target(for:server:)` checks the resulting URL against the server origin and the
/// navigation policy again. No link runs a command.
public enum DeepLink: Equatable, Sendable {
    case auth(code: String, state: String)
    case open(path: String)

    public static let scheme = "zerosoft"
    public static let maxLength = 2000
    public static let maxPath = 500
    static let locales: Set<String> = ["en", "es", "pt"]

    public static func parse(_ url: URL) -> DeepLink? {
        parse(url.absoluteString)
    }

    public static func parse(_ raw: String) -> DeepLink? {
        guard raw.utf8.count <= maxLength,
              !raw.unicodeScalars.contains(where: { $0 == " " || CharacterSet.controlCharacters.contains($0) }),
              let parts = URLComponents(string: raw),
              parts.scheme?.lowercased() == scheme,
              parts.user == nil, parts.password == nil, parts.port == nil,
              let host = parts.host?.lowercased() else { return nil }
        let items = parts.queryItems ?? []
        // One value per key: `?path=/app&path=//evil` must not leave the choice to the parser.
        guard Set(items.map(\.name)).count == items.count else { return nil }
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value) })
        switch host {
        case "auth":
            let path = parts.percentEncodedPath
            guard path == "/callback" || path == "/callback/",
                  Set(query.keys) == ["code", "state"],
                  let code = query["code"] ?? nil, let state = query["state"] ?? nil,
                  token(code, 20 ... 200), token(state, 16 ... 200) else { return nil }
            return .auth(code: code, state: state)
        case "open":
            let path: String
            if parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/" {
                guard Set(query.keys) == ["path"], let value = query["path"] ?? nil else { return nil }
                path = value
            } else {
                let q = parts.percentEncodedQuery.map { "?\($0)" } ?? ""
                path = parts.percentEncodedPath + q
            }
            return safeAppPath(path).map { .open(path: $0) }
        default:
            return nil
        }
    }

    /// `safe_app_path` of deeplink.rs: `/app...` or `/<locale>/app...`, at most 500 bytes, no
    /// `//`, `\`, `..`, `:` (no scheme), spaces or control characters, and no percent-encoded
    /// dot or backslash (WebKit's URL parser turns `%2e%2e` into `..`).
    public static func safeAppPath(_ path: String) -> String? {
        let lower = path.lowercased()
        guard path.utf8.count <= maxPath, Bridge.validPath(path),
              !path.contains(".."), !path.contains(":"),
              !lower.contains("%2e"), !lower.contains("%5c") else { return nil }
        let pathOnly = path.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? ""
        let segments = pathOnly.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard let first = segments.first else { return nil }
        if first == "app" { return path }
        if locales.contains(first), segments.count > 1, segments[1] == "app" { return path }
        return nil
    }

    /// The URL to load for an app path: the server plus the path, only when the result is still
    /// the server origin and the navigation policy loads it inside.
    public static func target(for path: String, server: String) -> URL? {
        guard let path = safeAppPath(path), let url = URL(string: server + path),
              Server.origin(of: url) == server,
              NavigationPolicy.classify(url, server: server) == .allow else { return nil }
        return url
    }

    /// `token_ok` of deeplink.rs: base64url characters only, length in range.
    static func token(_ value: String, _ range: ClosedRange<Int>) -> Bool {
        range.contains(value.utf8.count) && value.unicodeScalars.allSatisfy {
            ("a" ... "z").contains($0) || ("A" ... "Z").contains($0) || ("0" ... "9").contains($0) || $0 == "-" || $0 == "_"
        }
    }
}
