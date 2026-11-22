import AppKit
import ServiceManagement
import UserNotifications

/// Open at login (docs/desktop-swift.md, section 4.7): `SMAppService.mainApp`, macOS 13. Off
/// until the person turns it on in Settings or the onboarding (guideline 2.4.5(iii)); the
/// system keeps the state, so the app stores nothing of its own.
@MainActor
protocol LoginItemService: AnyObject {
    var state: LoginItemState { get }
    /// Registers or unregisters. Returns false when the system refused.
    func set(_ on: Bool) -> Bool
    func openSystemSettings()
}

@MainActor
final class SystemLoginItem: LoginItemService {
    var state: LoginItemState {
        switch SMAppService.mainApp.status {
        case .enabled: return .enabled
        case .requiresApproval: return .needsApproval
        // A fresh install that never registered can report notFound on macOS 13 and 14:
        // the switch stays usable and register() decides.
        case .notFound, .notRegistered: return .disabled
        @unknown default: return .disabled
        }
    }

    func set(_ on: Bool) -> Bool {
        do {
            if on {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            return true
        } catch {
            return false
        }
    }

    func openSystemSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }
}

/// Notification permission. The system prompt is shown only from the "Turn on notifications"
/// button (NotificationAccess.buttonAction), never at launch and never because something
/// arrived.
@MainActor
protocol NotificationPermission: AnyObject {
    func current() async -> NotificationAccess
    /// Shows the system prompt (only while it is not determined) and returns the answer.
    func request() async -> NotificationAccess
    func openSystemSettings()
}

@MainActor
final class SystemNotificationPermission: NotificationPermission {
    func current() async -> NotificationAccess {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return Self.map(settings.authorizationStatus)
    }

    func request() async -> NotificationAccess {
        let center = UNUserNotificationCenter.current()
        if await current() == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        return await current()
    }

    func openSystemSettings() {
        // The Notifications pane; System Settings shows the app's row in it.
        let id = Bundle.main.bundleIdentifier ?? "ai.zerosoft.mac"
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)") {
            NSWorkspace.shared.open(url)
        }
    }

    nonisolated static func map(_ status: UNAuthorizationStatus) -> NotificationAccess {
        switch status {
        case .authorized, .provisional: return .allowed
        case .denied: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }
}

#if DEBUG
/// UI tests only: the login item and the permission without the system (CI cannot click the
/// system prompt, and an ad hoc build must not add itself to the runner's login items). They
/// record what the app asked for so the tests can check when it asked.
@MainActor
final class FakeLoginItem: LoginItemService {
    private(set) var state: LoginItemState = .disabled
    var onChange: ((LoginItemState) -> Void)?

    init(on: Bool) {
        state = on ? .enabled : .disabled
    }

    func set(_ on: Bool) -> Bool {
        state = on ? .enabled : .disabled
        onChange?(state)
        return true
    }

    func openSystemSettings() {}
}

@MainActor
final class FakeNotificationPermission: NotificationPermission {
    private var access: NotificationAccess = .notDetermined
    private(set) var asked = 0
    var onChange: ((Int, NotificationAccess) -> Void)?

    func current() async -> NotificationAccess { access }

    func request() async -> NotificationAccess {
        asked += 1
        if access == .notDetermined { access = .allowed }
        onChange?(asked, access)
        return access
    }

    func openSystemSettings() {}
}
#endif
