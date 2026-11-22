import CryptoKit
import Foundation
import Security

// Google sign-in for the app (docs/desktop-swift.md, section 4.5), the same server flow as
// desktop/src-tauri/src/auth.rs and lib/desktop-auth.ts:
// 1. The app makes a PKCE verifier and a state (random, in memory only) and opens
//    <server>/api/desktop/login?challenge=S256(verifier)&state&locale&device=darwin in an
//    ASWebAuthenticationSession.
// 2. The person signs in there and confirms; the server answers with
//    zerosoft://auth/callback?code&state (a one-time code, 2 minutes).
// 3. The app checks the callback against the pending sign-in (state, age, server), exchanges
//    code + verifier at POST /api/desktop/token and puts the session cookie into the web view's
//    cookie store. The app keeps no copy of the token of its own: the web view's store is the
//    only place it lives, as in the Tauri app (desktop/privacy-facts.json).

public enum PKCE {
    /// base64url without padding (RFC 7636, appendix A).
    public static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The S256 challenge: base64url(SHA-256(verifier)), 43 characters.
    public static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// `bytes` random bytes from the system generator as base64url, nil if it fails.
    public static func random(bytes: Int) -> String? {
        var buffer = [UInt8](repeating: 0, count: bytes)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes, &buffer) == errSecSuccess else { return nil }
        return base64url(Data(buffer))
    }
}

/// A sign-in in progress. Lives only in memory, for one attempt. `description` never prints the
/// verifier or the state.
public struct PendingLogin: Equatable, Sendable, CustomStringConvertible {
    public let state: String
    public let verifier: String
    public let server: String
    public let createdAt: Date

    public init(state: String, verifier: String, server: String, createdAt: Date) {
        self.state = state
        self.verifier = verifier
        self.server = server
        self.createdAt = createdAt
    }

    /// 32 bytes of verifier (43 characters) and 24 of state (32 characters), as auth.rs.
    public static func make(server: String, now: Date = Date()) -> PendingLogin? {
        guard let verifier = PKCE.random(bytes: 32), let state = PKCE.random(bytes: 24) else { return nil }
        return PendingLogin(state: state, verifier: verifier, server: server, createdAt: now)
    }

    public var challenge: String { PKCE.challenge(for: verifier) }

    public var description: String { "PendingLogin(server: \(server), createdAt: \(createdAt))" }

    /// The page that starts the sign-in on the server. The verifier never leaves the app.
    public func startURL(lang: Lang) -> URL? {
        guard var parts = URLComponents(string: server + "/api/desktop/login") else { return nil }
        parts.queryItems = [
            URLQueryItem(name: "challenge", value: challenge),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "locale", value: lang.rawValue),
            URLQueryItem(name: "device", value: "darwin"),
        ]
        return parts.url
    }
}

/// Why a sign-in did not complete. Closed tags: what gets logged and shown to tests.
public enum LoginRejection: String, Error, Equatable, Sendable {
    /// No sign-in was waiting for this callback.
    case noPending
    /// The sign-in waited longer than `LoginFlow.ttl`.
    case expired
    /// The callback is not `zerosoft://auth/callback?code&state` with valid values.
    case malformed
    /// The state does not match the pending sign-in.
    case state
    /// The server setting changed since the sign-in started.
    case server
    /// The person closed the sign-in window, or it could not open.
    case cancelled
    /// The token exchange failed or answered something unexpected.
    case token
    /// The web view did not take the cookie.
    case cookie
}

/// The session cookie to put into the web view's store. `description` never prints the value.
public struct SessionCookie: Equatable, Sendable, CustomStringConvertible {
    public let name: String
    public let value: String
    /// The cookie's domain: the server host (host-only), or `.parent` of it when the server sets
    /// its session cookie for a parent domain (`NEXTAUTH_COOKIE_DOMAIN`), as the web does, so the
    /// page's own sign-out clears it and there is never a second cookie with the same name.
    public let domain: String
    public let secure: Bool
    public let maxAge: Int

    public var description: String { "SessionCookie(\(name), domain: \(domain), secure: \(secure), maxAge: \(maxAge))" }

    /// HTTPCookie properties: path /, HttpOnly, SameSite Lax, Secure on https.
    public func properties(now: Date = Date()) -> [HTTPCookiePropertyKey: Any] {
        var p: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: "/",
            .expires: now.addingTimeInterval(TimeInterval(maxAge)),
            .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax.rawValue,
            HTTPCookiePropertyKey("HttpOnly"): "TRUE",
        ]
        if secure { p[.secure] = "TRUE" }
        return p
    }
}

