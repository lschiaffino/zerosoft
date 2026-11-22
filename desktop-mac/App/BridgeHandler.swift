import Foundation
import os
import WebKit

/// The `zerosoft` script message handler (docs/desktop-swift.md, section 4.3). Every message goes
/// through `Bridge.validate` (origin, allowlist, typed arguments, size) before anything native
/// runs; refusals reject the page's promise with a closed reason and are logged with that reason
/// only. Block 2 answers `info` and takes `ready`; block 3 adds `startLogin` and `notify`;
/// block 4 adds `tabs`; block 5 `openSettings`. The other commands answer `unavailable` until their blocks add the
/// native side.
@MainActor
final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "bridge")

    private let server: String
    private let info: BridgeInfo
    private weak var webView: WKWebView?
    /// A validated `ready` from the page in the main frame.
    var onReady: ((ReadyReport) -> Void)?
    /// Every refusal, by reason (UI tests read the counts).
    var onReject: ((BridgeRejection) -> Void)?
    /// `startLogin` and `notify` from the server's main frame.
    var onStartLogin: (() -> Void)?
    var onNotify: ((String, String?) -> Void)?
    /// `openSettings` (block 5): the native Settings window.
    var onOpenSettings: (() -> Void)?
    /// `tabs` from the server's main frame of this web view (block 4). The path, when there is
    /// one, already passed `Bridge.validPath`; the tabs controller checks it again.
    var onTabs: ((TabsAction, String?, String?, Int?) -> Void)?

    init(server: String, info: BridgeInfo) {
        self.server = server
        self.info = info
    }

    /// Adds the handler and the bridge script to a configuration. The script runs in the main
    /// frame only; the handler is visible to every frame of the page world, which is why the
    /// origin check is on the native side. A frame that can already script the main frame (same
    /// origin, or an about:blank/srcdoc frame that inherits it) can also call through
    /// `parent.zerosoftDesktop`; WebKit attributes that call to the main frame. That grants
    /// nothing such a frame did not already have.
    func install(in controller: WKUserContentController) {
        controller.addScriptMessageHandler(self, contentWorld: .page, name: Bridge.handlerName)
        controller.addUserScript(WKUserScript(
            source: BridgeScript.source(server: server, info: info),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .page
        ))
    }

    /// Only messages from this web view count (set once the web view exists).
    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    /// A suspended or closed tab: no message reaches the app any more.
    func detach(from controller: WKUserContentController) {
        controller.removeScriptMessageHandler(forName: Bridge.handlerName, contentWorld: .page)
        controller.removeAllUserScripts()
        webView = nil
        onReady = nil
        onReject = nil
        onStartLogin = nil
        onNotify = nil
        onOpenSettings = nil
        onTabs = nil
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard let webView, message.webView === webView, message.world == .page else {
            reject(.origin, replyHandler)
            return
        }
        let origin = message.frameInfo.securityOrigin
        let frame = BridgeFrame(
            isMainFrame: message.frameInfo.isMainFrame,
            scheme: origin.protocol,
            host: origin.host,
            port: origin.port
        )
        switch Bridge.validate(body: message.body, frame: frame, server: server) {
        case let .failure(reason):
            reject(reason, replyHandler)
        case let .success(request):
            handle(request, replyHandler)
        }
    }

    private func handle(_ request: BridgeRequest, _ reply: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        switch request {
        case .info:
            reply(info.reply, nil)
        case let .ready(report):
            Self.log.info("ready \(report.summary, privacy: .public)")
            onReady?(report)
            reply(nil, nil)
        case .startLogin:
            onStartLogin?()
            reply(nil, nil)
        case .openSettings:
            onOpenSettings?()
            reply(nil, nil)
        case let .notify(title, body):
            onNotify?(title, body)
            reply(nil, nil)
        case let .tabs(action, path, title, n):
            onTabs?(action, path, title, n)
            reply(nil, nil)
        default:
            // Valid, but this build has no native side for it yet.
            reject(.unavailable, reply)
        }
    }

    private func reject(_ reason: BridgeRejection, _ reply: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        if reason != .unavailable {
            Self.log.notice("rejected \(reason.rawValue, privacy: .public)")
        }
        onReject?(reason)
        reply(nil, reason.rawValue)
    }
}
