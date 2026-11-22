import AppKit
import Network
import WebKit

/// The web view of the server plus everything that keeps it honest: the navigation policy
/// (NavigationPolicy), the load and paint watchdog (LoadWatchdog) and the process-crash handler.
/// The bridge (BridgeHandler) answers only the server's main frame; its `ready` message is the
/// watchdog's second paint signal. Iframes load (the policy is for the main frame) but cannot
/// use the bridge.
@MainActor
final class WebController: NSObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    let model: OverlayModel
    private let server: String
    private let serverURL: URL
    private let lockdown: LockdownSetting
    private let lang: Lang
    private let openExternal: (URL) -> Void
    private var watchdog = LoadWatchdog()
    /// The last main-frame URL allowed inside: what Retry and Open in browser use.
    private var lastRequested: URL?
    private var lastAllowedAt: Date?
    /// The main-frame navigation in flight: events of an older one are ignored.
    private var currentNavigation: WKNavigation?
    private let pathMonitor = NWPathMonitor()
    private let bridge: BridgeHandler
    /// Called when the overlay changes (the content view hides it when there is none).
    var onOverlayChange: ((Overlay) -> Void)?

    /// A validated bridge `ready` and every bridge refusal (UI tests show them).
    var onBridgeReady: ((ReadyReport) -> Void)?
    var onBridgeReject: ((BridgeRejection) -> Void)?

    init(server: String, lockdown: LockdownSetting, info: BridgeInfo, lang: Lang, openExternal: @escaping (URL) -> Void) {
        self.server = server
        serverURL = URL(string: server)!
        self.lockdown = lockdown
        self.lang = lang
        self.openExternal = openExternal

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        if let on = lockdown.webpagePreference {
            config.defaultWebpagePreferences.isLockdownModeEnabled = on
        }
        let bridge = BridgeHandler(server: server, info: info)
        bridge.install(in: config.userContentController)
        let webView = WKWebView(frame: .zero, configuration: config)
        bridge.attach(to: webView)
        self.bridge = bridge
        self.webView = webView
        webView.allowsBackForwardNavigationGestures = true
        webView.setAccessibilityIdentifier("zs-webview")
        model = OverlayModel(lang: lang, server: server)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        model.onRetry = { [weak self] in self?.send(.retry) }
        bridge.onReady = { [weak self] report in
            self?.send(.ready(hasContent: report.content > 0))
            self?.onBridgeReady?(report)
        }
        bridge.onReject = { [weak self] reason in self?.onBridgeReject?(reason) }
        model.onOpenInBrowser = { [weak self] in
            guard let self else { return }
            self.openExternal(self.lastRequested ?? self.serverURL)
        }
        pathMonitor.pathUpdateHandler = { @Sendable [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.send(.networkAvailable) }
        }
        pathMonitor.start(queue: DispatchQueue.global(qos: .utility))
    }

    deinit {
        pathMonitor.cancel()
    }

    func start() {
        send(.loadRequested)
    }

    /// View › Reload: Retry when the error view is up, a normal reload otherwise.
    func reloadPage() {
        if case .error = watchdog.overlay {
            send(.retry)
        } else {
            webView.reload()
        }
    }

    private func load(_ url: URL) {
        lastRequested = url
        currentNavigation = webView.load(URLRequest(url: url))
    }

    // MARK: Watchdog

    private func send(_ event: LoadWatchdog.Event) {
        let effects = watchdog.handle(event)
        publish()
        effects.forEach(perform)
    }

    private func publish() {
        if model.overlay != watchdog.overlay {
            model.overlay = watchdog.overlay
            onOverlayChange?(watchdog.overlay)
        }
    }

    private func perform(_ effect: WatchdogEffect) {
        switch effect {
        case let .schedule(timer, after, generation):
            later(after) { $0.send(.timer(timer, generation: generation)) }
        case let .checkPaint(after, generation):
            later(after) { controller in
                controller.webView.evaluateJavaScript(LoadWatchdog.paintCheckScript) { [weak controller] result, _ in
                    let count = (result as? NSNumber)?.intValue ?? 0
                    controller?.send(.paint(hasContent: count > 0, generation: generation))
                }
            }
        case .reload:
            load(lastRequested ?? serverURL)
        }
    }

    private func later(_ seconds: TimeInterval, _ work: @escaping @MainActor (WebController) -> Void) {
        Task { @MainActor [weak self] in
            if seconds > 0 { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            if let self { work(self) }
        }
    }

    // MARK: Navigation policy

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        if let on = lockdown.webpagePreference {
            preferences.isLockdownModeEnabled = on
        }
        guard let url = action.request.url else {
            decisionHandler(.cancel, preferences)
            return
        }
        // Frames inside the page (embeds) follow the page; the policy is about the main frame.
        if let frame = action.targetFrame, !frame.isMainFrame {
            decisionHandler(.allow, preferences)
            return
        }
        // `<a download>`: downloads are deferred to the browser (see the response policy).
        if action.shouldPerformDownload {
            if NavigationPolicy.classify(url, server: server) == .allow { openExternal(url) }
            decisionHandler(.cancel, preferences)
            return
        }
        if route(url) {
            decisionHandler(.allow, preferences)
        } else {
            decisionHandler(.cancel, preferences)
        }
    }

    /// Applies the policy to a main-frame URL: true to load it inside, otherwise it was handed
    /// to the browser (or blocked).
    private func route(_ url: URL) -> Bool {
        switch NavigationPolicy.classify(url, server: server) {
        case .allow:
            lastRequested = url
            lastAllowedAt = Date()
            return true
        case .googleLogin:
            // Block 3 replaces this with ASWebAuthenticationSession and PKCE.
            openExternal(url)
        case .connect:
            let age = lastAllowedAt.map { Date().timeIntervalSince($0) } ?? .infinity
            let start = NavigationPolicy.connectStart(last: lastRequested, age: age, server: server)
            openExternal(start ?? url)
        case .external:
            openExternal(url)
        case .block:
            break
        }
        return false
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
    ) {
        guard navigationResponse.isForMainFrame else {
            decisionHandler(.allow)
            return
        }
        let http = navigationResponse.response as? HTTPURLResponse
        if let status = http?.statusCode, let failure = LoadFailure.from(httpStatus: status) {
            decisionHandler(.cancel)
            send(.failed(failure))
            return
        }
        // Downloads (an attachment or a type WebKit cannot show) open in the default browser
        // for now: saving inside the app needs a Downloads entitlement and comes with a later
        // block. The page that was drawn stays (the cancel below reaches the watchdog as
        // `.cancelled`).
        let disposition = (http?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased()
        if !navigationResponse.canShowMIMEType || disposition.hasPrefix("attachment") {
            if let url = navigationResponse.response.url { openExternal(url) }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // MARK: Load events

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        currentNavigation = navigation
        send(.started)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard isCurrent(navigation) else { return }
        send(.finished)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard isCurrent(navigation) else { return }
        fail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard isCurrent(navigation) else { return }
        fail(error)
    }

    /// Events of a navigation that another one replaced are not about what is on screen.
    private func isCurrent(_ navigation: WKNavigation?) -> Bool {
        navigation == nil || currentNavigation == nil || navigation === currentNavigation
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        send(.terminated(at: Date()))
    }

    private func fail(_ error: Error) {
        let ns = error as NSError
        if let failure = LoadFailure.from(domain: ns.domain, code: ns.code) {
            send(.failed(failure))
        } else {
            send(.cancelled)
        }
    }

    // MARK: UI delegate

    /// target=_blank and window.open: the server's pages load here (tabs arrive in block 4),
    /// everything else goes through the policy. window.open() without a URL (about:blank) is
    /// blocked by the policy and leaves the page alone.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, route(url) {
            webView.load(action.request)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable () -> Void
    ) {
        let alert = dialog(message, buttons: [.ok])
        present(alert) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable (Bool) -> Void
    ) {
        let alert = dialog(message, buttons: [.ok, .cancel])
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        let alert = dialog(prompt, buttons: [.ok, .cancel])
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    private func dialog(_ text: String, buttons: [StringKey]) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = String(text.prefix(1000))
        buttons.forEach { alert.addButton(withTitle: Strings.text($0, lang)) }
        return alert
    }

    private func present(_ alert: NSAlert, _ done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window {
            alert.beginSheetModal(for: window, completionHandler: done)
        } else {
            done(alert.runModal())
        }
    }
}
