import Foundation

/// The server the app shows, as an origin (`scheme://host[:port]`, no trailing slash).
/// Same rules as `normalize_server` in desktop/src-tauri/src/config.rs.
public enum Server {
    public static let defaultOrigin = "https://zerosoft.ai"

    /// UserDefaults key with a custom server (self-hosting), as `server` in the Tauri app's
    /// settings.json. Also readable as a launch argument: `-server http://localhost:3000`.
    public static let defaultsKey = "server"

    /// http(s) with a host and no credentials; plain http only for localhost (development).
    /// Returns the origin, or nil when the value is not acceptable.
    public static func normalize(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        if url.user != nil || url.password != nil { return nil }
        let local = host == "localhost" || host == "127.0.0.1"
        switch scheme {
        case "https": break
        case "http" where local: break
        default: return nil
        }
        return origin(scheme: scheme, host: host, port: url.port)
    }

    /// The configured origin: a valid custom value, otherwise the default.
    public static func resolve(_ configured: String?) -> String {
        configured.flatMap(normalize) ?? defaultOrigin
    }

    /// Origin of any URL (empty host when it has none). Default ports are dropped, as the `url`
    /// crate does, so `https://zerosoft.ai:443` and `https://zerosoft.ai` are the same origin.
    public static func origin(of url: URL) -> String {
        let scheme = url.scheme?.lowercased() ?? ""
        return origin(scheme: scheme, host: url.host?.lowercased() ?? "", port: url.port)
    }

    static func origin(scheme: String, host: String, port: Int?) -> String {
        let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
        let shownPort = port.flatMap { $0 == defaultPort ? nil : $0 }
        return "\(scheme)://\(host)\(shownPort.map { ":\($0)" } ?? "")"
    }
}
