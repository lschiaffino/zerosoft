import Foundation
import WebKit

/// The app's own requests to the server (token exchange, badge poll, the Settings window). An ephemeral session with
/// no cookie jar, no cache and no redirects: the only cookies sent are the server's, read from
/// the web view's store for each request (as api.rs does), and a redirect never carries them to
/// another place. Nothing here logs a request, a header or a body.
@MainActor
final class NativeHTTP {
    private let server: String
    private let session: URLSession

    init(server: String, timeout: TimeInterval = 20) {
        self.server = server
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.timeoutIntervalForRequest = timeout
        session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }

    /// Sends a request to the server, with the session cookies when `withSession` is true.
    /// Requests to any other origin are refused before they leave.
    func send(_ request: URLRequest, withSession: Bool) async -> (status: Int, body: Data)? {
        guard let answer = await exchange(request, withSession: withSession) else { return nil }
        return (answer.status, answer.body)
    }

    /// `send` with the response's cookies (the sign-out needs next-auth's CSRF cookie from the
    /// first request in the second) and extra cookies to send. Cookies are only ever the
    /// server's: the request is refused before it leaves when it is not for the server.
    func exchange(_ request: URLRequest, withSession: Bool, extra: [HTTPCookie] = []) async -> (status: Int, body: Data, cookies: [HTTPCookie])? {
        guard let url = request.url, Server.origin(of: url) == server else { return nil }
        var request = request
        request.httpShouldHandleCookies = false
        // A fresh cookie replaces a stored one of the same name (one CSRF cookie, not two).
        let fresh = Set(extra.map(\.name))
        let cookies = (withSession ? await Self.cookies(for: url) : []).filter { !fresh.contains($0.name) } + extra
        if !cookies.isEmpty {
            for (key, value) in HTTPCookie.requestHeaderFields(with: cookies) {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse else { return nil }
        var fields: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let k = key as? String, let v = value as? String { fields[k] = v }
        }
        return (http.statusCode, data, HTTPCookie.cookies(withResponseHeaderFields: fields, for: url))
    }

    /// The web view's cookies that a browser would send to `url`.
    static func cookies(for url: URL) async -> [HTTPCookie] {
        let all = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        let host = url.host?.lowercased() ?? ""
        let https = url.scheme?.lowercased() == "https"
        let path = url.path.isEmpty ? "/" : url.path
        return all.filter { c in
            let domain = c.domain.lowercased()
            let bare = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
            let hostMatch = host == bare || (domain.hasPrefix(".") && host.hasSuffix(domain))
            let expired = c.expiresDate.map { $0 < Date() } ?? false
            return hostMatch && !expired && (https || !c.isSecure) && path.hasPrefix(c.path)
        }
    }

    /// The web view store's session cookie after a sign-in. Session cookies already stored for
    /// this server go first, so exactly one is left; the write is checked by its value.
    static func setCookie(_ cookie: SessionCookie, host: String) async -> Bool {
        guard let http = HTTPCookie(properties: cookie.properties()) else { return false }
        let store = WKWebsiteDataStore.default().httpCookieStore
        for old in await store.allCookies() where LoginFlow.isSessionCookie(name: old.name, domain: old.domain, host: host) {
            await store.deleteCookie(old)
        }
        await store.setCookie(http)
        return await store.allCookies().contains {
            $0.name == cookie.name && $0.domain.lowercased() == cookie.domain && $0.value == cookie.value
        }
    }
}

/// Refuses every redirect: the app's endpoints answer directly.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}
