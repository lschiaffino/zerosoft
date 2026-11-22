import AppKit
import SwiftUI

/// The dictation's bar at the bottom of the screen (hud.rs): a non-activating `NSPanel` above
/// other apps and on every Space, so it never takes the focus from the app the text goes to. It
/// shows while the microphone is open (with a timer and the level) and for a moment after, with
/// what happened. Public API only (guideline 2.5.1): no private transparent windows. It cannot
/// be hidden while the microphone is open (guideline 2.5.14).
@MainActor
final class DictationHUD {
    enum Phase: String {
        case recording
        case working
        case done
        case error
    }

    private let panel: NSPanel
    private let model = HUDModel()
    /// Bumped by every show: a hide scheduled for an older message does nothing.
    private var shown = 0
    /// False while the microphone is open: nothing replaces or hides the recording bar then
    /// (guideline 2.5.14).
    var mayChange: () -> Bool = { true }

    init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 340, height: 52),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isExcludedFromWindowsMenu = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.setAccessibilityIdentifier("zs-hud")
        let host = NSHostingView(rootView: HUDView(model: model))
        host.frame = NSRect(x: 0, y: 0, width: 340, height: 52)
        panel.contentView = host
    }

    /// What the HUD says now, for the UI tests ("hidden" when it is not on screen).
    var summary: String { panel.isVisible ? "\(model.phase.rawValue) \(model.label)" : "hidden" }

    func show(_ phase: Phase, _ label: String, hint: String = "", startedAt: Date? = nil) {
        shown += 1
        model.phase = phase
        model.label = label
        model.hint = hint
        model.startedAt = startedAt
        model.level = 0
        place()
        panel.orderFrontRegardless()
    }

    /// Shows a result, then hides it (1.1 s, errors 3.2 s), unless something else showed meanwhile.
    func flash(_ phase: Phase, _ label: String) {
        guard mayChange() else { return }
        show(phase, label)
        let mine = shown
        let seconds = phase == .error ? 3.2 : 1.1
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard let self, self.shown == mine, self.mayChange() else { return }
            self.hide()
        }
    }

    func level(_ value: Float) {
        model.level = Double(min(max(value, 0), 1))
    }

    func hide() {
        shown += 1
        panel.orderOut(nil)
    }

    /// Bottom center of the screen with the mouse (where the person is looking).
    private func place() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        guard let area = screen?.visibleFrame else { return }
        let size = panel.frame.size
        panel.setFrameOrigin(NSPoint(x: area.midX - size.width / 2, y: area.minY + 72))
    }
}

@MainActor
private final class HUDModel: ObservableObject {
    @Published var phase: DictationHUD.Phase = .recording
    @Published var label = ""
    @Published var hint = ""
    @Published var startedAt: Date?
    @Published var level: Double = 0
}

private struct HUDView: View {
    @ObservedObject var model: HUDModel

    var body: some View {
        HStack(spacing: 10) {
            icon.frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(model.label).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                if !model.hint.isEmpty {
                    Text(model.hint).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if model.phase == .recording {
                Rectangle()
                    .fill(Color.accentColor.opacity(0.25))
                    .frame(width: 44, height: 4)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Color.accentColor).frame(width: max(4, 44 * model.level), height: 4)
                    }
                    .accessibilityHidden(true)
                if let start = model.startedAt {
                    Text(timerInterval: start ... start.addingTimeInterval(DictationMachine.maxSeconds), countsDown: false)
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 38, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(width: 340, height: 52)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(nsColor: .separatorColor), lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.hint.isEmpty ? model.label : "\(model.label). \(model.hint)")
        .accessibilityIdentifier("zs-hud-content")
    }

    @ViewBuilder private var icon: some View {
        switch model.phase {
        case .recording:
            Circle().fill(Color.red).frame(width: 10, height: 10)
        case .working:
            ProgressView().controlSize(.small)
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
    }
}
