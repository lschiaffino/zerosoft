import AppKit
import SwiftUI

/// What the native overlay shows. Lives on the main thread.
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
final class MainContentView: NSView {
    private var overlayHost: NSHostingView<StatusOverlayView>?
    #if DEBUG
    private var testLabel: NSTextField?
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
        // The test label stays above the overlay so tests can read it at any time.
        if let label = testLabel { addSubview(label, positioned: .above, relativeTo: host) }
        #endif
        web.onOverlayChange = { [weak host] overlay in
            host?.isHidden = overlay == .none
        }
    }

    #if DEBUG
    /// UI tests only (`-ZSUITest YES`): a tiny label that receives the last URL that would have
    /// opened in the browser, so tests can check the policy without launching a browser.
    func installTestRecorder() -> (URL) -> Void {
        let label = NSTextField(labelWithString: "none")
        label.frame = NSRect(x: 0, y: 0, width: 4, height: 4)
        label.alphaValue = 0.02
        label.setAccessibilityIdentifier("zs-test-external")
        addSubview(label)
        testLabel = label
        return { [weak label] url in label?.stringValue = url.absoluteString }
    }
    #endif
}
