import AppKit
import Network
import WebKit

/// The web view of the server plus everything that keeps it honest: the navigation policy
/// (NavigationPolicy), the load and paint watchdog (LoadWatchdog) and the process-crash handler.
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
    private let pathMonitor = NWPathMonitor()
    /// Called when the overlay changes (the content view hides it when there is none).
    var onOverlayChange: ((Overlay) -> Void)?

    init(server: String, lockdown: LockdownSetting, lang: Lang, openExternal: @escaping (URL) -> Void) {
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
        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.setAccessibilityIdentifier("zs-webview")
        model = OverlayModel(lang: lang, server: server)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        model.onRetry = { [weak self] in self?.send(.retry) }
        model.onOpenInBrowser = { [weak self] in
            guard let self else { return }
            self.openExternal(self.lastRequested ?? self.serverURL)
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async { self?.send(.networkAvailable) }
        }
        pathMonitor.start(queue: DispatchQueue.global(qos: .utility))
    }

    deinit {
        pathMonitor.cancel()
    }

    func start() {
        load(serverURL)
        publish()
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
        webView.load(URLRequest(url: url))
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
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in
                self?.send(.timer(timer, generation: generation))
            }
        case let .checkPaint(after, generation):
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in
                guard let self else { return }
                self.webView.evaluateJavaScript(LoadWatchdog.paintCheckScript) { [weak self] result, _ in
                    let count = (result as? NSNumber)?.intValue ?? 0
                    self?.send(.paint(hasContent: count > 0, generation: generation))
                }
            }
        case .reload:
            load(lastRequested ?? serverURL)
        }
    }

    // MARK: Navigation policy

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
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
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.isForMainFrame,
           let http = navigationResponse.response as? HTTPURLResponse,
           let failure = LoadFailure.from(httpStatus: http.statusCode) {
            decisionHandler(.cancel)
            send(.failed(failure))
            return
        }
        decisionHandler(.allow)
    }

    // MARK: Load events

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        send(.started)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        send(.finished)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        send(.terminated(at: Date()))
    }

    private func fail(_ error: Error) {
        let ns = error as NSError
        if let failure = LoadFailure.from(domain: ns.domain, code: ns.code) {
            send(.failed(failure))
        }
    }

    // MARK: UI delegate

    /// target=_blank and window.open: the server's pages load here (tabs arrive in block 4),
    /// everything else goes through the policy.
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
        completionHandler: @escaping () -> Void
    ) {
        let alert = dialog(message, buttons: [.ok])
        present(alert) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = dialog(message, buttons: [.ok, .cancel])
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
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
