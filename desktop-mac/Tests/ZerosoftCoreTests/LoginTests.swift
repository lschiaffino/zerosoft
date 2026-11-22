import Foundation
import Testing
@testable import ZerosoftCore

private let server = "https://zerosoft.ai"
private let start = Date(timeIntervalSince1970: 1_800_000_000)
private let pending = PendingLogin(
    state: String(repeating: "S", count: 32),
    verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    server: server,
    createdAt: start
)
private let code = String(repeating: "c", count: 43)

private func callback(code c: String = code, state: String = pending.state) -> URL {
    URL(string: "zerosoft://auth/callback?code=\(c)&state=\(state)")!
}

private func check(_ url: URL, pending p: PendingLogin? = pending, server s: String = server, at seconds: TimeInterval = 30) -> Result<String, LoginRejection> {
    LoginFlow.code(from: url, pending: p, server: s, now: start.addingTimeInterval(seconds))
}

// MARK: PKCE

@Test func pkceIsS256() {
    // RFC 7636, appendix B.
    #expect(PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    #expect(PKCE.base64url(Data([0xfb, 0xff, 0xfe])) == "-__-")
}

@Test func pendingLoginIsRandomAndTheVerifierStaysInTheApp() throws {
    let a = try #require(PendingLogin.make(server: server))
    let b = try #require(PendingLogin.make(server: server))
    #expect(a.verifier.count == 43 && a.state.count == 32)
    #expect(a.verifier != b.verifier && a.state != b.state)
    // What the server accepts (lib/desktop-auth.ts): verifier 43 to 128, state 16 to 128.
    #expect(DeepLink.token(a.verifier, 43 ... 128) && DeepLink.token(a.state, 16 ... 128))

    let url = try #require(a.startURL(lang: .es))
    let parts = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(parts.scheme == "https" && parts.host == "zerosoft.ai" && parts.path == "/api/desktop/login")
    let q = Dictionary(uniqueKeysWithValues: (parts.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    #expect(q == ["challenge": a.challenge, "state": a.state, "locale": "es", "device": "darwin"])
    #expect(!url.absoluteString.contains(a.verifier))
}

// MARK: The callback

@Test func validCallbackGivesTheCode() {
    #expect(check(callback()) == .success(code))
}

@Test func stateMustMatch() {
    #expect(check(callback(state: String(repeating: "T", count: 32))) == .failure(.state))
    #expect(check(callback(state: pending.state + "x")) == .failure(.state))
    #expect(check(callback(state: String(pending.state.dropLast()))) == .failure(.state))
    #expect(!LoginFlow.constantTimeEqual("abc", "abd") && !LoginFlow.constantTimeEqual("abc", "ab"))
    #expect(LoginFlow.constantTimeEqual("abc", "abc"))
}

@Test func callbackWithoutAPendingSignInIsRefused() {
    #expect(check(callback(), pending: nil) == .failure(.noPending))
}

@Test func oldOrFutureSignInIsRefused() {
    #expect(check(callback(), at: LoginFlow.ttl + 1) == .failure(.expired))
    #expect(check(callback(), at: -5) == .failure(.expired))
}

@Test func serverChangeIsRefused() {
    #expect(check(callback(), server: "https://other.example") == .failure(.server))
}

@Test func malformedCallbacksAreRefused() {
    let bad = [
        "zerosoft://auth/callback?code=\(code)",
        "zerosoft://open?path=/app",
        "zerosoft://auth/callback?code=\(code)&state=\(pending.state)&state=\(pending.state)",
        "https://zerosoft.ai/auth/callback?code=\(code)&state=\(pending.state)",
        "zerosoft://auth/callback?code=c&state=\(pending.state)",
        "zerosoft://auth/callback?code=\(code)%22&state=\(pending.state)",
    ]
    for raw in bad { #expect(check(URL(string: raw)!) == .failure(.malformed), "\(raw)") }
}

// MARK: The token exchange

@Test func tokenRequestCarriesCodeAndVerifierInTheBody() throws {
    let request = try #require(LoginFlow.tokenRequest(code: code, pending: pending))
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "https://zerosoft.ai/api/desktop/token")
    #expect(request.url?.query == nil)
    let body = try #require(request.httpBody)
    let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: String])
    #expect(json == ["code": code, "verifier": pending.verifier])
}

private func response(_ json: String, status: Int = 200, server s: String = server) -> Result<SessionCookie, LoginRejection> {
    LoginFlow.session(status: status, body: Data(json.utf8), server: s)
}

