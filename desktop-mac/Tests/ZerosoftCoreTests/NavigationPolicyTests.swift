import Foundation
import Testing
@testable import ZerosoftCore

// Port of the tests of desktop/src-tauri/src/nav.rs (`policy`, `connect_is_not_login`,
// `connect_start_only_own_api_routes`).

private let server = "https://zerosoft.ai"

private func c(_ raw: String, _ s: String = server) -> NavigationDecision {
    NavigationPolicy.classify(URL(string: raw)!, server: s)
}

private func enc(_ s: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return s.addingPercentEncoding(withAllowedCharacters: allowed)!
}

@Test func policy() {
    #expect(c("https://zerosoft.ai/app/talk") == .allow)
    #expect(c("https://zerosoft.ai") == .allow)
    #expect(c("https://ZeroSoft.ai/app") == .allow)
    #expect(c("https://zerosoft.ai:443/app") == .allow)
    #expect(c("https://zerosoft.ai:8443/app") == .external)
    #expect(c("https://zerosoft.ai.evil.com/app") == .external)
    #expect(c("https://evil.com/?https://zerosoft.ai") == .external)
    #expect(c("http://zerosoft.ai/app") == .external)
    #expect(c("https://accounts.google.com/o/oauth2/v2/auth?x=1") == .googleLogin)
    #expect(c("https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fauth%2Fcallback%2Fgoogle&state=s") == .googleLogin)
    #expect(c("https://example.com/docs") == .external)
    #expect(c("mailto:a@b.c") == .external)
    #expect(c("tel:+15550100") == .external)
    #expect(c("file:///etc/passwd") == .block)
    #expect(c("javascript:alert(1)") == .block)
    #expect(c("data:text/html,hi") == .block)
    #expect(c("zerosoft://open?path=/app") == .block)
    #expect(c("about:blank") == .allow)
    #expect(c("about:srcdoc") == .block)
    #expect(c("http://localhost:3210/app", "http://localhost:3210") == .allow)
    #expect(c("http://127.0.0.1:3210/app", "http://localhost:3210") == .external)
    #expect(c("http://localhost:3211/app", "http://localhost:3210") == .external)
}

@Test func connectIsNotLogin() {
    for cb in ["/api/integrations/gmail/callback", "/api/integrations/google-calendar/callback", "/api/social/oauth/callback"] {
        let u = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=\(enc(server + cb))&state=s"
        #expect(c(u) == .connect, "\(cb)")
    }
    #expect(c("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Foutlook%2Fcallback") == .connect)
    #expect(c("https://slack.com/oauth/v2/authorize?state=s&redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Ftrack%2Fslack%2Fcallback") == .connect)
    #expect(c("https://api.notion.com/v1/oauth/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Fnotion%2Fcallback") == .connect)
    #expect(c("https://linear.app/oauth/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Flinear%2Fcallback") == .connect)
    // A redirect_uri of another site, broken or of another scheme is just an external link.
    #expect(c("https://slack.com/oauth/v2/authorize?redirect_uri=https%3A%2F%2Fevil.com%2Fapi%2Fx") == .external)
    #expect(c("https://slack.com/oauth/v2/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai.evil.com%2Fapi%2Fx") == .external)
    #expect(c("https://slack.com/oauth/v2/authorize?redirect_uri=nope") == .external)
    #expect(c("https://slack.com/oauth/v2/authorize?redirect_uri=javascript%3Aalert(1)") == .external)
    #expect(c("https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=nope") == .googleLogin)
    // The server's own origin always loads inside, whatever the parameters.
    #expect(c("https://zerosoft.ai/api/inbox/gmail?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fx") == .allow)
}

@Test func connectStartOnlyOwnAPIRoutes() {
    func s(_ raw: String, _ age: TimeInterval) -> String? {
        NavigationPolicy.connectStart(last: URL(string: raw), age: age, server: server)?.absoluteString
    }
    #expect(s("https://zerosoft.ai/api/inbox/gmail", 0) == "https://zerosoft.ai/api/inbox/gmail")
    #expect(s("https://zerosoft.ai/api/integrations/gmail/start?return=%2Fes%2Fapp%2Fwelcome", 2)
        == "https://zerosoft.ai/api/integrations/gmail/start?return=%2Fes%2Fapp%2Fwelcome")
    // Old, a page (not a start route), next-auth or another origin: nothing.
    #expect(s("https://zerosoft.ai/api/inbox/gmail", 31) == nil)
    #expect(s("https://zerosoft.ai/es/app/social/accounts", 0) == nil)
    #expect(s("https://zerosoft.ai/api/auth/signin/google", 0) == nil)
    #expect(s("https://evil.com/api/inbox/gmail", 0) == nil)
    #expect(s("http://zerosoft.ai/api/inbox/gmail", 0) == nil)
    #expect(s("about:blank", 0) == nil)
    #expect(NavigationPolicy.connectStart(last: nil, age: 0, server: server) == nil)
}

@Test func serverNormalize() {
    #expect(Server.normalize("https://zerosoft.ai/") == "https://zerosoft.ai")
    #expect(Server.normalize("  https://Zerosoft.AI/app?x=1 ") == "https://zerosoft.ai")
    #expect(Server.normalize("https://self.example.com:8443") == "https://self.example.com:8443")
    #expect(Server.normalize("https://zerosoft.ai:443") == "https://zerosoft.ai")
    #expect(Server.normalize("http://localhost:3000") == "http://localhost:3000")
    #expect(Server.normalize("http://127.0.0.1:3000/") == "http://127.0.0.1:3000")
    #expect(Server.normalize("http://zerosoft.ai") == nil)
    #expect(Server.normalize("https://user:pw@zerosoft.ai") == nil)
    #expect(Server.normalize("ftp://zerosoft.ai") == nil)
    #expect(Server.normalize("zerosoft.ai") == nil)
    #expect(Server.normalize("") == nil)
    #expect(Server.resolve(nil) == "https://zerosoft.ai")
    #expect(Server.resolve("javascript:alert(1)") == "https://zerosoft.ai")
    #expect(Server.resolve("http://localhost:3210") == "http://localhost:3210")
}
