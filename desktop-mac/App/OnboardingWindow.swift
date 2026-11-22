import AppKit
import SwiftUI

/// The first-run window (block 5 of docs/desktop-swift.md, section 4.2): what the app does,
/// notifications with the reason before the system prompt, open at login and the menu bar item
/// (both optional, login off by default), then sign in. It opens by itself once; finishing or
/// closing it counts as seen. Settings › General opens it again.
@MainActor
final class OnboardingWindowController: NSWindowController, NSWindowDelegate {
    private let model: SettingsModel
    private let state = OnboardingState()

    init(model: SettingsModel) {
        self.model = model
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 380),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "zerosoft"
        window.identifier = NSUserInterfaceItemIdentifier("zs-onboarding")
        window.setAccessibilityIdentifier("zs-onboarding")
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        super.init(window: window)
        window.contentViewController = NSHostingController(rootView: OnboardingView(model: model, state: state) { [weak self] in
            self?.window?.performClose(nil)
        })
        window.center()
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func show() {
        state.step = .welcome
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        Task {
            await model.refreshSystemState()
            await model.loadAccount()
        }
    }

    func windowWillClose(_ notification: Notification) {
        model.update { $0.onboarded = true }
    }
}

@MainActor
final class OnboardingState: ObservableObject {
    @Published var step: OnboardingStep = .welcome
}

struct OnboardingView: View {
    @ObservedObject var model: SettingsModel
    @ObservedObject var state: OnboardingState
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 6) {
                ForEach(OnboardingStep.allCases, id: \.self) { step in
                    Capsule()
                        .fill(step.rawValue <= state.step.rawValue ? Color.accentColor : Color(nsColor: .separatorColor))
                        .frame(width: 24, height: 4)
                }
            }
            .accessibilityHidden(true)
            page
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            HStack {
                if let previous = state.step.previous {
                    Button(model.t(.back)) { state.step = previous }
                        .accessibilityIdentifier("zs-ob-back")
                }
                Spacer()
                buttons
            }
        }
        .padding(28)
        .frame(width: 520, height: 380)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("zs-ob-step-\(state.step.rawValue)")
    }

    @ViewBuilder private var page: some View {
        switch state.step {
        case .welcome:
            OBTitle(model.t(.obWelcomeTitle))
            OBText(model.t(.obWelcomeBody))
        case .notifications:
            OBTitle(model.t(.obNotifTitle))
            OBText(model.t(.obNotifBody))
            if model.notifications != .notDetermined {
                Text(model.t(model.notifications == .allowed ? .notifAllowed : .notifDenied))
                    .accessibilityIdentifier("zs-ob-notif-state")
            }
        case .startup:
            OBTitle(model.t(.obStartupTitle))
            OBText(model.t(.obStartupBody))
            VStack(alignment: .leading, spacing: 10) {
                Toggle(model.t(.loginItem), isOn: Binding(get: { model.loginItem.isOn }, set: { model.setLoginItem($0) }))
                    .disabled(model.loginItem == .unavailable)
                    .accessibilityIdentifier("zs-ob-loginitem")
                if model.loginItem == .needsApproval { OBText(model.t(.loginItemApproval)) }
                Toggle(model.t(.menuBarItem), isOn: Binding(get: { model.settings.menuBarItem }, set: { on in model.update { $0.menuBarItem = on } }))
                    .accessibilityIdentifier("zs-ob-menubar")
            }
            .padding(.top, 4)
        case .done:
            OBTitle(model.t(.obDoneTitle))
            OBText(model.t(.obDoneBody))
        }
    }

    @ViewBuilder private var buttons: some View {
        switch state.step {
        case .notifications where model.notifications == .notDetermined:
            Button(model.t(.obNotLater)) { state.step = .startup }
                .accessibilityIdentifier("zs-ob-later")
            Button(model.t(.notifTurnOn)) {
                model.notificationButton()
                state.step = .startup
            }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("zs-ob-notif")
        case .done:
            if case .signedOut? = model.account {
                Button(model.t(.signIn)) {
                    model.signIn()
                    close()
                }
                .accessibilityIdentifier("zs-ob-signin")
            }
            Button(model.t(.done), action: close)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("zs-ob-done")
        default:
            Button(model.t(.next)) { if let next = state.step.next { state.step = next } }
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("zs-ob-next")
        }
    }
}

private struct OBTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.title).bold() }
}

private struct OBText: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
}
