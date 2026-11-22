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

/// One tab's content: its web view with the native overlay on top. The overlay is hidden only
/// while a page that drew is showing. A window shows the content of its tab in front; moving a
/// tab to another window moves this view (the page is not reloaded).
@MainActor
final class TabContentView: NSView {
    private var overlayHost: NSHostingView<StatusOverlayView>?

    func install(_ web: WebController) {
        web.webView.frame = bounds
        web.webView.autoresizingMask = [.width, .height]
        addSubview(web.webView)

        let host = NSHostingView(rootView: StatusOverlayView(model: web.model))
        host.frame = bounds
        host.autoresizingMask = [.width, .height]
        addSubview(host, positioned: .above, relativeTo: web.webView)
        overlayHost = host
        host.isHidden = web.model.overlay == .none
        web.onOverlayChange = { [weak host] overlay in
            host?.isHidden = overlay == .none
        }
    }
}
