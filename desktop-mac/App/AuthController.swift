import AppKit
import AuthenticationServices
import os

/// Google sign-in through ASWebAuthenticationSession with PKCE (LoginFlow in ZerosoftCore has
/// the rules and their tests). One sign-in at a time; the verifier and state live in memory for
/// that attempt only. The token goes from the exchange response straight into the web view's
/// cookie store: never into UserDefaults, a file, a log or a URL.
@MainActor
final class AuthController: NSObject, ASWebAuthenticationPresentationContextProviding {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "auth")

    private let server: String
    private let lang: Lang
    private let http: NativeHTTP
    private var pending: PendingLogin?
    private var session: ASWebAuthenticationSession?
    private var busy = false
    weak var window: NSWindow?

    /// The session cookie is in the web view's store.
    var onSignedIn: () -> Void = {}
    /// Every outcome, as a closed tag ("ok" or a LoginRejection). UI tests show it.
    var onOutcome: ((String) -> Void)?
    #if DEBUG
    /// UI tests: instead of the system sign-in window, fetch the start URL without following its
    /// redirect and hand the Location to the same completion as the real session.
    var testBrowser: ((URL, @escaping @MainActor @Sendable (URL?) -> Void) -> Void)?
    #endif

    init(server: String, lang: Lang, http: NativeHTTP) {
        self.server = server
        self.lang = lang
        self.http = http
    }

    /// Bridge `startLogin` (already checked: the server's main frame).
    func begin() {
        guard !busy else { return }
        guard let login = PendingLogin.make(server: server), let url = login.startURL(lang: lang) else {
            outcome(LoginRejection.cancelled.rawValue)
            return
        }
        busy = true
        pending = login
        #if DEBUG
        if let testBrowser {
            testBrowser(url) { [weak self] callback in self?.finish(callback) }
            return
        }
        #endif
        let done: ASWebAuthenticationSession.CompletionHandler = { [weak self] callback, _ in
            Task { @MainActor in self?.finish(callback) }
        }
        let session: ASWebAuthenticationSession
        if #available(macOS 14.4, *) {
            session = ASWebAuthenticationSession(url: url, callback: .customScheme(LoginFlow.callbackScheme), completionHandler: done)
        } else {
            session = ASWebAuthenticationSession(url: url, callbackURLScheme: LoginFlow.callbackScheme, completionHandler: done)
        }
        session.presentationContextProvider = self
        // The person's browser session on the server (and Google) is reused: they confirm the
        // account on the server's page instead of signing in again.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { finish(nil) }
    }

    /// The end of the attempt: the callback is checked against the pending sign-in, which is
    /// dropped whatever happens (a callback counts once).
    private func finish(_ callback: URL?) {
        let login = pending
        pending = nil
        session = nil
        guard let callback, let login else {
            busy = false
            outcome(LoginRejection.cancelled.rawValue)
            return
        }
        switch LoginFlow.code(from: callback, pending: login, server: server) {
        case let .failure(reason):
            busy = false
            outcome(reason.rawValue)
        case let .success(code):
            Task { await exchange(code: code, login: login) }
        }
    }

    private func exchange(code: String, login: PendingLogin) async {
        defer { busy = false }
        guard let request = LoginFlow.tokenRequest(code: code, pending: login),
              let (status, body) = await http.send(request, withSession: false) else {
            outcome(LoginRejection.token.rawValue)
            return
        }
        switch LoginFlow.session(status: status, body: body, server: server) {
        case let .failure(reason):
            outcome(reason.rawValue)
        case let .success(cookie):
            guard await NativeHTTP.setCookie(cookie, host: URL(string: server)?.host?.lowercased() ?? "") else {
                outcome(LoginRejection.cookie.rawValue)
                return
            }
            outcome("ok")
            onSignedIn()
        }
    }

    private func outcome(_ tag: String) {
        Self.log.notice("sign-in \(tag, privacy: .public)")
        onOutcome?(tag)
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { window ?? NSApp.keyWindow ?? NSWindow() }
    }
}