public enum LoginFlow {
    /// How long a sign-in waits for its callback (auth.rs PENDING_TTL).
    public static let ttl: TimeInterval = 600
    /// The scheme ASWebAuthenticationSession waits for.
    public static let callbackScheme = DeepLink.scheme
    /// The cookie names next-auth uses (lib/desktop-auth.ts `sessionCookieInfo`).
    public static let cookieNames: Set<String> = ["next-auth.session-token", "__Secure-next-auth.session-token"]
    public static let maxTokenBytes = 8192
    public static let minMaxAge = 60
    public static let maxMaxAge = 30 * 86_400

    /// Checks the callback of the sign-in against the pending one and returns the code. The
    /// caller drops the pending sign-in whatever the result: a callback is used once.
    public static func code(from callback: URL, pending: PendingLogin?, server: String, now: Date = Date()) -> Result<String, LoginRejection> {
        guard let pending else { return .failure(.noPending) }
        guard case let .auth(code, state)? = DeepLink.parse(callback) else { return .failure(.malformed) }
        let age = now.timeIntervalSince(pending.createdAt)
        guard age >= 0, age < ttl else { return .failure(.expired) }
        guard constantTimeEqual(state, pending.state) else { return .failure(.state) }
        guard pending.server == server else { return .failure(.server) }
        return .success(code)
    }

    /// POST /api/desktop/token with the code and the verifier.
    public static func tokenRequest(code: String, pending: PendingLogin) -> URLRequest? {
        guard let url = URL(string: pending.server + "/api/desktop/token"),
              let body = try? JSONSerialization.data(withJSONObject: ["code": code, "verifier": pending.verifier]) else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    /// Reads the token response: `{ token, cookie: { name, domain, maxAge } }` with status 200.
    /// The cookie's domain is the server host, or the response's domain when it is the host or a
    /// dot-prefixed parent of it; any other domain falls back to the host.
    public static func session(status: Int, body: Data, server: String) -> Result<SessionCookie, LoginRejection> {
        guard status == 200,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let token = json["token"] as? String,
              let cookie = json["cookie"] as? [String: Any],
              let name = cookie["name"] as? String,
              let maxAge = (cookie["maxAge"] as? NSNumber)?.doubleValue, maxAge.isFinite,
              let url = URL(string: server), let host = url.host?.lowercased(), !host.isEmpty else { return .failure(.token) }
        let secure = url.scheme?.lowercased() == "https"
        guard cookieNames.contains(name), !(name.hasPrefix("__Secure-") && !secure),
              !token.isEmpty, token.utf8.count <= maxTokenBytes,
              token.unicodeScalars.allSatisfy(cookieValueScalar) else { return .failure(.token) }
        let age = Int(min(max(maxAge, Double(minMaxAge)), Double(maxMaxAge)))
        let domain = cookieDomain(cookie["domain"] as? String, host: host)
        return .success(SessionCookie(name: name, value: token, domain: domain, secure: secure, maxAge: age))
    }

    /// `.zerosoft.ai` for host `zerosoft.ai` or `app.zerosoft.ai`; never a bare TLD, never a
    /// domain the host is not inside, never for an IP address.
    static func cookieDomain(_ raw: String?, host: String) -> String {
        guard let raw = raw?.lowercased(), !raw.isEmpty, !host.allSatisfy({ $0.isNumber || $0 == "." || $0 == ":" }) else { return host }
        let bare = raw.hasPrefix(".") ? String(raw.dropFirst()) : raw
        guard bare.contains("."), !bare.hasPrefix("."), !bare.hasSuffix("."),
              host == bare || host.hasSuffix("." + bare) else { return host }
        return "." + bare
    }

    /// Whether a stored cookie is one of the session cookies for this server (any of the two
    /// names, host-only or for a parent domain): the ones a new sign-in replaces.
    public static func isSessionCookie(name: String, domain: String, host: String) -> Bool {
        guard cookieNames.contains(name) else { return false }
        let d = domain.lowercased()
        let bare = d.hasPrefix(".") ? String(d.dropFirst()) : d
        return host == bare || host.hasSuffix("." + bare)
    }

    /// A JWT is base64url segments and dots; anything else does not go into a cookie.
    static func cookieValueScalar(_ s: Unicode.Scalar) -> Bool {
        ("a" ... "z").contains(s) || ("A" ... "Z").contains(s) || ("0" ... "9").contains(s) || s == "-" || s == "_" || s == "."
    }

    public static func constantTimeEqual(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        var diff: UInt8 = 0
        for i in 0 ..< x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }
}
