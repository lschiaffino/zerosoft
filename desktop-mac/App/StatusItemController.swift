import AppKit

/// The menu bar item (block 5 of docs/desktop-swift.md, section 4.2): an `NSStatusItem` with an
/// AppKit menu built from `StatusMenuItem.items` each time it opens, so it reflects the session
/// and the count of new items. Dictation, history and the recording dot join it in blocks 6
/// and 7. Settings › General hides it.
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

    init(lang: Lang) {
        self.lang = lang
    }

    var isShown: Bool { item != nil }

    func setShown(_ shown: Bool) {
        if shown, item == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let button = item.button {
                let image = NSImage(systemSymbolName: "z.square", accessibilityDescription: "zerosoft")
                image?.isTemplate = true
                button.image = image
                button.setAccessibilityIdentifier("zs-status-item")
                button.setAccessibilityLabel("zerosoft")
                button.toolTip = "zerosoft"
            }
            let menu = NSMenu()
            menu.delegate = self
            menu.autoenablesItems = false
            item.menu = menu
            self.item = item
        } else if !shown, let item {
            NSStatusBar.system.removeStatusItem(item)
            self.item = nil
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let t = { (key: StringKey) in Strings.text(key, self.lang) }
        for entry in StatusMenuItem.items(signedIn: signedIn, unread: unread) {
            switch entry {
            case .separator:
                menu.addItem(.separator())
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

    private func add(_ menu: NSMenu, _ title: String, _ id: String, _ action: Selector, key: String = "") {
        let entry = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        entry.target = self
        entry.setAccessibilityIdentifier("zs-status-\(id)")
    }

    @objc private func open(_ sender: Any?) { onOpen() }
    @objc private func newTab(_ sender: Any?) { onNewTab() }
    @objc private func newWindow(_ sender: Any?) { onNewWindow() }
    @objc private func settings(_ sender: Any?) { onSettings() }
    @objc private func signIn(_ sender: Any?) { onSignIn() }
    @objc private func signOut(_ sender: Any?) { onSignOut() }
}
