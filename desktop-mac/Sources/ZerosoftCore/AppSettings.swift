import Foundation

// The app's own settings (block 5 of docs/desktop-swift.md): what the Settings window, the
// onboarding and the menu bar item read and write. Saved as settings.json next to session.json
// in the app's container. It holds switches only: never a token, an email, a title, a query or
// anything the page showed. The tab preferences stay in session.json (TabPrefs), where the Tauri
// app keeps them; the login item lives in the system (SMAppService), so neither is copied here.

public struct AppSettings: Equatable, Sendable {
    public static let fileVersion = 1
    /// Every key the file may hold. A test checks that nothing else is ever written.
    public static let keys: Set<String> = ["version", "onboarded", "menuBarItem"]

    /// The first-run window was finished or closed (it does not open again by itself).
    public var onboarded = false
    /// The item in the menu bar. On by default: it is how the app is reached with every window
    /// closed, and dictation (block 6) lives there.
    public var menuBarItem = true

    public init() {}

    /// Reads settings.json. Anything missing, of the wrong type or unreadable keeps its default.
    public static func decode(_ data: Data?) -> AppSettings {
        var s = AppSettings()
        guard let data, data.count <= 64 * 1024,
              let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return s }
        if let b = bool(raw["onboarded"]) { s.onboarded = b }
        if let b = bool(raw["menuBarItem"]) { s.menuBarItem = b }
        return s
    }

    public func encoded() -> Data {
        let root: [String: Any] = [
            "version": Self.fileVersion,
            "onboarded": onboarded,
            "menuBarItem": menuBarItem,
        ]
        return (try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])) ?? Data()
    }

    /// "onboarded=true menubar=false": closed keys and values, for the UI tests.
    public var summary: String {
        "onboarded=\(onboarded) menubar=\(menuBarItem)"
    }

    private static func bool(_ v: Any?) -> Bool? {
        guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
}

extension TabPrefs {
    /// "suspend=true minutes=30 restore=true links=tab", for the UI tests.
    public var summary: String {
        "suspend=\(suspend) minutes=\(suspendMinutes) restore=\(restore) links=\(links.rawValue)"
    }
}

/// The sections of the Settings window, in order (the Tauri window's native sections that have
/// a native side in this build; dictation, meetings, privacy and updates come with their blocks).
public enum SettingsSection: String, CaseIterable, Sendable {
    case general
    case tabs
    case notifications
    case voice
    case dictionary
    case history
    case account
}

/// SMAppService.Status reduced to what Settings shows.
public enum LoginItemState: String, Sendable {
    /// Registered and allowed: the app opens at login.
    case enabled
    /// Not registered (the default: off until the person turns it on, guideline 2.4.5(iii)).
    case disabled
    /// Registered, but the person has to allow it in System Settings › Login Items.
    case needsApproval
    /// Registering failed (for example the app runs from a disk image). Shown only after a
    /// failed attempt: a fresh install may report "not found" before its first registration.
    case unavailable

    /// The switch is on for a registered item, also while it waits for approval.
    public var isOn: Bool { self == .enabled || self == .needsApproval }
}

/// Notification permission as the system reports it, reduced.
public enum NotificationAccess: String, Sendable {
    case notDetermined
    case allowed
    case denied

    /// What the "Turn on notifications" button does. The system prompt shows only from that
    /// button (onboarding or Settings), never at launch or because something arrived: a prompt
    /// out of nowhere is the one people deny.
    public enum Action: Equatable, Sendable {
        /// Show the system prompt.
        case ask
        /// Already decided: open System Settings › Notifications to change it.
        case openSystemSettings
        /// Nothing to do.
        case none
    }

    public var buttonAction: Action {
        switch self {
        case .notDetermined: return .ask
        case .denied: return .openSystemSettings
        case .allowed: return .none
        }
    }

    /// A notification is handed to the system only when it is allowed.
    public var mayDeliver: Bool { self == .allowed }
}

/// The steps of the first-run window.
public enum OnboardingStep: Int, CaseIterable, Sendable {
    /// What the app does that the browser does not.
    case welcome
    /// Notifications, with the reason before the system prompt.
    case notifications
    /// Open at login and the menu bar item (both optional).
    case startup
    /// Sign in (skipped when already signed in) and close.
    case done

    public var next: OnboardingStep? { OnboardingStep(rawValue: rawValue + 1) }
    public var previous: OnboardingStep? { OnboardingStep(rawValue: rawValue - 1) }

    /// The first-run window opens by itself only once, and never in a UI test unless asked for.
    public static func shouldShow(_ settings: AppSettings, testing: Bool, forced: Bool) -> Bool {
        forced || (!testing && !settings.onboarded)
    }
}

/// The menu of the menu bar item, as data: the app builds the NSMenu from it.
public enum StatusMenuItem: Equatable, Sendable {
    case open
    case newTab
    case newWindow
    case unread(Int)
    case settings
    case signIn
    case signOut
    case quit
    case separator

    /// The items for a state. `signedIn` nil means unknown (not asked yet, or offline): no
    /// account item. `unread` is the badge total.
    public static func items(signedIn: Bool?, unread: Int) -> [StatusMenuItem] {
        var list: [StatusMenuItem] = [.open, .newTab, .newWindow]
        if unread > 0 { list += [.separator, .unread(unread)] }
        list += [.separator, .settings]
        switch signedIn {
        case true?: list.append(.signOut)
        case false?: list.append(.signIn)
        case nil: break
        }
        list += [.separator, .quit]
        return list
    }
}
