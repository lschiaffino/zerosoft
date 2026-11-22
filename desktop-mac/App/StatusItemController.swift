import AppKit

/// The menu bar item (block 5 of docs/desktop-swift.md, section 4.2): an `NSStatusItem` with an
/// AppKit menu built from `StatusMenuItem.items` each time it opens, so it reflects the session
/// and the count of new items. Dictation (start or stop, paste last, the saved dictations and
/// history) joined in block 6; while the microphone is open the icon changes and the tooltip
/// says so. The recording dot of meetings joins in block 7. Settings › General hides it.
@MainActor
final class StatusItemController: NSObject, NSMenuDelegate {
    private var item: NSStatusItem?
    private let lang: Lang
    /// From the badge poll: nil until the first answer.
    var signedIn: Bool?
    var unread = 0

    var onOpen: () -> Void = {}
    var onNewTab: () -> Void = {}
    var onNewWindow: () -> Void = {}
    var onSettings: () -> Void = {}
    var onSignIn: () -> Void = {}
    var onSignOut: () -> Void = {}
    /// Dictation (block 6): its state when the menu opens, and its actions.
    var dictation: () -> DictationMenuState? = { nil }
    var shortcutLabel: () -> String = { "" }
    var onDictate: () -> Void = {}
    var onPasteLast: () -> Void = {}
    var onRetry: () -> Void = {}
    var onHistory: () -> Void = {}
    private var recording = false

    init(lang: Lang) {
        self.lang = lang
    }

    var isShown: Bool { item != nil }

    func setShown(_ shown: Bool) {
        if shown, item == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let button = item.button {
                button.setAccessibilityIdentifier("zs-status-item")
            }
            let menu = NSMenu()
            menu.delegate = self
            menu.autoenablesItems = false
            item.menu = menu
            self.item = item
            drawIcon()
        } else if !shown, let item {
            NSStatusBar.system.removeStatusItem(item)
            self.item = nil
        }
    }

    /// The microphone is open for a dictation: the icon and tooltip say so (guideline 2.5.14).
    func setRecording(_ on: Bool) {
        guard on != recording else { return }
        recording = on
        drawIcon()
    }

    private func drawIcon() {
        guard let button = item?.button else { return }
        let tip = recording ? Strings.text(.statusRecording, lang) : "zerosoft"
        let image = NSImage(systemSymbolName: recording ? "mic.circle.fill" : "z.square", accessibilityDescription: tip)
        image?.isTemplate = true
        button.image = image
        button.setAccessibilityLabel(tip)
        button.toolTip = tip
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let t = { (key: StringKey) in Strings.text(key, self.lang) }
        let state = dictation()
        for entry in StatusMenuItem.items(signedIn: signedIn, unread: unread, dictation: state) {
            switch entry {
            case .separator:
                menu.addItem(.separator())
            case let .dictate(recording):
                let item = add(menu, t(recording ? .statusDictateStop : .statusDictate), "dictate", #selector(dictate(_:)))
                item.isEnabled = state?.phase != .working
            case .dictateHint:
                let item = add(menu, Strings.text(.statusDictateHint, lang, ["key": shortcutLabel()]), "dictate-hint", #selector(dictate(_:)))
                item.isEnabled = false
            case .pasteLast:
                let item = add(menu, t(.statusPasteLast), "paste-last", #selector(pasteLast(_:)))
                item.keyEquivalent = "v"
                item.keyEquivalentModifierMask = [.control, .command]
            case let .retry(n):
                add(menu, Strings.text(.statusRetry, lang, ["n": String(n)]), "retry", #selector(retry(_:)))
            case .history:
                add(menu, t(.statusHistory), "history", #selector(history(_:)))
            case .open:
                add(menu, t(.statusOpen), "open", #selector(open(_:)))
            case .newTab:
                add(menu, t(.menuNewTab), "new-tab", #selector(newTab(_:)))
            case .newWindow:
                add(menu, t(.menuNewWindow), "new-window", #selector(newWindow(_:)))
            case let .unread(n):
                // Opens the app, where the items are.
                add(menu, Strings.text(.statusUnread, lang, ["n": String(n)]), "unread", #selector(open(_:)))
            case .settings:
                add(menu, t(.menuSettings), "settings", #selector(settings(_:)), key: ",")
            case .signIn:
                add(menu, t(.statusSignIn), "sign-in", #selector(signIn(_:)))
            case .signOut:
                add(menu, t(.statusSignOut), "sign-out", #selector(signOut(_:)))
            case .quit:
                let quit = menu.addItem(withTitle: t(.menuQuit), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
                quit.setAccessibilityIdentifier("zs-status-quit")
            }
        }
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, _ id: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let entry = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        entry.target = self
        entry.setAccessibilityIdentifier("zs-status-\(id)")
        return entry
    }

    @objc private func dictate(_ sender: Any?) { onDictate() }
    @objc private func pasteLast(_ sender: Any?) { onPasteLast() }
    @objc private func retry(_ sender: Any?) { onRetry() }
    @objc private func history(_ sender: Any?) { onHistory() }

    @objc private func open(_ sender: Any?) { onOpen() }
    @objc private func newTab(_ sender: Any?) { onNewTab() }
    @objc private func newWindow(_ sender: Any?) { onNewWindow() }
    @objc private func settings(_ sender: Any?) { onSettings() }
    @objc private func signIn(_ sender: Any?) { onSignIn() }
    @objc private func signOut(_ sender: Any?) { onSignOut() }
}