@Test func tokenResponseBecomesAHostOnlyHttpOnlyCookie() throws {
    let ok = response(#"{"token":"eyJ.abc-_.x","cookie":{"name":"__Secure-next-auth.session-token","domain":"evil.com","secure":true,"maxAge":2592000}}"#)
    let cookie = try #require(try? ok.get())
    // A domain the host is not inside falls back to the host (host-only).
    #expect(cookie.domain == "zerosoft.ai" && cookie.secure && cookie.maxAge == 2_592_000)
    #expect(!cookie.description.contains("eyJ"))
    let p = cookie.properties(now: start)
    #expect(p[.domain] as? String == "zerosoft.ai")
    #expect(p[.path] as? String == "/")
    #expect(p[.secure] as? String == "TRUE")
    #expect(p[HTTPCookiePropertyKey("HttpOnly")] as? String == "TRUE")
    #expect(p[.sameSitePolicy] as? String == HTTPCookieStringPolicy.sameSiteLax.rawValue)
    #expect(p[.expires] as? Date == start.addingTimeInterval(2_592_000))

    // Local http: no Secure flag, and a __Secure- name is refused.
    let local = try #require(try? response(#"{"token":"t","cookie":{"name":"next-auth.session-token","maxAge":10}}"#, server: "http://127.0.0.1:3000").get())
    #expect(!local.secure && local.domain == "127.0.0.1" && local.maxAge == LoginFlow.minMaxAge)
    #expect(local.properties()[.secure] == nil)
    #expect(response(#"{"token":"t","cookie":{"name":"__Secure-next-auth.session-token","maxAge":60}}"#, server: "http://127.0.0.1:3000") == .failure(.token))
}

@Test func cookieDomainFollowsTheServerOnlyWhenItContainsTheHost() {
    // The web sets the session cookie for `.zerosoft.ai` (lib/auth.ts): the app does the same,
    // so the page's sign-out clears it and no second cookie with that name appears.
    #expect(LoginFlow.cookieDomain(".zerosoft.ai", host: "zerosoft.ai") == ".zerosoft.ai")
    #expect(LoginFlow.cookieDomain("zerosoft.ai", host: "app.zerosoft.ai") == ".zerosoft.ai")
    #expect(LoginFlow.cookieDomain(nil, host: "zerosoft.ai") == "zerosoft.ai")
    for bad in ["evil.com", ".ai", "ai", "rosoft.ai", "app.zerosoft.ai", ".", "zerosoft.ai."] {
        #expect(LoginFlow.cookieDomain(bad, host: "zerosoft.ai") == "zerosoft.ai", "\(bad)")
    }
    #expect(LoginFlow.cookieDomain("0.1", host: "127.0.0.1") == "127.0.0.1")
    // What a new sign-in replaces: both names, host-only or a parent; nothing else.
    #expect(LoginFlow.isSessionCookie(name: "next-auth.session-token", domain: "zerosoft.ai", host: "zerosoft.ai"))
    #expect(LoginFlow.isSessionCookie(name: "__Secure-next-auth.session-token", domain: ".zerosoft.ai", host: "zerosoft.ai"))
    #expect(!LoginFlow.isSessionCookie(name: "next-auth.csrf-token", domain: "zerosoft.ai", host: "zerosoft.ai"))
    #expect(!LoginFlow.isSessionCookie(name: "next-auth.session-token", domain: "other.ai", host: "zerosoft.ai"))
    #expect(!String(describing: pending).contains(pending.verifier) && !String(describing: pending).contains(pending.state))
}

@Test func unexpectedTokenResponsesAreRefused() {
    let bad = [
        (#"{"token":"t","cookie":{"name":"next-auth.session-token","maxAge":60}}"#, 400),
        (#"{"error":"invalid_grant"}"#, 200),
        (#"{"token":"","cookie":{"name":"next-auth.session-token","maxAge":60}}"#, 200),
        (#"{"token":"t; Domain=evil.com","cookie":{"name":"next-auth.session-token","maxAge":60}}"#, 200),
        (#"{"token":"t","cookie":{"name":"other","maxAge":60}}"#, 200),
        (#"{"token":"t","cookie":{"name":"next-auth.session-token"}}"#, 200),
        (#"{"token":"t"}"#, 200),
        ("[]", 200),
        ("<html>", 200),
    ]
    for (json, status) in bad { #expect(response(json, status: status) == .failure(.token), "\(json)") }
    let long = String(repeating: "a", count: LoginFlow.maxTokenBytes + 1)
    #expect(response(#"{"token":"\#(long)","cookie":{"name":"next-auth.session-token","maxAge":60}}"#) == .failure(.token))
    // maxAge is clamped to 30 days.
    let big = try? response(#"{"token":"t","cookie":{"name":"next-auth.session-token","maxAge":99999999}}"#).get()
    #expect(big?.maxAge == LoginFlow.maxMaxAge)
}
