import AppKit
import SwiftUI

/// What the native overlay shows.
@MainActor
final class OverlayModel: ObservableObject {
    @Published var overlay: Overlay = .loading
    let lang: Lang
    let server: String
    var onRetry: () -> Void = {}
    var onOpenInBrowser: () -> Void = {}

    init(lang: Lang, server: String) {
        self.lang = lang
        self.server = server
    }
}

/// Native loading and error views drawn over the web view: they need nothing from WebKit, so the
/// window has something to show even when the page cannot draw.
struct StatusOverlayView: View {
    @ObservedObject var model: OverlayModel

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            switch model.overlay {
            case .none:
                EmptyView()
            case .loading:
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(Text(t(.loading)))
                    .accessibilityIdentifier("zs-loading")
            case let .error(failure):
                errorView(failure)
            }
        }
    }

    private func errorView(_ failure: LoadFailure) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t(.errorTitle))
                .font(.title2.weight(.semibold))
                .accessibilityIdentifier("zs-error-title")
            Text(Strings.message(for: failure, model.lang, server: model.server))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Button(t(.retry), action: model.onRetry)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("zs-retry")
                Button(t(.openInBrowser), action: model.onOpenInBrowser)
                    .accessibilityIdentifier("zs-open-browser")
            }
            .padding(.top, 4)
            Text(Strings.text(.reasonCode, model.lang, ["code": failure.code]))
                .font(.caption.monospaced())
                .foregroundStyle(.tertiary)
                .textSelection(.enabled)
                .accessibilityIdentifier("zs-error-reason")
        }
        .frame(maxWidth: 440, alignment: .leading)
        .padding(32)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("zs-error-view")
    }

    private func t(_ key: StringKey) -> String { Strings.text(key, model.lang) }
}

/// The window's content: the web view with the native overlay on top. The overlay is hidden only
/// while a page that drew is showing.
@MainActor
final class MainContentView: NSView {
    private var overlayHost: NSHostingView<StatusOverlayView>?
    #if DEBUG
    private var testLabels: [NSTextField] = []
    #endif

    func install(_ web: WebController) {
        web.webView.frame = bounds
        web.webView.autoresizingMask = [.width, .height]
        addSubview(web.webView)

        let host = NSHostingView(rootView: StatusOverlayView(model: web.model))
        host.frame = bounds
        host.autoresizingMask = [.width, .height]
        addSubview(host, positioned: .above, relativeTo: web.webView)
        overlayHost = host
        #if DEBUG
        // The test labels stay above the overlay so tests can read them at any time.
        for label in testLabels { addSubview(label, positioned: .above, relativeTo: host) }
        #endif
        web.onOverlayChange = { [weak host] overlay in
            host?.isHidden = overlay == .none
        }
    }

    #if DEBUG
    /// UI tests only (`-ZSUITest YES`): a tiny label that receives the last URL that would have
    /// opened in the browser, so tests can check the policy without launching a browser.
    func installTestRecorder() -> (URL) -> Void {
        let label = testLabel("zs-test-external", "none")
        return { [weak label] url in label?.stringValue = url.absoluteString }
    }

    /// UI tests only: what the bridge's `ready` reported (`zs-test-ready`) and how many messages
    /// it refused, by reason (`zs-test-bridge`), so tests see the native side of the checks.
    func installBridgeRecorder(_ web: WebController) {
        let ready = testLabel("zs-test-ready", "none")
        let rejected = testLabel("zs-test-bridge", "rejected end")
        var counts: [BridgeRejection: Int] = [:]
        let order: [BridgeRejection] = [.origin, .malformed, .tooLarge, .unknownCommand, .badArgs, .unavailable]
        web.onBridgeReady = { [weak ready] report in ready?.stringValue = "ready \(report.summary) end" }
        web.onBridgeReject = { [weak rejected] reason in
            counts[reason, default: 0] += 1
            let parts = order.compactMap { r in counts[r].map { "\(r.rawValue)=\($0)" } }
            rejected?.stringValue = (["rejected"] + parts + ["end"]).joined(separator: " ")
        }
    }

    /// UI tests only: the outcome of a sign-in (`zs-test-login`, a closed tag), the Dock badge
    /// (`zs-test-badge`), the last page notification and whether it would show
    /// (`zs-test-notify`). Returns the recorder of deep links (`zs-test-deeplink`).
    func installBlock3Recorders(auth: AuthController, notifier: Notifier) -> (String) -> Void {
        let login = testLabel("zs-test-login", "none")
        let badge = testLabel("zs-test-badge", "none")
        let note = testLabel("zs-test-notify", "none")
        let link = testLabel("zs-test-deeplink", "none")
        var logins = 0
        auth.onOutcome = { [weak login] tag in
            logins += 1
            login?.stringValue = "login \(logins) \(tag)"
        }
        notifier.onBadge = { [weak badge] label in badge?.stringValue = "badge \(label)" }
        notifier.onPageNotification = { [weak note] title, body, show in
            note?.stringValue = "notify \(title)|\(body ?? "-")|\(show ? "shown" : "app-active")"
        }
        var links = 0
        return { [weak link] what in
            links += 1
            link?.stringValue = "link \(links) \(what)"
        }
    }

    private func testLabel(_ id: String, _ initial: String) -> NSTextField {
        let label = NSTextField(labelWithString: initial)
        label.frame = NSRect(x: CGFloat(testLabels.count) * 5, y: 0, width: 4, height: 4)
        label.alphaValue = 0.02
        label.setAccessibilityIdentifier(id)
        addSubview(label)
        testLabels.append(label)
        return label
    }
    #endif
}
