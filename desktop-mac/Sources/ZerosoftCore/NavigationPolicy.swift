import Foundation

/// What to do with a main-frame navigation. Port of `classify` and `connect_start` in
/// desktop/src-tauri/src/nav.rs: only the exact server origin loads inside the app; Google sign-in
/// and integration OAuth go to the system browser; other http(s), mailto and tel open in the
/// default browser; every other scheme is blocked.
public enum NavigationDecision: Equatable {
    case allow
    /// Signing in to the app with Google (next-auth). Block 3 runs it with PKCE through
    /// ASWebAuthenticationSession; until then it opens in the browser.
    case googleLogin
    /// The OAuth consent of an integration that returns to a callback of this server. Opened in
    /// the browser starting from the route that led here (`connectStart`).
    case connect
    case external
    case block
}

public enum NavigationPolicy {
    /// Callback of the Google sign-in. Any other redirect_uri is an integration.
    static let loginCallback = "/api/auth/callback/google"

    /// How long the last allowed navigation counts as the start route of the redirect after it.
    public static let connectStartTTL: TimeInterval = 30

    public static func classify(_ target: URL, server: String) -> NavigationDecision {
        let scheme = target.scheme?.lowercased() ?? ""
        switch scheme {
        case "about", "blob", "data":
            return target.absoluteString == "about:blank" ? .allow : .block
        case "mailto", "tel":
            return .external
        case "http", "https":
            break
        default:
            return .block
        }
        if Server.origin(of: target) == server { return .allow }
        let host = target.host?.lowercased() ?? ""
        let back = redirectURI(target)
        if host == "accounts.google.com" || host.hasSuffix(".accounts.google.com") {
            // Without a recognisable redirect_uri it stays a sign-in.
            if let back, back.path != loginCallback { return .connect }
            return .googleLogin
        }
        // Another provider that returns to a callback of this server: connecting an account.
        if let back, Server.origin(of: back) == server { return .connect }
        return .external
    }

    /// The start route to open in the browser for `.connect`: the last navigation allowed inside,
    /// when it is recent, of the server, and an API route other than next-auth's. The OAuth state
    /// is checked against a cookie that route sets, so the whole flow must happen in one browser.
    /// Never returns a URL of another origin.
    public static func connectStart(last: URL?, age: TimeInterval, server: String) -> URL? {
        guard let last, age <= connectStartTTL else { return nil }
        let scheme = last.scheme?.lowercased() ?? ""
        guard scheme == "http" || scheme == "https", Server.origin(of: last) == server else { return nil }
        let path = last.path
        guard path.hasPrefix("/api/"), !path.hasPrefix("/api/auth/") else { return nil }
        return last
    }

    static func redirectURI(_ target: URL) -> URL? {
        guard let items = URLComponents(url: target, resolvingAgainstBaseURL: false)?.queryItems,
              let raw = items.first(where: { $0.name == "redirect_uri" })?.value,
              let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host != nil else { return nil }
        return url
    }
}
